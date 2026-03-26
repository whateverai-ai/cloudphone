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

import { writeFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join, extname } from "path";
import { createHash } from "crypto";

/** Plugin config type, aligned with openclaw.plugin.json configSchema. */
export interface CloudphonePluginConfig {
  baseUrl?: string;
  apikey?: string;
  timeout?: number;
  autoglmBaseUrl?: string;
  autoglmApiKey?: string;
  autoglmModel?: string;
  autoglmMaxTokens?: number;
  autoglmLang?: string;
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
    "vlmapikey",
    "vlm_api_key",
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

/**
 * Look up resolutionWidth / resolutionHeight from POST /devices/list for a given device_id.
 * Paginates until the device is found or pages are exhausted.
 */
async function getDeviceResolutionByDeviceId(
  deviceId: string
): Promise<{ width: number; height: number } | null> {
  const pageSize = 50;
  let page = 1;
  const maxPages = 200;

  while (page <= maxPages) {
    const result = await apiRequest("POST", "/devices/list", { page, size: pageSize });
    const first = result.content[0];
    if (!first || first.type !== "text") {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(first.text);
    } catch {
      return null;
    }

    if (!parsed || typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const obj = parsed as Record<string, unknown>;
    if (obj.ok === false) {
      return null;
    }

    const content = obj.content;
    if (!Array.isArray(content)) {
      return null;
    }

    for (const item of content) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      if (String(row.device_id ?? "") !== deviceId) continue;

      const w = Number(row.resolutionWidth);
      const h = Number(row.resolutionHeight);
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        return { width: Math.round(w), height: Math.round(h) };
      }
      return null;
    }

    const totalPages = Number(obj.totalPages ?? 1);
    const safeTotal = Number.isFinite(totalPages) && totalPages > 0 ? totalPages : 1;
    if (page >= safeTotal || content.length === 0) {
      break;
    }
    page += 1;
  }

  return null;
}

/** Prepend a critical notice + fenced full URL so agents do not strip pre-signed query params in user-facing replies. */
function enrichSnapshotResult(result: McpToolResult): McpToolResult {
  const first = result.content[0];
  if (!first || first.type !== "text") {
    return result;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(first.text);
  } catch {
    return result;
  }
  if (!parsed || typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return result;
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.ok === false) {
    return result;
  }
  const url = obj.screenshot_url;
  if (typeof url !== "string" || !url.includes("?")) {
    return result;
  }
  const warning =
    "[CRITICAL / 关键] screenshot_url is a pre-signed URL. When replying to users (including WeChat Work / 企业微信), " +
    "you MUST paste the ENTIRE URL from https to the end, including all query parameters after ? — " +
    "never output only the path before ?.\n\n" +
    "Complete URL (copy verbatim / 请完整复制以下整行):\n\n```\n" +
    url +
    "\n```\n";
  return {
    content: [
      { type: "text", text: warning },
      { type: "text", text: first.text },
    ],
  };
}

// ─── Coordinate helpers ────────────────────────────────────────────────────

/**
 * Convert a normalized coordinate (0–999 scale, matching Open-AutoGLM convention)
 * to an absolute pixel value given the screen dimension.
 * Formula: pixel = round(normalized / 1000 * dimension), consistent with Open-AutoGLM.
 */
function convertNormalizedToPixel(normalized: number, dimension: number): number {
  return Math.round((normalized / 1000) * dimension);
}

/**
 * Resolve x/y from params, applying coordinate conversion when needed.
 * Returns null with an error message if required dimensions are missing.
 */
function resolveCoords(
  params: Record<string, unknown>,
  keys: string[]
): { values: number[] } | { error: string } {
  const coordSystem = String(params.coordinate_system ?? "pixel");
  const values: number[] = [];

  if (coordSystem === "normalized") {
    const sw = Number(params.screen_width ?? 0);
    const sh = Number(params.screen_height ?? 0);
    if (!sw || !sh) {
      return {
        error:
          "screen_width and screen_height are required when coordinate_system is 'normalized'. " +
          "Use the cloud phone logical resolution: resolutionWidth and resolutionHeight from cloudphone_list_devices " +
          "(match device_id), or resolution_width and resolution_height from cloudphone_analyze_screen. " +
          "Do not use screenshot image pixel dimensions.",
      };
    }
    for (let i = 0; i < keys.length; i++) {
      const raw = Number(params[keys[i]] ?? 0);
      const dim = i % 2 === 0 ? sw : sh; // even index → x axis, odd → y axis
      values.push(convertNormalizedToPixel(raw, dim));
    }
  } else {
    for (const key of keys) {
      values.push(Math.round(Number(params[key] ?? 0)));
    }
  }

  return { values };
}

// ─── Image helpers ────────────────────────────────────────────────────────

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

function guessMimeType(url: string, contentType?: string | null): string {
  if (contentType) {
    const base = contentType.split(";")[0].trim().toLowerCase();
    if (base.startsWith("image/")) return base;
  }
  const pathname = new URL(url).pathname.toLowerCase();
  const dot = pathname.lastIndexOf(".");
  if (dot !== -1) {
    const ext = pathname.slice(dot);
    if (ext in MIME_BY_EXT) return MIME_BY_EXT[ext];
  }
  return "image/png";
}

/** Parse width/height from PNG header (bytes 16–23 of IHDR chunk). */
function getPngDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Parse width/height from JPEG SOF0/SOF1/SOF2 marker. */
function getJpegDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < buf.length - 8) {
    if (buf[offset] !== 0xff) return null;
    const marker = buf[offset + 1];
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    const segLen = buf.readUInt16BE(offset + 2);
    offset += 2 + segLen;
  }
  return null;
}

function getImageDimensions(buf: Buffer): { width: number; height: number } | null {
  return getPngDimensions(buf) ?? getJpegDimensions(buf);
}

