# CloudPhone Tool Reference

This file is the parameter quick reference for the `basic-skill` skill. It describes the tools currently provided by the plugin.

The source of truth for parameters and descriptions is `src/tools.ts`.

## Device Management

### `cloudphone_get_user_profile`

- Purpose: get the current user's basic information
- Parameters: none
- Returns: user information as JSON text

### `cloudphone_list_devices`

- Purpose: list the current user's cloud phone devices with pagination and filters
- Parameters:
  - `keyword`: `string`, optional, keyword matching device name or device ID
  - `status`: `string`, optional, allowed values: `online`, `offline`
  - `page`: `integer`, optional, page number, default `1`
  - `size`: `integer`, optional, items per page, default `20`
- Returns: device list as JSON text; each device entry includes `device_id` and `user_device_id`
- Typical use: locate the target device before submitting an automation task

### `cloudphone_get_device_info`

- Purpose: get details for a specific cloud phone device
- Required parameters:
  - `user_device_id`: `number`, user device ID
- Returns: device details as JSON text

## AI Agent Task Execution

### `cloudphone_execute`

- Purpose: submit a natural language instruction to the backend AI Agent for cloud phone automation
- Required parameters:
  - `instruction`: `string`, natural language task description
- Optional parameters:
  - `device_id`: `string`, device unique ID (recommended; takes priority over `user_device_id`)
  - `user_device_id`: `number`, user device ID (compatibility field)
  - `session_id`: `string`, optional session ID for streaming persistence
  - `lang`: `string`, language hint — `"cn"` (default) or `"en"`
- Returns: JSON text containing:
  - `ok`: `boolean`
  - `task_id`: `number` — use this with `cloudphone_task_result`
  - `session_id`: `string` — echo of input session_id if provided
  - `status`: `string` — `"success"` or `"fail"`
  - `message`: `string` — human-readable status message
- Typical use: the first call in every automation workflow; always follow with `cloudphone_task_result`

**Example instruction values:**

```text
"打开微信，在搜索框输入 OpenClaw 并进入该公众号"
"Open Taobao, search for running shoes, add the first result to cart"
"打开应用宝"
```

**FORBIDDEN instruction patterns (never use these):**

| Forbidden | Reason |
|-----------|--------|
| "截图" / "截屏" / "take a screenshot" | The backend cannot relay image data through the SSE result stream; this instruction produces no useful output |
| Autonomous extra steps not requested by the user | Only submit what the user explicitly asked for |
| Submitting a new task while a previous one is still running | Wait for `cloudphone_task_result` to complete first |

### `cloudphone_task_result`

- Purpose: subscribe to the SSE stream for a task and return aggregated thinking + final result
- Required parameters:
  - `task_id`: `number`, task ID from `cloudphone_execute`
- Optional parameters:
  - `timeout_ms`: `number`, maximum wait time in milliseconds, default `300000` (5 minutes)
- Returns: JSON text containing:
  - `ok`: `boolean`
  - `task_id`: `number` — echo of input task_id
  - `status`: `string` — `"done"` | `"success"` | `"error"` | `"timeout"`
  - `thinking`: `string[]` — list of agent thinking steps, including the final task summary message
  - `result`: `object` — final structured result from the backend; contains `status`, `message`, `history`, `agent_type`, `task_id`, `instruction` fields
  - `message`: `string` — error or timeout message when status is not `"done"`/`"success"`
- Typical use: always call after `cloudphone_execute`; the tool blocks until the stream ends or timeout
- Retry behavior: on transient network errors or timeouts, the tool automatically retries up to 2 times internally before returning

**Status meanings:**

| status | Meaning |
|--------|---------|
| `"done"` | Task completed successfully, stream closed normally |
| `"success"` | Backend sent a `task_result` event (may arrive before `done`) |
| `"error"` | Backend sent an `error` event or an `agent_thinking` error sub-event; check `message` |
| `"timeout"` | `timeout_ms` elapsed before stream ended after all retry attempts; task may still be running |

**result object structure (when status is "success" or "done"):**

```json
{
  "status": "success",
  "message": "Agent reasoning and final action summary",
  "history": [{ "message": "...", "_metadata": "finish" }],
  "agent_type": "phone-agent",
  "task_id": "uuid-string",
  "instruction": "original instruction text"
}
```

## Recommended Calling Order

### Standard Automation Flow

```text
1. cloudphone_list_devices          → identify device_id
2. cloudphone_execute(instruction, device_id) → get task_id
3. cloudphone_task_result(task_id)  → get thinking + result
```

### With Device Verification

```text
1. cloudphone_list_devices          → confirm device is online, get device_id
2. cloudphone_execute(instruction, device_id) → get task_id
3. cloudphone_task_result(task_id)  → get result
4. if status == "error": retry with revised instruction
```

## Common Pitfalls

- `device_id` and `user_device_id` are different fields — `device_id` is the string unique device code; `user_device_id` is the numeric user-bound device record ID
- Always call `cloudphone_task_result` after `cloudphone_execute` — the execute call only dispatches the task, it does not wait for completion
- Default `timeout_ms` is 5 minutes; increase it for long-running tasks
- If `status` is `"timeout"`, the tool has already retried automatically; consider increasing `timeout_ms` if tasks consistently time out
- Vague instructions produce unpredictable results — be specific about the app, action, and target
- **Never use screenshot instructions** — they do not return image data and will only consume execution time
- **Never submit tasks autonomously** — only act on explicit user requests
