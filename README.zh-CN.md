# CloudPhone Plugin for OpenClaw

[English](./README.md)

OpenClaw 云手机插件，让 AI Agent 具备云手机的设备管理与 UI 自动化操控能力。

通过自然语言对话即可完成云手机的查询、开关机、截图、点击、滑动、输入等操作，无需手动编写脚本。

从 `v2026.3.26.1` 开始，插件会一并发布内置 skills（包含 `basic-skill`），用于教 Agent 更稳定地组合使用这些工具。

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

一般情况下，只需在 `plugins.entries.cloudphone.config` 中填写 **`apikey`**；其余可选项由插件内置默认值覆盖。若需自托管或进阶调优，仍可在 `openclaw.json` 或控制台中补充 `baseUrl`、`timeout` 等可选字段，完整字段说明见本包中的 `openclaw.plugin.json`。

可通过以下两种方式之一配置插件。

#### 方式一：配置文件（openclaw.json）

在 `openclaw.json` 中添加以下配置：

- **apikey**：在 [https://whateverai.ai](https://whateverai.ai) 登录或注册后，在账户/设置中获取 API Key，填入下方 `apikey` 字段。

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

也可以在 OpenClaw 控制台页面上配置 CloudPhone 插件：

1. 在浏览器中打开 OpenClaw 控制台。
2. 进入「插件」相关页面，找到 **CloudPhone** 并启用。
3. 填写 **apikey**（在 [https://whateverai.ai](https://whateverai.ai) 登录或注册后，于账户/设置中获取）。

参考截图：

![OpenClaw 控制台 — 插件](https://github.com/whateverai-ai/cloudphone/blob/main/assets/0.jpg)

![OpenClaw 控制台 — CloudPhone 配置](https://github.com/whateverai-ai/cloudphone/blob/main/assets/1.jpg)

### 3. 重启 Gateway

```bash
openclaw gateway restart
```

插件加载成功后，Agent 即可使用全部云手机工具；若插件启用成功，随包发布的 `basic-skill` skill 也会一并生效。

## 插件与 Skill 的关系

这个仓库首先是一个 **OpenClaw 插件**，职责是把云手机 OpenAPI 暴露为 Agent 可调用的工具。

从 `v2026.3.26.1` 开始，仓库会随包发布 **OpenClaw Skills**：

- 插件：解决“能做什么”，提供 `cloudphone_*` 工具
- skill：解决“怎样更稳地做”，教 Agent 何时调用工具、如何按顺序调用、失败后如何恢复

两者配合后的效果是：

- 插件负责设备管理、UI 交互、截图观察等底层能力
- skill 负责把这些能力串成稳定的操作闭环

## 内置 Skill

插件内置了 `basic-skill` skill，目录位于：

```text
skills/basic-skill/
```

其中包含：

- `SKILL.md`：主说明，定义适用场景、标准流程、恢复策略和能力边界
- `reference.md`：14 个工具的参数速查表

该 skill 不需要额外安装脚本，也不会新增新的 API 能力。它只会帮助 Agent 更合理地使用已有工具。

### Skill 解决什么问题

`basic-skill` 主要解决以下问题：

- 安装与排障：检查 `openclaw.json` 与 `apikey`
- 标准流程：选设备 -> 确认在线 -> 观察 -> 操作 -> 验证
- UI 自动化稳定性：采用“观察 -> 行动 -> 验证 -> 再观察”的短闭环
- 恢复策略：优先 `BACK`、`HOME`、重新截图，必要时重启设备

### Skill 的能力边界

当前 skill 是建立在现有插件工具集上的，因此它不会自动补齐下面这些高层能力：

- OCR
- 按文本找控件
- 按 selector 直接点击控件
- 指定包名启动 App
- 复杂宏录制与回放

如果你需要这些能力，应继续扩展插件，而不是只改 skill。

## 配置说明

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `apikey` | string | 是 | — | Authorization 鉴权凭证（ApiKey） |

> `apikey` 请在 [https://whateverai.ai](https://whateverai.ai) 登录或注册后，在账户/设置中获取。

`baseUrl`、`timeout` 等可选字段见 `openclaw.plugin.json`；省略时使用内置默认值，仅在自托管或需要调优时再填写。

## 工具一览

插件安装后，Agent 将自动获得以下工具能力：

### 用户与设备管理

| 工具 | 说明 |
|------|------|
| `cloudphone_get_user_profile` | 获取当前用户基本信息 |
| `cloudphone_list_devices` | 获取云手机设备列表，支持分页、关键字搜索和状态筛选 |
| `cloudphone_get_device_info` | 获取指定设备的详细信息 |
| `cloudphone_device_power` | 设备电源控制：开机、关机或重启 |
| `cloudphone_get_adb_connection` | 获取设备的 ADB/SSH 连接信息 |

### UI 交互操控

| 工具 | 说明 |
|------|------|
| `cloudphone_tap` | 点击屏幕指定坐标 |
| `cloudphone_long_press` | 长按指定坐标，可设置时长 |
| `cloudphone_swipe` | 从起点滑动到终点，可设置时长 |
| `cloudphone_input_text` | 在当前输入框输入文本 |
| `cloudphone_clear_text` | 清空当前输入框 |
| `cloudphone_keyevent` | 发送系统按键：返回、主页、回车、最近任务或电源 |

### 状态观测

| 工具 | 说明 |
|------|------|
| `cloudphone_wait` | 等待条件满足，例如元素出现、消失或页面稳定 |
| `cloudphone_snapshot` | 获取设备截图 |
| `cloudphone_render_image` | 将截图 URL 渲染为对话中可直接展示的图片 |

## planActionTool（`cloudphone_plan_action`）

`planActionTool` 对应工具名 `cloudphone_plan_action`。它会调用 AutoGLM 模型，结合当前截图与任务目标，产出结构化的下一步操作规划，帮助云手机 UI 自动化更稳地决策。

典型场景：
- 页面状态复杂，不确定下一步动作
- 执行前先判断应点击/滑动/输入什么
- 直接操作多次失败后用于恢复决策

### 前置配置

使用 `cloudphone_plan_action` 前需要在插件配置中设置：
- 必填：`autoglmBaseUrl`、`autoglmApiKey`、`autoglmModel`
- 可选：`autoglmMaxTokens`（默认 `3000`）、`autoglmLang`（默认 `cn`）

示例（`plugins.entries.cloudphone.config`）：

```json
{
  "autoglmBaseUrl": "https://open.bigmodel.cn/api/paas/v4",
  "autoglmApiKey": "your-api-key",
  "autoglmModel": "autoglm-phone",
  "autoglmMaxTokens": 3000,
  "autoglmLang": "cn"
}
```

### 参数与最小示例

核心入参：
- `device_id`：目标云手机设备 ID
- `goal`：自然语言任务目标

最小示例：

```text
device_id: "your-device-id"
goal: "打开微信并进入搜索页面"
```

预期输出：
- 对当前页面的分析摘要
- 可由 `cloudphone_*` 工具执行的下一步建议动作

### 注意事项

- 缺少必填 `autoglm*` 配置时，工具会返回配置错误。
- 推荐链路：`cloudphone_snapshot` -> `cloudphone_plan_action` -> 用 `cloudphone_tap`/`cloudphone_swipe`/`cloudphone_input_text` 执行 -> 再截图验证。
- 每次 `goal` 尽量聚焦一个短目标，可提升规划质量与稳定性。

## 使用示例

安装配置完成后，可以直接通过自然语言对话操控云手机。

### 查看设备列表

> 帮我看看我有哪些云手机

Agent 会调用 `cloudphone_list_devices` 返回设备列表。

### 开机并查看当前画面

> 把我的云手机开机，然后截个图看看当前画面

Agent 通常会依次调用 `cloudphone_device_power` -> `cloudphone_snapshot` -> `cloudphone_render_image`。

### 执行 UI 自动化任务

> 在云手机上打开微信，搜索“OpenClaw”公众号并关注

Agent 会结合插件工具和内置 skill 自动规划步骤，并通过“先观察、再操作、再验证”的方式完成整个流程。

### 获取调试连接信息

> 给我这台云手机的 ADB 连接信息

Agent 会调用 `cloudphone_get_adb_connection` 返回连接地址和端口。

## 工具参数详解

### `cloudphone_list_devices`

```text
keyword   : string  - 搜索关键字（设备名称或设备 ID）
status    : string  - 状态筛选："online" | "offline"
page      : integer - 页码，默认 1
size      : integer - 每页条数，默认 20
```

### `cloudphone_device_power`

```text
user_device_id : number - 用户设备 ID（必填）
device_id      : string - 设备 ID（必填）
action         : string - 操作类型："start" | "stop" | "restart"（必填）
```

### `cloudphone_tap`

```text
device_id : string  - 设备 ID（必填）
x         : integer - X 坐标，像素（必填）
y         : integer - Y 坐标，像素（必填）
```

### `cloudphone_long_press`

```text
device_id : string  - 设备 ID（必填）
x         : integer - X 坐标，像素（必填）
y         : integer - Y 坐标，像素（必填）
duration  : integer - 长按时长（毫秒），默认 1000
```

### `cloudphone_swipe`

```text
device_id : string  - 设备 ID（必填）
start_x   : integer - 起点 X 坐标（必填）
start_y   : integer - 起点 Y 坐标（必填）
end_x     : integer - 终点 X 坐标（必填）
end_y     : integer - 终点 Y 坐标（必填）
duration  : integer - 滑动时长（毫秒），默认 300
```

### `cloudphone_input_text`

```text
device_id : string - 设备 ID（必填）
text      : string - 输入文本内容（必填）
```

### `cloudphone_keyevent`

```text
device_id : string - 设备 ID（必填）
key_code  : string - 按键码："BACK" | "HOME" | "ENTER" | "RECENT" | "POWER"（必填）
```

### `cloudphone_wait`

```text
device_id : string  - 设备 ID（必填）
condition : string  - 等待条件："element_appear" | "element_disappear" | "page_stable"（必填）
timeout   : integer - 超时时间（毫秒），默认 5000
selector  : string  - 元素选择器（在元素出现/消失条件下使用）
```

### `cloudphone_snapshot`

```text
device_id : string - 设备 ID（必填）
format    : string - 快照格式："screenshot"（当前仅支持 screenshot）
```

### `cloudphone_render_image`

```text
image_url : string - HTTPS 图片地址（必填）
```

## 常见问题

**Q: 安装后 Agent 找不到云手机工具？**

确认 `plugins.entries.cloudphone.enabled` 设置为 `true`，然后重启 Gateway。

**Q: 工具能用，但 Agent 不太会稳定操作云手机 UI？**

从 `v2026.3.26.1` 开始，插件会随包发布内置 skills（如 `basic-skill`）。它们会教 Agent 按“观察 -> 行动 -> 验证 -> 再观察”的闭环使用工具。请确认当前安装的是较新版本，并已重启 Gateway 让最新 skills 被加载。

**Q: 调用工具报请求失败或超时？**

- 检查 `apikey` 是否有效，修改配置后是否已重启 Gateway
- 检查本机网络与云手机服务是否可达
- 若使用自定义部署或端点，请在自有环境侧确认路由与可用性

**Q: 如何获取 `apikey`？**

请在 [https://whateverai.ai](https://whateverai.ai) 登录或注册后，在账户/设置中获取 API Key。

**Q: `cloudphone_snapshot` 返回了 URL，但对话中看不到图片？**

Agent 应该会自动调用 `cloudphone_render_image` 将该 URL 转成可展示的图片。当前版本会优先返回 MCP `image` 内容块，并附带兼容旧宿主的 `MEDIA:<filePath>` 文本。如果仍未展示，可以手动要求 Agent 展示截图；若仍无效，基本说明当前宿主没有消费 `type: "image"` 内容项。

## 更新日志

当前版本：**v2026.3.26.1**

### v2026.3.26.1

- 修复 README 仍残留 `v1.1.0` 的版本表述
- 同步发布相关版本标识到 `v2026.3.26.1`
- 中英文版本显示与更新日志表述保持一致

### v2026.3.26

- 为 cloudphone_plan_action 增加详细分步日志，提升调试与失败排查效率
- 完善 planActionTool 文档说明，补充前置配置、调用流程和注意事项（中英文 README 同步）
- 同步内置 skills 相关表述与发布文档，使其与当前 v1.1.0+ 行为保持一致

### v1.1.0

- 增强 `cloudphone_render_image` 的截图渲染处理，提升不同宿主中的兼容性与展示稳定性
- 新增 `cloudphone-snapshot-url` skill，并同步更新 `basic-skill` 及参数速查文档的截图 URL 使用指引
- 同步修订中英文文档中的截图相关工具说明与 skill 指南

### v1.0.8

- 精简插件配置文档：一般用户只需配置 `apikey`；可选 `baseUrl`、`timeout` 仍在 `openclaw.plugin.json` 中，省略时使用内置默认值
- 同步更新 `basic-skill` 的前置条件与排障说明
- 同步修订中英文 README 与更新日志表述

### v1.0.7

- 调整 `cloudphone_snapshot` 文档，明确当前仅支持设备截图能力
- 更新 `format` 参数说明，标注仅支持 `screenshot`
- 同步修订中英文 README 与工具参数参考文档的描述一致性
- 将工具一览表中 `cloudphone_snapshot` 的说明与参数文档对齐

### v1.0.6

- 新增随插件发布的内置 skill：`basic-skill`
- 新增 `reference.md` 参数速查表
- 补充插件与 skill 的职责分工、标准流程和能力边界说明

## 许可证

本插件遵循项目所在仓库的许可协议。
