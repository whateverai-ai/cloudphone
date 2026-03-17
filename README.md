# CloudPhone Plugin for OpenClaw

[Chinese README](./README.zh-CN.md)

OpenClaw CloudPhone is a plugin that gives AI agents device management and UI automation capabilities for cloud phones.

With natural language instructions, an agent can list devices, power them on or off, capture screenshots, tap, swipe, type text, and perform other UI actions without writing manual scripts.

Starting from `v1.0.3`, the package also ships with a built-in skill, `basic-skill`, which helps agents combine these tools in a more reliable way.

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

Add the following configuration to `openclaw.json`:

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

### 3. Restart the Gateway

```bash
openclaw gateway restart
```

Once the plugin is loaded successfully, the agent can use all CloudPhone tools. If the plugin is enabled correctly, the bundled `basic-skill` skill will also become available.

## How the Plugin and Skill Work Together

This repository is first and foremost an **OpenClaw plugin**. Its job is to expose the CloudPhone OpenAPI as tools that an agent can call.

Starting from `v1.0.3`, the package also includes an **OpenClaw skill**:

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

- Installation and troubleshooting: checking `openclaw.json`, `baseUrl`, `apikey`, and `timeout`
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
| `baseUrl` | string | No | `https://cptest.yaltc.cn` | CloudPhone API base URL without `/openapi/v1` |
| `apikey` | string | Yes | - | Authorization credential (ApiKey) |
| `timeout` | number | No | `5000` | Request timeout in milliseconds |

> You can obtain `apikey` from the CloudPhone management console.

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
| `cloudphone_snapshot` | Capture a screenshot or UI tree snapshot from the device |
| `cloudphone_render_image` | Render a screenshot URL as an image directly in chat |

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
format    : string - Snapshot format: "screenshot" | "ui_tree" | "both", default screenshot
```

### `cloudphone_render_image`

```text
image_url : string - HTTPS image URL (required)
```

## FAQ

**Q: The agent cannot find the CloudPhone tools after installation.**

Make sure `plugins.entries.cloudphone.enabled` is set to `true` in `openclaw.json`, then restart the Gateway.

**Q: The tools work, but the agent is not very stable when operating a cloud phone UI.**

Starting from `v1.0.3`, the package ships with the `basic-skill` skill. It teaches the agent to use the tools in a short loop: observe -> act -> verify -> observe again. Make sure you installed a recent version and restarted the Gateway so the latest skill was loaded.

**Q: A tool call fails with a request error or timeout.**

- Check whether `baseUrl` is correct and does not include `/openapi/v1`
- Check whether `apikey` is valid
- Increase `timeout` if the network is slow or unstable

**Q: How do I get an `apikey`?**

Create or view it from the API key page in the CloudPhone management console.

**Q: `cloudphone_snapshot` returned a URL, but I cannot see the image in chat.**

The agent should call `cloudphone_render_image` automatically to turn that URL into a displayable image. The current version returns an MCP `image` content block first and also keeps a fallback `MEDIA:<filePath>` text item for older hosts. If the image still does not appear, ask the agent to show the screenshot explicitly; if that still fails, the current host likely does not consume `type: "image"` content items yet.

## Changelog

Current version: **v1.0.3**

### v1.0.3

- Added the built-in `basic-skill` skill distributed with the plugin
- Added `reference.md` as a tool parameter quick reference
- Expanded the documentation for plugin vs. skill responsibilities, standard workflows, and capability boundaries

## License

This plugin follows the license terms of the repository it belongs to.
