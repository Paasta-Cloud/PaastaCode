import pathlib,tempfile,subprocess,json,os,runpy,hashlib,zipfile,io,contextlib
from types import SimpleNamespace
script=pathlib.Path(__file__).with_name('publish-native-vsix.py');sha='a'*40;run='42';repo='Paasta-Cloud/PaastaCode'
platforms=['win32-x64','linux-x64','linux-arm64','darwin-x64','darwin-arm64'];marker='Installed native tools: registered manager, packaged Node helper, private credentials and disabled-key rejection passed without provider requests.'
original_output=subprocess.check_output;original_run=subprocess.run;environment=dict(os.environ);cwd=os.getcwd()
def scenario(kind):
 state={'release':None,'uploads':0,'edited':False,'created':False}
 def output(args,**kwargs):
  args=args[1:]
  if args[0]=='api':
   endpoint=args[1]
   if '/jobs?' in endpoint:
    jobs=[{'name':'package (runner, '+p.rsplit('-',1)[0]+', '+p.rsplit('-',1)[1]+')','conclusion':'success'} for p in platforms]
    return json.dumps({'jobs':jobs[:-1] if kind=='missing-platform' else jobs})
   if '/actions/runs/' in endpoint:return json.dumps({'head_sha':'b'*40 if kind=='wrong-source' else sha,'path':'.github/workflows/paastacode-release.yml','event':'workflow_dispatch','status':'completed','conclusion':'failure' if kind=='failed-run' else 'success'})
   if '/releases/tags/' in endpoint:return json.dumps(state['release'])
   raise AssertionError('Unexpected endpoint '+endpoint)
  if args[:2]==['run','view']:return marker*(9 if kind=='missing-acceptance' else 10)
  if args[:2]==['run','download']:
   target=pathlib.Path(args[args.index('--dir')+1])
   for p in platforms:
    folder=target/('paastacode-'+p);folder.mkdir(parents=True);file=folder/'PaastaCode-fixture.vsix';suffix='.exe' if p.startswith('win32') else ''
    with zipfile.ZipFile(file,'w',compression=zipfile.ZIP_DEFLATED) as archive:
     archive.writestr('extension/package.json',json.dumps({'publisher':'paasta-cloud','name':'paasta','version':'0.8.5'}))
     for n in ['paastacode.cjs','native-workbench.cjs','coding-tools.cjs','coding-credentials.cjs','coding-provider-config.cjs','coding-tool-launcher.cjs','PAASTACODE_LICENSE','client/LICENSE']:archive.writestr('extension/'+n,'fixture')
     for n in ['runtime/node','client/engine/paasta','client/engine/opencode']:archive.writestr('extension/'+n+suffix,b'x'*100001)
    data=file.read_bytes();digest=hashlib.sha256(data).hexdigest()
    (folder/'release-manifest-fixture.json').write_text(json.dumps({'files':[{'name':file.name,'bytes':len(data),'sha256':'bad' if kind=='bad-artifact' else digest}]}))
   return ''
  if args[:2]==['release','create']:
   state['created']=True;state['release']={'id':42,'target_commitish':sha,'draft':True,'html_url':'https://github.com/'+repo+'/releases/tag/vscode-v0.8.5','assets':[]};return ''
  if args[:2]==['release','upload']:
   file=pathlib.Path(args[3]);data=file.read_bytes();state['uploads']+=1
   state['release']['assets'].append({'name':file.name,'size':len(data),'digest':'sha256:'+('0'*64 if kind=='bad-upload' else hashlib.sha256(data).hexdigest())});return ''
  if args[:2]==['release','edit']:state['edited']=True;state['release']['draft']=False;return ''
  raise AssertionError('Unexpected command '+str(args))
 def request(args,**kwargs):
  if state['release'] is None:return SimpleNamespace(returncode=1,stderr='HTTP 404',stdout='')
  return SimpleNamespace(returncode=0,stderr='',stdout=json.dumps(state['release']))
 with tempfile.TemporaryDirectory(prefix='native-promotion-test-') as temp:
  os.chdir(temp);os.environ.update(GITHUB_REPOSITORY=repo,NATIVE_PACKAGE_RUN=run,NATIVE_PACKAGE_SHA=sha,NATIVE_PUBLISH='true')
  subprocess.check_output=output;subprocess.run=request
  try:
   with contextlib.redirect_stdout(io.StringIO()):runpy.run_path(str(script),run_name='__main__')
   assert kind=='success';assert state['edited'] and state['uploads']==7
  except AssertionError:
   if kind=='success':raise
   assert not state['edited']
   if kind!='bad-upload':assert not state['created']
  finally:subprocess.check_output=original_output;subprocess.run=original_run;os.chdir(cwd)
for kind in ['wrong-source','failed-run','missing-platform','missing-acceptance','bad-artifact','bad-upload','success']:scenario(kind)
os.environ.clear();os.environ.update(environment)
print('Native promotion: exact source, complete platform matrix, both installed modes, artifact hashes and uploaded hashes enforced before publication; valid seven-file release passed with synthetic packages only.')
