# Third-party software

PaastaCode is an independent open-source fork of OpenCode, maintained at https://github.com/Paasta-Cloud/PaastaCode. The Paasta client currently runs the pinned, unmodified OpenCode 1.19.0 npm binary; it does not yet build a custom binary from the fork's source. OpenCode is Copyright (c) 2025 opencode and distributed under the MIT licence. Its full licence and existing notices must remain in shipped packages. PaastaCode is developed by Paasta and is not an official OpenCode product.

Upstream: https://github.com/anomalyco/opencode

The Paasta client code is MIT-licensed; see LICENSE. The Paasta logo in web/brand.png identifies this distribution. The MIT licence grants no trademark rights or rights to imply Paasta endorsement of a modified distribution.

The Paasta deployment CLI client source is included under paasta-cli/ with its MIT licence. Release builders compile this source into the platform package; customers do not need Go. Authentication credentials are supplied only to that child process in memory and do not replace a saved standalone Paasta CLI login.

Vazirmatn variable WOFF2 is bundled unmodified from https://github.com/rastikerdar/vazirmatn (Copyright 2015 The Vazirmatn Project Authors). It remains under SIL Open Font License 1.1; see licenses/Vazirmatn-OFL.txt. Fonts load locally without a CDN or a commercial-font licence.

The native web components adapt the auto-growing prompt input from VibeFarsi (https://vibefarsi.ir; https://github.com/TronIsHere/vibefarsiui/blob/main/registry/ui/prompt-input.tsx), Copyright (c) 2026 VibeFarsi, and RTL dialog labeling/layout from FarsiUI (https://farsiui.ir; https://github.com/farsi-ui/ui/blob/main/components/ui/dialog.tsx), Copyright (c) 2025 Ehsan Ghaffar. MIT notices are preserved in licenses/VibeFarsi-MIT.txt and licenses/FarsiUI-MIT.txt. The adaptations use native browser elements to retain the shared lightweight UI.
