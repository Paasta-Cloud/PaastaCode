# PaastaCode 0.2.0-beta.9 / پاستاکد

بسته‌های نصب دسکتاپ، وب محلی، CLI و افزونهٔ VS Code با رابط فارسی و راست‌چین و فونت یکان.

- ریدیزاین میزکار برای برنامه‌نویس‌ها: تم تیره و روشن، آیکون‌های یکدست، جست‌وجوی گفتگو و انتخاب واضح. عنوان گفتگو از نخستین درخواست گرفته می‌شود.
- اصلاح بسته‌بندی یکان در ویندوز و آزمون بارگذاری واقعی آن؛ شمارهٔ نسخه در عنوان پنجره.
- دنبال‌کردن خروجی و حفظ اسکرول دستی هنگام خواندن پیام‌های قبلی.
- تغییر مدل در همان گفتگو؛ توقف و ادامهٔ درخواست در حال اجرا با مدل تازه.
- مدیریت خودکار برنامه‌ریزی فقط‌خواندنی و اجرا با مدل اقتصادی‌تر، در صورت وجود جفت مدل مناسب؛ نمایش مدل و قیمت مرحلهٔ جاری، تنظیمات دستی و توقف قابل‌اعتماد.
- حذف مدل‌های رایگان و بدون قیمت معتبر از کاتالوگ و درخواست‌های جدید پاستاکد.
- ادامهٔ پروژه‌های Codex، Claude Code و Cursor در همان پوشه و ورود قواعد و متن گفتگو پس از پیش‌نمایش.
- Full Access، عملیات گیت و بررسی به‌روزرسانی از داخل برنامه.
- دریافت ZIP کامل پروژهٔ آماده با دانلود مرورگر، نمایش خطای آماده‌سازی و تلاش دوباره؛ حفظ گفتگوی بازیابی‌شده پس از جایگزینی کانتینر، بدون بازپخش ابزارها.
- رابط انتخاب و مدیریت فضای کار ابری در شاخهٔ توسعه، با بررسی هزینه، تمدید، لغو و حفظ پیش‌نویس هر پروژه.

اجرای کاملاً ابری هنوز روی سرویس عمومی فعال نشده است. [رابط وب](https://code.paasta.cloud) فعلاً به اجرای محلی متصل می‌شود. نسخهٔ افزونه برای ارتقای نصب قبلی `0.2.8` است.

[راهنمای نصب و استفاده](https://github.com/Paasta-Cloud/PaastaCode/blob/codex/paastacode-cloud/extensions/paastacode/README.md) شامل فرمان‌های CLI و قالب‌های قابل ایمپورت است. ایمپورت، متن انتخاب‌شده و قواعد پروژه را منتقل می‌کند؛ انتقال کامل تاریخچهٔ خصوصی یا فرایند در حال اجرای ابزار قبلی نیست.

These are unsigned beta packages. Choose the package for your operating system and architecture and verify SHA256SUMS. Publisher signing and final in-place desktop upgrade acceptance remain open. Hosted runtime source is included for development; no production hosted execution or paid inference acceptance is claimed.

### Publisher signing configuration

Configure Windows `PAASTACODE_WINDOWS_CSC_LINK` and `PAASTACODE_WINDOWS_CSC_KEY_PASSWORD` separately from macOS `PAASTACODE_MAC_CSC_LINK` and `PAASTACODE_MAC_CSC_KEY_PASSWORD`. macOS also requires `PAASTACODE_APPLE_ID`, `PAASTACODE_APPLE_APP_SPECIFIC_PASSWORD` and `PAASTACODE_APPLE_TEAM_ID` for notarization. Store certificate material and passwords in GitHub Secrets, never in this repository or chat.

The release workflow supplies these credentials only when `signed` is enabled and only to the matching operating system. Unsigned and Linux jobs receive none. The previous `PAASTACODE_CSC_LINK`/`PAASTACODE_CSC_KEY_PASSWORD` remain a fallback for existing single-platform configuration; one certificate cannot replace both Windows and Apple certificates. Windows CI has installed published beta8, upgraded beta9 over the same directory, run both installed versions and verified that the existing profile remained. Signed installer acceptance still requires publisher credentials and is not proved by either this unsigned upgrade or the credential-routing test.

Powered by OpenCode. PaastaCode is an explicit MIT fork of OpenCode. Official packages contain the publisher-licensed Yekan Bakh font; source builds retain the open-source Vazirmatn fallback. The licensed font is not relicensed under MIT.
