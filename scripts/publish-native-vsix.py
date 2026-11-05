"""Promote only the five installed-and-tested unified customer packages."""
import json,os,pathlib,re,subprocess,hashlib,shutil,zipfile
repo=os.environ['GITHUB_REPOSITORY'];run=os.environ['NATIVE_PACKAGE_RUN'];sha=os.environ['NATIVE_PACKAGE_SHA'];version='0.8.5'
assert repo=='Paasta-Cloud/PaastaCode' and run.isdigit() and re.fullmatch('[a-f0-9]{40}',sha)
def gh(*args):return subprocess.check_output(['gh',*args],text=True)
def api(path):return json.loads(gh('api','repos/'+repo+'/'+path))
info=api('actions/runs/'+run)
assert info['head_sha']==sha and info['path']=='.github/workflows/paastacode-release.yml'
assert info['event']=='workflow_dispatch' and info['status']=='completed' and info['conclusion']=='success'
jobs={}
for attempt in range(1,info.get('run_attempt',1)+1):
 for job in api('actions/runs/'+run+'/attempts/'+str(attempt)+'/jobs?per_page=100')['jobs']:jobs[job['name']]=job
packages=[j for j in jobs.values() if j['name'].startswith('package (')]
platforms={'win32-x64','linux-x64','linux-arm64','darwin-x64','darwin-arm64'}
assert len(packages)==5 and all(j['conclusion']=='success' for j in packages)
actual=set()
for job in packages:
 match=re.search(r', (win32|linux|darwin), (x64|arm64)\)$',job['name']);assert match
 actual.add('-'.join(match.groups()))
 log=gh('api','repos/'+repo+'/actions/jobs/'+str(job['id'])+'/logs')
 assert log.count('Installed native tools: registered manager, packaged Node helper, private credentials and disabled-key rejection passed without provider requests.')>=2
assert actual==platforms
stage=pathlib.Path('.artifacts/native-promote');stage.mkdir(parents=True,exist_ok=True)
gh('run','download',run,'--repo',repo,'--pattern','paastacode-*','--dir',str(stage/'accepted'))
out=stage/'publish';out.mkdir();records=[]
for platform in sorted(platforms):
 folder=stage/'accepted'/('paastacode-'+platform);files=list(folder.glob('*.vsix'));assert len(files)==1
 source=files[0];data=source.read_bytes();digest=hashlib.sha256(data).hexdigest()
 manifests=list(folder.glob('release-manifest-*.json'));assert len(manifests)==1
 manifest=json.loads(manifests[0].read_text());entry=next(f for f in manifest['files'] if f['name']==source.name)
 assert entry['bytes']==len(data) and entry['sha256']==digest
 with zipfile.ZipFile(source) as archive:
  pkg=json.loads(archive.read('extension/package.json'));assert (pkg['publisher'],pkg['name'],pkg['version'])==('paasta-cloud','paasta',version)
  for required in ['extension/paastacode.cjs','extension/native-workbench.cjs','extension/coding-tools.cjs','extension/coding-credentials.cjs','extension/coding-provider-config.cjs','extension/coding-tool-launcher.cjs','extension/PAASTACODE_LICENSE','extension/client/LICENSE']:
   assert required in archive.namelist(),required
  suffix='.exe' if platform.startswith('win32') else ''
  for required in ['extension/runtime/node'+suffix,'extension/client/engine/paasta'+suffix,'extension/client/engine/opencode'+suffix]:assert archive.getinfo(required).file_size>100000
  assert not any('/.git/' in n or '/.artifacts/' in n or n.endswith('.credential') for n in archive.namelist())
 name='paasta-vscode-'+version+'-'+platform+'.vsix';shutil.copyfile(source,out/name)
 records.append({'platform':platform,'name':name,'bytes':len(data),'sha256':digest})
release={'version':version,'extensionId':'paasta-cloud.paasta','sourceRepository':repo,'sourceCommit':sha,'acceptanceRun':int(run),'files':records}
(out/'release-manifest.json').write_text(json.dumps(release,indent=2)+'\n')
(out/'SHA256SUMS').write_text(''.join(f['sha256']+'  '+f['name']+'\n' for f in records))
notes=stage/'release-notes.md';notes.write_text('Paasta '+version+'\n\nOfficial Claude Code/Codex connection management, private tool credentials, personal configuration restore and confirmed local CLI entry in the unified extension.\n\nFive native packages passed real installed VS Code acceptance (project and empty workspace), bundled CLI authentication and credential-helper tests. No live provider inference was used.\n\nSource: '+sha+'\nVerified package run: https://github.com/'+repo+'/actions/runs/'+run+'\n')
tag='vscode-v'+version
prior=subprocess.run(['gh','api','repos/'+repo+'/releases/tags/'+tag],capture_output=True,text=True)
if prior.returncode==0:
 existing=json.loads(prior.stdout);assert existing['target_commitish']==sha,'Refuse a release from another source commit'
elif '404' in prior.stderr:
 gh('release','create',tag,'--repo',repo,'--draft','--prerelease','--target',sha,'--title','Paasta '+version,'--notes-file',str(notes));existing=api('releases/tags/'+tag)
else:raise RuntimeError('Release state could not be verified')
existingAssets={a['name']:a for a in existing['assets']}
for source in out.iterdir():
 if source.name in existingAssets:
  data=source.read_bytes();asset=existingAssets[source.name];assert asset['size']==len(data) and asset['digest']=='sha256:'+hashlib.sha256(data).hexdigest()
 else:
  assert existing['draft'],'Refuse to add missing assets to an already public release'
  gh('release','upload',tag,str(source),'--repo',repo)
published=api('releases/tags/'+tag)
assets=published['assets'];expected={f['name']:(f['bytes'],f['sha256']) for f in records}
for name in ['release-manifest.json','SHA256SUMS']:
 data=(out/name).read_bytes();expected[name]=(len(data),hashlib.sha256(data).hexdigest())
assert set(a['name'] for a in assets)==set(expected)
for asset in assets:assert (asset['size'],asset['digest'])==(expected[asset['name']][0],'sha256:'+expected[asset['name']][1])
if os.environ.get('NATIVE_PUBLISH')=='true':gh('release','edit',tag,'--repo',repo,'--draft=false','--prerelease')
print(json.dumps({'release':published['html_url'],'version':version,'verifiedPlatforms':len(records),'sourceCommit':sha,'acceptanceRun':run,'published':not published['draft'] or os.environ.get('NATIVE_PUBLISH')=='true'}))
