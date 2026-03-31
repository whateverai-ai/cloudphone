# CloudPhone Plugin for OpenClaw

[Chinese README](./README.zh-CN.md)

OpenClaw CloudPhone is a plugin that gives AI agents cloud phone automation capabilities through natural language.

With a single instruction, an agent can submit any cloud phone task to the backend AI Agent, which handles the full execution loop — screen observation, LLM planning, and UI actions — and streams the result back in real time.

## Quick Start

### 1. Install the plugin

```bash
openclaw plugins install @whateverai/cloudphone
```

To update the plugin later, run:

```bash
openclaw plugins update @whateverai/cloudphone
```

### 2. Configure the plugin

Set **`apikey`** in `plugins.entries.cloudphone.config`. The plugin uses built-in defaults for other optional settings.

#### Option A: Configuration file (openclaw.json)

Add the following configuration to `openclaw.json`:

- **apikey**: Obtain your API Key by logging in or signing up at [https://whateverai.ai](https://whateverai.ai), then add it in your account/settings.

```json
{
  "plugins": {
    "entries": {
      "cloudphone": {
        "enabled": true,
        "config": {
          "apikey": "the apikey you can get from the user center of this website"
        }
      }
    }
  }
}
```

#### Option B: OpenClaw Console UI

1. Open the OpenClaw console in your browser.
2. Go to the Plugins section, find **CloudPhone** and enable it.
3. Set **apikey** (from [https://whateverai.ai](https://whateverai.ai) after login or sign-up).

### 3. Restart the Gateway

```bash
openclaw gateway restart
```

## How It Works

This plugin exposes the CloudPhone backend AI Agent as two high-level tools:

1. **`cloudphone_execute`** — Submit a natural language instruction to the backend. The backend handles LLM interpretation, cloud phone UI automation (observe → plan → act loop), and dispatches all actions automatically. Returns a `task_id` immediately.

2. **`cloudphone_task_result`** — Subscribe to the SSE stream for a task. Streams the agent's thinking process in real time and returns the final task result when execution completes.

The agent no longer needs to directly control UI coordinates, manage screenshots, or call individual tap/swipe/input tools. The backend AI Agent handles the full automation loop.

## Configuration

| Field | Type | Required | Default | Description |
|------|------|------|--------|------|
| `apikey` | string | Yes | - | Authorization credential (ApiKey) |

> Obtain your API Key by logging in or signing up at [https://whateverai.ai](https://whateverai.ai), then find it in your account/settings.

Optional fields such as `baseUrl` and `timeout` are documented in `openclaw.plugin.json` and use built-in defaults when omitted.

## Tool Overview

After the plugin is installed, the agent automatically gets the following tools.

### User and device management

| Tool | Description |
|------|------|
| `cloudphone_get_user_profile` | Get the current user's basic information |
| `cloudphone_list_devices` | List cloud phone devices with pagination, keyword search, and status filters |
| `cloudphone_get_device_info` | Get detailed information for a specific device |

### AI Agent task execution

| Tool | Description |
|------|------|
| `cloudphone_execute` | Submit a natural language instruction; returns task_id immediately |
| `cloudphone_task_result` | Stream agent thinking and final result for a task via SSE |

## Usage Examples

After installation and configuration, you can control cloud phones through natural language prompts.

### Run a UI automation task

> Open WeChat on the cloud phone, search for the "OpenClaw" public account, and follow it

The agent will:
1. Call `cloudphone_list_devices` to get the device ID
2. Call `cloudphone_execute` with the instruction → receives `task_id`
3. Call `cloudphone_task_result` with `task_id` → streams thinking and returns result

### Check device status

> Show me my cloud phone devices

The agent will call `cloudphone_list_devices` and return the device list.

### Submit a task and wait for completion

```text
Agent: cloudphone_execute
  instruction: "打开抖音，搜索美食视频并点赞第一条"
  device_id: "abc123"
→ returns: { ok: true, task_id: 42 }

Agent: cloudphone_task_result
  task_id: 42
→ streams agent thinking, returns: { ok: true, status: "done", result: {...} }
```

## Tool Parameters

### `cloudphone_execute`

```text
instruction    : string  - Natural language task instruction (required)
device_id      : string  - Device unique ID (recommended)
user_device_id : number  - User device ID (compatibility, device_id takes priority)
session_id     : string  - Optional session ID for streaming persistence
lang           : string  - Language hint: "cn" (default) or "en"
```

### `cloudphone_task_result`

```text
task_id    : number - Task ID from cloudphone_execute (required)
timeout_ms : number - Max wait time in milliseconds (default 300000)
```

**Response fields:**

```text
ok         : boolean - Whether the operation succeeded
task_id    : number  - Echo of the input task_id
status     : string  - "done" | "success" | "error" | "timeout"
thinking   : string[] - Aggregated agent thinking steps
result     : object  - Final task result from the backend
message    : string  - Error message (when status is "error" or "timeout")
```

### `cloudphone_list_devices`

```text
keyword : string  - Search keyword (device name or device ID)
status  : string  - Status filter: "online" | "offline"
page    : integer - Page number, default 1
size    : integer - Items per page, default 20
```

### `cloudphone_get_device_info`

```text
user_device_id : number - User device ID (required)
```

## FAQ

**Q: The agent cannot find the CloudPhone tools after installation.**

Make sure `plugins.entries.cloudphone.enabled` is set to `true` in `openclaw.json`, then restart the Gateway.

**Q: `cloudphone_execute` returns ok but `cloudphone_task_result` times out.**

The default timeout is 5 minutes (300,000 ms). For long-running tasks you can increase `timeout_ms`. If the task consistently times out, check that the backend service is reachable and the device is online.

**Q: A tool call fails with a request error or authorization failure.**

- Check whether `apikey` is valid and that you restarted the Gateway after changing config
- Check network connectivity and whether the CloudPhone service is reachable
- `401` errors indicate an invalid or expired `apikey`

**Q: How do I get an `apikey`?**

Log in or sign up at [https://whateverai.ai](https://whateverai.ai) and get your API Key from your account/settings.

**Q: Does `cloudphone_execute` support concurrent tasks?**

Yes. Each call returns an independent `task_id`. You can call `cloudphone_task_result` with each `task_id` separately.

## Changelog

Current version: **v2026.3.31**

### v2026.3.31

- Enhanced task execution and result handling flow in plugin tools
- Improved task-related documentation and reference examples in built-in skills
- Synced package/plugin/doc version references to `v2026.3.31`

### v2026.3.30

- Replaced 12 fine-grained UI automation tools (tap, swipe, snapshot, etc.) with 2 high-level backend-delegated tools
- Added `cloudphone_execute`: submit natural language instructions to the backend AI Agent
- Added `cloudphone_task_result`: stream agent thinking and final result via SSE
- Removed AutoGLM direct integration (backend now handles the full observe → plan → act loop)
- Simplified plugin config: removed all `autoglm*` fields, only `apikey`, `baseUrl`, `timeout` remain
- Updated skills, README, and reference docs to reflect new architecture

### v2026.3.27

- Summarized and aligned release notes based on target commit `1da1031`
- Synced package/plugin/doc version references to `v2026.3.27`

### v1.1.0

- Enhanced screenshot handling in `cloudphone_render_image` for improved compatibility
- Added the `cloudphone-snapshot-url` skill

### v1.0.6

- Added the built-in `basic-skill` skill distributed with the plugin
- Added `reference.md` as a tool parameter quick reference

## License

This plugin follows the license terms of the repository it belongs to.
