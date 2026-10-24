# Project task workspace

Extend the established charcoal/neutral PaastaCode workbench; do not replace the brand. Qoder's project → task → execution → review flow is the interaction reference. The existing project toolbar is the context anchor, the right rail is a searchable task navigator, and the transcript remains the primary work surface.

- Filter local work by all, active, or awaiting approval. Account snapshots remain a separate read-only scope. Status comes from the runtime, never from an optimistic click.
- Keep background work discoverable by its real title, with one navigation action that never grants approval.
- Show a compact last-run recap inside the transcript after execution settles. Count observed tool results and file edits, distinguish errors and unfinished tools, and lead to actual project diffs. Never claim tests passed from a shell tool's completion alone.
- Native VS Code uses the same status and recap rules, editor colors, a compact task picker, and native Source Control/diffs.
- Keep Yekan, bidi-safe code, keyboard navigation, explicit current selection, manual scroll position and automatic bottom-follow. Fit 1440, 390 and 320px; the VS Code panel must also fit 280px.

Acceptance: background approval without consent; combined status/search filters; current selection survives polling; recaps isolate the last request and clear on account/task switch; errors cannot appear successful; real review navigation; no horizontal overflow or hidden composer.

## Project knowledge and verification

- Private notes belong to one account and project, outside the repository and automatic conversation backups. Show the scope before editing, require a revision on save, retain unsaved typing during delayed loads, and expose Markdown export. Knowledge reaches the engine on the next request without interrupting work. Keep a short context limit and never suggest storing credentials.
- The review dialog uses a file navigator and safe, line-numbered unified diffs. Distinguish working-tree changes, staged changes and new-file previews; keep the selected file and manual reading position when data is unchanged. Native VS Code opens its own Source Control/diff surface.
- Verification is evidence from the latest request: identify recognized test/lint/build commands, show recorded exit codes and output, and distinguish passed, failed, running and unknown. A zero exit with no tests executed is unknown. Never infer success from output prose. Preserve expanded results, keyboard focus and scroll across polling.

Acceptance: isolated persistence/reopen, concurrent-save refusal, delayed-read draft preservation, real engine next-request knowledge and real failed/passed test commands, native polling stability, staged/worktree/untracked/rename previews, no secret-file preview and desktop/390/320/native-280 reachability. Qoder is an interaction reference; Paasta identity and native editor conventions remain authoritative.
