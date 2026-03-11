# CloudPhone Plugin for OpenClaw

OpenClaw 云手机插件 —— 让 AI Agent 具备云手机的设备管理与 UI 自动化操控能力。

通过对话即可完成云手机的查询、开关机、截图、点击、滑动、输入等操作，无需手动编写脚本。

从 `v0.0.10` 开始，插件会一并发布内置 skill `openclaw-cloudphone`，用于教 Agent 更稳定地组合使用这些工具。

## 快速开始

### 1. 安装插件

```bash
openclaw plugins install @suqiai/cloudphone
```

### 2. 配置插件

在 OpenClaw 配置文件 `openclaw.json` 中添加以下内容：

```json
{
  "plugins": {
    "entries": {
      "cloudphone": {
        "enabled": true,
        "config": {
          "baseUrl": "https://your-cloudphone-api.com",
          "apikey": "your-api-key"
        }
      }
    }
  }
}
```

### 3. 重启 Gateway

```bash
openclaw gateway restart
```

插件加载成功后，Agent 即可使用全部云手机工具；若插件启用成功，随包发布的 `openclaw-cloudphone` skill 也会一并生效。

## 插件与 Skill 的关系

这个仓库首先是一个 **OpenClaw 插件**，职责是把云手机 OpenAPI 暴露为 Agent 可调用的工具。

从 `v0.0.10` 开始，仓库还会随包发布一个 **OpenClaw Skill**：

- 插件：解决“**能做什么**”，提供 `cloudphone_*` 工具
- skill：解决“**怎样更稳地做**”，教 Agent 何时调用工具、如何按顺序调用、失败后如何恢复

两者配合后的效果是：

- 插件负责设备管理、UI 交互、截图观察等底层能力
- skill 负责把这些能力串成稳定的操作闭环

## 内置 Skill

插件内置了 `openclaw-cloudphone` skill，目录位于：

```text
skills/openclaw-cloudphone/
```

其中包含：

- `SKILL.md`：主说明，定义适用场景、标准流程、恢复策略和能力边界
- `reference.md`：14 个工具的参数速查表

该 skill 不需要额外安装脚本，也不会新增新的 API 能力。它只会帮助 Agent 更合理地使用已有工具。

### Skill 解决什么问题

`openclaw-cloudphone` 主要解决以下问题：

- 安装与排障：检查 `openclaw.json`、`baseUrl`、`apikey`、`timeout`
- 标准流程：选设备 -> 确认在线 -> 截图观察 -> 执行动作 -> 再次验证
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
| `baseUrl` | string | 否 | `https://cptest.yaltc.cn` | 云手机 API 基础地址（不含 `/openapi/v1`） |
| `apikey` | string | 是 | — | Authorization 鉴权凭证（ApiKey） |
| `timeout` | number | 否 | `5000` | 请求超时时间（毫秒） |

> `apikey` 可在云手机管理后台获取。

## 工具一览

插件安装后，Agent 将自动获得以下工具能力：

### 用户与设备管理

| 工具 | 说明 |
|------|------|
| `cloudphone_get_user_profile` | 获取当前用户基本信息 |
| `cloudphone_list_devices` | 获取云手机设备列表（支持分页、关键字搜索、状态筛选） |
| `cloudphone_get_device_info` | 获取指定设备的详细信息 |
| `cloudphone_device_power` | 设备电源控制：开机 / 关机 / 重启 |
| `cloudphone_get_adb_connection` | 获取设备的 ADB/SSH 连接信息 |

### UI 交互操控

| 工具 | 说明 |
|------|------|
| `cloudphone_tap` | 点击屏幕指定坐标 |
| `cloudphone_long_press` | 长按屏幕指定坐标（可设置时长） |
| `cloudphone_swipe` | 从起点滑动到终点（可设置时长） |
| `cloudphone_input_text` | 在当前输入框输入文本 |
| `cloudphone_clear_text` | 清空当前输入框 |
| `cloudphone_keyevent` | 发送系统按键：返回 / 主页 / 回车 / 最近任务 / 电源 |

### 状态观测

| 工具 | 说明 |
|------|------|
| `cloudphone_wait` | 等待指定条件（元素出现/消失、页面稳定） |
| `cloudphone_snapshot` | 获取设备截图或 UI 树快照 |
| `cloudphone_render_image` | 将截图 URL 渲染为对话中可直接展示的图片 |

## 使用示例

安装配置完成后，直接通过自然语言对话即可操控云手机：

