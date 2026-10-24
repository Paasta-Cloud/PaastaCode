# Project task workspace

Extend the established charcoal/neutral PaastaCode workbench; do not replace the brand. Qoder's project → task → execution → review flow is the interaction reference. The existing project toolbar is the context anchor, the right rail is a searchable task navigator, and the transcript remains the primary work surface.

- Filter local work by all, active, or awaiting approval. Account snapshots remain a separate read-only scope. Status comes from the runtime, never from an optimistic click.
- Keep background work discoverable by its real title, with one navigation action that never grants approval.
- Show a compact last-run recap inside the transcript after execution settles. Count observed tool results and file edits, distinguish errors and unfinished tools, and lead to actual project diffs. Never claim tests passed from a shell tool's completion alone.
- Native VS Code uses the same status and recap rules, editor colors, a compact task picker, and native Source Control/diffs.
- Keep Yekan, bidi-safe code, keyboard navigation, explicit current selection, manual scroll position and automatic bottom-follow. Fit 1440, 390 and 320px; the VS Code panel must also fit 280px.

Acceptance: background approval without consent; combined status/search filters; current selection survives polling; recaps isolate the last request and clear on account/task switch; errors cannot appear successful; real review navigation; no horizontal overflow or hidden composer.
