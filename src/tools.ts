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

async function apiRequest(
  method: "GET" | "POST",
  path: string,
  payload?: Record<string, unknown>
): Promise<McpToolResult> {
  const baseUrl = normalizeBaseUrl(runtimeConfig.baseUrl ?? "https://cptest.yaltc.cn");
  const timeout = runtimeConfig.timeout ?? 5000;
  const url = `${baseUrl}/openapi/v1${path.startsWith("/") ? path : `/${path}`}`;

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
      method,
      headers,
      ...(method === "POST" ? { body: JSON.stringify(payload ?? {}) } : {}),
      signal: controller?.signal,
    });

    if (!response.ok) {
      return toJsonText({
        ok: false,
        httpStatus: response.status,
        message: `HTTP error: ${response.status} ${response.statusText}`,
      });
    }

    const body = (await response.json()) as Record<string, unknown>;

    if (typeof body === "object" && body !== null && "code" in body) {
      if (body.code === 200) {
        return toJsonText(body.data ?? body);
      }
      return toJsonText({
        ok: false,
        code: body.code,
        message: body.data ?? "Unknown error",
      });
    }

    return toJsonText(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
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
  description: "Tap a specific screen coordinate.",
  parameters: {
    type: "object",
    properties: {
      device_id: {
        type: "string",
        description: "Device ID",
      },
      x: {
        type: "integer",
        description: "X coordinate in pixels",
      },
      y: {
        type: "integer",
        description: "Y coordinate in pixels",
      },
    },
    required: ["device_id", "x", "y"],
  },
  execute: async (_id, params) => apiRequest("POST", "/devices/actions/tap", params),
};

const longPressTool: ToolDefinition = {
  name: "cloudphone_long_press",
  description: "Long press a specific coordinate with an optional duration.",
  parameters: {
    type: "object",
    properties: {
      device_id: {
        type: "string",
        description: "Device ID",
      },
      x: {
        type: "integer",
        description: "X coordinate in pixels",
      },
      y: {
        type: "integer",
        description: "Y coordinate in pixels",
      },
      duration: {
        type: "integer",
        description: "Press duration in milliseconds, default is 1000",
      },
    },
    required: ["device_id", "x", "y"],
  },
  execute: async (_id, params) => apiRequest("POST", "/devices/actions/long-press", params),
};

const swipeTool: ToolDefinition = {
  name: "cloudphone_swipe",
  description: "Swipe from a start coordinate to an end coordinate.",
  parameters: {
    type: "object",
    properties: {
      device_id: {
        type: "string",
        description: "Device ID",
      },
      start_x: {
        type: "integer",
        description: "Start X coordinate",
      },
      start_y: {
        type: "integer",
        description: "Start Y coordinate",
      },
      end_x: {
        type: "integer",
        description: "End X coordinate",
      },
      end_y: {
        type: "integer",
        description: "End Y coordinate",
      },
      duration: {
        type: "integer",
        description: "Swipe duration in milliseconds, default is 300",
      },
    },
    required: ["device_id", "start_x", "start_y", "end_x", "end_y"],
  },
  execute: async (_id, params) => apiRequest("POST", "/devices/actions/swipe", params),
};

const inputTextTool: ToolDefinition = {
  name: "cloudphone_input_text",
  description: "Type text into the current input focus.",
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
    },
    required: ["device_id", "text"],
  },
  execute: async (_id, params) => apiRequest("POST", "/devices/actions/input-text", params),
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
  description: "Send a system key event.",
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
    },
    required: ["device_id", "key_code"],
  },
  execute: async (_id, params) => apiRequest("POST", "/devices/actions/keyevent", params),
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
  description: "Capture a device screenshot or UI tree snapshot.",
  parameters: {
    type: "object",
    properties: {
      device_id: {
        type: "string",
        description: "Device ID",
      },
      format: {
        type: "string",
        enum: ["screenshot", "ui_tree", "both"],
        description: "Snapshot format, default is screenshot",
      },
    },
    required: ["device_id"],
  },
  execute: async (_id, params) => apiRequest("POST", "/devices/snapshot", params),
};

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

const renderImageTool: ToolDefinition = {
  name: "cloudphone_render_image",
  description:
    "Render an HTTPS image URL as an image that can be displayed directly in chat. " +
    "Use this after cloudphone_snapshot returns a screenshot URL.",
  parameters: {
    type: "object",
    properties: {
      image_url: {
        type: "string",
        description: "HTTPS image URL",
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
      const resp = await fetch(imageUrl);
      if (!resp.ok) {
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
      const dataUrl = `data:${mimeType};base64,${buf.toString("base64")}`;
      const markdownImage = `![cloudphone screenshot](${dataUrl})`;

      return {
        content: [
          { type: "text" as const, text: markdownImage },
          { type: "text" as const, text: `MEDIA:${filePath}` },
          {
            type: "text" as const,
            text: JSON.stringify({
              ok: true,
              filePath,
              url: imageUrl,
              mimeType,
              size: buf.length,
              renderMode: "markdown_data_url",
            }),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return toJsonText({ ok: false, message: `Failed to fetch image: ${message}` });
    }
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
];
