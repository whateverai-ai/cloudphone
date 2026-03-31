---
name: basic-skill
description: CloudPhone plugin workflows for device management and AI Agent task execution. Use cloudphone_execute to submit natural language instructions and cloudphone_task_result to stream results. The backend handles the full automation loop.
metadata:
  openclaw:
    requires:
      config:
        - plugins.entries.cloudphone.enabled
---

# Basic Skill

This skill is intended for OpenClaw agents that already have the `cloudphone` plugin installed and enabled.

It does not add new tools. Its role is to teach the agent:

- when to call each `cloudphone_*` tool
- how to combine `cloudphone_execute` and `cloudphone_task_result` for end-to-end automation
- how to handle task failures and errors
- where the boundaries of the current toolset are

## When to Use This Skill

Prefer this skill for requests such as:

- the user wants to see which cloud phone devices are available
- the user wants device details or status information
- the user wants the agent to complete any multi-step automation task on a cloud phone by natural language

## Preconditions

Before calling any tool, confirm the following:

1. The `cloudphone` plugin is enabled.
2. `plugins.entries.cloudphone.config` exists in `openclaw.json`.
3. `apikey` is configured and valid.

If the user reports that the tools are missing, ask them to verify that the plugin is enabled and restart the Gateway.

## Installation and Troubleshooting

### Basic Checks

Check these configuration items first:

- `plugins.entries.cloudphone.enabled` should be `true`
- `plugins.entries.cloudphone.config.apikey`

### Common Errors

- `401` or authorization failure: `apikey` is usually invalid, expired, or missing.
- `404`: wrong or unreachable API endpoint — often a custom `baseUrl` or deployment issue.
- `timeout`, `AbortError`, or request timeout: usually network latency, service load, or temporary unavailability. Try increasing `timeout_ms` in `cloudphone_task_result`.
- Task status `"error"`: the backend AI Agent encountered an unrecoverable error. Check the `message` field and consider retrying with a clearer instruction.

## Tool Groups

### Device Management

- `cloudphone_get_user_profile`
- `cloudphone_list_devices`
- `cloudphone_get_device_info`

### AI Agent Task Execution

- `cloudphone_execute` — submit a natural language instruction, get a `task_id` immediately
- `cloudphone_task_result` — stream agent thinking and wait for the final result

## Standard Workflow

Use this default pattern for all automation tasks:

`select_device → execute_instruction → stream_result`

### 1. Select a Device

If the user did not provide a clear device identifier:

1. Call `cloudphone_list_devices` first.
2. Identify the target device from the results.
3. Note the `device_id` field — this is what `cloudphone_execute` expects.

If more detail is needed, call `cloudphone_get_device_info` with `user_device_id`.

### 2. Execute the Instruction

Call `cloudphone_execute` with:
- `instruction`: a clear natural language description of the task
- `device_id`: the target device's `device_id`
- `lang`: `"cn"` (default) or `"en"` depending on the instruction language

```text
cloudphone_execute(
  instruction = "打开微信，在搜索框输入 OpenClaw 并进入该公众号",
  device_id   = "abc123"
)
→ { ok: true, task_id: 42 }
```

**Writing good instructions:**

- Be specific about the app, target page, and action
- Include the goal, not just the steps: "搜索并关注 OpenClaw 公众号" is better than "打开微信然后点击搜索"
- Use `lang: "en"` when the instruction is in English

### 3. Stream the Result

Call `cloudphone_task_result` with the `task_id` returned by `cloudphone_execute`:

```text
cloudphone_task_result(task_id = 42)
→ {
    ok: true,
    status: "done",
    thinking: ["Step 1: Launch WeChat...", "Step 2: Tap search..."],
    result: { ... }
  }
```

**You MUST wait for `cloudphone_task_result` to return before doing anything else.** The tool is blocking — it subscribes to the SSE stream and does not return until the task reaches a terminal state (`done`, `success`, `error`, or `timeout`). Do not assume the task succeeded or failed until you receive the return value.

- `thinking` contains the backend agent's step-by-step reasoning.
- `result` contains the final structured outcome from the backend.
- `result.message` contains the agent's final action summary (human-readable).

**After receiving the result, always report back to the user before taking any further action.**

If `status` is `"error"`, follow the Error Recovery procedure below.

If `status` is `"timeout"`, the tool has already retried automatically. If the task consistently times out, report to the user that the operation could not be completed.

## Task Execution Strategy

### Strict Rules — Must Follow for Every Task

**These rules apply to the entire execution flow — from submission to result:**

1. **Only submit tasks the user explicitly asked for.** Never autonomously add extra steps, follow-up actions, or supplementary operations that the user did not request.

2. **Never include screenshot or screen-capture instructions.** Instructions like "截图", "截屏", or "take a screenshot" will NOT return any image result through this plugin. The backend agent cannot relay screenshots back to the caller. These instructions waste time and produce no useful output.

3. **Never submit duplicate tasks.** Do not call `cloudphone_execute` again for the same user request while a previous call is still being processed by `cloudphone_task_result`.

