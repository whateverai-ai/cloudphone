## CloudPhone Plugin

OpenClaw CloudPhone 插件，用于为 Agent 提供基于云手机 OpenAPI 的工具能力（用户信息、设备管理、设备 UI 交互）。

---

### 目录结构

```
cloudphone/
├── openclaw.plugin.json   # 插件清单（id、configSchema、uiHints）
├── package.json           # npm 依赖 & 构建脚本
├── tsconfig.json          # TypeScript 编译配置
├── src/
│   ├── index.ts           # 插件入口，注册所有工具
│   └── tools.ts           # Agent 工具定义与实现
└── README.md
```

---

### 开发与构建

- **安装依赖**

```bash
npm install
```

- **开发模式（监听编译）**

```bash
npm run dev
```

- **生产构建**

```bash
npm run build
```

构建产物默认为 `dist/index.js`，并通过 `package.json` 中的 `openclaw.extensions` 暴露给 OpenClaw。

---

### 在 OpenClaw 中加载插件

- **方式一：链接模式（开发推荐）**

```bash
openclaw plugins install -l ./
```

- **方式二：扩展目录**

将整个目录复制（或软链接）到工作区：

```text
<workspace>/.openclaw/extensions/cloudphone/
```

或全局目录：

```text
~/.openclaw/extensions/cloudphone/
```

- **方式三：配置路径**

在 OpenClaw 配置中添加（指向构建后的入口文件）：

```json
{
  "plugins": {
    "load": {
      "paths": ["E:/cloudphone/dist/index.js"]
    }
  }
}
```

---

### 插件配置（`openclaw.plugin.json`）

插件配置位于 OpenClaw 配置的 `plugins.entries.cloudphone.config` 下，对应的 `configSchema` 为：

- `baseUrl`：CloudPhone API 基础地址（不包含 `/openapi/v1`），默认 `https://cptest.yaltc.cn`
- `apikey`：Authorization 鉴权凭证（ApiKey）
- `timeout`：请求超时时间（毫秒），默认 `5000`

示例配置：

```json
{
  "plugins": {
    "entries": {
      "cloudphone": {
        "enabled": true,
        "config": {
          "baseUrl": "https://cptest.yaltc.cn",
          "apikey": "your-api-key",
          "timeout": 5000
        }
      }
    }
  }
}
```

| 字段       | 类型   | 必填 | 说明                                   |
|------------|--------|------|----------------------------------------|
| `baseUrl`  | string | 否   | CloudPhone API 基础地址，未配置时使用默认值   |
| `apikey`   | string | 否   | Authorization 头的值（ApiKey）          |
| `timeout`  | number | 否   | 请求超时（ms），默认 `5000`           |

> 修改配置后通常需要重启 Gateway 才能生效。

---

### 已注册工具

所有工具都在 `src/tools.ts` 中定义，并在 `src/index.ts` 中通过 `api.registerTool` 注册。

| 工具名                            | 说明                                             |
|-----------------------------------|--------------------------------------------------|
| `cloudphone_get_user_profile` | 获取当前用户信息 |
| `cloudphone_list_devices` | 获取用户云手机列表 |
| `cloudphone_get_device_info` | 获取云手机设备详情 |
| `cloudphone_device_power` | 云手机电源控制（start/stop/restart） |
| `cloudphone_get_adb_connection` | 获取云手机 ADB/SSH 连接信息 |
| `cloudphone_tap` | 点击交互 |
| `cloudphone_long_press` | 长按交互 |
| `cloudphone_swipe` | 滑动交互 |
| `cloudphone_input_text` | 文本输入 |
| `cloudphone_clear_text` | 文本清空 |
| `cloudphone_keyevent` | 系统按键控制 |
| `cloudphone_wait` | 条件等待 |
| `cloudphone_snapshot` | 状态观测（快照） |

工具内部会根据配置自动拼接并调用 `/{baseUrl}/openapi/v1/*` 接口：

- 使用 `baseUrl`（默认 `https://cptest.yaltc.cn`）
- 在配置了 `apikey` 时附带 `Authorization` 头
- 根据 `timeout` 做超时控制，并返回明确的错误信息

---

### 扩展：添加新工具

1. 在 `src/tools.ts` 中新增一个符合 `ToolDefinition` 接口的对象：

```typescript
const myTool: ToolDefinition = {
  name: "my_tool",          // 建议使用 snake_case
  description: "工具功能描述",
  parameters: {
    type: "object",
    properties: {
      input: { type: "string", description: "输入参数" }
    },
    required: ["input"]
  },
  execute: async (_id, { input }) => {
    // 使用 config.baseUrl / config.apikey / config.timeout 实现业务逻辑
    return { content: [{ type: "text", text: JSON.stringify({ result: input }) }] };
  }
};
```

2. 将新工具加入导出的 `tools` 数组：

```typescript
export const tools: ToolDefinition[] = [myTool];
```

3. 运行构建并重启 Gateway：

```bash
npm run build
```

> 重启后，OpenClaw 会自动根据插件导出的工具列表更新 Agent 可用工具。

