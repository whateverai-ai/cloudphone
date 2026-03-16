---
name: basic-skill
description: Cloud phone device management and UI automation. Use it to inspect and manage cloud phone devices, capture screenshots, perform taps, swipes, and text input, handle power actions, retrieve ADB connection details, and complete multi-step UI automation tasks with a safer workflow.
metadata:
  openclaw:
    requires:
      config:
        - plugins.entries.cloudphone.enabled
---

# Basic Skill

This skill is intended for OpenClaw agents that already have the `cloudphone` plugin installed and enabled.

It does not add new tools and does not replace the plugin itself. Its role is to teach the agent:

- when to call each `cloudphone_*` tool
- how to execute multi-step tasks in a safe order
- how to recover, retry, or step back after failures
- where the boundaries of the current toolset are

## When to Use This Skill

Prefer this skill for requests such as:

- the user wants to see which cloud phone devices are available
- the user wants device details, status, or ADB/SSH connection information
- the user wants to start, stop, or restart a device
- the user wants the agent to tap, long press, swipe, type text, go back, or return to the home screen on a cloud phone
- the user wants the agent to capture a screenshot first and decide the next step based on the current screen
- the user wants to complete a multi-step UI automation task such as opening a page and interacting with it

## Preconditions

Before calling any tool, confirm the following:

1. The `cloudphone` plugin is enabled.
2. `plugins.entries.cloudphone.config` exists in `openclaw.json`.
3. `baseUrl` does not include the `/openapi/v1` suffix.
4. `apikey` is configured and valid.
5. If the network is slow, `timeout` may need to be increased.

If the user reports that the tools are missing, ask them to verify that the plugin is enabled and restart the Gateway.

## Installation and Troubleshooting

### Basic Checks

Check these configuration items first:

- `plugins.entries.cloudphone.enabled` should be `true`
- `plugins.entries.cloudphone.config.baseUrl`
- `plugins.entries.cloudphone.config.apikey`
- `plugins.entries.cloudphone.config.timeout`

### Common Errors

- `401` or authorization failure: `apikey` is usually invalid, expired, or missing.
- `404`: `baseUrl` is usually incorrect, most often because `/openapi/v1` was included.
- `timeout`, `AbortError`, or request timeout: usually caused by network conditions or a timeout value that is too small.
- Image cannot be displayed: first confirm that `cloudphone_snapshot` was called, then pass the returned screenshot URL to `cloudphone_render_image`. The tool now returns an MCP `image` content item first and keeps a legacy `MEDIA:<filePath>` fallback, so if nothing is shown, check whether the current UI consumes `type: "image"` tool output.

### Troubleshooting Principles

- Verify config first, then network, then timeout settings.
- Do not assume the config is still correct. Even if the user says it worked yesterday, re-check the key and URL.
- When a request fails, explain the failure type and the recovery suggestion instead of repeating the raw error only.

## Tool Groups

### Device Management

- `cloudphone_get_user_profile`
- `cloudphone_list_devices`
- `cloudphone_get_device_info`
- `cloudphone_device_power`
- `cloudphone_get_adb_connection`

### UI Interaction

- `cloudphone_tap`
- `cloudphone_long_press`
- `cloudphone_swipe`
- `cloudphone_input_text`
- `cloudphone_clear_text`
- `cloudphone_keyevent`

### State Observation

- `cloudphone_wait`
- `cloudphone_snapshot`
- `cloudphone_render_image`

For a quick parameter reference, read [reference.md](reference.md).

## Standard Workflow

Use this default loop:

`select_device -> confirm_online -> observe -> act -> verify -> observe_again`

### 1. Select a Device

If the user did not provide a clear device identifier:

1. Call `cloudphone_list_devices` first.
2. Identify the target device from the results.
3. If more confirmation is needed, call `cloudphone_get_device_info`.

Distinguish these two identifiers carefully:

- `user_device_id`: primarily used for device details and power control
- `device_id`: primarily used for UI actions, snapshots, and ADB connection info

Do not mix them up.

### 2. Confirm the Device Is Online

Before any UI action:

- if the device is offline, call `cloudphone_device_power` with `action: "start"`
- if the device status is unknown, inspect the device list or device details first
- do not tap, swipe, or type on an offline device

### 3. Observe Before Acting

Before any visual interaction, call:

1. `cloudphone_snapshot`
2. If a screenshot URL is returned, call `cloudphone_render_image`

