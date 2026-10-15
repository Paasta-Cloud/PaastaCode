# Upstream synchronization

## 2026-10-15

- Paasta base: `7b960c1`.
- OpenCode dev: `654b79b27e79da735d6b07d766c8d7431a71d1b7` (132 upstream commits).
- Integrated with a merge commit, retaining both histories and all Paasta commits.
- The merge leaves `extensions/paastacode` and every `paastacode-*` release workflow unchanged. Paasta branding, authentication, billing, session persistence, native VS Code UI and package assembly remain owned by this client.
- Upstream publish/deploy workflows retain their `anomalyco/opencode` repository guards. Fork checks use GitHub-hosted runners rather than upstream-only Blacksmith runners.
- Local client validation: syntax checks and all 77 tests passed, including real pinned-engine permissions, command streaming, PDF catalogue refresh, workflow handoff and session persistence.
- Full upstream lint/type checks and Linux/Windows tests run in the pull request. Native packages still require the existing release and installed-extension acceptance gates before promotion.
- Compatibility fixes found during acceptance activate the transcript CSS font before rich history, resolve Storybook dependencies from the application's installed public package entry, and retain the inferred Solid owner type instead of an unnecessary assertion.
- Windows core integration tests start real Git/npm processes and exceeded Bun's five-second default on hosted runners. The test launcher uses a bounded 30-second Windows default; explicit test/caller timeouts and every assertion remain intact. Linux keeps the original default. See [Bun's timeout reference](https://bun.com/docs/test/runtime-behavior#global-timeout).

### Runtime compatibility boundary

The source tree tracks OpenCode's 2.x development line. PaastaCode currently ships the separately pinned `opencode-ai@1.19.0` engine, which is the latest stable upstream GitHub release at this checkpoint. This merge does **not** claim that the shipped engine runs 2.x fixes. The new `@opencode/cli` package, API, configuration and storage changes require a separate migration with real engine and persisted-session upgrade acceptance before changing that dependency. Do not replace the pin with a moving development version.

The independent draft `mcp-skills-browser` feature branch is outside this merge; its unpublished functionality is neither removed nor automatically released.