/** Fetch an image URL, return base64 data, MIME type, and dimensions. */
async function fetchImageAsBase64(imageUrl: string): Promise<
  { base64: string; mimeType: string; width?: number; height?: number } | { error: string }
> {
  const urlSafe = safeUrlForLog(imageUrl);
  const started = Date.now();
  console.log(`${LOG_PREFIX} fetchImageAsBase64 start url=${urlSafe}`);
  try {
    const resp = await fetch(imageUrl);
    const elapsed = Date.now() - started;
    console.log(
      `${LOG_PREFIX} fetchImageAsBase64 url=${urlSafe} httpStatus=${resp.status} ${elapsed}ms`
    );
    if (!resp.ok) {
      console.error(
        `${LOG_PREFIX} fetchImageAsBase64 failed: ${resp.status} ${resp.statusText} url=${urlSafe}`
      );
      return { error: `Image request failed: ${resp.status} ${resp.statusText}` };
    }
    const mimeType = guessMimeType(imageUrl, resp.headers.get("content-type"));
    if (!mimeType.startsWith("image/")) {
      return { error: `URL did not return an image (${mimeType})` };
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    const dims = getImageDimensions(buf);
    return {
      base64: buf.toString("base64"),
      mimeType,
      width: dims?.width,
      height: dims?.height,
    };
  } catch (err) {
    const elapsed = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `${LOG_PREFIX} fetchImageAsBase64 error after ${elapsed}ms url=${urlSafe}: ${message}`
    );
    return { error: message };
  }
}

// ─── Sleep helper ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

const devicePowerTool: ToolDefinition = {
  name: "cloudphone_device_power",
  description: "Start, stop, or restart a cloud phone device.",
  parameters: {
    type: "object",
    properties: {
      user_device_id: {
        type: "number",
        description: "User device ID",
      },
      device_id: {
        type: "string",
        description: "Device ID",
      },
      action: {
        type: "string",
        enum: ["start", "stop", "restart"],
        description: "Power action",
      },
    },
    required: ["user_device_id", "device_id", "action"],
  },
  execute: async (_id, params) => apiRequest("POST", "/devices/power", params),
};

const getAdbConnectionTool: ToolDefinition = {
  name: "cloudphone_get_adb_connection",
  description: "Get ADB/SSH connection info for a specific cloud phone device.",
  parameters: {
    type: "object",
    properties: {
      device_id: {
        type: "string",
        description: "Device ID",
      },
    },
    required: ["device_id"],
  },
  execute: async (_id, params) => apiRequest("POST", "/devices/adb-connection", params),
};

const tapTool: ToolDefinition = {
  name: "cloudphone_tap",
  description:
    "Tap a specific screen coordinate. " +
    "Supports two coordinate systems: " +
    "(1) 'pixel' (default) — absolute pixel coordinates, e.g. x=540 y=960 on a 1080×1920 screen. " +
    "(2) 'normalized' — 0–999 scale mapped to screen dimensions, matching the Open-AutoGLM convention. " +
    "When using 'normalized', pass screen_width and screen_height as the cloud phone logical resolution " +
    "(resolutionWidth/resolutionHeight from cloudphone_list_devices, or resolution_width/resolution_height from cloudphone_analyze_screen). " +
    "Use auto_wait_ms to pause after the tap for animations or page transitions.",
  parameters: {
    type: "object",
    properties: {
      device_id: {
        type: "string",
        description: "Device ID",
      },
      x: {
        type: "number",
        description: "X coordinate. Absolute pixels when coordinate_system is 'pixel'; 0–999 when 'normalized'.",
      },
      y: {
        type: "number",
        description: "Y coordinate. Absolute pixels when coordinate_system is 'pixel'; 0–999 when 'normalized'.",
      },
      coordinate_system: {
        type: "string",
        enum: ["pixel", "normalized"],
        description:
          "Coordinate system. 'pixel' = absolute pixels (default). " +
          "'normalized' = 0–999 scale where (0,0) is top-left and (999,999) is bottom-right.",
      },
      screen_width: {
        type: "integer",
        description:
          "Logical screen width in pixels (cloud phone). Required when coordinate_system is 'normalized'. " +
          "Use resolutionWidth from cloudphone_list_devices or resolution_width from cloudphone_analyze_screen.",
      },
      screen_height: {
        type: "integer",
        description:
          "Logical screen height in pixels (cloud phone). Required when coordinate_system is 'normalized'. " +
          "Use resolutionHeight from cloudphone_list_devices or resolution_height from cloudphone_analyze_screen.",
      },
      auto_wait_ms: {
        type: "integer",
        description: "Milliseconds to wait after the tap before returning. Useful for slow page transitions. Default 0.",
      },
    },
    required: ["device_id", "x", "y"],
  },
  execute: async (_id, params) => {
    const coordResult = resolveCoords(params, ["x", "y"]);
    if ("error" in coordResult) return toJsonText({ ok: false, message: coordResult.error });
    const [x, y] = coordResult.values;

    const result = await apiRequest("POST", "/devices/actions/tap", {
      device_id: params.device_id,
      x,
      y,
    });

    if (params.auto_wait_ms) {
      await sleep(Number(params.auto_wait_ms));
    }
    return result;
  },
};

