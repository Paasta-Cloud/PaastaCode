import sys,json,urllib.request,urllib.error,hashlib,zipfile,tempfile,pathlib,shutil,os,urllib.parse
event=json.load(open(os.environ['GITHUB_EVENT_PATH']));request=json.loads(event['inputs']['unified_artifacts']);token=os.environ['GH_TOKEN'];phase='setup'
assert os.environ['GITHUB_REPOSITORY']=='Paasta-Cloud/PaastaCode'
assert event['inputs']['package_run']=='41471685301' and event['inputs']['acceptance_run']=='41471685301' and event['inputs']['package_sha']=='f80bc92b03b88142338b46551e96f1c83370c1ae'
accepted={13154409657:'sha256:809e167094738b1cd31d6b0c634b5918e6183f78ea32224d09abca30ffc3b2de',13156255448:'sha256:255cefce42ca263443535b6ee699c3c38c759f06da40116eba0865f075f35d9d',13155583908:'sha256:de768fdeb862c4e127b2e2b1e1fe1ef02c2a65b68ee088af46393448ff339b1c',13155002981:'sha256:e13ba66796b32440b4a9cceb65f19dd53f2f5dc61c3886d72cf8000e63b22c1c',13156116387:'sha256:b8c45201bd41933b0f5fa6870fd3b16345bf9c49b022497d10f43ff1645d6b0f'}
assert {a['id'] for a in request['artifacts']}==set(accepted) and len(request['artifacts'])==5
for a in request['artifacts']:
 assert a['digest']==accepted[a['id']]
 u=urllib.parse.urlparse(a['url']);assert u.scheme=='https' and u.hostname.endswith('.blob.core.windows.net')
repo='Paasta-Cloud/PaastaCode';release=431659868
def api(path,method='GET',data=None):
 payload=None if data is None else json.dumps(data).encode()
 r=urllib.request.Request('https://api.github.com/'+path,data=payload,method=method,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','User-Agent':'Paasta-release','Content-Type':'application/json'})
 with urllib.request.urlopen(r,timeout=60) as response:return json.load(response)
def digest(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  while True:
   b=f.read(1024*1024)
   if not b:break
   h.update(b)
 return h.hexdigest()
def upload(path,name,assets):
 sha=digest(path)
 if name in assets:
  assert assets[name].get('digest')=='sha256:'+sha,'Existing asset differs; preserved';return
 url='https://uploads.github.com/repos/'+repo+'/releases/'+str(release)+'/assets?name='+urllib.parse.quote(name)
 with open(path,'rb') as f:
  req=urllib.request.Request(url,data=f,method='POST',headers={'Authorization':'Bearer '+token,'User-Agent':'Paasta-release','Content-Type':'application/octet-stream','Content-Length':str(os.path.getsize(path))})
  try:
   with urllib.request.urlopen(req,timeout=240) as response:result=json.load(response)
  except urllib.error.HTTPError as error:
   if error.code!=422:raise
   matches=[a for a in api('repos/'+repo+'/releases/'+str(release)+'/assets?per_page=100') if a['name']==name]
   assert len(matches)==1 and matches[0].get('digest')=='sha256:'+sha,'Concurrent asset differs; preserved'
   result=matches[0]
 assert result['size']==os.path.getsize(path)
 if result.get('digest'):assert result['digest']=='sha256:'+sha
 assets[name]=result
try:
 info=api('repos/'+repo+'/releases/'+str(release));assert info['draft'] and info['tag_name']=='vscode-v0.8.0'
 assets={a['name']:a for a in api('repos/'+repo+'/releases/'+str(release)+'/assets?per_page=100')}
 records=[]
 for artifact in request['artifacts']:
  phase=artifact['platform'];print(json.dumps({'phase':phase,'status':'preparing'}),flush=True)
  assert shutil.disk_usage('/tmp').free>10*1024**3+300*1024**2,'Remote staging would fall below 10 GiB'
  with tempfile.TemporaryDirectory(prefix='paasta-vscode-release-') as staging:
   stage=pathlib.Path(staging);archive=stage/'artifact.zip'
   with urllib.request.urlopen(artifact['url'],timeout=120) as source,open(archive,'xb') as output:shutil.copyfileobj(source,output)
   assert 'sha256:'+digest(archive)==artifact['digest']
   platform,arch=phase.rsplit('-',1)
   with zipfile.ZipFile(archive) as z:
    manifests=[n for n in z.namelist() if n.endswith('release-manifest-'+phase+'.json')];assert len(manifests)==1
    m=json.loads(z.read(manifests[0]));assert m['platform']==platform and m['arch']==arch
    names=[n for n in z.namelist() if n.endswith('.vsix')];assert len(names)==1
    old=names[0];expected=next(v for v in m['files'] if v['name']==pathlib.PurePosixPath(old).name)
    filename='paasta-vscode-0.8.0-'+phase+'.vsix';vsix=stage/filename
    with z.open(old) as source,open(vsix,'xb') as output:shutil.copyfileobj(source,output)
    assert digest(vsix)==expected['sha256'] and vsix.stat().st_size==expected['bytes']
   with zipfile.ZipFile(vsix) as v:
    pkg=json.loads(v.read('extension/package.json'));assert(pkg['publisher'],pkg['name'],pkg['version'])==('paasta-cloud','paasta','0.8.0')
   upload(vsix,filename,assets)
   records.append({'platform':platform,'arch':arch,'name':filename,'bytes':expected['bytes'],'sha256':expected['sha256']})
  print(json.dumps({'phase':phase,'status':'uploaded'}),flush=True)
 phase='metadata'
 with tempfile.TemporaryDirectory(prefix='paasta-vscode-release-meta-') as staging:
  manifest=pathlib.Path(staging)/'release-manifest.json';checksums=pathlib.Path(staging)/'SHA256SUMS'
  manifest.write_text(json.dumps({'version':'0.8.0','extensionId':'paasta-cloud.paasta','sourceRepository':'Paasta-Cloud/paasta','sourceCommit':'f80bc92b03b88142338b46551e96f1c83370c1ae','acceptanceRun':41471685301,'files':records},indent=2)+'\n')
  checksums.write_text(''.join(r['sha256']+'  '+r['name']+'\n' for r in records))
  upload(manifest,'release-manifest.json',assets);upload(checksums,'SHA256SUMS',assets)
 print(json.dumps({'draftPrepared':True,'releaseId':release,'platforms':len(records),'published':False}),flush=True)
except Exception as error:
 print(json.dumps({'releasePreparationFailed':True,'phase':phase,'errorType':type(error).__name__,'httpStatus':getattr(error,'code',None)}),flush=True);sys.exit(1)
