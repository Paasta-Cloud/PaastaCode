# Third-party software

PaastaCode is an independent open-source fork of OpenCode, maintained at https://github.com/Paasta-Cloud/PaastaCode. The Paasta client currently runs the pinned, unmodified OpenCode 1.19.0 npm binary; it does not yet build a custom binary from the fork's source. OpenCode is Copyright (c) 2025 opencode and distributed under the MIT licence. Its full licence and existing notices must remain in shipped packages. PaastaCode is developed by Paasta and is not an official OpenCode product.

Upstream: https://github.com/anomalyco/opencode

The Paasta client code is MIT-licensed; see LICENSE. The Paasta logo in web/brand.png identifies this distribution. The MIT licence grants no trademark rights or rights to imply Paasta endorsement of a modified distribution.

The Paasta deployment CLI client source is included under paasta-cli/ with its MIT licence. Release builders compile this source into the platform package; customers do not need Go. Authentication credentials are supplied only to that child process in memory and do not replace a saved standalone Paasta CLI login.

Official Paasta builds use Yekan Bakh under the publisher's commercial licence. That font is not covered by this repository's MIT licence and is supplied separately at packaging time through `PAASTACODE_YEKAN_FONT`. The public source does not redistribute its source file. Vazirmatn variable WOFF2 is bundled as the open-source fallback, unmodified from https://github.com/rastikerdar/vazirmatn (Copyright 2015 The Vazirmatn Project Authors), under SIL Open Font License 1.1; see licenses/Vazirmatn-OFL.txt. Both fonts load locally without a CDN.

The native web components adapt the auto-growing prompt input from VibeFarsi (https://vibefarsi.ir; https://github.com/TronIsHere/vibefarsiui/blob/main/registry/ui/prompt-input.tsx), Copyright (c) 2026 VibeFarsi, and RTL dialog labeling/layout from FarsiUI (https://farsiui.ir; https://github.com/farsi-ui/ui/blob/main/components/ui/dialog.tsx), Copyright (c) 2025 Ehsan Ghaffar. MIT notices are preserved in licenses/VibeFarsi-MIT.txt and licenses/FarsiUI-MIT.txt. The adaptations use native browser elements to retain the shared lightweight UI.

The bundled Paasta deployment helper includes Go's runtime and standard library, Copyright 2009 The Go Authors, under the BSD 3-Clause licence preserved in licenses/Go-BSD.txt. The Paasta helper's own source remains MIT-licensed.

The shared select and composer send controls also port VibeFarsi's native Select, Button and PromptInput implementations from https://vibefarsi.ir/r/components/select.json, https://vibefarsi.ir/r/components/button.json and https://vibefarsi.ir/r/components/prompt-input.json (retrieved 2026-10-14). The React/Tailwind presentation is translated to the existing DOM/CSS renderer; native selection, RTL inline-end chevrons, keyboard interaction, focus, disabled and reduced-motion behavior are retained. The VibeFarsi MIT notice above applies.

The English PaastaCode wordmark embeds the same unmodified Geist variable WOFF2 used by Paasta, Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font), under SIL Open Font License 1.1. Its notice is preserved in licenses/Geist-OFL.txt. The font loads locally and requires no external font service.

## Browser automation

Microsoft Playwright MCP 0.0.83 and its pinned Playwright/Playwright Core runtime are distributed unmodified under Apache-2.0. Source: https://github.com/microsoft/playwright-mcp and https://github.com/microsoft/playwright. Their LICENSE/NOTICE files remain inside the bundled vendor packages. The PaastaCode launcher selects an isolated profile; browser binaries are installed separately or supplied in the cloud runtime image.

## VS Code Codicons

Native toolbar SVG icons are from Microsoft vscode-codicons, revision 8853e0b1b0e2058b099fde515d5f1f478db2f8e1, under Creative Commons Attribution 4.0 International (CC-BY-4.0). Source: https://github.com/microsoft/vscode-codicons/tree/8853e0b1b0e2058b099fde515d5f1f478db2f8e1. SVG geometry is unchanged; accessibility attributes are added at runtime. The full license is bundled at vscode/media/CODICONS_LICENSE.txt in extension packages.

## Curated skills and outbound proxy

Ponytail 5.3.2 by DietrichGebert (https://github.com/DietrichGebert/ponytail) is bundled as its standalone MIT-licensed SKILL.md, without plugin hooks. Persian Writing 1.3.6 by the persian-writing contributors (https://github.com/ali2000hos/persian-writing) is adapted into a task-routed entry and four unmodified prose/RTL references under MIT, without fonts or scripts. Their full licenses are in src/bundled-skills/<name>/LICENSE and travel with installed skills. UI/UX Design is a Paasta-authored MIT skill.

Apify proxy-chain 3.0.1 (https://github.com/apify/proxy-chain), Apache-2.0, and its dependencies are bundled into vendor/network.cjs. Dependency LICENSE/NOTICE files are retained under licenses/proxy-chain. Proxy transport does not disable TLS verification. Service names identify independent MCP services and imply no affiliation or included service subscription.