const longPressTool: ToolDefinition = {
  name: "cloudphone_long_press",
  description:
    "Long press a specific coordinate with an optional duration. " +
    "Supports 'pixel' (default) and 'normalized' (0–999) coordinate systems. " +
    "When using 'normalized', pass screen_width and screen_height as cloud phone logical resolution " +
    "(from cloudphone_list_devices or cloudphone_analyze_screen).",
  parameters: {
    type: "object",
    properties: {
      device_id: {
        type: "string",
        description: "Device ID",
      },
      x: {
        type: "number",
        description: "X coordinate. Absolute pixels when coordinate_system is 'pixel'; 0–999 when 'normalized'.",
      },
      y: {
        type: "number",
        description: "Y coordinate. Absolute pixels when coordinate_system is 'pixel'; 0–999 when 'normalized'.",
      },
      duration: {
        type: "integer",
        description: "Press duration in milliseconds, default is 1000",
      },
      coordinate_system: {
        type: "string",
        enum: ["pixel", "normalized"],
        description: "Coordinate system: 'pixel' (default) or 'normalized' (0–999).",
      },
      screen_width: {
        type: "integer",
        description:
          "Logical screen width in pixels. Required when coordinate_system is 'normalized'. " +
          "From cloudphone_list_devices (resolutionWidth) or cloudphone_analyze_screen (resolution_width).",
      },
      screen_height: {
        type: "integer",
        description:
          "Logical screen height in pixels. Required when coordinate_system is 'normalized'. " +
          "From cloudphone_list_devices (resolutionHeight) or cloudphone_analyze_screen (resolution_height).",
      },
      auto_wait_ms: {
        type: "integer",
        description: "Milliseconds to wait after the long press before returning. Default 0.",
      },
    },
    required: ["device_id", "x", "y"],
  },
  execute: async (_id, params) => {
    const coordResult = resolveCoords(params, ["x", "y"]);
    if ("error" in coordResult) return toJsonText({ ok: false, message: coordResult.error });
    const [x, y] = coordResult.values;

    const payload: Record<string, unknown> = { device_id: params.device_id, x, y };
    if (params.duration !== undefined) payload.duration = params.duration;

    const result = await apiRequest("POST", "/devices/actions/long-press", payload);

    if (params.auto_wait_ms) {
      await sleep(Number(params.auto_wait_ms));
    }
    return result;
  },
};

const swipeTool: ToolDefinition = {
  name: "cloudphone_swipe",
  description:
    "Swipe from a start coordinate to an end coordinate. " +
    "Supports 'pixel' (default) and 'normalized' (0–999) coordinate systems. " +
    "When using 'normalized', pass screen_width and screen_height as cloud phone logical resolution " +
    "(from cloudphone_list_devices or cloudphone_analyze_screen). " +
    "All four coordinate fields (start_x, start_y, end_x, end_y) are interpreted under the same coordinate_system.",
  parameters: {
    type: "object",
    properties: {
      device_id: {
        type: "string",
        description: "Device ID",
      },
      start_x: {
        type: "number",
        description: "Start X coordinate",
      },
      start_y: {
        type: "number",
        description: "Start Y coordinate",
      },
      end_x: {
        type: "number",
        description: "End X coordinate",
      },
      end_y: {
        type: "number",
        description: "End Y coordinate",
      },
      duration: {
        type: "integer",
        description: "Swipe duration in milliseconds, default is 300",
      },
      coordinate_system: {
        type: "string",
        enum: ["pixel", "normalized"],
        description: "Coordinate system: 'pixel' (default) or 'normalized' (0–999).",
      },
      screen_width: {
        type: "integer",
        description:
          "Logical screen width in pixels. Required when coordinate_system is 'normalized'. " +
          "From cloudphone_list_devices (resolutionWidth) or cloudphone_analyze_screen (resolution_width).",
      },
      screen_height: {
        type: "integer",
        description:
          "Logical screen height in pixels. Required when coordinate_system is 'normalized'. " +
          "From cloudphone_list_devices (resolutionHeight) or cloudphone_analyze_screen (resolution_height).",
      },
      auto_wait_ms: {
        type: "integer",
        description: "Milliseconds to wait after the swipe before returning. Default 0.",
      },
    },
    required: ["device_id", "start_x", "start_y", "end_x", "end_y"],
  },
  execute: async (_id, params) => {
    const coordResult = resolveCoords(params, ["start_x", "start_y", "end_x", "end_y"]);
    if ("error" in coordResult) return toJsonText({ ok: false, message: coordResult.error });
    const [start_x, start_y, end_x, end_y] = coordResult.values;

    const payload: Record<string, unknown> = {
      device_id: params.device_id,
      start_x,
      start_y,
      end_x,
      end_y,
    };
    if (params.duration !== undefined) payload.duration = params.duration;

    const result = await apiRequest("POST", "/devices/actions/swipe", payload);

    if (params.auto_wait_ms) {
      await sleep(Number(params.auto_wait_ms));
    }
    return result;
  },
};

const inputTextTool: ToolDefinition = {
  name: "cloudphone_input_text",
  description:
    "Type text into the current input focus. " +
    "Use auto_wait_ms to wait after input completes, e.g. for search suggestions or keyboard animations.",
  parameters: {
    type: "object",
    properties: {
      device_id: {
        type: "string",
        description: "Device ID",
      },
      text: {
        type: "string",
        description: "Text to input",
      },
      auto_wait_ms: {
        type: "integer",
        description: "Milliseconds to wait after input before returning. Default 0.",
      },
    },
    required: ["device_id", "text"],
  },
  execute: async (_id, params) => {
    const result = await apiRequest("POST", "/devices/actions/input-text", {
      device_id: params.device_id,
      text: params.text,
    });

    if (params.auto_wait_ms) {
      await sleep(Number(params.auto_wait_ms));
    }
    return result;
  },
};

const clearTextTool: ToolDefinition = {
  name: "cloudphone_clear_text",
  description: "Clear text from the current input field.",
  parameters: {
    type: "object",
    properties: {
      device_id: {
        type: "string",
        description: "Device ID",
      },
    },
    required: ["device_id"],
  },
  execute: async (_id, params) => apiRequest("POST", "/devices/actions/clear-text", params),
};

