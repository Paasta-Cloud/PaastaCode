# PaastaCode design

Inherit Paasta's official identity and design system from ../../DESIGN.md. Operate mode: users spend long development sessions here, under mixed ambient light. Support system light/dark appearance with neutral surfaces; reserve blue for the primary send action and focus.

Persian UI uses Yekan Bakh. Conversation prose is RTL; code and diff blocks are LTR and independently scrollable. Sessions, account, cloud-save state, workspace and model remain visible. On narrow screens, sessions collapse into a labeled drawer and the composer stays in normal flow. Controls have at least 44px touch height, clear labels, keyboard focus, busy/disabled states and actionable failures.

Use the official Paasta mark beside the text پاستاکد; no substitute logo. Keep provider credentials out of the renderer. Tool permission decisions are visible, explicit and default to rejection. Never render model-generated HTML. Design must distinguish local sessions from acknowledged account backups.
