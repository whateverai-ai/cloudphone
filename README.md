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

Set **`apikey`** in `plugins.entries.cloudphone.config`. The plugin uses built-in defaults for other optional settings. If you need a **default LLM provider** for the cloud phone automation agent (backend), add optional **`llmApiKey`** and **`llmBaseUrl`** as well.

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

Optional — default LLM credentials for automation (omit if the backend supplies its own):

```json
{
  "plugins": {
    "entries": {
      "cloudphone": {
        "enabled": true,
        "config": {
          "apikey": "your CloudPhone apikey",
          "llmApiKey": "your-zai-api-key",
          "llmBaseUrl": "https://api.z.ai/api/paas/v4"
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
4. Optionally set **LLM API Key** and **LLM Base URL** if you want plugin-level default LLM settings for automation. For Z.AI usage, you can follow [Z.AI API Introduction](https://docs.z.ai/api-reference/introduction) to create an API key.

### 3. Restart the Gateway

```bash
openclaw gateway restart
```

## How It Works

This plugin exposes the CloudPhone backend AI Agent as three high-level tools:

1. **`cloudphone_execute`** — Submit a natural language instruction to the backend. The backend handles LLM interpretation, cloud phone UI automation (observe → plan → act loop), and dispatches all actions automatically. Returns a `task_id` immediately.

2. **`cloudphone_execute_and_wait`** — Auto-chain call: execute `cloudphone_execute`, then automatically run one `cloudphone_task_result` poll and return the first 10-second window result.

3. **`cloudphone_task_result`** — Subscribe to SSE for a task; each call consumes one 10-second window and returns the thinking delta for that window until terminal status.

The agent no longer needs to directly control UI coordinates, manage screenshots, or call individual tap/swipe/input tools. The backend AI Agent handles the full automation loop.

## Configuration

| Field | Type | Required | Default | Description |
|------|------|------|--------|------|
| `apikey` | string | Yes | - | Authorization credential (ApiKey) |
| `llmApiKey` | string | No | - | Default LLM provider API key for cloud phone automation (sensitive; omit if not needed). For Z.AI, create it from [Z.AI API Introduction](https://docs.z.ai/api-reference/introduction). |
| `llmBaseUrl` | string | No | - | Default LLM provider base URL for cloud phone automation. Example for Z.AI: `https://api.z.ai/api/paas/v4`. |
| `maxSteps` | integer | No | 50 | Default maximum agent steps (1-200) used when the caller of `cloudphone_execute` does not provide `max_steps`. |