const keyeventTool: ToolDefinition = {
  name: "cloudphone_keyevent",
  description:
    "Send a system key event. " +
    "Use auto_wait_ms to wait for page transitions after BACK or HOME.",
  parameters: {
    type: "object",
    properties: {
      device_id: {
        type: "string",
        description: "Device ID",
      },
      key_code: {
        type: "string",
        enum: ["BACK", "HOME", "ENTER", "RECENT", "POWER"],
        description: "System key code",
      },
      auto_wait_ms: {
        type: "integer",
        description: "Milliseconds to wait after the key event before returning. Default 0.",
      },
    },
    required: ["device_id", "key_code"],
  },
  execute: async (_id, params) => {
    const result = await apiRequest("POST", "/devices/actions/keyevent", {
      device_id: params.device_id,
      key_code: params.key_code,
    });

    if (params.auto_wait_ms) {
      await sleep(Number(params.auto_wait_ms));
    }
    return result;
  },
};

const waitTool: ToolDefinition = {
  name: "cloudphone_wait",
  description: "Wait for a page condition to make automation timing more reliable.",
  parameters: {
    type: "object",
    properties: {
      device_id: {
        type: "string",
        description: "Device ID",
      },
      condition: {
        type: "string",
        enum: ["element_appear", "element_disappear", "page_stable"],
        description: "Wait condition",
      },
      timeout: {
        type: "integer",
        description: "Timeout in milliseconds, default is 5000",
      },
      selector: {
        type: "string",
        description: "Element selector used with appear/disappear conditions",
      },
    },
    required: ["device_id", "condition"],
  },
  execute: async (_id, params) => apiRequest("POST", "/devices/wait", params),
};

const snapshotTool: ToolDefinition = {
  name: "cloudphone_snapshot",
  description:
    "Capture a device screenshot. " +
    "IMPORTANT: The returned screenshot_url is a pre-signed URL that contains cryptographic signature query parameters " +
    "(X-Amz-Algorithm, X-Amz-Credential, X-Amz-Date, X-Amz-Expires, X-Amz-SignedHeaders, X-Amz-Signature). " +
    "You MUST use the entire screenshot_url exactly as returned, including ALL query parameters. " +
    "Any truncation, re-encoding, or modification will invalidate the signature and cause an access denied error.",
  parameters: {
    type: "object",
    properties: {
      device_id: {
        type: "string",
        description: "Device ID",
      },
      format: {
        type: "string",
        enum: ["screenshot"],
        description: "Snapshot format, currently only screenshot is supported",
      },
    },
    required: ["device_id"],
  },
  execute: async (_id, params) =>
    enrichSnapshotResult(await apiRequest("POST", "/devices/snapshot", params)),
};


