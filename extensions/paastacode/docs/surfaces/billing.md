# Billing surface

Operate mode. The owner already chose a familiar Codex-style developer workbench and delegated layout choices; extend its charcoal/light tokens, Yekan typography, outline icons and quiet density.

The task is seeing the owned account's remaining allowance and pending funding, then deliberately choosing subscription, a finite shared wallet cap or pause. Use a right navigation rail, a readable central ledger with quota bars and separate wallet controls. On narrow screens, replace the rail with a compact header and stack the sections without horizontal overflow.

All prices, model IDs, periods and availability come from the authenticated API. No illustrative commercial plans in shipped UI. Default-off sales show a clear unavailable state. Purchase uses a frozen, expiring preview and a protected confirmation dialog; retries after a missing acknowledgement reuse the same token. Changes require the current preference revision. Local clients open the owned browser page; a device token cannot make a purchase or change the cap. Keep the expected owner across requests and clear rendered data after account mismatch.

Acceptance: desktop, 390px and 320px; both themes; loading, denied/disabled/empty, active quota, pending cost, expiry, stale preferences, purchase retry, malicious names and account switching. Preserve OpenCode attribution and the bundled open-source font fallback.

Cancellation extends this surface: review only an owned future prepaid period, show its original charge returning to the Paasta wallet, keep the active period and current funding choice, and retain the frozen request after lost acknowledgement or reload. Sales being disabled must not prevent an authenticated refund. The backend rejects started periods, any request history, changed receipts and revoked ownership; one refund and audit survive concurrency and expired receipt replay. A replacement purchase can reuse the calendar boundary while the old receipt remains archived.

An unavailable-sales notice identifies the blocked purchase/cap changes while keeping pause and an eligible refund available. Recovery validates stored intents before opening a dialog; malformed records clear with an actionable message after an owned refresh, never by sending a mutation.
