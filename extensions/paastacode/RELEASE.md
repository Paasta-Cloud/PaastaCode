# PaastaCode 0.2.0-beta.2

Bundled local web/CLI, Electron installers and standalone platform VSIX packages, with local open-source Vazirmatn and MIT VibeFarsi/FarsiUI pattern adaptations. Powered by OpenCode; the source fork and deployment CLI source remain open source.

The separate Paasta deployment connection is restricted to project/log read and deployment write, bound to the same account, and requests a one-use human source/cost review. Changed source/price fails closed; environment files and known credentials are excluded; ambiguous deployment results are observed rather than automatically retried.

Public commit `2fd801773c06bd35011c601d69f3fff0f92ed970` passed package run `38304288587`: Windows x64, Linux x64/arm64 and macOS Intel/Apple Silicon built their own portable web/CLI, VSIX and desktop installers and executed the actual desktop renderer to check version, RTL, Vazirmatn and the preload bridge. The Windows standalone VSIX previously installed and rendered in an isolated real VS Code profile; installed extension execution on the other architectures is being verified separately. New account features include conversation export, revision-checked deletion and owned-connection revocation with preservation of conversations and files.

The hosted UI is available at https://code.paasta.cloud and pairs explicitly with a local workspace started using `paastacode web --hosted`. Execution currently takes place on the user's device. Full hosted workspaces, opt-in background sync/conflict recovery, extra-resource deployment previews, paid model/deployment acceptance, publisher signing and signed update delivery remain completion gates. This is an unsigned prerelease, not the final customer release. Check each native manifest for signing status.

Use only the package for your operating system and architecture. Verify SHA256SUMS before installation. Unsigned candidates may trigger operating-system warnings; final signed delivery requires the publisher's signing credentials.
