/**
 * Agent 工具定义模块
 *
 * 每个工具需包含：
 *   - name:        snake_case 格式的工具名
 *   - description: 向 AI Agent 说明工具用途
 *   - parameters:  JSON Schema 描述入参结构
 *   - execute:     执行函数，接收 (id, params)，返回 MCP Content 格式结果
 *
 * 官方文档：https://docs.openclaw.ai/plugins/agent-tools
 */

/** 插件配置类型（与 openclaw.plugin.json configSchema 保持一致） */
export interface CloudphonePluginConfig {
  baseUrl?: string;
  apikey?: string;
  timeout?: number;
}

/** MCP Content 项 */
export interface McpContentItem {
  type: "text";
  text: string;
}

/** MCP 风格的工具返回值 */
export interface McpToolResult {
  content: McpContentItem[];
}

/** 工具定义类型（与 OpenClaw api.registerTool 参数对齐） */
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

/** 在插件注册阶段注入配置 */
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
        message: `HTTP 错误：${response.status} ${response.statusText}`,
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
        message: body.message ?? "未知错误",
      });
    }

    return toJsonText(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return toJsonText({
      ok: false,
      message: `请求失败：${message}`,
    });
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

const getUserProfileTool: ToolDefinition = {
  name: "cloudphone_get_user_profile",
  description: "获取当前用户的基本信息。",
  parameters: {
    type: "object",
    properties: {},
  },
  execute: async () => apiRequest("GET", "/user/profile"),
};

const listDevicesTool: ToolDefinition = {
  name: "cloudphone_list_devices",
  description: "获取当前用户的云手机设备列表，支持分页和筛选。",
  parameters: {
    type: "object",
    properties: {
      keyword: {
        type: "string",
        description: "关键字（设备名称/设备 ID）",
      },
      status: {
        type: "string",
        enum: ["online", "offline"],
        description: "设备状态过滤",
      },
      page: {
        type: "integer",
        description: "页码，默认 1",
      },
      size: {
        type: "integer",
        description: "每页条数，默认 20",
      },
    },
  },
  execute: async (_id, params) => apiRequest("POST", "/devices/list", params),
};

const getDeviceInfoTool: ToolDefinition = {
  name: "cloudphone_get_device_info",
  description: "获取指定云手机设备详情。",
  parameters: {
    type: "object",
    properties: {
      user_device_id: {
        type: "number",
        description: "用户设备 ID",
      },
    },
    required: ["user_device_id"],
  },
  execute: async (_id, params) => apiRequest("POST", "/devices/info", params),
};

const devicePowerTool: ToolDefinition = {
  name: "cloudphone_device_power",
  description: "对云手机执行开机、关机或重启。",
  parameters: {
    type: "object",
    properties: {
      user_device_id: {
        type: "number",
        description: "用户设备 ID",
      },
      device_id: {
        type: "string",
        description: "设备 ID",
      },
      action: {
        type: "string",
        enum: ["start", "stop", "restart"],
        description: "电源操作类型",
      },
    },
    required: ["user_device_id", "device_id", "action"],
  },
  execute: async (_id, params) => apiRequest("POST", "/devices/power", params),
};

const getAdbConnectionTool: ToolDefinition = {
  name: "cloudphone_get_adb_connection",
  description: "获取指定云手机的 ADB/SSH 连接信息。",
  parameters: {
    type: "object",
    properties: {
      device_id: {
        type: "string",
        description: "设备 ID",
      },
    },
    required: ["device_id"],
  },
  execute: async (_id, params) => apiRequest("POST", "/devices/adb-connection", params),
};

const tapTool: ToolDefinition = {
  name: "cloudphone_tap",
  description: "点击指定坐标位置。",
  parameters: {
    type: "object",
    properties: {
      device_id: {
        type: "string",
        description: "设备 ID",
      },
      x: {
        type: "integer",
        description: "X 坐标（像素）",
      },
      y: {
        type: "integer",
        description: "Y 坐标（像素）",
      },
    },
    required: ["device_id", "x", "y"],
  },
  execute: async (_id, params) => apiRequest("POST", "/devices/actions/tap", params),
};

const longPressTool: ToolDefinition = {
  name: "cloudphone_long_press",
  description: "长按指定坐标，可选持续时长。",
  parameters: {
    type: "object",
    properties: {
      device_id: {
        type: "string",
        description: "设备 ID",
      },
      x: {
        type: "integer",
        description: "X 坐标（像素）",
      },
      y: {
        type: "integer",
        description: "Y 坐标（像素）",
      },
      duration: {
        type: "integer",
        description: "长按时长（毫秒），默认 1000",
      },
    },
    required: ["device_id", "x", "y"],
  },
  execute: async (_id, params) => apiRequest("POST", "/devices/actions/long-press", params),
};

const swipeTool: ToolDefinition = {
  name: "cloudphone_swipe",
  description: "按起止坐标执行滑动操作。",
  parameters: {
    type: "object",
    properties: {
      device_id: {
        type: "string",
        description: "设备 ID",
      },
      start_x: {
        type: "integer",
        description: "起点 X 坐标",
      },
      start_y: {
        type: "integer",
        description: "起点 Y 坐标",
      },
      end_x: {
        type: "integer",
        description: "终点 X 坐标",
      },
      end_y: {
        type: "integer",
        description: "终点 Y 坐标",
      },
      duration: {
        type: "integer",
        description: "滑动时长（毫秒），默认 300",
      },
    },
    required: ["device_id", "start_x", "start_y", "end_x", "end_y"],
  },
  execute: async (_id, params) => apiRequest("POST", "/devices/actions/swipe", params),
};

const inputTextTool: ToolDefinition = {
  name: "cloudphone_input_text",
  description: "在当前输入焦点处输入文本。",
  parameters: {
    type: "object",
    properties: {
      device_id: {
        type: "string",
        description: "设备 ID",
      },
      text: {
        type: "string",
        description: "输入文本内容",
      },
    },
    required: ["device_id", "text"],
  },
  execute: async (_id, params) => apiRequest("POST", "/devices/actions/input-text", params),
};

const clearTextTool: ToolDefinition = {
  name: "cloudphone_clear_text",
  description: "清空当前输入框文本。",
  parameters: {
    type: "object",
    properties: {
      device_id: {
        type: "string",
        description: "设备 ID",
      },
    },
    required: ["device_id"],
  },
  execute: async (_id, params) => apiRequest("POST", "/devices/actions/clear-text", params),
};

const keyeventTool: ToolDefinition = {
  name: "cloudphone_keyevent",
  description: "触发系统按键事件。",
  parameters: {
    type: "object",
    properties: {
      device_id: {
        type: "string",
        description: "设备 ID",
      },
      key_code: {
        type: "string",
        enum: ["BACK", "HOME", "ENTER", "RECENT", "POWER"],
        description: "系统按键码",
      },
    },
    required: ["device_id", "key_code"],
  },
  execute: async (_id, params) => apiRequest("POST", "/devices/actions/keyevent", params),
};

const waitTool: ToolDefinition = {
  name: "cloudphone_wait",
  description: "等待页面条件满足，确保操作时序稳定。",
  parameters: {
    type: "object",
    properties: {
      device_id: {
        type: "string",
        description: "设备 ID",
      },
      condition: {
        type: "string",
        enum: ["element_appear", "element_disappear", "page_stable"],
        description: "等待条件",
      },
      timeout: {
        type: "integer",
        description: "超时时间（毫秒），默认 5000",
      },
      selector: {
        type: "string",
        description: "元素选择器（条件为元素出现/消失时可用）",
      },
    },
    required: ["device_id", "condition"],
  },
  execute: async (_id, params) => apiRequest("POST", "/devices/wait", params),
};

const snapshotTool: ToolDefinition = {
  name: "cloudphone_snapshot",
  description: "获取设备截图或 UI 树快照。",
  parameters: {
    type: "object",
    properties: {
      device_id: {
        type: "string",
        description: "设备 ID",
      },
      format: {
        type: "string",
        enum: ["screenshot", "ui_tree", "both"],
        description: "快照格式，默认 screenshot",
      },
    },
    required: ["device_id"],
  },
  execute: async (_id, params) => apiRequest("POST", "/devices/snapshot", params),
};

/** 导出所有工具定义列表 */
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
];
