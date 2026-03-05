import { tools, setConfig, CloudphonePluginConfig, McpToolResult } from "./tools";
import { version } from "../package.json";

/**
 * OpenClaw 插件 API 简化类型声明。
 * 完整类型由 OpenClaw 运行时在加载时注入，此处仅声明插件用到的部分。
 */
interface PluginApi {
  logger: {
    info: (msg: string, ...args: unknown[]) => void;
    warn: (msg: string, ...args: unknown[]) => void;
    error: (msg: string, ...args: unknown[]) => void;
  };
  config: {
    plugins?: {
      entries?: Record<string, { config?: CloudphonePluginConfig }>;
    };
  };
  registerTool: (tool: {
    name: string;
    description: string;
    parameters: unknown;
    execute: (id: string, params: Record<string, unknown>) => Promise<McpToolResult>;
  }) => void;
}

/**
 * 从 OpenClaw 运行时配置中读取当前插件的配置项。
 */
function resolveConfig(api: PluginApi): CloudphonePluginConfig {
  return api.config?.plugins?.entries?.["cloudphone"]?.config ?? {};
}

const plugin = {
  id: "cloudphone",

  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      baseUrl: {
        type: "string",
        description: "CloudPhone API 基础地址（不包含 /openapi/v1）",
      },
      apikey: {
        type: "string",
        description: "Authorization 鉴权凭证（ApiKey）",
      },
      timeout: {
        type: "number",
        description: "请求超时时间（毫秒）",
      },
    },
  },

  register(api: PluginApi) {
    const config = resolveConfig(api);
    setConfig(config);
    api.logger.info(`[cloudphone] 插件加载完成，版本=${version}，baseUrl=${config.baseUrl ?? "(未配置，使用默认值)"}`);

    for (const tool of tools) {
      api.registerTool({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        execute: async (id, params) => {
          api.logger.info(
            `[cloudphone] 工具 ${tool.name} 开始执行，id=${id}，params=${JSON.stringify(params)}`
          );
          try {
            const result = await tool.execute(id, params);
            api.logger.info(
              `[cloudphone] 工具 ${tool.name} 返回值: ${JSON.stringify(result)}`
            );
            if (
              result &&
              Array.isArray(result.content) &&
              result.content.length > 0
            ) {
              return result;
            }
            return {
              content: [
                {
                  type: "text" as const,
                  text: result
                    ? JSON.stringify(result)
                    : `[cloudphone] 工具 ${tool.name} 未返回有效内容`,
                },
              ],
            };
          } catch (err) {
            const message =
              err instanceof Error ? err.message : String(err);
            api.logger.error(
              `[cloudphone] 工具 ${tool.name} 执行异常: ${message}`
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({ ok: false, error: message }),
                },
              ],
            };
          }
        },
      });
      api.logger.info(`[cloudphone] 已注册工具: ${tool.name}`);
    }
  },
};

export default plugin;
