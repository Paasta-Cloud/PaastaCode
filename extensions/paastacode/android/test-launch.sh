#!/usr/bin/env bash
set -euo pipefail
mkdir -p launch-evidence
adb shell pm list packages | grep -E 'chrome|browser' > launch-evidence/browsers.txt || true
adb install -r launch-apk/app-debug.apk
adb logcat -c
adb shell am start -W -n cloud.paasta.code.debug/com.google.androidbrowserhelper.trusted.LauncherActivity > launch-evidence/start.txt
sleep 12
adb logcat -d > launch-evidence/logcat.txt
adb shell dumpsys activity activities > launch-evidence/activities.txt
adb shell uiautomator dump /sdcard/window.xml
adb pull /sdcard/window.xml launch-evidence/window.xml
adb exec-out screencap -p > launch-evidence/launch.png
if grep -q 'FATAL EXCEPTION' launch-evidence/logcat.txt; then
  grep -A 30 'FATAL EXCEPTION' launch-evidence/logcat.txt
  exit 1
fi
grep -E 'mResumedActivity|topResumedActivity' launch-evidence/activities.txt
