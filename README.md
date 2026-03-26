# CloudPhone Plugin for OpenClaw

[Chinese README](./README.zh-CN.md)

OpenClaw CloudPhone is a plugin that gives AI agents device management and UI automation capabilities for cloud phones.

With natural language instructions, an agent can list devices, power them on or off, capture screenshots, tap, swipe, type text, and perform other UI actions without writing manual scripts.

Starting from `v2026.3.27`, the package ships with built-in skills (including `basic-skill`) that help agents combine these tools in a more reliable way.

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

For most setups, you only need to set **`apikey`** in `plugins.entries.cloudphone.config`. The plugin applies built-in defaults for other optional settings. Advanced users can still add optional keys such as `baseUrl` or `timeout` when self-hosting or tuning behavior; see `openclaw.plugin.json` in this package for the full schema.

You can configure the plugin in either of the following ways.

#### Option A: Configuration file (openclaw.json)

Add the following configuration to `openclaw.json`:

- **apikey**: Obtain your API Key by logging in or signing up at [https://whateverai.ai](https://whateverai.ai), then add it in your account/settings and paste it into the `apikey` field below.

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

You can also configure the CloudPhone plugin in the OpenClaw console UI:

1. Open the OpenClaw console in your browser.
2. Go to the Plugins section, find **CloudPhone** and enable it.
3. Set **apikey** (from [https://whateverai.ai](https://whateverai.ai) after login or sign-up, in your account/settings).

Screenshots:

![OpenClaw Console — Plugins](https://github.com/whateverai-ai/cloudphone/blob/main/assets/0.jpg)

![OpenClaw Console — CloudPhone config](https://github.com/whateverai-ai/cloudphone/blob/main/assets/1.jpg)

### 3. Restart the Gateway

```bash
openclaw gateway restart
```

Once the plugin is loaded successfully, the agent can use all CloudPhone tools. If the plugin is enabled correctly, the bundled `basic-skill` skill will also become available.

## How the Plugin and Skill Work Together

This repository is first and foremost an **OpenClaw plugin**. Its job is to expose the CloudPhone OpenAPI as tools that an agent can call.

Starting from `v2026.3.27`, the package includes **OpenClaw skills**:

- Plugin: defines **what the agent can do** by providing `cloudphone_*` tools
- Skill: defines **how the agent should do it reliably** by teaching call order, recovery steps, and safer workflows

Together they form a complete automation loop:

- The plugin provides the low-level capabilities such as device management, UI interaction, and screenshot capture
- The skill helps the agent chain those capabilities into a stable multi-step workflow

## Built-in Skill

The package includes the `basic-skill` skill under:

```text
skills/basic-skill/
```

It contains:

- `SKILL.md`: the main guide that defines scenarios, standard workflows, recovery strategies, and capability boundaries
- `reference.md`: a quick reference for the 14 available tools and their parameters

The skill does not add new API capabilities and does not require an extra install step. It only helps the agent use the existing tools more effectively.

### What the Skill Solves

`basic-skill` mainly improves the following areas:

- Installation and troubleshooting: checking `openclaw.json` and `apikey`
- Standard workflow: select device -> confirm online -> observe -> act -> verify
- UI automation stability: using short loops such as observe -> act -> verify -> observe again
- Recovery strategy: prefer `BACK`, `HOME`, and fresh screenshots; restart the device only when needed

### Skill Boundaries

The current skill is built on top of the existing plugin toolset, so it does not automatically provide these higher-level capabilities:

- OCR
- Find UI controls by text
- Click controls directly by selector
- Launch an app by package name
- Complex macro recording and playback

If you need those capabilities, extend the plugin itself instead of changing only the skill.

## Configuration

| Field | Type | Required | Default | Description |
|------|------|------|--------|------|
| `apikey` | string | Yes | - | Authorization credential (ApiKey) |

> Obtain your API Key by logging in or signing up at [https://whateverai.ai](https://whateverai.ai), then find it in your account/settings.

Optional fields such as `baseUrl` and `timeout` are documented in `openclaw.plugin.json` and use built-in defaults when omitted; set them only for custom deployments or advanced tuning.

## Tool Overview

After the plugin is installed, the agent automatically gets the following capabilities.

### User and device management

| Tool | Description |
|------|------|
| `cloudphone_get_user_profile` | Get the current user's basic information |
| `cloudphone_list_devices` | List cloud phone devices with pagination, keyword search, and status filters |
| `cloudphone_get_device_info` | Get detailed information for a specific device |
| `cloudphone_device_power` | Control device power: start, stop, or restart |
| `cloudphone_get_adb_connection` | Get ADB/SSH connection information for a device |

### UI interaction

| Tool | Description |
|------|------|
| `cloudphone_tap` | Tap a specific screen coordinate |
| `cloudphone_long_press` | Long press a coordinate with an optional duration |
| `cloudphone_swipe` | Swipe from a start point to an end point |
| `cloudphone_input_text` | Type text into the current input field |
| `cloudphone_clear_text` | Clear the current input field |
| `cloudphone_keyevent` | Send system keys such as back, home, enter, recent apps, or power |

### State observation

| Tool | Description |
|------|------|
| `cloudphone_wait` | Wait for a condition such as element appear/disappear or page stability |
| `cloudphone_snapshot` | Capture a device screenshot |
| `cloudphone_render_image` | Render a screenshot URL as an image directly in chat |

## planActionTool (`cloudphone_plan_action`)

`planActionTool` maps to `cloudphone_plan_action`. It lets the agent call an AutoGLM model to analyze the current screenshot and goal, then return a structured next-action plan for CloudPhone UI automation.

Typical scenarios:
- uncertain next step on a dynamic UI
- deciding tap/swipe/input intent before execution
- recovering when repeated direct actions fail

### Prerequisites

Configure these plugin fields before using `cloudphone_plan_action`:
- required: `autoglmBaseUrl`, `autoglmApiKey`, `autoglmModel`
- optional: `autoglmMaxTokens` (default `3000`), `autoglmLang` (default `cn`)

Example (`plugins.entries.cloudphone.config`):

```json
{
  "autoglmBaseUrl": "https://open.bigmodel.cn/api/paas/v4",
  "autoglmApiKey": "your-api-key",
  "autoglmModel": "autoglm-phone",
  "autoglmMaxTokens": 3000,
  "autoglmLang": "cn"
}
```

### Parameters and minimal example

Core input:
- `device_id`: target cloud phone device ID
- `goal`: natural language task goal

Minimal example:

```text
device_id: "your-device-id"
goal: "Open WeChat and enter the search page"
```

Expected output:
- model reasoning summary for the current screen
- a suggested next action that can be executed with `cloudphone_*` tools

### Notes

- If required `autoglm*` fields are missing, the tool returns a config error.
- Recommended flow: `cloudphone_snapshot` -> `cloudphone_plan_action` -> execute with `cloudphone_tap`/`cloudphone_swipe`/`cloudphone_input_text` -> verify with new snapshot.
- Keep each goal focused to one immediate UI objective for better planning quality.

## Usage Examples

After installation and configuration, you can control cloud phones through natural language prompts.

### View device list

> Show me my cloud phone devices

The agent will call `cloudphone_list_devices` and return the matching devices.

### Power on and inspect the screen

> Power on my cloud phone and show me the current screen

The agent will typically call `cloudphone_device_power` -> `cloudphone_snapshot` -> `cloudphone_render_image`.

### Run a UI automation flow

> Open WeChat on the cloud phone, search for the "OpenClaw" public account, and follow it

The agent can combine the plugin tools with the bundled skill to plan the task and execute it using the safer pattern of observe first, then act, then verify.

### Get device debugging access

> Give me the ADB connection info for this cloud phone

The agent will call `cloudphone_get_adb_connection` and return the host and port.

## Tool Parameters

### `cloudphone_list_devices`

```text
keyword   : string  - Search keyword (device name or device ID)
status    : string  - Status filter: "online" | "offline"
page      : integer - Page number, default 1
size      : integer - Items per page, default 20
```

### `cloudphone_device_power`

```text
user_device_id : number - User device ID (required)
device_id      : string - Device ID (required)
action         : string - Action: "start" | "stop" | "restart" (required)
```

### `cloudphone_tap`

```text
device_id : string  - Device ID (required)
x         : integer - X coordinate in pixels (required)
y         : integer - Y coordinate in pixels (required)
```

### `cloudphone_long_press`

```text
device_id : string  - Device ID (required)
x         : integer - X coordinate in pixels (required)
y         : integer - Y coordinate in pixels (required)
duration  : integer - Press duration in milliseconds, default 1000
```

### `cloudphone_swipe`

```text
device_id : string  - Device ID (required)
start_x   : integer - Start X coordinate (required)
start_y   : integer - Start Y coordinate (required)
end_x     : integer - End X coordinate (required)
end_y     : integer - End Y coordinate (required)
duration  : integer - Swipe duration in milliseconds, default 300
```

### `cloudphone_input_text`

```text
device_id : string - Device ID (required)
text      : string - Text to input (required)
```

### `cloudphone_keyevent`

```text
device_id : string - Device ID (required)
key_code  : string - Key code: "BACK" | "HOME" | "ENTER" | "RECENT" | "POWER" (required)
```

### `cloudphone_wait`

```text
device_id : string  - Device ID (required)
condition : string  - Wait condition: "element_appear" | "element_disappear" | "page_stable" (required)
timeout   : integer - Timeout in milliseconds, default 5000
selector  : string  - Element selector used with appear/disappear conditions
```

### `cloudphone_snapshot`

```text
device_id : string - Device ID (required)
format    : string - Snapshot format: "screenshot" (currently only screenshot is supported)
```

### `cloudphone_render_image`

```text
image_url : string - HTTPS image URL (required)
```

## FAQ

**Q: The agent cannot find the CloudPhone tools after installation.**

Make sure `plugins.entries.cloudphone.enabled` is set to `true` in `openclaw.json`, then restart the Gateway.

**Q: The tools work, but the agent is not very stable when operating a cloud phone UI.**

Starting from `v2026.3.27`, the package ships with built-in skills such as `basic-skill`. They teach the agent to use the tools in a short loop: observe -> act -> verify -> observe again. Make sure you installed a recent version and restarted the Gateway so the latest skills were loaded.

**Q: A tool call fails with a request error or timeout.**

- Check whether `apikey` is valid and that you restarted the Gateway after changing config
- Check network connectivity and whether the CloudPhone service is reachable
- If you use a custom deployment or endpoint, verify routing and availability on your side

**Q: How do I get an `apikey`?**

Log in or sign up at [https://whateverai.ai](https://whateverai.ai) and get your API Key from your account/settings.

**Q: `cloudphone_snapshot` returned a URL, but I cannot see the image in chat.**

The agent should call `cloudphone_render_image` automatically to turn that URL into a displayable image. The current version returns an MCP `image` content block first and also keeps a fallback `MEDIA:<filePath>` text item for older hosts. If the image still does not appear, ask the agent to show the screenshot explicitly; if that still fails, the current host likely does not consume `type: "image"` content items yet.

## Changelog

Current version: **v2026.3.27**

### v2026.3.27

- Summarized and aligned release notes based on target commit `1da1031`
- Synced package/plugin/doc version references to `v2026.3.27`
- Kept English and Chinese changelog/version labels consistent

### v2026.3.26.1

- Fixed leftover version wording in README sections that still referenced `v1.1.0`
- Synced release-related version identifiers to `v2026.3.26.1`
- Updated English and Chinese changelog/version labels consistently

### v2026.3.26

- Added verbose step-by-step logs for cloudphone_plan_action to improve debugging and failure tracing
- Expanded planActionTool documentation with prerequisites, usage flow, and safety notes in both English and Chinese README
- Synced built-in skills wording and release docs to align with the current v1.1.0+ behavior

### v1.1.0

- Enhanced screenshot handling in `cloudphone_render_image` for improved compatibility and display reliability across hosts
- Added the `cloudphone-snapshot-url` skill and aligned `basic-skill` guides/reference for screenshot URL workflows
- Synced screenshot-related tool docs and skill guidance in both English and Chinese content

### v1.0.8

- Simplified plugin configuration documentation: typical users only need `apikey`; optional `baseUrl` and `timeout` remain in `openclaw.plugin.json` with built-in defaults
- Updated `basic-skill` skill preconditions and troubleshooting to match the streamlined config guidance
- Synced English and Chinese README and changelog wording

### v1.0.7

- Revised `cloudphone_snapshot` docs to clarify that it captures screenshots only
- Updated the `format` parameter description to indicate only `screenshot` is supported
- Synced related descriptions in English and Chinese README and tool reference docs
- Aligned tool overview table rows for `cloudphone_snapshot` with the parameter documentation

### v1.0.6

- Added the built-in `basic-skill` skill distributed with the plugin
- Added `reference.md` as a tool parameter quick reference
- Expanded the documentation for plugin vs. skill responsibilities, standard workflows, and capability boundaries

## License

This plugin follows the license terms of the repository it belongs to.
