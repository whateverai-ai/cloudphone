import { tools, setConfig, CloudphonePluginConfig, McpToolResult } from "./tools";
import { version } from "../package.json";

/**
 * Minimal type declarations for the OpenClaw plugin API.
 * Full types are injected by the OpenClaw runtime when the plugin is loaded.
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
 * Resolve this plugin's config from the OpenClaw runtime config.
 */
function resolveConfig(api: PluginApi): CloudphonePluginConfig {
  return api.config?.plugins?.entries?.["cloudphone"]?.config ?? {};
}

function summarizeToolResult(result: McpToolResult): string {
  return JSON.stringify({
    content: result.content.map((item) =>
      item.type === "image"
        ? {
            type: item.type,
            mimeType: item.mimeType,
            dataBytes: item.data.length,
          }
        : item
    ),
  });
}

const plugin = {
  id: "cloudphone",

  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      baseUrl: {
        type: "string",
        description: "CloudPhone API base URL (without /openapi/v1)",
      },
      apikey: {
        type: "string",
        description: "Authorization credential (ApiKey)",
      },
      timeout: {
        type: "number",
        description: "Request timeout in milliseconds",
      },
    },
  },

  register(api: PluginApi) {
    const config = resolveConfig(api);
    // Log only config presence and non-sensitive values. Never print secrets.
    console.log(
      `[cloudphone] register input: config=${JSON.stringify({
        baseUrl: config.baseUrl ?? "(not configured)",
        timeout: config.timeout,
        hasApikey: !!config.apikey,
      })}`
    );
    setConfig(config);
    console.log(
      `[cloudphone] plugin loaded, version=${version}, baseUrl=${config.baseUrl ?? "(not configured, using default)"}`
    );

    for (const tool of tools) {
      api.registerTool({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        execute: async (id, params) => {
          console.log(
            `[cloudphone] tool ${tool.name} started, id=${id}, params=${JSON.stringify(params)}`
          );
          try {
            const result = await tool.execute(id, params);
            console.log(
              `[cloudphone] tool ${tool.name} result: ${summarizeToolResult(result)}`
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
                    : `[cloudphone] tool ${tool.name} did not return valid content`,
                },
              ],
            };
          } catch (err) {
            const message =
              err instanceof Error ? err.message : String(err);
            console.error(
              `[cloudphone] tool ${tool.name} failed: ${message}`
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
      console.log(`[cloudphone] registered tool: ${tool.name}`);
    }
  },
};

export default plugin;
