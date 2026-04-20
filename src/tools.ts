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
  llmApiKey?: string;
  llmBaseUrl?: string;
  // 云手机 Agent 单任务最大步骤数，未在调用入参中传入 max_steps 时使用
  maxSteps?: number;
}

// max_steps 允许的取值范围（与 openclaw.plugin.json configSchema 保持一致）
const MAX_STEPS_MIN = 1;
const MAX_STEPS_MAX = 200;
// 调用方与插件配置均未提供 max_steps 时使用的硬编码兜底值
const MAX_STEPS_DEFAULT = 50;

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

interface InFlightTaskRecord {
  agentKey: string;
  taskId: number | null;
  reservedAt: number;
}

interface TaskPollingState {
  taskId: number;
  thinkingHistory: string[];
  latestResult: unknown;
  latestStatus: string;
}

const inFlightByAgentKey = new Map<string, InFlightTaskRecord>();
const agentKeyByTaskId = new Map<number, string>();
const taskPollingStateByTaskId = new Map<number, TaskPollingState>();

/** Inject runtime config during plugin registration. */
export function setConfig(config: CloudphonePluginConfig): void {
  runtimeConfig = config;
}

function getAgentKeyFromParams(params: Record<string, unknown>): string {
  if (typeof params.session_id === "string" && params.session_id.trim()) {
    return `session:${params.session_id.trim()}`;
  }
  if (typeof params.device_id === "string" && params.device_id.trim()) {
    return `device:${params.device_id.trim()}`;
  }
  if (params.user_device_id !== undefined && params.user_device_id !== null) {
    return `user_device:${String(params.user_device_id)}`;
  }
  return "default-agent";
}

