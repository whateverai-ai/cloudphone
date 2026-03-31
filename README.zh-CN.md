# CloudPhone Plugin for OpenClaw

[English](./README.md)

OpenClaw 云手机插件，让 AI Agent 通过自然语言即可完成云手机自动化操作。

只需一条指令，Agent 就能把任务提交给后端 AI Agent，后端负责完整的执行闭环（截图观察、LLM 规划、UI 操作），并将结果实时流式返回。

## 快速开始

### 1. 安装插件

```bash
openclaw plugins install @whateverai/cloudphone
```

后续如需更新插件，可执行：

```bash
openclaw plugins update @whateverai/cloudphone
```

### 2. 配置插件

只需在 `plugins.entries.cloudphone.config` 中填写 **`apikey`**，其余可选项由插件内置默认值覆盖。

#### 方式一：配置文件（openclaw.json）

在 `openclaw.json` 中添加以下配置：

- **apikey**：在 [https://whateverai.ai](https://whateverai.ai) 登录或注册后，在账户/设置中获取 API Key。

```json
{
  "plugins": {
    "entries": {
      "cloudphone": {
        "enabled": true,
        "config": {
          "apikey": "你可以在该网站的用户中心获取 API 密钥"
        }
      }
    }
  }
}
```

#### 方式二：OpenClaw 控制台 UI

1. 在浏览器中打开 OpenClaw 控制台。
2. 进入「插件」相关页面，找到 **CloudPhone** 并启用。
3. 填写 **apikey**（在 [https://whateverai.ai](https://whateverai.ai) 登录或注册后，于账户/设置中获取）。

### 3. 重启 Gateway

```bash
openclaw gateway restart
```

## 工作原理

本插件将云手机后端 AI Agent 能力封装为两个高层工具：

1. **`cloudphone_execute`** — 将自然语言指令提交给后端。后端负责 LLM 语义解析、云手机 UI 自动化（观察 → 规划 → 操作 闭环）。立即返回 `task_id`。

2. **`cloudphone_task_result`** — 订阅任务的 SSE 流。实时流式返回 Agent 的思考过程，执行完成后返回最终结果。

Agent 不再需要直接控制 UI 坐标、管理截图或逐一调用 tap/swipe/input 等工具。后端 AI Agent 处理完整的自动化闭环。

## 配置说明

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `apikey` | string | 是 | — | Authorization 鉴权凭证（ApiKey） |

> `apikey` 请在 [https://whateverai.ai](https://whateverai.ai) 登录或注册后，在账户/设置中获取。

`baseUrl`、`timeout` 等可选字段见 `openclaw.plugin.json`；省略时使用内置默认值。

## 工具一览

插件安装后，Agent 将自动获得以下工具能力：

### 用户与设备管理

| 工具 | 说明 |
|------|------|
| `cloudphone_get_user_profile` | 获取当前用户基本信息 |
| `cloudphone_list_devices` | 获取云手机设备列表，支持分页、关键字搜索和状态筛选 |
| `cloudphone_get_device_info` | 获取指定设备的详细信息 |

### AI Agent 任务执行

| 工具 | 说明 |
|------|------|
| `cloudphone_execute` | 提交自然语言指令，立即返回 task_id |
| `cloudphone_task_result` | 通过 SSE 流式获取 Agent 思考过程和最终结果 |

## 使用示例

安装配置完成后，可以直接通过自然语言对话操控云手机。

### 执行 UI 自动化任务

> 在云手机上打开微信，搜索"OpenClaw"公众号并关注

Agent 会：
1. 调用 `cloudphone_list_devices` 获取设备 ID
2. 调用 `cloudphone_execute` 提交指令 → 获得 `task_id`
3. 调用 `cloudphone_task_result` 传入 `task_id` → 流式返回思考过程，输出最终结果

### 查看设备列表

> 帮我看看我有哪些云手机

Agent 会调用 `cloudphone_list_devices` 返回设备列表。

### 提交任务并等待完成

```text
Agent: cloudphone_execute
  instruction: "打开抖音，搜索美食视频并点赞第一条"
  device_id: "abc123"
→ 返回: { ok: true, task_id: 42 }

Agent: cloudphone_task_result
  task_id: 42
→ 流式输出 Agent 思考，返回: { ok: true, status: "done", result: {...} }
```

## 工具参数详解

### `cloudphone_execute`

```text
instruction    : string  - 自然语言任务指令（必填）
device_id      : string  - 设备唯一 ID（推荐）
user_device_id : number  - 用户设备 ID（兼容字段，device_id 优先）
session_id     : string  - 可选会话 ID，用于流式内容持久化
lang           : string  - 语言提示："cn"（默认）或 "en"
```

### `cloudphone_task_result`

```text
task_id    : number - cloudphone_execute 返回的任务 ID（必填）
timeout_ms : number - 最大等待时间（毫秒），默认 300000
```

**返回字段：**

```text
ok         : boolean  - 操作是否成功
task_id    : number   - 输入的任务 ID 回显
status     : string   - "done" | "success" | "error" | "timeout"
thinking   : string[] - 汇总的 Agent 思考步骤列表
result     : object   - 后端返回的最终任务结果
message    : string   - 错误信息（status 为 "error" 或 "timeout" 时）
```

### `cloudphone_list_devices`

```text
keyword : string  - 搜索关键字（设备名称或设备 ID）
status  : string  - 状态筛选："online" | "offline"
page    : integer - 页码，默认 1
size    : integer - 每页条数，默认 20
```

### `cloudphone_get_device_info`

```text
user_device_id : number - 用户设备 ID（必填）
```

## 常见问题

**Q: 安装后 Agent 找不到云手机工具？**

确认 `plugins.entries.cloudphone.enabled` 设置为 `true`，然后重启 Gateway。

**Q: `cloudphone_execute` 返回成功，但 `cloudphone_task_result` 超时？**

默认超时时间为 5 分钟（300,000 毫秒）。对于长时任务可以增大 `timeout_ms`。如果任务持续超时，请检查后端服务是否可达以及设备是否在线。

**Q: 调用工具报鉴权失败或请求错误？**

- 检查 `apikey` 是否有效，修改配置后是否已重启 Gateway
- 检查本机网络与云手机服务是否可达
- `401` 错误通常表示 `apikey` 无效或已过期

**Q: 如何获取 `apikey`？**

请在 [https://whateverai.ai](https://whateverai.ai) 登录或注册后，在账户/设置中获取 API Key。

**Q: `cloudphone_execute` 支持并发任务吗？**

支持。每次调用返回独立的 `task_id`，可以分别调用 `cloudphone_task_result` 获取各自的结果。

## 更新日志

当前版本：**v2026.3.31**

### v2026.3.31

- 增强插件工具中的任务执行与结果处理流程
- 完善内置 skill 的任务相关文档与参考示例
- 同步 package/plugin/doc 的版本标识到 `v2026.3.31`

### v2026.3.30

- 移除 12 个细粒度 UI 自动化工具（tap、swipe、snapshot 等），改由后端 AI Agent 统一处理
- 新增 `cloudphone_execute`：将自然语言指令提交给后端 AI Agent
- 新增 `cloudphone_task_result`：通过 SSE 流式获取 Agent 思考过程和最终结果
- 移除 AutoGLM 直接集成（后端现在负责完整的观察 → 规划 → 操作 闭环）
- 精简插件配置：移除所有 `autoglm*` 字段，仅保留 `apikey`、`baseUrl`、`timeout`
- 同步更新 skills、README 和工具参考文档

### v2026.3.27

- 基于目标提交 `1da1031` 汇总并对齐发布说明
- 同步 package/plugin/doc 的版本标识到 `v2026.3.27`

### v1.1.0

- 增强 `cloudphone_render_image` 的截图渲染处理，提升不同宿主中的兼容性
- 新增 `cloudphone-snapshot-url` skill

### v1.0.6

- 新增随插件发布的内置 skill：`basic-skill`
- 新增 `reference.md` 参数速查表

## 许可证

本插件遵循项目所在仓库的许可协议。
