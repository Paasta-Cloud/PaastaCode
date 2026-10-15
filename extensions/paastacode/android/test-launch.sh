#!/usr/bin/env bash
set -euo pipefail
mkdir -p launch-evidence
adb shell pm list packages | grep -E 'chrome|browser' > launch-evidence/browsers.txt || true
adb install -r launch-apk/app-release.apk
adb logcat -c
adb shell am start -W -n cloud.paasta.code/com.google.androidbrowserhelper.trusted.LauncherActivity > launch-evidence/start.txt
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
grep -E 'mResumedActivity|topResumedActivity' launch-evidence/activities.txt | grep 'com.android.chrome'
# A second icon tap must also hand off successfully, not leave an invisible activity.
adb shell am force-stop cloud.paasta.code
adb shell am start -W -n cloud.paasta.code/com.google.androidbrowserhelper.trusted.LauncherActivity > launch-evidence/relaunch.txt
sleep 5
adb logcat -d > launch-evidence/relaunch-logcat.txt
if grep -q 'FATAL EXCEPTION' launch-evidence/relaunch-logcat.txt; then exit 1; fi
adb shell dumpsys activity activities | grep -E 'mResumedActivity|topResumedActivity' | grep 'com.android.chrome'
if [[ "${VERIFY_LIVE_TWA:-false}" == "true" ]]; then python3 extensions/paastacode/android/test-live-twa.py; fi