function normalizeTaskId(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

/**
 * 规范化 max_steps 取值：
 * - 将任意输入转为整数并裁剪到 [MAX_STEPS_MIN, MAX_STEPS_MAX] 区间
 * - 非法值（非有限数、NaN、字符串无法解析等）返回 null，交由上层继续 fallback
 */
function normalizeMaxSteps(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const floored = Math.floor(parsed);
  if (floored < MAX_STEPS_MIN) {
    return MAX_STEPS_MIN;
  }
  if (floored > MAX_STEPS_MAX) {
    return MAX_STEPS_MAX;
  }
  return floored;
}

/**
 * 按优先级解析最终生效的 max_steps：调用入参 > 插件配置 > 硬编码默认值 50。
 * 每一层若不合法都会自动下沉，确保最终返回值始终在合法区间内。
 */
function resolveEffectiveMaxSteps(paramValue: unknown): number {
  const fromParams = normalizeMaxSteps(paramValue);
  if (fromParams !== null) {
    return fromParams;
  }
  const fromConfig = normalizeMaxSteps(runtimeConfig.maxSteps);
  if (fromConfig !== null) {
    return fromConfig;
  }
  return MAX_STEPS_DEFAULT;
}

function releaseInFlightByTask(taskId: number): void {
  const agentKey = agentKeyByTaskId.get(taskId);
  if (!agentKey) {
    taskPollingStateByTaskId.delete(taskId);
    return;
  }
  const current = inFlightByAgentKey.get(agentKey);
  if (current?.taskId === taskId) {
    inFlightByAgentKey.delete(agentKey);
  }
  agentKeyByTaskId.delete(taskId);
  taskPollingStateByTaskId.delete(taskId);
}

function isTerminalTaskStatus(status: string): boolean {
  return status === "success" || status === "done" || status === "error" || status === "timeout";
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
  const baseUrl = normalizeBaseUrl(runtimeConfig.baseUrl ?? "https://whateverai.ai/ai");
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

const getDeviceScreenshotUrlTool: ToolDefinition = {
  name: "cloudphone_get_device_screenshot_url",
  description:
    "Get the latest screenshot URL for a specific cloud phone device by device_id. " +
    "This tool is enabled by default. Invoke it ONLY when the user explicitly requests a screenshot URL. " +
    "Do NOT call this tool autonomously for non-explicit requests.",
  parameters: {
    type: "object",
    properties: {
      device_id: {
        type: "string",
        description: "Device unique ID",
      },
    },
    required: ["device_id"],
  },
  execute: async (_id, params) => {
    const deviceId = String(params.device_id ?? "").trim();
    if (!deviceId) {
      return toJsonText({
        ok: false,
        code: "INVALID_PARAMS",
        message: "device_id is required",
      });
    }

    const baseUrl = normalizeBaseUrl(runtimeConfig.baseUrl ?? "https://whateverai.ai/ai");
    const url = `${baseUrl}/openapi/v1/devices/snapshot`;
    const timeout = runtimeConfig.timeout ?? 5000;
    const payload = {
      device_id: deviceId,
      type: "screenshot",
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (runtimeConfig.apikey) {
      headers.Authorization = runtimeConfig.apikey;
    }

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
        body: JSON.stringify(payload),
        signal: controller?.signal,
      });

      if (!response.ok) {
        return toJsonText({
          ok: false,
          code: "HTTP_ERROR",
          http_status: response.status,
          message: `HTTP error: ${response.status} ${response.statusText}`,
        });
      }

      const body = (await response.json()) as Record<string, unknown>;
      if (!isSuccessfulApiResponse(body)) {
        return toJsonText({
          ok: false,
          code: "UPSTREAM_ERROR",
          upstream_code: body.code ?? null,
          message: getApiErrorMessage(body),
          upstream: body,
        });
      }

      const data =
        body && typeof body.data === "object" && body.data !== null
          ? (body.data as Record<string, unknown>)
          : body;
      const screenshotUrl = typeof data.screenshot_url === "string" ? data.screenshot_url : "";
      if (!screenshotUrl) {
        return toJsonText({
          ok: false,
          code: "INVALID_UPSTREAM_PAYLOAD",
          message: "Upstream response missing screenshot_url",
          upstream: data,
        });
      }

      console.log(
        `${LOG_PREFIX} screenshot_url ready device_id=${deviceId} safe_url=${safeUrlForLog(screenshotUrl)}`
      );

      return toJsonText({
        ok: true,
        device_id: deviceId,
        screenshot_url: screenshotUrl,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return toJsonText({
        ok: false,
        code: "REQUEST_FAILED",
        message: `Request failed: ${message}`,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  },
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
    "Prefer cloudphone_execute_and_wait to auto-chain the first cloudphone_task_result polling call. " +
    "Otherwise call cloudphone_task_result with the returned taskId to stream progress and final result. " +
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
      api_key: {
        type: "string",
        description: "Optional LLM provider API key for the cloud phone automation agent. Overrides the plugin-level llmApiKey config when provided.",
      },
      base_url: {
        type: "string",
        description: "Optional LLM provider base URL for the cloud phone automation agent. Overrides the plugin-level llmBaseUrl config when provided.",
      },
      max_steps: {
        type: "integer",
        minimum: MAX_STEPS_MIN,
        maximum: MAX_STEPS_MAX,
        description:
          "Maximum number of steps the cloud phone Agent may execute for this task (range 1-200). " +
          "Use a larger value for complex multi-step flows (e.g. open app → search → tap result → perform action), " +
          "and a smaller value for simple single-step tasks to fail fast. " +
          "When omitted, the plugin-level maxSteps config is used, falling back to 50.",
      },
    },
    required: ["instruction"],
  },
  execute: async (_id, params) => {
    const agentKey = getAgentKeyFromParams(params);
    const inFlight = inFlightByAgentKey.get(agentKey);
    if (inFlight) {
      return toJsonText({
        ok: false,
        code: "AGENT_BUSY",
        status: "running",
        message:
          "Agent already has an in-flight task. Call cloudphone_task_result and wait for terminal status before executing a new task.",
        agent_id: agentKey,
        blocking_task_id: inFlight.taskId,
      });
    }

    const reservation: InFlightTaskRecord = {
      agentKey,
      taskId: null,
      reservedAt: Date.now(),
    };
    inFlightByAgentKey.set(agentKey, reservation);

    const baseUrl = normalizeBaseUrl(runtimeConfig.baseUrl ?? "https://whateverai.ai/ai");
    const url = `${baseUrl}/openapi/v1/devices/execute`;
    const timeout = runtimeConfig.timeout ?? 30000;

    const body: Record<string, unknown> = {
      instruction: params.instruction,
    };
    if (params.device_id !== undefined) body.device_id = params.device_id;
    if (params.user_device_id !== undefined) body.user_device_id = params.user_device_id;
    if (params.session_id !== undefined) body.session_id = params.session_id;
    if (params.lang !== undefined) body.lang = params.lang;
    const effectiveLlmApiKey = (params.api_key as string | undefined) ?? runtimeConfig.llmApiKey;
    const effectiveLlmBaseUrl = (params.base_url as string | undefined) ?? runtimeConfig.llmBaseUrl;
    if (effectiveLlmApiKey) body.api_key = effectiveLlmApiKey;
    if (effectiveLlmBaseUrl) body.base_url = effectiveLlmBaseUrl;
    // max_steps 始终透传：按"调用入参 > 插件配置 > 默认 50"的优先级解析
    const effectiveMaxSteps = resolveEffectiveMaxSteps(params.max_steps);
    body.max_steps = effectiveMaxSteps;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (runtimeConfig.apikey) {
      headers.Authorization = runtimeConfig.apikey;
    }

    const started = Date.now();
    console.log(
      `${LOG_PREFIX} cloudphone_execute start device_id=${String(params.device_id ?? "")} max_steps=${effectiveMaxSteps} instruction=${summarizeTextForLog(String(params.instruction ?? ""), 80)}`
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
        inFlightByAgentKey.delete(agentKey);
        return toJsonText({
          ok: false,
          httpStatus: response.status,
          message: `HTTP error: ${response.status} ${response.statusText}`,
        });
      }

      const resp = (await response.json()) as Record<string, unknown>;

      if (resp.status === "fail") {
        inFlightByAgentKey.delete(agentKey);
        return toJsonText({
          ok: false,
          message: String(resp.message ?? "Task execution failed"),
        });
      }

      const normalizedTaskId = normalizeTaskId(resp.taskId);
      if (!normalizedTaskId) {
        inFlightByAgentKey.delete(agentKey);
        return toJsonText({
          ok: false,
          code: "INVALID_EXECUTE_RESPONSE",
          message: "Task submitted but backend response did not include a valid taskId",
        });
      }

      reservation.taskId = normalizedTaskId;
      agentKeyByTaskId.set(normalizedTaskId, agentKey);

      return toJsonText({
        ok: true,
        task_id: normalizedTaskId,
        session_id: resp.sessionId,
        status: resp.status,
        message: resp.message,
        agent_id: agentKey,
      });
    } catch (err) {
      inFlightByAgentKey.delete(agentKey);
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
  attemptTimeoutMs: number
): Promise<{
  thinkingDelta: string[];
  taskResult: unknown;
  finalStatus: string;
  errorMessage: string | undefined;
  pollWindowElapsed: boolean;
}> {
  const thinkingLines: string[] = [];
  let taskResult: unknown = null;
  let finalStatus = "running";
  let errorMessage: string | undefined;
  let pollWindowElapsed = false;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedByWindow = false;
  try {
    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : undefined;
    if (controller) {
      timer = setTimeout(() => {
        timedByWindow = true;
        console.warn(
          `${LOG_PREFIX} cloudphone_task_result poll window elapsed after ${attemptTimeoutMs}ms task_id=${taskId}`
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
        thinkingDelta: thinkingLines,
        taskResult,
        finalStatus: "error",
        errorMessage: `HTTP error: ${response.status} ${response.statusText}`,
        pollWindowElapsed: false,
      };
    }

    if (!response.body) {
      return {
        thinkingDelta: thinkingLines,
        taskResult,
        finalStatus: "error",
        errorMessage: "Response body is null",
        pollWindowElapsed: false,
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
    const messageLower = message.toLowerCase();
    const isNetworkError =
      !timedByWindow &&
      (message.includes("abort") ||
        messageLower.includes("timeout") ||
        messageLower.includes("network") ||
        messageLower.includes("econnreset") ||
        messageLower.includes("econnrefused"));

    if (timedByWindow) {
      pollWindowElapsed = true;
      finalStatus = "running";
    } else {
      console.error(
        `${LOG_PREFIX} cloudphone_task_result stream error task_id=${taskId}: ${message}`
      );

      if (isNetworkError) {
        finalStatus = "timeout";
        errorMessage = `Stream interrupted: ${message}`;
      } else {
        finalStatus = "error";
        errorMessage = `Stream error: ${message}`;
      }
    }
  } finally {
    if (timer) clearTimeout(timer);
  }

  return { thinkingDelta: thinkingLines, taskResult, finalStatus, errorMessage, pollWindowElapsed };
}

/**
 * Consume one 10s SSE polling window and return delta updates.
 */
const getTaskResultTool: ToolDefinition = {
  name: "cloudphone_task_result",
  description:
    "Stream the execution progress and final result of a cloud phone Agent task. " +
    "Call this after cloudphone_execute with the returned task_id. " +
    "The tool subscribes to the backend SSE stream for a 10-second polling window and returns the thinking delta for that window. " +
    "Keep calling this tool every ~10 seconds until status reaches terminal: success, done, or error.",
  parameters: {
    type: "object",
    properties: {
      task_id: {
        type: "number",
        description: "Task ID returned by cloudphone_execute.",
      },
    },
    required: ["task_id"],
  },
  execute: async (_id, params) => {
    const taskId = Number(params.task_id);
    const normalizedTaskId = normalizeTaskId(taskId);
    if (!normalizedTaskId) {
      return toJsonText({ ok: false, status: "error", message: "Invalid task_id" });
    }

    const pollWindowMs = 10000;
    const baseUrl = normalizeBaseUrl(runtimeConfig.baseUrl ?? "https://whateverai.ai/ai");
    const url = `${baseUrl}/openapi/v1/devices/result/${normalizedTaskId}`;

    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    };
    if (runtimeConfig.apikey) {
      headers.Authorization = runtimeConfig.apikey;
    }

    console.log(
      `${LOG_PREFIX} cloudphone_task_result start task_id=${normalizedTaskId} poll_window=${pollWindowMs}ms`
    );

    const pollingState =
      taskPollingStateByTaskId.get(normalizedTaskId) ??
      ({
        taskId: normalizedTaskId,
        thinkingHistory: [],
        latestResult: null,
        latestStatus: "running",
      } as TaskPollingState);
    taskPollingStateByTaskId.set(normalizedTaskId, pollingState);

    const { thinkingDelta, finalStatus, errorMessage, taskResult, pollWindowElapsed } =
      await consumeSseStream(url, headers, normalizedTaskId, pollWindowMs);

    console.log(
      `${LOG_PREFIX} cloudphone_task_result done task_id=${normalizedTaskId} status=${finalStatus} delta_count=${thinkingDelta.length}`
    );

    if (thinkingDelta.length > 0) {
      pollingState.thinkingHistory.push(...thinkingDelta);
    }
    if (taskResult !== null && taskResult !== undefined) {
      pollingState.latestResult = taskResult;
    }
    pollingState.latestStatus = finalStatus;

    if (finalStatus === "error") {
      releaseInFlightByTask(normalizedTaskId);
      return toJsonText({
        ok: false,
        task_id: normalizedTaskId,
        status: "error",
        message: errorMessage ?? "Task failed with error",
        thinking: thinkingDelta,
        result: pollingState.latestResult,
      });
    }

    if (finalStatus === "timeout") {
      return toJsonText({
        ok: false,
        task_id: normalizedTaskId,
        status: "timeout",
        message: errorMessage ?? "Stream interrupted in current polling window",
        thinking: thinkingDelta,
        result: pollingState.latestResult,
      });
    }

    if (!isTerminalTaskStatus(finalStatus)) {
      return toJsonText({
        ok: false,
        code: "TASK_NOT_FINISHED",
        task_id: normalizedTaskId,
        status: "running",
        message: pollWindowElapsed
          ? "Polling window completed. Continue calling cloudphone_task_result every 10s until terminal status."
          : "Task has not reached terminal status yet. Continue polling cloudphone_task_result.",
        thinking: thinkingDelta,
        result: pollingState.latestResult,
      });
    }

    releaseInFlightByTask(normalizedTaskId);

    return toJsonText({
      ok: true,
      task_id: normalizedTaskId,
      status: finalStatus,
      thinking: thinkingDelta,
      result: pollingState.latestResult,
    });
  },
};

function parseJsonResult(result: McpToolResult): Record<string, unknown> {
  const text = result.content[0]?.type === "text" ? result.content[0].text : "{}";
  try {
    return JSON.parse(text ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

const executeAndPollTool: ToolDefinition = {
  name: "cloudphone_execute_and_wait",
  description:
    "Submit a task with cloudphone_execute and automatically call cloudphone_task_result once. " +
    "This tool returns the first 10-second polling window result so callers do not need to manually chain the first poll.",
  parameters: executeAgentTaskTool.parameters,
  execute: async (id, params) => {
    const executeResult = parseJsonResult(await executeAgentTaskTool.execute(id, params));
    if (executeResult.ok !== true) {
      return toJsonText(executeResult);
    }
    const taskId = normalizeTaskId(executeResult.task_id);
    if (!taskId) {
      return toJsonText({
        ok: false,
        code: "INVALID_EXECUTE_RESPONSE",
        message: "cloudphone_execute returned no valid task_id",
      });
    }
    const firstPoll = parseJsonResult(
      await getTaskResultTool.execute(`${id}:poll`, {
        task_id: taskId,
      })
    );
    return toJsonText({
      ok: firstPoll.ok,
      task_id: taskId,
      execute: executeResult,
      task_result: firstPoll,
    });
  },
};

/** Export all tool definitions. */
export const tools: ToolDefinition[] = [
  getUserProfileTool,
  listDevicesTool,
  getDeviceInfoTool,
  getDeviceScreenshotUrlTool,
  executeAgentTaskTool,
  executeAndPollTool,
  getTaskResultTool,
];
