---
name: cloudphone-snapshot-url
description: Cloud phone screenshot workflow with pre-signed S3 URLs (X-Amz-* query params). Use when capturing screenshots or sharing image links to users, WeChat Work, or any channel. Enforces verbatim cloudphone_snapshot screenshot_url and optional cloudphone_render_image; never truncate the URL before the query string.
metadata:
  openclaw:
    requires:
      config:
        - plugins.entries.cloudphone.enabled
---

# CloudPhone Snapshot URL (pre-signed)

Use this skill whenever you need a **screenshot** from a cloud phone **or** you must give the user a **link** to that image (including enterprise WeChat / 企业微信, IM, email, or chat).

The `screenshot_url` returned by `cloudphone_snapshot` is a **pre-signed URL**. The signature lives in the **query string** (e.g. `X-Amz-Algorithm`, `X-Amz-Credential`, `X-Amz-Date`, `X-Amz-Expires`, `X-Amz-SignedHeaders`, `X-Amz-Signature`). If you drop anything after `?`, the link **will not work**.

## When to apply

- User asks for a screenshot, current screen, or “send the picture / link”.
- You will **paste a URL** in the reply (especially 企业微信): you **must** follow this skill first.

## Required steps

1. Call **`cloudphone_snapshot`** with the correct `device_id` (and `format: "screenshot"` if needed).

2. Obtain **`screenshot_url`** from the tool result:
   - If the tool output includes a **CRITICAL** notice and a **fenced code block** with one long `https://...` line, treat that line as the canonical URL—copy it **in full**, single line, no edits.
   - Otherwise read **`screenshot_url`** from the JSON text in the result. Copy from **`https`** through the **last character** of the URL (the string must include `?` and all parameters).

3. **Forbidden**: outputting only the path ending in `.jpg` / `.png` **without** the `?...` query; “simplifying” the URL; re-encoding; line-wrapping mid-URL; summarizing the link as “the screenshot URL” without pasting the full string when the user needs the link.

4. **Optional — show image in chat**: call **`cloudphone_render_image`** with **`image_url` set exactly** to the same full `screenshot_url` string (every query parameter unchanged).

## WeChat Work / 企业微信

When you tell the user “here is the link” or send the link to 企业微信, the text you output must be **character-for-character identical** to the tool’s `screenshot_url` (or the single line inside the code block). Partial URLs are invalid.

## Relation to basic-skill

General device and automation flows stay in `basic-skill`. For **any** task where a **screenshot URL leaves the agent** (user-visible link), apply **this skill** in addition.