Inspect the current screen before deciding the next action. Do not guess the current page, and do not execute long chains of coordinate actions without fresh observation.

### 4. Perform the Action

Choose the tool based on the current screen:

- tap an area: `cloudphone_tap`
- open a context menu or press an icon: `cloudphone_long_press`
- scroll or change pages: `cloudphone_swipe`
- type text: `cloudphone_input_text`
- clear existing text: `cloudphone_clear_text`
- go back, return home, or trigger a system key: `cloudphone_keyevent`

### 5. Verify Immediately

After every 1 to 3 actions, observe again:

1. `cloudphone_wait` if the page may still be loading or changing
2. `cloudphone_snapshot`
3. If a screenshot URL is returned, call `cloudphone_render_image`

If the page did not change as expected, stop and reassess instead of continuing to tap blindly.

## UI Automation Strategy

### Core Principle

Always use a short loop:

`observe -> act -> verify -> observe_again`

### Avoid Blind Long Chains

Do not plan many coordinate taps at once. A safer pattern is:

1. capture the current screen
2. perform one clear action
3. capture the screen again
4. decide the next step based on the new screen

### Recommended Text Input Sequence

For search boxes, login forms, or other text fields:

1. use `cloudphone_tap` to focus the field
2. if the existing content is uncertain, call `cloudphone_clear_text`
3. call `cloudphone_input_text`
4. if needed, send `ENTER` with `cloudphone_keyevent`
5. capture a screenshot again to verify the input

### Page Transitions and Loading

When the screen changes, a dialog appears, an animation is playing, or a loading state is visible:

- call `cloudphone_wait` first
- prefer `condition: "page_stable"` by default
- use `element_appear` or `element_disappear` only when you know the element condition clearly

### Coordinate Action Notes

- coordinates are measured in pixels
- `duration` is measured in milliseconds
- do not reuse coordinates derived from an old screenshot on a new page
- after a page transition or scroll, previously inferred coordinates may be invalid

## Recovery Strategy

When the page is unexpected, the agent mis-tapped, the current state is unclear, or the result cannot be trusted, recover in this order:

1. call `cloudphone_keyevent` with `key_code: "BACK"`
2. if the context is still unclear, call `cloudphone_keyevent` with `key_code: "HOME"`
3. call `cloudphone_snapshot` again
4. if visual confirmation is needed, call `cloudphone_render_image`
5. if the device is clearly stuck or the context cannot be recovered, call `cloudphone_device_power` with `action: "restart"`

During recovery, do not continue new UI actions until the page has been observed again.

## Recommended Task Templates

### List Devices and Show a Screenshot

1. `cloudphone_list_devices`
2. identify the target `device_id`
3. `cloudphone_snapshot`
4. `cloudphone_render_image`

### Start a Device and Inspect the Current Screen

1. `cloudphone_list_devices` or `cloudphone_get_device_info`
2. `cloudphone_device_power(action="start")`
3. wait until the device becomes usable
4. `cloudphone_snapshot`
5. `cloudphone_render_image`

### Run a Simple UI Flow

1. `cloudphone_snapshot`
2. `cloudphone_render_image`
3. based on the screen, call `cloudphone_tap` or `cloudphone_swipe`
4. `cloudphone_wait(condition="page_stable")`
5. `cloudphone_snapshot`
6. `cloudphone_render_image`

### Get Debug Connection Details

1. confirm the target device first
2. call `cloudphone_get_adb_connection`
3. return the connection host and port

## Capability Boundaries

The current plugin toolset mainly provides:

- device listing, device details, and power control
- coordinate-based UI interaction
- screenshots, waits, and screenshot rendering

It does not currently provide these higher-level capabilities:

- OCR
- locate controls by text
- direct clicks by selector
- launch a specific app by package or activity name
- complex macro recording and playback

Therefore:

- the reliability of complex tasks still depends on the model's interpretation of screenshots
- this skill can improve workflow stability, but it cannot replace missing higher-level tools
- if the user needs more reliable advanced automation, extend the plugin rather than only editing the skill

## Output Requirements

When replying to the user:

- briefly explain the current step
- clearly state which tool will be called next
- if something fails, explain the failure reason and the recovery suggestion
- if a screenshot is available, prefer showing the latest screen before continuing

Do not:

- pretend to know the current screen without fresh observation
- confuse `user_device_id` and `device_id`
- continue UI actions when the device is offline
- turn the skill into a duplicate of the plugin installation guide