4. **Always call `cloudphone_task_result` after every `cloudphone_execute` and wait for it to return.** Never skip this step. Never assume success without a confirmed terminal status from `cloudphone_task_result`.

5. **Retry at most 2 times total.** If a task returns `status: "error"`, you may retry `cloudphone_execute` with a revised instruction (max 2 retries). If `status: "timeout"` persists after the built-in retries, do not call `cloudphone_task_result` again — report failure to the user instead.

6. **Report failure explicitly after exhausting retries.** Once you have reached the retry limit with no successful result, stop all automation and clearly tell the user: the operation failed, the reason (from `message` / `thinking`), and optionally suggest a corrective action.

### Writing Effective Instructions

The backend AI Agent is driven by the natural language `instruction`. Quality of the instruction directly affects task success rate.

**Good patterns:**
- Include the starting app: "打开抖音，搜索美食，点赞第一条视频"
- Include the goal state: "进入设置页面，关闭通知权限"
- Be specific about selection criteria: "选择评分最高的商品"

**Avoid:**
- Screenshot instructions: "截图当前屏幕" — use query-based instructions instead
- Vague instructions without a clear target: "做一些操作"
- Instructions that depend on unshared context: "点击刚才那个按钮"

### Handling Long-Running Tasks

For tasks that may take more than 5 minutes, pass a larger `timeout_ms`:

```text
cloudphone_task_result(task_id = 42, timeout_ms = 600000)
```

The backend stream timeout is 300 seconds. If the task is expected to run longer than that, the backend will close the SSE stream before the task finishes. In this case, you would need to retry `cloudphone_task_result` to reconnect to the stream.

### Error Recovery

#### When `status` is `"error"`

1. Read the `message` and `thinking` fields to understand what went wrong.
2. Retry `cloudphone_execute` with a revised instruction (more specific, different phrasing), then call `cloudphone_task_result` and wait for the result.
3. If the device may be stuck or offline, call `cloudphone_list_devices` to check its status.
4. After **2 retries** (3 total attempts), **stop immediately** and tell the user the operation failed. Do not keep retrying indefinitely.

**Failure report format:**
> "操作执行失败（尝试了 X 次）。错误信息：{message}。建议：{suggestion based on error type}"

#### When `status` is `"timeout"`

The tool has already internally retried up to 2 times. After all retries are exhausted:

- Do **not** call `cloudphone_task_result` again for the same task.
- Tell the user the operation timed out and could not be confirmed.
- If the timeout seems too short for the task (e.g. a complex multi-step workflow), suggest the user retry with a larger `timeout_ms`.

**Timeout report format:**
> "操作超时，未能在规定时间内获取执行结果。云手机上的操作可能仍在进行，也可能已失败。建议稍后重试，或检查设备状态。"

## Recommended Task Templates

### Simple One-Shot Automation

```text
1. cloudphone_list_devices → identify device_id
2. cloudphone_execute(instruction, device_id) → get task_id
3. [WAIT] cloudphone_task_result(task_id) → MUST wait for return
4a. status == "done"/"success" → report result to user
4b. status == "error"          → retry up to 2 times (go to step 2 with revised instruction)
4c. status == "timeout"        → report timeout failure to user, stop
4d. after 2 retries still fail → report failure to user, stop
```

### With Explicit Device Check

```text
1. cloudphone_list_devices → confirm device is online, get device_id
2. cloudphone_execute(instruction, device_id) → get task_id
3. [WAIT] cloudphone_task_result(task_id) → MUST wait for return
4a. ok == true  → summarize result.message and thinking for the user
4b. ok == false → determine if retryable (error vs timeout)
    - error:   retry cloudphone_execute (max 2 times total) then report
    - timeout: report timeout to user immediately, do not retry result stream
```

## Capability Boundaries

The current plugin toolset provides:

- device listing, device details
- natural language task execution delegated to the backend AI Agent
- streaming task thinking and results via SSE

The backend AI Agent handles internally:

- screen observation and screenshot analysis
- LLM-based action planning
- UI interaction (tap, swipe, type, key events)
- multi-step observe → plan → act loops

The plugin does **not** expose direct low-level UI control tools. All automation goes through `cloudphone_execute`.

## Output Requirements

When replying to the user:

- Briefly state the current step (device lookup, task submission, result)
- Always wait for `cloudphone_task_result` to return before reporting any outcome
- If `cloudphone_task_result` returns `thinking` or `result.message`, summarize the key steps for the user
- **If all retries are exhausted with no success, explicitly tell the user the operation failed** — include the reason from `message`/`thinking` and a concrete suggestion

Do not:

- pretend to know what happened on the device without calling `cloudphone_task_result`
- confuse `user_device_id` and `device_id`
- call `cloudphone_execute` multiple times for the same task before the first one completes
- silently retry beyond the 2-retry limit without telling the user what is happening
- report a task as "in progress" or "maybe succeeded" — either it succeeded (confirmed result) or it failed (tell the user)
