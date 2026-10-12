# PaastaCode 0.2.0-beta.4 candidate

Bundled local web/CLI, Electron installers and standalone platform VSIX packages, with local open-source Vazirmatn and MIT VibeFarsi/FarsiUI pattern adaptations. Powered by OpenCode; the source fork and deployment CLI source remain open source.

The separate Paasta deployment connection is restricted to project/log read and deployment write, bound to the same account, and requests a one-use human source/cost review. Changed source/price fails closed; environment files and known credentials are excluded; ambiguous deployment results are observed rather than automatically retried.

This candidate keeps workspace execution alive independently of desktop/web/CLI/VS Code clients. Closing one interface does not terminate another interface's shared engine/session. Authenticated explicit local stop preserves files and conversations. Credential changes invalidate old engines, account mutations are serialized, and stale-window actions cannot revoke a newer login. Windows packaged Electron lifecycle and 23 source checks passed; the beta4 native matrix and production UI/lifecycle acceptance are being verified.

The published beta3 source `31a4d3e816eb4607b4b3d3d797fe6799771cf384` passed package/desktop run `38310904450`, with all 20 customer files matched against native manifests and GitHub SHA-256 digests. Installed VSIX 0.2.2 executed in actual isolated VS Code 1.141.0 on all five native targets in `38312342215`. Its sync UI shipped as `56537883558a` through canonical `38312599338`; actual public browser consent/conflict/copy and production-role account/retry/audit checks pass. Beta4 uses extension upgrade version 0.2.3.

The hosted UI is available at https://code.paasta.cloud and pairs explicitly with a local workspace started using `paastacode web --hosted`. Execution currently takes place on the user's device. Full hosted workspaces, opt-in background sync/conflict recovery, extra-resource deployment previews, paid model/deployment acceptance, publisher signing and signed update delivery remain completion gates. This is an unsigned prerelease, not the final customer release. Check each native manifest for signing status.

Use only the package for your operating system and architecture. Verify SHA256SUMS before installation. Unsigned candidates may trigger operating-system warnings; final signed delivery requires the publisher's signing credentials.
