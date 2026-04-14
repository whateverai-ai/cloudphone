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

本插件将云手机后端 AI Agent 能力封装为三个高层工具：

1. **`cloudphone_execute`** — 将自然语言指令提交给后端。后端负责 LLM 语义解析、云手机 UI 自动化（观察 → 规划 → 操作 闭环）。立即返回 `task_id`。

2. **`cloudphone_execute_and_wait`** — 自动串联调用：先执行 `cloudphone_execute`，再自动触发一次 `cloudphone_task_result`，返回首个 10 秒轮询窗口结果。

3. **`cloudphone_task_result`** — 订阅任务的 SSE 流；每次调用消费一个 10 秒窗口并返回该窗口内的 `thinking` 增量，直到终态。

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
| `cloudphone_get_device_screenshot_url` | 按 `device_id` 获取最新截图 URL（默认可用；仅用户触发） |

### AI Agent 任务执行

| 工具 | 说明 |
|------|------|
| `cloudphone_execute` | 提交自然语言指令，立即返回 task_id |
| `cloudphone_execute_and_wait` | 自动串联 execute + 首次 task_result 轮询 |
| `cloudphone_task_result` | 每次返回 10 秒窗口内的思考增量与当前状态 |

## 使用示例

安装配置完成后，可以直接通过自然语言对话操控云手机。

### 执行 UI 自动化任务

> 在云手机上打开微信，搜索"OpenClaw"公众号并关注

Agent 会：
1. 调用 `cloudphone_list_devices` 获取设备 ID
2. 调用 `cloudphone_execute_and_wait` 提交指令并自动触发首次结果轮询
3. 若状态为 `running`，继续每 10 秒调用一次 `cloudphone_task_result`，直到 `success`/`done`/`error`

### 查看设备列表

> 帮我看看我有哪些云手机

Agent 会调用 `cloudphone_list_devices` 返回设备列表。

### 提交任务并等待完成

```text
Agent: cloudphone_execute_and_wait
  instruction: "打开抖音，搜索美食视频并点赞第一条"
  device_id: "abc123"
→ 返回: { ok: false, task_result: { status: "running", thinking: [...] } }

Agent: cloudphone_task_result
  task_id: 42
→ 10 秒窗口增量，直到终态: { ok: true, status: "done", result: {...} }
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
```

**返回字段：**

```text
ok         : boolean  - 操作是否成功
task_id    : number   - 输入的任务 ID 回显
status     : string   - "done" | "success" | "error" | "timeout"
thinking   : string[] - 当前 10 秒窗口内新增的 Agent 思考步骤（增量）
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

### `cloudphone_get_device_screenshot_url`

```text
device_id : string - 设备唯一 ID（必填）
```

说明：
- 插件安装后该工具默认可用，无需额外白名单开启。
- 仅在用户明确要求获取截图 URL 时调用，禁止自主触发。
- 返回的 `screenshot_url` 为上游原样透传，应视为敏感的临时凭证链接。

## 常见问题

**Q: 安装后 Agent 找不到云手机工具？**

确认 `plugins.entries.cloudphone.enabled` 设置为 `true`，然后重启 Gateway。

**Q: `cloudphone_task_result` 为什么返回 `running`？**

这是正常行为，表示当前 10 秒轮询窗口未到终态。请继续每 10 秒调用一次 `cloudphone_task_result`，直到 `success`/`done`/`error`。

**Q: 调用工具报鉴权失败或请求错误？**

- 检查 `apikey` 是否有效，修改配置后是否已重启 Gateway
- 检查本机网络与云手机服务是否可达
- `401` 错误通常表示 `apikey` 无效或已过期

**Q: 如何获取 `apikey`？**

请在 [https://whateverai.ai](https://whateverai.ai) 登录或注册后，在账户/设置中获取 API Key。

**Q: `cloudphone_execute` 支持并发任务吗？**

同一 agent 上下文不支持并发。插件会按 agent key（优先 `session_id`，其次 `device_id`，再其次 `user_device_id`，最后 default）强制串行执行。  
如果上一个任务还未在 `cloudphone_task_result` 到达终态，你再次调用 `cloudphone_execute` 会返回 `code: "AGENT_BUSY"`，并携带 `blocking_task_id`。

推荐调用顺序：

1. `cloudphone_execute_and_wait`（自动触发首次轮询）
2. `cloudphone_task_result`（若返回 `running`，继续轮询到终态：`success`/`done`/`error`）
3. 再次 `cloudphone_execute`

## 更新日志

当前版本：**v2026.4.14**

### v2026.4.14

- 新增可选插件配置项 `llmApiKey`、`llmBaseUrl`，作为云手机自动化 Agent 的默认 LLM 凭证
- 为 `cloudphone_execute` 增加可选参数 `api_key`、`base_url`，可按任务覆盖插件级 LLM 设置
- 同步 package/plugin/doc 的版本标识到 `v2026.4.14`

### v2026.4.3

- 新增 `cloudphone_get_device_screenshot_url`，按设备获取最新截图 URL（默认可用；仅应在用户明确提及时调用）
- 日志与工具结果摘要中对 `screenshot_url` 的签名类查询参数脱敏，仍向 Agent 返回完整 URL
- `tsconfig.json` 仅编译 `src/**/*.ts`，并将 `*.test.ts` 排除在构建产物之外
- 同步 package/plugin/doc 的版本标识到 `v2026.4.3`

### v2026.4.2

- 将默认 CloudPhone API 基址设为 `https://whateverai.ai/ai`（运行时、清单默认值与测试均已对齐产品域名）
- 同步 package/plugin/doc 的版本标识到 `v2026.4.2`

### v2026.4.1

- 新增 `cloudphone_execute_and_wait`，自动串联任务提交与首次结果轮询
- 明确任务提交、轮询与调用顺序的工具说明文档
- 在 `.gitignore` 中新增 `docs/` 与 `openspec/`，便于项目管理
- 同步 package/plugin/doc 的版本标识到 `v2026.4.1`

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