> Obtain your API Key by logging in or signing up at [https://whateverai.ai](https://whateverai.ai), then find it in your account/settings.

Optional fields `baseUrl`, `timeout`, `llmApiKey`, and `llmBaseUrl` are fully described in `openclaw.plugin.json`. `baseUrl` and `timeout` use built-in defaults when omitted; LLM fields are omitted by default unless you configure them.

When using Z.AI as the LLM provider, set:
- `llmApiKey`: your Z.AI API key
- `llmBaseUrl`: `https://api.z.ai/api/paas/v4`

## Tool Overview

After the plugin is installed, the agent automatically gets the following tools.

### User and device management

| Tool | Description |
|------|------|
| `cloudphone_get_user_profile` | Get the current user's basic information |
| `cloudphone_list_devices` | List cloud phone devices with pagination, keyword search, and status filters |
| `cloudphone_get_device_info` | Get detailed information for a specific device by `device_id` |
| `cloudphone_get_device_screenshot_url` | Get the latest screenshot URL by `device_id` (default-enabled; user-trigger only) |
| `cloudphone_create_share_link` | Create a streaming share link by `device_id` (default-enabled; user-trigger only) |

### AI Agent task execution

| Tool | Description |
|------|------|
| `cloudphone_execute` | Submit a natural language instruction; returns task_id immediately |
| `cloudphone_execute_and_wait` | Auto-chain execute + first task_result poll |
| `cloudphone_task_result` | Return 10s-window thinking delta and current task status |

## Usage Examples

After installation and configuration, you can control cloud phones through natural language prompts.

### Run a UI automation task

> Open WeChat on the cloud phone, search for the "OpenClaw" public account, and follow it

The agent will:
1. Call `cloudphone_list_devices` to get the device ID
2. Call `cloudphone_execute_and_wait` to submit and trigger the first poll automatically
3. If status is `running`, continue calling `cloudphone_task_result` every ~10 seconds until `success`/`done`/`error`

### Check device status

> Show me my cloud phone devices

The agent will call `cloudphone_list_devices` and return the device list.

### Submit a task and wait for completion

```text
Agent: cloudphone_execute_and_wait
  instruction: "打开抖音，搜索美食视频并点赞第一条"
  device_id: "abc123"
→ returns: { ok: false, task_result: { status: "running", thinking: [...] } }

Agent: cloudphone_task_result
  task_id: 42
→ returns 10s-window delta until terminal: { ok: true, status: "done", result: {...} }
```

## Tool Parameters

### `cloudphone_execute`

```text
instruction    : string  - Natural language task instruction (required)
device_id      : string  - Device unique ID (recommended)
user_device_id : number  - User device ID (compatibility, device_id takes priority)
session_id     : string  - Optional session ID for streaming persistence
lang           : string  - Language hint: "cn" (default) or "en"
api_key        : string  - Optional LLM provider API key; overrides plugin-level llmApiKey when set
base_url       : string  - Optional LLM provider base URL; overrides plugin-level llmBaseUrl when set
max_steps      : integer - Maximum agent steps (1-200). Falls back to plugin-level maxSteps, then 50
```

The same parameters apply to **`cloudphone_execute_and_wait`** (it uses the same schema).

### `cloudphone_task_result`

```text
task_id    : number - Task ID from cloudphone_execute (required)
```

**Response fields:**

```text
ok         : boolean - Whether the operation succeeded
task_id    : number  - Echo of the input task_id
status     : string  - "done" | "success" | "error" | "timeout"
thinking   : string[] - New thinking lines from the current 10-second polling window (delta)
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
device_id : string - Device unique ID (32-char hex opaque identifier, required)
```

### `cloudphone_get_device_screenshot_url`

```text
device_id : string - Device unique ID (required)
```

Notes:
- This tool is available by default after plugin installation (no extra whitelist enablement required).
- Call this tool only when the user explicitly requests a screenshot URL.
- The returned `screenshot_url` is passed through as-is from upstream and should be treated as a sensitive temporary credential URL.

### `cloudphone_create_share_link`

```text
device_id : string - Device unique ID (32-char hex opaque identifier, required)
```

Notes:
- This tool is available by default after plugin installation (no extra whitelist enablement required).
- Call this tool only when the user explicitly requests to share a device or generate a share link; do not trigger autonomously.
- The returned `share_url` is a signed credential URL and may have a limited lifetime; treat it as sensitive and do not forward it beyond the user's explicit request.

## FAQ

**Q: The agent cannot find the CloudPhone tools after installation.**

Make sure `plugins.entries.cloudphone.enabled` is set to `true` in `openclaw.json`, then restart the Gateway.

**Q: Why does `cloudphone_task_result` return `running`?**

This is expected when the current 10-second polling window has not reached terminal status. Keep calling `cloudphone_task_result` every ~10 seconds until `success`/`done`/`error`.

**Q: A tool call fails with a request error or authorization failure.**

- Check whether `apikey` is valid and that you restarted the Gateway after changing config
- Check network connectivity and whether the CloudPhone service is reachable
- `401` errors indicate an invalid or expired `apikey`

**Q: How do I get an `apikey`?**

Log in or sign up at [https://whateverai.ai](https://whateverai.ai) and get your API Key from your account/settings.

**Q: Does `cloudphone_execute` support concurrent tasks?**

No, not for the same agent context. The plugin enforces serial execution per agent key (`session_id`, then `device_id`, then `user_device_id`, otherwise default).  
If you call `cloudphone_execute` before the previous task reaches terminal status in `cloudphone_task_result`, it returns `code: "AGENT_BUSY"` with `blocking_task_id`.

Required call order:

1. `cloudphone_execute_and_wait` (auto-runs the first poll)
2. `cloudphone_task_result` (if status is `running`, continue polling until terminal: `success`/`done`/`error`)
3. Next `cloudphone_execute`

## Changelog

Current version: **v2026.4.24**

### v2026.4.24

- Added `cloudphone_create_share_link` to generate a streaming share link for a specific cloud phone device by `device_id` (default-enabled; user-trigger only; the returned `share_url` is a sensitive signed credential URL)
- Switched `cloudphone_create_share_link` and `cloudphone_get_device_info` inputs from the long-integer `user_device_id` to the 32-char opaque hex `device_id`, aligning with `cloudphone_get_device_screenshot_url` and avoiding LLM long-integer precision loss on tool-call payloads
- Preserved long-integer precision across all API responses by replacing native `JSON.parse` with `json-bigint` (`storeAsString: true`) in `apiRequest`, keeping 19-digit snowflake IDs (for example `user_device_id`, `id`, `fk_viz_tn_machine_id`) intact for the agent
- Extended the new parser to `cloudphone_execute` / `cloudphone_get_device_screenshot_url` inline `fetch` branches and to SSE event parsing (`agent_thinking`, `task_result`, `error`) in `cloudphone_task_result`, and hardened `normalizeTaskId` to accept and validate string `task_id` inputs
- Added runtime dependency `json-bigint` (and dev type `@types/json-bigint`)
- Synced package/plugin/doc version references to `v2026.4.24`

### v2026.4.20

- Added optional `max_steps` parameter to `cloudphone_execute` (and `cloudphone_execute_and_wait`) for capping the backend agent's maximum action steps per task (range 1-200)
- Added optional plugin config `maxSteps` (integer, 1-200, default 50) used as the fallback when the caller omits `max_steps`
- `cloudphone_execute` now always forwards the resolved `max_steps` value to the backend using the priority chain: caller input → plugin config → default 50, with automatic integer flooring and range clamping
- Synced package/plugin/doc version references to `v2026.4.20`

### v2026.4.14001

- Expanded setup documentation for default LLM provider settings, including `llmApiKey` and `llmBaseUrl` examples
- Clarified `cloudphone_execute`/`cloudphone_execute_and_wait` optional override parameters `api_key` and `base_url`
- Synced package/plugin/doc version references to `v2026.4.14001`

### v2026.4.14

- Added optional plugin config `llmApiKey` and `llmBaseUrl` for default LLM credentials used by the cloud phone automation agent
- Extended `cloudphone_execute` with optional `api_key` and `base_url` parameters to override plugin-level LLM settings per task
- Synced package/plugin/doc version references to `v2026.4.14`

### v2026.4.3

- Added `cloudphone_get_device_screenshot_url` to fetch the latest device screenshot URL (default-enabled; intended for explicit user requests only)
- Redacted signed query parameters from `screenshot_url` in plugin logs and tool-result summaries while returning the full URL to the agent
- Scoped `tsconfig.json` to `src/**/*.ts` and excluded `*.test.ts` from the build output
- Synced package/plugin/doc version references to `v2026.4.3`

### v2026.4.2

- Set default CloudPhone API base URL to `https://whateverai.ai/ai` in runtime, manifest defaults, and tests (aligned with product domain)
- Synced package/plugin/doc version references to `v2026.4.2`

### v2026.4.1

- Added `cloudphone_execute_and_wait` to auto-chain task submission and the first result polling
- Clarified tool behavior and call sequence documentation for task execution and polling
- Updated `.gitignore` with `docs/` and `openspec/` entries for cleaner project management
- Synced package/plugin/doc version references to `v2026.4.1`

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
