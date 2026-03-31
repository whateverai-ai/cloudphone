/**
 * Agent tool definitions.
 *
 * Each tool must include:
 *   - name:        snake_case tool name
 *   - description: human-readable description for the AI agent
 *   - parameters:  JSON Schema for the input payload
 *   - execute:     execution handler that returns MCP content items
 *
 * Docs: https://docs.openclaw.ai/plugins/agent-tools
 */

/** Plugin config type, aligned with openclaw.plugin.json configSchema. */
export interface CloudphonePluginConfig {
  baseUrl?: string;
  apikey?: string;
  timeout?: number;
}

/** MCP content items (text | image), following MCP + OpenClaw conventions. */
export type McpContentItem =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

/** MCP-style tool return value. */
export interface McpToolResult {
  content: McpContentItem[];
}

/** Tool definition shape, aligned with OpenClaw api.registerTool. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  optional?: boolean;
  execute: (id: string, params: Record<string, unknown>) => Promise<McpToolResult>;
}

let runtimeConfig: CloudphonePluginConfig = {};

/** Inject runtime config during plugin registration. */
export function setConfig(config: CloudphonePluginConfig): void {
  runtimeConfig = config;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function toJsonText(value: unknown): McpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function isSuccessfulApiResponse(body: Record<string, unknown>): boolean {
  if (body.success === true) {
    return true;
  }

  return body.code === 1 || body.code === "1" || body.code === 200 || body.code === "200";
}

function getApiErrorMessage(body: Record<string, unknown>): string {
  if (typeof body.message === "string" && body.message.trim()) {
    return body.message;
  }

  if (typeof body.data === "string" && body.data.trim()) {
    return body.data;
  }

  return "Unknown error";
}

const LOG_PREFIX = "[cloudphone]";

function summarizeTextForLog(value: string, limit = 120): string {
  if (!value) return "";
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

/** Safe for logs: origin + pathname only (no query — pre-signed URLs must not be logged in full). */
function safeUrlForLog(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "(invalid url)";
  }
}

function summarizePayloadForLog(payload: Record<string, unknown> | undefined): string {
  if (!payload || Object.keys(payload).length === 0) {
    return "{}";
  }
  const sensitive = new Set([
    "apikey",
    "api_key",
    "token",
    "password",
    "authorization",
    "secret",
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (sensitive.has(k.toLowerCase())) {
      out[k] = "(redacted)";
      continue;
    }
    if (typeof v === "string" && v.length > 120) {
      out[k] = `${v.slice(0, 120)}…`;
    } else {
      out[k] = v;
    }
  }
  return JSON.stringify(out);
}

async function apiRequest(
  method: "GET" | "POST",
  path: string,
  payload?: Record<string, unknown>,
  timeoutMs?: number
): Promise<McpToolResult> {
  const pathForLog = path.startsWith("/") ? path : `/${path}`;
  const baseUrl = normalizeBaseUrl(runtimeConfig.baseUrl ?? "https://ai.suqi.tech/ai");
  const timeout = timeoutMs ?? runtimeConfig.timeout ?? 5000;
  const url = `${baseUrl}/openapi/v1${pathForLog}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (runtimeConfig.apikey) {
    headers.Authorization = runtimeConfig.apikey;
  }

  const started = Date.now();
  console.log(
    `${LOG_PREFIX} apiRequest ${method} ${pathForLog} timeout=${timeout}ms payload=${summarizePayloadForLog(payload)}`
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : undefined;
    if (controller) {
      timer = setTimeout(() => controller.abort(), timeout);
    }

    const response = await fetch(url, {
      method,
      headers,
      ...(method === "POST" ? { body: JSON.stringify(payload ?? {}) } : {}),
      signal: controller?.signal,
    });

    const elapsed = Date.now() - started;
    console.log(
      `${LOG_PREFIX} apiRequest ${method} ${pathForLog} httpStatus=${response.status} ${elapsed}ms`
    );

    if (!response.ok) {
      console.error(
        `${LOG_PREFIX} apiRequest ${method} ${pathForLog} failed: ${response.status} ${response.statusText}`
      );
      return toJsonText({
        ok: false,
        httpStatus: response.status,
        message: `HTTP error: ${response.status} ${response.statusText}`,
      });
    }

    const body = (await response.json()) as Record<string, unknown>;

    if (typeof body === "object" && body !== null && ("code" in body || "success" in body)) {
      if (isSuccessfulApiResponse(body)) {
        return toJsonText(body.data ?? body);
      }
      return toJsonText({
        ok: false,
        code: body.code,
        message: getApiErrorMessage(body),
      });
    }

    return toJsonText(body);
  } catch (err) {
    const elapsed = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `${LOG_PREFIX} apiRequest ${method} ${pathForLog} error after ${elapsed}ms: ${message}`
    );
    return toJsonText({
      ok: false,
      message: `Request failed: ${message}`,
    });
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

// ─── Tool definitions ─────────────────────────────────────────────────────

const getUserProfileTool: ToolDefinition = {
  name: "cloudphone_get_user_profile",
  description: "Get the current user's basic profile information.",
  parameters: {
    type: "object",
    properties: {},
  },
  execute: async () => apiRequest("GET", "/user/profile"),
};

const listDevicesTool: ToolDefinition = {
  name: "cloudphone_list_devices",
  description: "List the current user's cloud phone devices with pagination and filters.",
  parameters: {
    type: "object",
    properties: {
      keyword: {
        type: "string",
        description: "Keyword to match device name or device ID",
      },
      status: {
        type: "string",
        enum: ["online", "offline"],
        description: "Device status filter",
      },
      page: {
        type: "integer",
        description: "Page number, default is 1",
      },
      size: {
        type: "integer",
        description: "Page size, default is 20",
      },
    },
  },
  execute: async (_id, params) => apiRequest("POST", "/devices/list", params),
};

const getDeviceInfoTool: ToolDefinition = {
  name: "cloudphone_get_device_info",
  description: "Get details for a specific cloud phone device.",
  parameters: {
    type: "object",
    properties: {
      user_device_id: {
        type: "number",
        description: "User device ID",
      },
    },
    required: ["user_device_id"],
  },
  execute: async (_id, params) => apiRequest("POST", "/devices/info", params),
};

// ─── Agent task execution ─────────────────────────────────────────────────

/**
 * Submit a natural-language instruction to the backend Agent.
 * The backend handles LLM interpretation, task dispatch, and cloud phone automation.
 * Returns a taskId that can be polled via cloudphone_task_result.
 */
const executeAgentTaskTool: ToolDefinition = {
  name: "cloudphone_execute",
  description:
    "Submit a natural language instruction to the cloud phone AI Agent for execution. " +
    "The backend parses the instruction, dispatches the task to the target device, and returns a taskId immediately. " +
    "Call cloudphone_task_result with the returned taskId to stream the thinking process and final result. " +
    "device_id (recommended) or user_device_id must be provided to identify the target device. " +
    "If neither is given, the backend will use the default device bound to the current user.\n\n" +
    "IMPORTANT constraints — strictly follow these rules:\n" +
    "1. ONLY submit tasks that the user has explicitly requested. Do NOT add extra steps or autonomous follow-up actions on your own initiative.\n" +
    "2. NEVER include screenshot or screen-capture instructions (e.g. '截图', '截屏', 'take a screenshot'). The backend agent cannot return image data through this channel; such instructions waste time and return no useful result.\n" +
    "3. NEVER submit a new task for the same request while a previous cloudphone_execute call is still being processed by cloudphone_task_result.\n" +
    "4. If a task fails or returns an error, you may retry cloudphone_execute with a clearer or revised instruction. Retry at most 2 times for the same user request before reporting failure.",
  parameters: {
    type: "object",
    properties: {
      instruction: {
        type: "string",
        description: "Natural language instruction describing the automation task, e.g. '打开微信搜索公众号OpenClaw' or 'Open WeChat and search for the OpenClaw account'.",
      },
      device_id: {
        type: "string",
        description: "Device unique ID (recommended). Takes priority over user_device_id when both are provided.",
      },
      user_device_id: {
        type: "number",
        description: "User device ID (compatibility field). Use device_id when available.",
      },
      session_id: {
        type: "string",
        description: "Optional session ID. When set, the backend will persist the streaming thinking process for this session.",
      },
      lang: {
        type: "string",
        enum: ["cn", "en"],
        description: "Language hint for the task instruction. Defaults to 'cn'.",
      },
    },
    required: ["instruction"],
  },
  execute: async (_id, params) => {
    const baseUrl = normalizeBaseUrl(runtimeConfig.baseUrl ?? "https://ai.suqi.tech/ai");
    const url = `${baseUrl}/openapi/v1/devices/execute`;
    const timeout = runtimeConfig.timeout ?? 30000;

    const body: Record<string, unknown> = {
      instruction: params.instruction,
    };
    if (params.device_id !== undefined) body.device_id = params.device_id;
    if (params.user_device_id !== undefined) body.user_device_id = params.user_device_id;
    if (params.session_id !== undefined) body.session_id = params.session_id;
    if (params.lang !== undefined) body.lang = params.lang;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (runtimeConfig.apikey) {
      headers.Authorization = runtimeConfig.apikey;
    }

    const started = Date.now();
    console.log(
      `${LOG_PREFIX} cloudphone_execute start device_id=${String(params.device_id ?? "")} instruction=${summarizeTextForLog(String(params.instruction ?? ""), 80)}`
    );

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller =
        typeof AbortController !== "undefined" ? new AbortController() : undefined;
      if (controller) {
        timer = setTimeout(() => controller.abort(), timeout);
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller?.signal,
      });

      const elapsed = Date.now() - started;
      console.log(
        `${LOG_PREFIX} cloudphone_execute httpStatus=${response.status} ${elapsed}ms`
      );

      if (!response.ok) {
        return toJsonText({
          ok: false,
          httpStatus: response.status,
          message: `HTTP error: ${response.status} ${response.statusText}`,
        });
      }

      const resp = (await response.json()) as Record<string, unknown>;

      if (resp.status === "fail") {
        return toJsonText({
          ok: false,
          message: String(resp.message ?? "Task execution failed"),
        });
      }

      return toJsonText({
        ok: true,
        task_id: resp.taskId,
        session_id: resp.sessionId,
        status: resp.status,
        message: resp.message,
      });
    } catch (err) {
      const elapsed = Date.now() - started;
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `${LOG_PREFIX} cloudphone_execute error after ${elapsed}ms: ${message}`
      );
      return toJsonText({ ok: false, message: `Request failed: ${message}` });
    } finally {
      if (timer) clearTimeout(timer);
    }
  },
};

/** Parsed SSE event from the task result stream. */
interface SseEvent {
  event: string;
  data: string;
}

/**
 * Parse raw SSE text into event objects.
 *
 * Supports two formats:
 *   - Standard SSE:  "event: xxx\ndata: {...}"
 *   - Backend format: "data: {\"event\":\"xxx\",\"data\":{...}}"
 *     (event type is embedded inside the JSON data payload)
 */
function parseSseChunk(chunk: string): SseEvent[] {
  const events: SseEvent[] = [];
  const blocks = chunk.split(/\n\n/);
  for (const block of blocks) {
    const lines = block.split(/\n/);
    let sseEventField = "";
    let rawData = "";
    for (const line of lines) {
      if (line.startsWith("event:")) {
        sseEventField = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        rawData += line.slice(5);
      }
    }
    if (!rawData) continue;

    // When no standard event: field, try to extract event from the JSON payload.
    // Backend format: data:{"event":"task_result","data":{...}}
    let event = sseEventField || "message";
    let data = rawData;
    if (!sseEventField) {
      try {
        const parsed = JSON.parse(rawData) as Record<string, unknown>;
        if (parsed && typeof parsed.event === "string") {
          event = parsed.event;
          data =
            typeof parsed.data === "string"
              ? parsed.data
              : JSON.stringify(parsed.data ?? {});
        }
      } catch {
        // keep rawData as-is
      }
    }
    events.push({ event, data });
  }
  return events;
}

/**
 * Consume a single SSE stream attempt for the given task.
 * Returns structured result along with a flag indicating whether a retry is appropriate.
 */
async function consumeSseStream(
  url: string,
  headers: Record<string, string>,
  taskId: number,
  attemptTimeoutMs: number,
  priorThinking: string[]
): Promise<{
  thinking: string[];
  taskResult: unknown;
  finalStatus: string;
  errorMessage: string | undefined;
  shouldRetry: boolean;
}> {
  const thinkingLines: string[] = [...priorThinking];
  let taskResult: unknown = null;
  let finalStatus = "unknown";
  let errorMessage: string | undefined;
  let shouldRetry = false;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : undefined;
    if (controller) {
      timer = setTimeout(() => {
        console.warn(
          `${LOG_PREFIX} cloudphone_task_result attempt timeout after ${attemptTimeoutMs}ms task_id=${taskId}`
        );
        controller.abort();
      }, attemptTimeoutMs);
    }

    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller?.signal,
    });

    if (!response.ok) {
      return {
        thinking: thinkingLines,
        taskResult,
        finalStatus: "error",
        errorMessage: `HTTP error: ${response.status} ${response.statusText}`,
        shouldRetry: response.status >= 500,
      };
    }

    if (!response.body) {
      return {
        thinking: thinkingLines,
        taskResult,
        finalStatus: "error",
        errorMessage: "Response body is null",
        shouldRetry: false,
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let done = false;

    while (!done) {
      const { value, done: readerDone } = await reader.read();
      if (readerDone) {
        done = true;
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE blocks (separated by double newline)
      const lastDoubleNewline = buffer.lastIndexOf("\n\n");
      if (lastDoubleNewline !== -1) {
        const toProcess = buffer.slice(0, lastDoubleNewline + 2);
        buffer = buffer.slice(lastDoubleNewline + 2);

        const events = parseSseChunk(toProcess);
        for (const evt of events) {
          const evtName = evt.event;
          const evtData = evt.data;

          console.log(
            `${LOG_PREFIX} cloudphone_task_result event=${evtName} data=${evtData.slice(0, 120)} task_id=${taskId}`
          );

          if (evtName === "agent_thinking") {
            try {
              const parsed = JSON.parse(evtData) as Record<string, unknown>;
              // agent_thinking may carry an error sub-event
              if (parsed.event_type === "error" && parsed.error) {
                const errObj = parsed.error as Record<string, unknown>;
                errorMessage = String(errObj.message ?? parsed.event_type ?? "Agent error");
                finalStatus = "error";
                done = true;
                break;
              }
              const content = String(
                parsed.content ?? parsed.message ?? parsed.data ?? evtData
              );
              thinkingLines.push(content);
            } catch {
              thinkingLines.push(evtData);
            }
          } else if (evtName === "task_result") {
            try {
              const parsed = JSON.parse(evtData) as Record<string, unknown>;
              taskResult = parsed;
              finalStatus =
                typeof parsed.status === "string" ? parsed.status : "success";
              // Append the agent's final message as a thinking summary
              if (parsed.message && typeof parsed.message === "string") {
                thinkingLines.push(parsed.message);
              }
            } catch {
              taskResult = evtData;
              finalStatus = "success";
            }
          } else if (evtName === "done") {
            finalStatus = finalStatus === "success" ? "success" : "done";
            done = true;
            break;
          } else if (evtName === "error") {
            try {
              const parsed = JSON.parse(evtData) as Record<string, unknown>;
              errorMessage = String(parsed.message ?? parsed.error ?? evtData);
            } catch {
              errorMessage = evtData;
            }
            finalStatus = "error";
            done = true;
            break;
          }
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isNetworkOrTimeout =
      message.includes("abort") ||
      message.toLowerCase().includes("timeout") ||
      message.toLowerCase().includes("network") ||
      message.toLowerCase().includes("econnreset") ||
      message.toLowerCase().includes("econnrefused");

    console.error(
      `${LOG_PREFIX} cloudphone_task_result stream error task_id=${taskId}: ${message}`
    );

    if (isNetworkOrTimeout) {
      finalStatus = "timeout";
      errorMessage = `Stream interrupted: ${message}`;
      shouldRetry = true;
    } else {
      finalStatus = "error";
      errorMessage = `Stream error: ${message}`;
    }
  } finally {
    if (timer) clearTimeout(timer);
  }

  return { thinking: thinkingLines, taskResult, finalStatus, errorMessage, shouldRetry };
}

/**
 * Consume the SSE task result stream and aggregate thinking + final result.
 * Automatically retries up to 2 times on timeout or transient network errors.
 */
const getTaskResultTool: ToolDefinition = {
  name: "cloudphone_task_result",
  description:
    "Stream the execution progress and final result of a cloud phone Agent task. " +
    "Call this after cloudphone_execute with the returned task_id. " +
    "The tool subscribes to the backend SSE stream and returns aggregated agent thinking and the final task result. " +
    "The stream ends when a 'done' or 'error' event is received, or when timeout_ms elapses. " +
    "On transient network errors or timeouts, the tool automatically retries up to 2 times.",
  parameters: {
    type: "object",
    properties: {
      task_id: {
        type: "number",
        description: "Task ID returned by cloudphone_execute.",
      },
      timeout_ms: {
        type: "number",
        description: "Maximum time to wait for the stream to complete in milliseconds. Default is 300000 (5 minutes).",
      },
    },
    required: ["task_id"],
  },
  execute: async (_id, params) => {
    const taskId = Number(params.task_id);
    const totalTimeoutMs = Number(params.timeout_ms ?? 300000);
    const baseUrl = normalizeBaseUrl(runtimeConfig.baseUrl ?? "https://ai.suqi.tech/ai");
    const url = `${baseUrl}/openapi/v1/devices/result/${taskId}`;

    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    };
    if (runtimeConfig.apikey) {
      headers.Authorization = runtimeConfig.apikey;
    }

    const started = Date.now();
    const maxAttempts = 3;
    const retryDelayMs = 2000;

    console.log(
      `${LOG_PREFIX} cloudphone_task_result start task_id=${taskId} timeout=${totalTimeoutMs}ms maxAttempts=${maxAttempts}`
    );

    let accumulatedThinking: string[] = [];
    let lastResult: {
      thinking: string[];
      taskResult: unknown;
      finalStatus: string;
      errorMessage: string | undefined;
      shouldRetry: boolean;
    } | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const elapsed = Date.now() - started;
      const remaining = totalTimeoutMs - elapsed;
      if (remaining <= 0) {
        console.warn(
          `${LOG_PREFIX} cloudphone_task_result total timeout reached before attempt ${attempt} task_id=${taskId}`
        );
        break;
      }

      if (attempt > 1) {
        console.log(
          `${LOG_PREFIX} cloudphone_task_result retry attempt=${attempt} task_id=${taskId} elapsed=${elapsed}ms`
        );
        await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
      }

      // Give each attempt a fair slice of the remaining time (at least 30s)
      const attemptTimeout = Math.max(30000, Math.min(remaining, totalTimeoutMs));

      lastResult = await consumeSseStream(
        url,
        headers,
        taskId,
        attemptTimeout,
        accumulatedThinking
      );

      accumulatedThinking = lastResult.thinking;

      const totalElapsed = Date.now() - started;
      console.log(
        `${LOG_PREFIX} cloudphone_task_result attempt=${attempt} status=${lastResult.finalStatus} elapsed=${totalElapsed}ms thinking_count=${lastResult.thinking.length}`
      );

      // Terminal states — no retry needed
      if (
        lastResult.finalStatus === "success" ||
        lastResult.finalStatus === "done" ||
        lastResult.finalStatus === "error"
      ) {
        break;
      }

      // Only retry on transient failures
      if (!lastResult.shouldRetry) {
        break;
      }
    }

    if (!lastResult) {
      return toJsonText({
        ok: false,
        task_id: taskId,
        status: "timeout",
        message: `Total timeout of ${totalTimeoutMs}ms elapsed before stream started`,
        thinking: accumulatedThinking,
        result: null,
      });
    }

    const { finalStatus, errorMessage, taskResult } = lastResult;
    const totalElapsed = Date.now() - started;

    console.log(
      `${LOG_PREFIX} cloudphone_task_result done task_id=${taskId} status=${finalStatus} total_elapsed=${totalElapsed}ms thinking_count=${accumulatedThinking.length}`
    );

    if (finalStatus === "error") {
      return toJsonText({
        ok: false,
        task_id: taskId,
        status: "error",
        message: errorMessage ?? "Task failed with error",
        thinking: accumulatedThinking,
        result: taskResult,
      });
    }

    if (finalStatus === "timeout") {
      return toJsonText({
        ok: false,
        task_id: taskId,
        status: "timeout",
        message: `Stream timed out after ${totalElapsed}ms (${maxAttempts} attempts)`,
        thinking: accumulatedThinking,
        result: taskResult,
      });
    }

    return toJsonText({
      ok: true,
      task_id: taskId,
      status: finalStatus,
      thinking: accumulatedThinking,
      result: taskResult,
    });
  },
};

/** Export all tool definitions. */
export const tools: ToolDefinition[] = [
  getUserProfileTool,
  listDevicesTool,
  getDeviceInfoTool,
  executeAgentTaskTool,
  getTaskResultTool,
];
