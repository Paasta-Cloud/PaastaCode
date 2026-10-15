# PaastaCode design

## Overview

VS Code exposes the official Paasta mark in the native Activity Bar, with a native welcome view containing the primary open-workbench action. An empty window shows a folder-picker action. Billing and updates stay in the view menu; the editor title has a workbench shortcut. Preserve the editor theme, focus behavior and workspace-trust boundary; do not auto-start an engine or open a tab on installation.
Operate mode, redesigned for the owner's Codex-like developer workbench. Developers follow long tasks alongside their editor; charcoal surfaces reduce the bright empty field of the previous interface. A persistent light/dark control supports daylight work. Keep the official Paasta mark.

## Colors
Dark canvas #1c1d21, rail #15161a, raised surface #24262b, foreground #f0f1f3, secondary #b0b3bd and line #363941. Light canvas #fafafa, rail #f0f1f3, surface #ffffff, foreground #20232b, secondary #606570 and line #d7dae0. Paasta blue identifies selection and focus. Running, failed and completed work always has a text/icon state as well as color.

## Typography
Licensed Yekan Bakh is embedded in publisher packages and served locally; an installed OS font is never required. Source-only builds retain bundled Vazirmatn. Persian body 16px, navigation 14px, supporting labels 12px; no letter spacing. Isolated monospace is for code, paths and branch names.

## Layout
A 280px right conversation rail, compact project toolbar, active conversation heading, independently scrolling transcript and anchored composer. Search and request-derived titles identify conversations. Exactly one visible row is selected, distinguished by background, weight and an icon; its title also appears above the transcript. Secondary deployment and account actions are compact. Narrow screens use the labeled conversation drawer.

## Components

Use one 24px outline icon grid for sidebar actions, search and conversations; labels remain visible and SVGs are decorative. Automatic planning/execution is the default only when the catalogue has an explicit planner candidate and an eligible cheaper executor. Manual phase controls live in collapsed model settings, not a required step in the primary flow. The visible status and price name the active model. An interrupted handoff offers explicit review-and-continue and never implies that execution succeeded.
Compact tool rows lead into expandable LTR output. Current tool, elapsed time and stop action are obvious beside the composer. Theme choice is local. Legacy generic names derive from their first real request; explicit names stay intact. The composer is the main contained surface; use 8px control and 12px composer corners, single borders and no decorative glow.

Persian UI uses licensed Yekan Bakh, with bundled Vazirmatn as the open-source fallback. Conversation prose is RTL; code and diff blocks are LTR and independently scrollable. Sessions, account, cloud-save state, workspace and model remain visible. On narrow screens, sessions collapse into a labeled drawer and the composer remains on screen. Controls have clear labels, keyboard focus, busy/disabled states and actionable failures. Preserve a reader's manual scroll and expanded tool details; follow new output only while they are at the bottom, with an explicit return-to-latest action. Empty assistant records do not create message blocks. A visible activity row beside the composer names the current tool, elapsed time, waiting approval and stop action.

Use the official Paasta mark beside the text پاستاکد; no substitute logo. Keep provider credentials out of the renderer. Review mode is the default; the user can explicitly enable Full Access for a workspace/account. Show the chosen mode continuously. Full Access authorizes local coding tools, not a new Paasta account grant or unreviewed billable deployment. Never render model-generated HTML. Design must distinguish local sessions from acknowledged account backups. Git provides branch, file diff, selected-file commits and remote synchronization without discarding unrelated work.