### 查看设备列表

> 帮我看看我有哪些云手机

Agent 会调用 `cloudphone_list_devices` 返回设备列表。

### 开机 & 查看状态

> 把我的云手机开机，然后截个图看看当前画面

Agent 会依次调用 `cloudphone_device_power`（开机）→ `cloudphone_snapshot`（截图）→ `cloudphone_render_image`（展示截图）。

### 自动化操作

> 在云手机上打开微信，搜索"OpenClaw"公众号并关注

Agent 会结合插件工具和内置 skill 自动规划操作步骤，通过“先观察、再操作、再验证”的方式完成截图观察、点击图标、输入文字、滑动页面等动作。

### 设备调试

> 给我这台云手机的 ADB 连接信息

Agent 会调用 `cloudphone_get_adb_connection` 返回连接地址和端口。

## 工具参数详解

### cloudphone_list_devices

```
keyword   : string  — 搜索关键字（设备名称/设备 ID）
status    : string  — 状态筛选："online" | "offline"
page      : integer — 页码，默认 1
size      : integer — 每页条数，默认 20
```

### cloudphone_device_power

```
user_device_id : number — 用户设备 ID（必填）
device_id      : string — 设备 ID（必填）
action         : string — 操作类型："start" | "stop" | "restart"（必填）
```

### cloudphone_tap

```
device_id : string  — 设备 ID（必填）
x         : integer — X 坐标，像素（必填）
y         : integer — Y 坐标，像素（必填）
```

### cloudphone_long_press

```
device_id : string  — 设备 ID（必填）
x         : integer — X 坐标，像素（必填）
y         : integer — Y 坐标，像素（必填）
duration  : integer — 长按时长（毫秒），默认 1000
```

### cloudphone_swipe

```
device_id : string  — 设备 ID（必填）
start_x   : integer — 起点 X 坐标（必填）
start_y   : integer — 起点 Y 坐标（必填）
end_x     : integer — 终点 X 坐标（必填）
end_y     : integer — 终点 Y 坐标（必填）
duration  : integer — 滑动时长（毫秒），默认 300
```

### cloudphone_input_text

```
device_id : string — 设备 ID（必填）
text      : string — 输入文本内容（必填）
```

### cloudphone_keyevent

```
device_id : string — 设备 ID（必填）
key_code  : string — 按键码："BACK" | "HOME" | "ENTER" | "RECENT" | "POWER"（必填）
```

### cloudphone_wait

```
device_id : string  — 设备 ID（必填）
condition : string  — 等待条件："element_appear" | "element_disappear" | "page_stable"（必填）
timeout   : integer — 超时时间（毫秒），默认 5000
selector  : string  — 元素选择器（条件为元素出现/消失时使用）
```

### cloudphone_snapshot

```
device_id : string — 设备 ID（必填）
format    : string — 快照格式："screenshot" | "ui_tree" | "both"，默认 screenshot
```

### cloudphone_render_image

```
image_url : string — HTTPS 图片地址（必填）
```

## 常见问题

**Q: 安装后 Agent 找不到云手机工具？**

确认 `openclaw.json` 中 `plugins.entries.cloudphone.enabled` 设置为 `true`，并已重启 Gateway。

**Q: 工具能用，但 Agent 不太会稳定操作云手机 UI？**

从 `v0.0.10` 开始，插件会随包发布 `openclaw-cloudphone` skill。它会教 Agent 按“观察 -> 行动 -> 验证 -> 再观察”的闭环使用工具。请确认当前安装的是新版本，并已重新启动 Gateway 让最新 skill 被加载。

**Q: 调用工具报 "请求失败" 或超时？**

- 检查 `baseUrl` 是否正确（不要包含 `/openapi/v1` 后缀）
- 检查 `apikey` 是否有效
- 网络不稳定时可适当增大 `timeout` 值

**Q: 如何获取 apikey？**

请在云手机管理后台的「API 密钥」页面创建或查看。

**Q: 截图工具返回了 URL 但对话中看不到图片？**

Agent 会自动调用 `cloudphone_render_image` 将 URL 转为可展示的图片。如果未自动展示，可以手动让 Agent "展示这张截图"。

## 更新日志

当前版本：**v0.0.10**

### v0.0.10

- 新增随插件发布的内置 skill：`openclaw-cloudphone`
- 新增 `reference.md` 参数速查表
- 文档补充插件与 skill 的职责分工、标准流程和边界说明

## 许可证

本插件遵循项目所在仓库的许可协议。
