# CloudPhone Tool Reference

This file is the parameter quick reference for the `basic-skill` skill. It only describes the 14 tools currently provided by the plugin.

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
- Returns: device list as JSON text
- Typical use: locate the target device before deciding the next action

### `cloudphone_get_device_info`

- Purpose: get details for a specific cloud phone device
- Required parameters:
- `user_device_id`: `number`, user device ID
- Returns: device details as JSON text
- Typical use: inspect the target device state and gather more context

### `cloudphone_device_power`

- Purpose: start, stop, or restart a cloud phone device
- Required parameters:
- `user_device_id`: `number`, user device ID
- `device_id`: `string`, device ID
- `action`: `string`, allowed values: `start`, `stop`, `restart`
- Returns: power action result as JSON text
- Typical use: start an offline device, restart a stuck device, or power off after a task
- Note: this tool requires both `user_device_id` and `device_id`

### `cloudphone_get_adb_connection`

- Purpose: get ADB/SSH connection information for a specific cloud phone device
- Required parameters:
- `device_id`: `string`, device ID
- Returns: ADB/SSH connection info as JSON text
- Typical use: device debugging and external connections

## UI Interaction

### `cloudphone_tap`

- Purpose: tap a specific screen coordinate
- Required parameters:
- `device_id`: `string`, device ID
- `x`: `integer`, X coordinate in pixels
- `y`: `integer`, Y coordinate in pixels
- Returns: tap result as JSON text
- Typical use: tap buttons, icons, input fields, or list items

### `cloudphone_long_press`

- Purpose: long press a specific coordinate with an optional duration
- Required parameters:
- `device_id`: `string`, device ID
- `x`: `integer`, X coordinate in pixels
- `y`: `integer`, Y coordinate in pixels
- Optional parameters:
- `duration`: `integer`, press duration in milliseconds, default `1000`
- Returns: long press result as JSON text
- Typical use: open context menus, long press icons, or prepare for drag actions

### `cloudphone_swipe`

- Purpose: swipe from a start coordinate to an end coordinate
- Required parameters:
- `device_id`: `string`, device ID
- `start_x`: `integer`, start X coordinate
- `start_y`: `integer`, start Y coordinate
- `end_x`: `integer`, end X coordinate
- `end_y`: `integer`, end Y coordinate
- Optional parameters:
- `duration`: `integer`, swipe duration in milliseconds, default `300`
- Returns: swipe result as JSON text
- Typical use: scroll lists, change pages, or drag a view

### `cloudphone_input_text`

- Purpose: type text into the current input focus
- Required parameters:
- `device_id`: `string`, device ID
- `text`: `string`, text to input
- Returns: input result as JSON text
- Typical use: search, sign in, or fill forms

### `cloudphone_clear_text`

- Purpose: clear the current input field
- Required parameters:
- `device_id`: `string`, device ID
- Returns: clear result as JSON text
- Typical use: remove old text before entering new content

### `cloudphone_keyevent`

- Purpose: send a system key event
- Required parameters:
- `device_id`: `string`, device ID
- `key_code`: `string`, allowed values: `BACK`, `HOME`, `ENTER`, `RECENT`, `POWER`
- Returns: key event result as JSON text
- Typical use: go back, return home, submit input, or open recent apps

## State Observation

### `cloudphone_wait`

- Purpose: wait for a page condition to improve action timing
- Required parameters:
- `device_id`: `string`, device ID
- `condition`: `string`, allowed values: `element_appear`, `element_disappear`, `page_stable`
- Optional parameters:
- `timeout`: `integer`, timeout in milliseconds, default `5000`
- `selector`: `string`, available when the condition is element appear or disappear
- Returns: wait result as JSON text
- Typical use: wait for page stability after a navigation, or wait for an element to appear or disappear
- Note: if no clear selector is available, prefer `page_stable`

### `cloudphone_snapshot`

- Purpose: capture a device screenshot or UI tree snapshot
- Required parameters:
- `device_id`: `string`, device ID
- Optional parameters:
- `format`: `string`, allowed values: `screenshot`, `ui_tree`, `both`, default `screenshot`
- Returns: snapshot result as JSON text, usually including a screenshot URL, a UI tree, or both
- Typical use: observe and verify the UI before and after any interaction

### `cloudphone_render_image`

- Purpose: render an HTTPS image URL as an image directly displayable in chat
- Required parameters:
- `image_url`: `string`, HTTPS image URL
- Returns:
- one MCP `image` content item with base64 `data` and `mimeType` for direct chat rendering
- one fallback `MEDIA:<filePath>` text item for hosts that still rely on the legacy media marker
- one JSON text item containing `ok`, `filePath`, `url`, `mimeType`, `size`, and `renderMode`
- Typical use: turn a screenshot URL returned by `cloudphone_snapshot` into a visible image
- Note: if the URL is unreachable or does not return an image, the tool returns a failure message

## Recommended Calling Order

### Inspect Devices

1. `cloudphone_list_devices`
2. if needed, `cloudphone_get_device_info`

### Control Power

1. confirm both `user_device_id` and `device_id`
2. then call `cloudphone_device_power`

### Run UI Automation

1. `cloudphone_snapshot`
2. `cloudphone_render_image`
3. `cloudphone_tap` / `cloudphone_long_press` / `cloudphone_swipe` / `cloudphone_input_text` / `cloudphone_keyevent`
4. `cloudphone_wait`
5. `cloudphone_snapshot`
6. `cloudphone_render_image`

### Recover From Problems

1. `cloudphone_keyevent(BACK)`
2. `cloudphone_keyevent(HOME)`
3. `cloudphone_snapshot`
4. if needed, `cloudphone_device_power(action="restart")`

## Common Pitfalls

- `device_id` and `user_device_id` are not the same field
- coordinate values are pixels, not percentages
- `duration` is measured in milliseconds
- `cloudphone_render_image` expects an image URL, not a device ID
- re-capture the screen before and after multi-step UI actions so coordinates do not rely on an outdated page state