const renderImageTool: ToolDefinition = {
  name: "cloudphone_render_image",
  description:
    "Render an HTTPS image URL as an image that can be displayed directly in chat. " +
    "Use this after cloudphone_snapshot returns screenshot_url when you need to show the screenshot to the user. " +
    "For automation loops where the model needs to analyze the screen and get UI element coordinates, use cloudphone_analyze_screen instead. " +
    "IMPORTANT: screenshot_url is a signed URL — you MUST pass the complete original URL as image_url, " +
    "including all query parameters (e.g. X-Amz-Signature). Do NOT truncate, re-encode, or modify it in any way.",
  parameters: {
    type: "object",
    properties: {
      image_url: {
        type: "string",
        description:
          "Complete HTTPS image URL including all query parameters. Must be passed exactly as received from cloudphone_snapshot.",
      },
    },
    required: ["image_url"],
  },
  execute: async (_id, params) => {
    const imageUrl = String(params.image_url ?? "");
    if (!imageUrl) {
      return toJsonText({ ok: false, message: "Missing required parameter: image_url" });
    }

    try {
      const urlSafe = safeUrlForLog(imageUrl);
      const started = Date.now();
      console.log(`${LOG_PREFIX} cloudphone_render_image fetch start url=${urlSafe}`);
      const resp = await fetch(imageUrl);
      const elapsed = Date.now() - started;
      console.log(
        `${LOG_PREFIX} cloudphone_render_image fetch url=${urlSafe} httpStatus=${resp.status} ${elapsed}ms`
      );
      if (!resp.ok) {
        console.error(
          `${LOG_PREFIX} cloudphone_render_image fetch failed: ${resp.status} ${resp.statusText} url=${urlSafe}`
        );
        return toJsonText({
          ok: false,
          message: `Image request failed: ${resp.status} ${resp.statusText}`,
        });
      }

      const mimeType = guessMimeType(imageUrl, resp.headers.get("content-type"));
      if (!mimeType.startsWith("image/")) {
        return toJsonText({
          ok: false,
          message: `The URL did not return an image (${mimeType})`,
        });
      }

      const buf = Buffer.from(await resp.arrayBuffer());
      const hash = createHash("md5").update(buf).digest("hex");
      const ext = extname(new URL(imageUrl).pathname) || ".jpg";
      const dir = join(tmpdir(), "cloudphone-images");
      await mkdir(dir, { recursive: true });
      const filePath = join(dir, `${hash}${ext}`);
      await writeFile(filePath, buf);

      return {
        content: [
          // { type: "image" as const, data: buf.toString("base64"), mimeType },
          { type: "text" as const, text: `MEDIA:${filePath}` },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`${LOG_PREFIX} cloudphone_render_image fetch error: ${message}`);
      return toJsonText({ ok: false, message: `Failed to fetch image: ${message}` });
    }
  },
};

// ─── AutoGLM action decision ──────────────────────────────────────────────

/**
 * System prompt (Chinese) for autoglm-phone model.
 * Adapted from Open-AutoGLM phone_agent/config/prompts.py:
 * - Removed ADB Keyboard IME instructions (cloud phone has its own text input channel)
 * - Added cloud phone network latency note
 * - Coordinate system 0–999 retained as-is
 */
const AUTOGLM_SYSTEM_PROMPT_CN = `你是一个智能体分析专家，可以根据操作历史和当前状态图执行一系列操作来完成任务。
你必须严格按照要求输出以下格式：
<think>{think}</think>
<answer>{action}</answer>

其中：
- {think} 是对你为什么选择这个操作的简短推理说明。
- {action} 是本次执行的具体操作指令，必须严格遵循下方定义的指令格式。

操作指令及其作用如下：
- do(action="Launch", app="xxx")
    Launch是启动目标app的操作，这比通过主屏幕导航更快。此操作完成后，您将自动收到结果状态的截图。
- do(action="Tap", element=[x,y])
    Tap是点击操作，点击屏幕上的特定点。可用此操作点击按钮、选择项目、从主屏幕打开应用程序，或与任何可点击的用户界面元素进行交互。坐标系统从左上角 (0,0) 开始到右下角（999,999)结束。此操作完成后，您将自动收到结果状态的截图。
- do(action="Tap", element=[x,y], message="重要操作")
    基本功能同Tap，点击涉及财产、支付、隐私等敏感按钮时触发。
- do(action="Type", text="xxx")
    Type是输入操作，在当前聚焦的输入框中输入文本。使用此操作前，请确保输入框已被聚焦（先点击它）。输入的文本将像使用键盘输入一样输入。自动清除文本：当你使用输入操作时，输入框中现有的任何文本都会在输入新文本前自动清除。操作完成后，你将自动收到结果状态的截图。
- do(action="Interact")
    Interact是当有多个满足条件的选项时而触发的交互操作，询问用户如何选择。
- do(action="Swipe", start=[x1,y1], end=[x2,y2])
    Swipe是滑动操作，通过从起始坐标拖动到结束坐标来执行滑动手势。可用于滚动内容、在屏幕之间导航、下拉通知栏以及项目栏或进行基于手势的导航。坐标系统从左上角 (0,0) 开始到右下角（999,999)结束。此操作完成后，您将自动收到结果状态的截图。
- do(action="Long Press", element=[x,y])
    Long Press是长按操作，在屏幕上的特定点长按指定时间。坐标系统从左上角 (0,0) 开始到右下角（999,999)结束。此操作完成后，您将自动收到结果状态的屏幕截图。
- do(action="Double Tap", element=[x,y])
    Double Tap在屏幕上的特定点快速连续点按两次。坐标系统从左上角 (0,0) 开始到右下角（999,999)结束。此操作完成后，您将自动收到结果状态的截图。
- do(action="Back")
    导航返回到上一个屏幕或关闭当前对话框。此操作完成后，您将自动收到结果状态的截图。
- do(action="Home")
    Home是回到系统桌面的操作，相当于按下 Android 主屏幕按钮。此操作完成后，您将自动收到结果状态的截图。
- do(action="Wait", duration="x seconds")
    等待页面加载，x为需要等待多少秒。
- do(action="Take_over", message="xxx")
    Take_over是接管操作，表示在登录和验证阶段需要用户协助。
- finish(message="xxx")
    finish是结束任务的操作，表示准确完整完成任务，message是终止信息。

注意：当前为云手机环境，网络操作可能有额外延迟，如页面未加载完毕请适当等待。

必须遵循的规则：
1. 在执行任何操作前，先检查当前app是否是目标app，如果不是，先执行 Launch。
2. 如果进入到了无关页面，先执行 Back。如果执行Back后页面没有变化，请点击页面左上角的返回键进行返回，或者右上角的X号关闭。
3. 如果页面未加载出内容，最多连续 Wait 三次，否则执行 Back重新进入。
4. 如果页面显示网络问题，需要重新加载，请点击重新加载。
5. 如果当前页面找不到目标联系人、商品、店铺等信息，可以尝试 Swipe 滑动查找。
6. 遇到价格区间、时间区间等筛选条件，如果没有完全符合的，可以放宽要求。
7. 在执行下一步操作前请一定要检查上一步的操作是否生效，如果点击没生效，可能因为app反应较慢，请先稍微等待一下，如果还是不生效请调整一下点击位置重试。
8. 在执行任务中如果遇到滑动不生效的情况，请调整一下起始点位置，增大滑动距离重试，如果还是不生效，有可能是已经滑到底了，请继续向反方向滑动。
9. 如果没有合适的搜索结果，可能是因为搜索页面不对，请返回到搜索页面的上一级尝试重新搜索，如果尝试三次返回上一级搜索后仍然没有符合要求的结果，执行 finish(message="原因")。
10. 在结束任务前请一定要仔细检查任务是否完整准确的完成，如果出现错选、漏选、多选的情况，请返回之前的步骤进行纠正。`;

/**
 * System prompt (English) for autoglm-phone model.
 * Adapted from Open-AutoGLM phone_agent/config/prompts_en.py.
 */
const AUTOGLM_SYSTEM_PROMPT_EN = `You are a professional Android operation agent assistant that can fulfill the user's high-level instructions. Given a screenshot of the Android interface at each step, you first analyze the situation, then plan the best course of action.

Your response format must be structured as follows:
<think>[Your thought]</think>
<answer>[Your operation code]</answer>

Available actions:
- do(action="Launch", app="xxx")  Launch an app by name.
- do(action="Tap", element=[x,y])  Tap at coordinates. Coordinate system: top-left (0,0) to bottom-right (999,999).
- do(action="Tap", element=[x,y], message="sensitive operation")  Tap with confirmation for sensitive actions.
- do(action="Type", text="xxx")  Type text into the focused input field. Existing text is auto-cleared before input.
- do(action="Interact")  Request user choice when multiple valid options exist.
- do(action="Swipe", start=[x1,y1], end=[x2,y2])  Swipe gesture. Coordinates 0–999.
- do(action="Long Press", element=[x,y])  Long press at coordinates. Coordinates 0–999.
- do(action="Double Tap", element=[x,y])  Double tap at coordinates. Coordinates 0–999.
- do(action="Back")  Navigate to previous screen.
- do(action="Home")  Return to home screen.
- do(action="Wait", duration="x seconds")  Wait for page to load.
- do(action="Take_over", message="xxx")  Request human takeover for login/captcha.
- finish(message="xxx")  End the task with a completion message.

Note: This is a cloud phone environment. Network operations may have additional latency — use Wait if a page is loading slowly.

Rules:
1. Check if the current app is the target app first; if not, use Launch.
2. If on an irrelevant page, use Back to return.
3. If the page fails to load after 3 consecutive Waits, use Back and re-enter.
4. Verify each action took effect before proceeding; retry with adjusted coordinates if needed.
5. If scrolling has no effect, adjust start position or increase distance; try reverse direction if at the boundary.
6. Before finishing, verify the task is fully and correctly completed.`;

/**
 * Parse the raw autoglm model response into thinking and action strings.
 * Priority: finish(message= > do(action= > <answer> XML tag fallback.
 * Ported from Open-AutoGLM phone_agent/model/client.py _parse_response().
 */
function parseAutoglmResponse(content: string): { thinking: string; actionStr: string } {
  // Rule 1: finish(message=
  if (content.includes("finish(message=")) {
    const parts = content.split("finish(message=", 2);
    return { thinking: parts[0].trim(), actionStr: "finish(message=" + parts[1] };
  }
  // Rule 2: do(action=
  if (content.includes("do(action=")) {
    const parts = content.split("do(action=", 2);
    return { thinking: parts[0].trim(), actionStr: "do(action=" + parts[1] };
  }
  // Rule 3: legacy <answer> XML tags
  if (content.includes("<answer>")) {
    const parts = content.split("<answer>", 2);
    const thinking = parts[0].replace(/<think>/g, "").replace(/<\/think>/g, "").trim();
    const actionStr = parts[1].replace(/<\/answer>/g, "").trim();
    return { thinking, actionStr };
  }
  // Rule 4: fallback — treat entire content as action
  return { thinking: "", actionStr: content.trim() };
}

/** Parsed action returned by parseAutoglmAction. */
export interface AutoglmAction {
  type: string;
  element?: number[];
  start?: number[];
  end?: number[];
  text?: string;
  app?: string;
  message?: string;
  duration?: string;
  [key: string]: unknown;
}

/**
 * Parse a do()/finish() action string into a structured object.
 * Ported from Open-AutoGLM phone_agent/actions/handler.py parse_action().
 */
function parseAutoglmAction(actionStr: string): AutoglmAction {
  const s = actionStr.trim();

  // finish(message="...")
  if (s.startsWith("finish")) {
    const msgMatch = s.match(/finish\(message=["'](.*)["']\s*\)$/s);
    return { type: "Finish", message: msgMatch ? msgMatch[1] : s };
  }

  // do(action="Type", text="...") — handle multiline text specially
  if (s.startsWith('do(action="Type"') || s.startsWith("do(action='Type'") ||
      s.startsWith('do(action="Type_Name"') || s.startsWith("do(action='Type_Name'")) {
    const textMatch = s.match(/text=["']([\s\S]*?)["']\s*\)\s*$/);
    return { type: "Type", text: textMatch ? textMatch[1] : "" };
  }

  // do(action="...", ...kwargs...)
  if (s.startsWith("do(")) {
    try {
      // Extract action name
      const actionMatch = s.match(/do\(\s*action=["']([^"']+)["']/);
      if (!actionMatch) throw new Error("no action name");
      const actionType = actionMatch[1];

      const result: AutoglmAction = { type: actionType };

      // element=[x,y]
      const elemMatch = s.match(/element=\[(\d+)\s*,\s*(\d+)\]/);
      if (elemMatch) result.element = [Number(elemMatch[1]), Number(elemMatch[2])];

      // start=[x,y]
      const startMatch = s.match(/start=\[(\d+)\s*,\s*(\d+)\]/);
      if (startMatch) result.start = [Number(startMatch[1]), Number(startMatch[2])];

      // end=[x,y]
      const endMatch = s.match(/end=\[(\d+)\s*,\s*(\d+)\]/);
      if (endMatch) result.end = [Number(endMatch[1]), Number(endMatch[2])];

      // app="xxx"
      const appMatch = s.match(/app=["']([^"']+)["']/);
      if (appMatch) result.app = appMatch[1];

      // message="xxx"
      const msgMatch = s.match(/message=["']([^"']+)["']/);
      if (msgMatch) result.message = msgMatch[1];

      // duration="x seconds"
      const durMatch = s.match(/duration=["']([^"']+)["']/);
      if (durMatch) result.duration = durMatch[1];

      // text="xxx" (for non-Type actions that might have text)
      const textMatch = s.match(/text=["']([^"']+)["']/);
      if (textMatch) result.text = textMatch[1];

      return result;
    } catch {
      return { type: "Unknown", raw: s };
    }
  }

  return { type: "Unknown", raw: s };
}

/**
 * Call the autoglm-phone model with a screenshot and task.
 * Returns { thinking, actionStr, rawContent }.
 */
async function callAutoglmForAction(
  base64: string,
  mimeType: string,
  task: string,
  context: string | undefined,
  baseUrl: string,
  apiKey: string,
  model: string,
  maxTokens: number,
  lang: string
): Promise<{ thinking: string; actionStr: string; rawContent: string }> {
  const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;
  let hostForLog = "(unknown)";
  try { hostForLog = new URL(normalizeBaseUrl(baseUrl)).host; } catch { /* ignore */ }

  const systemPrompt = lang === "en" ? AUTOGLM_SYSTEM_PROMPT_EN : AUTOGLM_SYSTEM_PROMPT_CN;

  // Build user message text: task + optional previous context
  let userText = task;
  if (context && context.trim()) {
    userText += `\n\n** Previous steps **\n${context.trim()}`;
  }

  const messages = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
        { type: "text", text: userText },
      ],
    },
  ];

  const started = Date.now();
  console.log(
    `${LOG_PREFIX} callAutoglmForAction start host=${hostForLog} model=${model} task="${task.slice(0, 80)}" imageBase64Len=${base64.length}`
  );

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0.0,
      top_p: 0.85,
      frequency_penalty: 0.2,
      messages,
    }),
  });

  const elapsed = Date.now() - started;
  console.log(
    `${LOG_PREFIX} callAutoglmForAction host=${hostForLog} model=${model} httpStatus=${resp.status} ${elapsed}ms`
  );

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    console.error(`${LOG_PREFIX} callAutoglmForAction failed: ${resp.status} ${errText.slice(0, 300)}`);
    throw new Error(`AutoGLM API error ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawContent = data.choices?.[0]?.message?.content ?? "";
  const { thinking, actionStr } = parseAutoglmResponse(rawContent);

  return { thinking, actionStr, rawContent };
}

const planActionTool: ToolDefinition = {
  name: "cloudphone_plan_action",
  description:
    "Capture the current cloud phone screen and ask an autoglm-phone vision-language model to decide the next action for a given task. " +
    "Returns a structured action recommendation with pixel coordinates (device resolution) and thinking reasoning. " +
    "The coordinate_system field in the response is 'pixel' when conversion succeeded; use action.element[0]/[1] directly as x/y for cloudphone_tap. " +
    "Use this tool in a ReAct loop: call it to get the next action, execute that action with the corresponding cloudphone_* tool, then call it again with updated context. " +
    "action.type maps to execution tools: Tap→cloudphone_tap (pixel, x=action.element[0] y=action.element[1]), " +
    "Swipe→cloudphone_swipe (pixel, start_x/start_y from action.start, end_x/end_y from action.end), " +
    "Type→cloudphone_input_text, Back→cloudphone_keyevent(BACK), Home→cloudphone_keyevent(HOME), " +
    "Launch→cloudphone_tap on app icon or note app name, Wait→cloudphone_wait or sleep, Finish→task complete. " +
    "Requires autoglmBaseUrl, autoglmApiKey, and autoglmModel in plugin config.",
  parameters: {
    type: "object",
    properties: {
      device_id: {
        type: "string",
        description: "Device ID",
      },
      task: {
        type: "string",
        description: "Natural language task description, e.g. '打开微信搜索美食攻略' or 'Open WeChat and search for food guides'.",
      },
      context: {
        type: "string",
        description:
          "Optional summary of previous steps in this task, to give the model memory of what has been done. " +
          "Example: 'Step 1: Tapped Launch WeChat → succeeded. Step 2: Tapped search box → succeeded.'",
      },
    },
    required: ["device_id", "task"],
  },
  optional: true,
  execute: async (_id, params) => {
    const traceId = `planAction:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const startedAll = Date.now();
    const autoglmBaseUrl = runtimeConfig.autoglmBaseUrl;
    const autoglmApiKey = runtimeConfig.autoglmApiKey;
    const autoglmModel = runtimeConfig.autoglmModel;
    const deviceId = String(params.device_id ?? "");
    const task = String(params.task ?? "");
    const context = params.context ? String(params.context) : undefined;
    const maxTokens = Number(runtimeConfig.autoglmMaxTokens ?? 3000);
    const lang = String(runtimeConfig.autoglmLang ?? "cn");

    console.log(
      `${LOG_PREFIX} planAction start trace=${traceId} device_id=${deviceId || "(empty)"} task_len=${task.length} context_len=${context?.length ?? 0} lang=${lang} max_tokens=${maxTokens}`
    );
    console.log(
      `${LOG_PREFIX} planAction config trace=${traceId} has_base_url=${!!autoglmBaseUrl} has_api_key=${!!autoglmApiKey} has_model=${!!autoglmModel}`
    );

    if (!autoglmBaseUrl || !autoglmApiKey || !autoglmModel) {
      console.error(`${LOG_PREFIX} planAction config missing trace=${traceId}`);
      return toJsonText({
        ok: false,
        message:
          "cloudphone_plan_action requires autoglmBaseUrl, autoglmApiKey, and autoglmModel " +
          "in plugins.entries.cloudphone.config. Example:\n" +
          '  "autoglmBaseUrl": "https://open.bigmodel.cn/api/paas/v4",\n' +
          '  "autoglmApiKey": "your-api-key",\n' +
          '  "autoglmModel": "autoglm-phone"',
      });
    }

    // 1. Take snapshot
    const startedSnapshot = Date.now();
    console.log(`${LOG_PREFIX} planAction step1 snapshot start trace=${traceId}`);
    const snapshotResult = await apiRequest("POST", "/devices/snapshot", { device_id: deviceId }, 15000);
    console.log(
      `${LOG_PREFIX} planAction step1 snapshot done trace=${traceId} elapsed=${Date.now() - startedSnapshot}ms content_items=${snapshotResult.content.length}`
    );
    const first = snapshotResult.content[0];
    if (!first || first.type !== "text") {
      console.error(`${LOG_PREFIX} planAction step1 snapshot invalid_content trace=${traceId}`);
      return toJsonText({ ok: false, message: "Snapshot did not return text content" });
    }

    let snapshotData: Record<string, unknown>;
    try {
      snapshotData = JSON.parse(first.text);
    } catch {
      console.error(`${LOG_PREFIX} planAction step1 snapshot parse_failed trace=${traceId}`);
      return toJsonText({ ok: false, message: "Failed to parse snapshot response" });
    }

    if (snapshotData.ok === false) {
      console.error(
        `${LOG_PREFIX} planAction step1 snapshot failed trace=${traceId} message=${summarizeTextForLog(String(snapshotData.message ?? ""))}`
      );
      return toJsonText({ ok: false, message: String(snapshotData.message ?? "Snapshot failed") });
    }

    const screenshotUrl = String(snapshotData.screenshot_url ?? "");
    if (!screenshotUrl) {
      console.error(`${LOG_PREFIX} planAction step1 snapshot missing_url trace=${traceId}`);
      return toJsonText({ ok: false, message: "Snapshot did not return a screenshot_url" });
    }
    console.log(
      `${LOG_PREFIX} planAction step1 snapshot success trace=${traceId} screenshot=${safeUrlForLog(screenshotUrl)}`
    );

    // 2. Fetch image as base64
    const startedImgFetch = Date.now();
    console.log(`${LOG_PREFIX} planAction step2 image_fetch start trace=${traceId}`);
    const imgResult = await fetchImageAsBase64(screenshotUrl);
    if ("error" in imgResult) {
      console.error(
        `${LOG_PREFIX} planAction step2 image_fetch failed trace=${traceId} elapsed=${Date.now() - startedImgFetch}ms error=${summarizeTextForLog(imgResult.error)}`
      );
      return toJsonText({ ok: false, message: `Image fetch error: ${imgResult.error}` });
    }
    console.log(
      `${LOG_PREFIX} planAction step2 image_fetch success trace=${traceId} elapsed=${Date.now() - startedImgFetch}ms mime=${imgResult.mimeType} base64_len=${imgResult.base64.length} width=${imgResult.width ?? "?"} height=${imgResult.height ?? "?"}`
    );

    // 3. Call autoglm model for action decision
    let thinking: string;
    let actionStr: string;
    let rawContent: string;
    const startedAutoglm = Date.now();
    console.log(
      `${LOG_PREFIX} planAction step3 autoglm start trace=${traceId} base_url=${safeUrlForLog(autoglmBaseUrl)} model=${autoglmModel} task_preview=${summarizeTextForLog(task, 80)} context_preview=${summarizeTextForLog(context ?? "", 80)}`
    );
    try {
      ({ thinking, actionStr, rawContent } = await callAutoglmForAction(
        imgResult.base64,
        imgResult.mimeType,
        task,
        context,
        autoglmBaseUrl,
        autoglmApiKey,
        autoglmModel,
        maxTokens,
        lang
      ));
      console.log(
        `${LOG_PREFIX} planAction step3 autoglm success trace=${traceId} elapsed=${Date.now() - startedAutoglm}ms thinking_len=${thinking.length} action_len=${actionStr.length} raw_len=${rawContent.length}`
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(
        `${LOG_PREFIX} planAction step3 autoglm failed trace=${traceId} elapsed=${Date.now() - startedAutoglm}ms error=${summarizeTextForLog(errMsg)}`
      );
      return toJsonText({ ok: false, message: `AutoGLM call failed: ${errMsg}` });
    }

    // 4. Parse action string into structured object
    const startedParse = Date.now();
    const action = parseAutoglmAction(actionStr);
    console.log(
      `${LOG_PREFIX} planAction step4 parse_action trace=${traceId} elapsed=${Date.now() - startedParse}ms action_type=${action.type} has_element=${!!action.element} has_start=${!!action.start} has_end=${!!action.end}`
    );

    // 5. Look up resolution and convert normalized 0-999 coords to device pixels
    const startedConvert = Date.now();
    const resolution = await getDeviceResolutionByDeviceId(deviceId);

    if (resolution) {
      if (action.element && action.element.length >= 2) {
        action.element = [
          convertNormalizedToPixel(action.element[0], resolution.width),
          convertNormalizedToPixel(action.element[1], resolution.height),
        ];
      }
      if (action.start && action.start.length >= 2) {
        action.start = [
          convertNormalizedToPixel(action.start[0], resolution.width),
          convertNormalizedToPixel(action.start[1], resolution.height),
        ];
      }
      if (action.end && action.end.length >= 2) {
        action.end = [
          convertNormalizedToPixel(action.end[0], resolution.width),
          convertNormalizedToPixel(action.end[1], resolution.height),
        ];
      }
    }
    console.log(
      `${LOG_PREFIX} planAction step5 convert_coords trace=${traceId} elapsed=${Date.now() - startedConvert}ms resolution=${resolution ? `${resolution.width}x${resolution.height}` : "unknown"} coord_system=${resolution ? "pixel" : "normalized"}`
    );

    const out: Record<string, unknown> = {
      ok: true,
      thinking,
      action,
      coordinate_system: resolution ? "pixel" : "normalized",
      screenshot_url: screenshotUrl,
      raw_action: actionStr,
      raw_content: rawContent,
    };
    if (resolution) {
      out.resolution_width = resolution.width;
      out.resolution_height = resolution.height;
    }

    console.log(`${LOG_PREFIX} planAction done trace=${traceId} elapsed=${Date.now() - startedAll}ms`);
    return toJsonText(out);
  },
};


/** Export all tool definitions. */
export const tools: ToolDefinition[] = [
  getUserProfileTool,
  listDevicesTool,
  getDeviceInfoTool,
  devicePowerTool,
  getAdbConnectionTool,
  tapTool,
  longPressTool,
  swipeTool,
  inputTextTool,
  clearTextTool,
  keyeventTool,
  waitTool,
  snapshotTool,
  renderImageTool,
  planActionTool,
];
