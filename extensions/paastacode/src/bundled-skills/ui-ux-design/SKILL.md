---
name: ui-ux-design
description: Design, implement and review polished accessible product interfaces, including Persian RTL and responsive layouts.
---
# UI/UX Design — Paasta

Start by reading the actual screen, nearby components, product/design instructions and the user's task. Reuse the product's typography, spacing, color tokens, official assets, icons and installed components. Do not invent customer metrics or unsupported capabilities.

Write down the primary user action and what success looks like. Use a clear hierarchy, concise labels and restrained visual detail. Prefer existing components to a new dependency. Add an icon alongside its label when it improves recognition; decorative icons must be hidden from assistive technology. Icon-only actions need an accessible name and visible focus.

Implement the entire interaction: loading, empty, error, success, disabled and retry states. Preserve input after a failed request. Never show success before the server confirms it. Confirm irreversible or billable operations under the product's existing policy; a design skill never grants permission.

For Persian, use logical CSS properties, correct RTL order and bidi isolation for paths, code and Latin names. Reuse the locally hosted product font. Keep code blocks LTR. Avoid fixed heights that clip Persian text. Use semantic buttons, headings, labels, landmarks and accessible dialogs with Escape and focus restoration.

Verify the real implementation at desktop and 320px mobile widths, with long content, keyboard navigation and 200% text zoom. Check contrast, touch targets, overflow, focus, reduced motion and light/dark themes where supported. Capture and inspect the result using the available browser tool. If none is available, state that visual verification remains. Fix observed defects before handing off. Report only tests actually run.
