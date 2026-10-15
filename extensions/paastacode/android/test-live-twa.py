import pathlib, subprocess, time, xml.etree.ElementTree as ET, re
out=pathlib.Path('launch-evidence')
def adb(*args):
    return subprocess.check_output(['adb',*args],text=True)
def window():
    adb('shell','uiautomator','dump','/sdcard/live.xml')
    adb('pull','/sdcard/live.xml',str(out/'live.xml'))
    return ET.parse(out/'live.xml').getroot()
for attempt in range(12):
    time.sleep(3)
    root=window()
    nodes=list(root.iter('node'))
    choices=[n for n in nodes if n.get('clickable')=='true' and (n.get('resource-id','').endswith('signin_fre_dismiss_button') or n.get('text') in ['No thanks','Not now','Got it','Use without an account'])]
    if choices:
        box=list(map(int,re.findall(r'\d+',choices[0].get('bounds',''))))
        if len(box)==4: adb('shell','input','tap',str((box[0]+box[2])//2),str((box[1]+box[3])//2))
        continue
    if any('پروژه‌ات را ادامه بده' in n.get('text','') for n in nodes): break
else:
    raise AssertionError('The live mobile home screen was not reached')
with (out/'live-twa.png').open('wb') as f: subprocess.run(['adb','exec-out','screencap','-p'],stdout=f,check=True)
ids={n.get('resource-id','') for n in nodes}
assert 'com.android.chrome:id/url_bar' not in ids, 'Browser URL bar is still visible'
assert 'com.android.chrome:id/toolbar' not in ids, 'Custom Tabs toolbar is still visible'
assert any(n.get('text')=='پروژه‌ها' for n in nodes), 'Mobile navigation is missing'
print('Signed publisher APK reached live mobile home without Chrome URL bar or toolbar.')
# The Persian application and source code must not trigger browser translation UI.
assert not any(n.get('resource-id')=='com.android.chrome:id/message_primary_button' and n.get('text')=='Translate' for n in nodes), 'Chrome translation prompt is visible'
# Exercise the actual Android Back key with the conversation drawer open.
conversation=[n for n in nodes if n.get('text')=='گفتگوها'][-1]
box=list(map(int,re.findall(r'\d+',conversation.get('bounds',''))))
adb('shell','input','tap',str((box[0]+box[2])//2),str((box[1]+box[3])//2))
time.sleep(1)
opened=window()
assert any(n.get('content-desc')=='بستن گفتگوها' or n.get('text')=='بستن گفتگوها' for n in opened.iter('node')), 'Conversation drawer did not open'
adb('shell','input','keyevent','4')
time.sleep(1)
closed=window()
assert any('پروژه‌ات را ادامه بده' in n.get('text','') for n in closed.iter('node')), 'Android Back did not return to home'
print('Android Back closed the conversation drawer without leaving the application.')
