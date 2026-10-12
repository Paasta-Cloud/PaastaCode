# PaastaCode 0.2.0-beta.3 candidate

Bundled local web/CLI, Electron installers and standalone platform VSIX packages, with local open-source Vazirmatn and MIT VibeFarsi/FarsiUI pattern adaptations. Powered by OpenCode; the source fork and deployment CLI source remain open source.

The separate Paasta deployment connection is restricted to project/log read and deployment write, bound to the same account, and requests a one-use human source/cost review. Changed source/price fails closed; environment files and known credentials are excluded; ambiguous deployment results are observed rather than automatically retried.

This candidate adds opt-in per-conversation background backup after completed requests, safe retry/readback and cloud conflict review. A restored conversation keeps its reviewed cloud revision; stale updates or remote deletion pause saving. An explicitly confirmed independent copy preserves both versions. Manual and automatic uploads share one queue and stay bound to the initiating account. Files and tool output are excluded, and the local broker must remain running. Beta3 native packages and live sync rollout are being verified; do not infer their completion from beta2 evidence.

The previous beta2 source `2fd801773c06bd35011c601d69f3fff0f92ed970` passed package/desktop run `38304288587`, with all 20 customer files matched against native manifests and GitHub SHA-256 digests. Installed VSIX 0.2.1 executed in actual isolated VS Code 1.141.0 on Windows/Linux x64/arm64 (`38305996610`) and macOS Intel/Apple Silicon (`38307139392`). Beta3 uses extension upgrade version 0.2.2.

The hosted UI is available at https://code.paasta.cloud and pairs explicitly with a local workspace started using `paastacode web --hosted`. Execution currently takes place on the user's device. Full hosted workspaces, opt-in background sync/conflict recovery, extra-resource deployment previews, paid model/deployment acceptance, publisher signing and signed update delivery remain completion gates. This is an unsigned prerelease, not the final customer release. Check each native manifest for signing status.

Use only the package for your operating system and architecture. Verify SHA256SUMS before installation. Unsigned candidates may trigger operating-system warnings; final signed delivery requires the publisher's signing credentials.
