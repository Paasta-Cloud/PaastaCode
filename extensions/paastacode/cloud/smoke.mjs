import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp,writeFile,chmod,rm,realpath} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomBytes} from "node:crypto";
const execute=promisify(execFile),image=process.argv[2]||"paastacode-cloud:development";
const directory=await realpath(await mkdtemp(join(tmpdir(),"paastacode-cloud-qa-")));
const name="paastacode-cloud-qa-"+randomBytes(6).toString("hex"),volume=name+"-data",secret=randomBytes(32).toString("base64url");
await writeFile(join(directory,"token"),secret,{mode:0o444});await chmod(directory,0o755);
const docker=async args=>(await execute("docker",args,{timeout:120_000,maxBuffer:1024*1024})).stdout.trim();
let created=false,createdVolume=false;
const archiveCheck="const fs=require('fs'),{spawnSync}=require('child_process');if(!fs.existsSync('/data/workspace/account-link'))fs.symlinkSync('/data/account','/data/workspace/account-link');const result=spawnSync('/opt/paastacode/engine/paasta',['workspace-export','/data/workspace','--private-root','/data/account'],{maxBuffer:1048576});if(result.status!==0)throw Error('Native workspace export failed');fs.writeFileSync('/data/qa-project.zip',result.stdout);";
const verifyArchive="import zipfile; z=zipfile.ZipFile('/data/qa-project.zip'); assert z.testzip() is None; assert z.read('persistence.txt') == b'retained synthetic project'; assert not any(n.startswith('account-link') for n in z.namelist()); print('native ZIP verified')";
const restoreCheck=`
import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
process.env.PAASTACODE_HOME="/data/acceptance";
const {startServer}=await import("./src/server.mjs");
const saved={id:"00000000-0000-4000-8000-000000000021",title:"Restored cloud session",revision:1,updated_at:"2026-10-13T00:00:00Z",snapshot:{version:1,messages:[{role:"user",text:"Saved project context"},{role:"assistant",text:"Reviewed without replaying tools"}]}};
const account={origin:"http://127.0.0.1:1",credentials:{token:"synthetic",aiKey:"synthetic"},context:async()=>({account:{id:"00000000-0000-4000-8000-000000000011",tenantId:"00000000-0000-4000-8000-000000000012"},models:[{id:"fixture",name:"Synthetic paid model",supported_parameters:["tools"],input_toman_per_million:100,output_toman_per_million:300}]}),request:async path=>{assert.equal(path,"/api/paastacode/sessions?id="+saved.id);return saved;}};
const app=await startServer({workspace:"/data/workspace",account});
const api=async(path,body)=>{const result=await fetch(app.url+"/api/"+path,{method:body?"POST":"GET",headers:{Authorization:"Bearer "+app.capability,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});assert.equal(result.status,200);return result.json();};
try{
  const mode=process.argv[1];let id;
  if(mode==="write"){id=(await api("restore",{id:saved.id})).session.id;await writeFile("/data/acceptance/restored-session.json",JSON.stringify({id}),{mode:0o600});}
  else{id=JSON.parse(await readFile("/data/acceptance/restored-session.json","utf8")).id;await api("ready",{});}
  assert((await api("sessions")).some(session=>session.id===id&&session.title===saved.title));
  const messages=await api("messages?id="+id),text=messages.flatMap(message=>message.parts.filter(part=>part.type==="text").map(part=>part.text)).join(" ");
  assert(text.includes(saved.snapshot.messages[0].text));assert(text.includes(saved.snapshot.messages[1].text));
  assert(messages.every(message=>message.parts.every(part=>part.type!=="tool")));assert.equal((await app.runtime.call("/session/"+id+"/message")).length,0,"Restore must not replay tools or inference");
  const transfer=await api('export',{});await new Promise(resolve=>setTimeout(resolve,300));const chunk=await api('export?id='+transfer.id+'&offset=0');assert(chunk.done);const zip=Buffer.from(chunk.data,'base64');assert.equal(zip.readUInt32LE(0),0x04034b50);assert(zip.includes(Buffer.from('persistence.txt')),'The real broker retains a fast archive before its first read');
  console.log("Real engine restored cloud session "+mode+" passed");
}finally{await app.close();}
`;
async function launch(){
  await docker(["run","--detach","--name",name,"--read-only","--cap-drop","ALL","--security-opt","no-new-privileges","--memory","1g","--cpus","1","--pids-limit","512","--tmpfs","/tmp:rw,nosuid,nodev,size=268435456","--mount",`type=volume,source=${volume},target=/data`,"--mount",`type=bind,source=${join(directory,"token")},target=/run/control-token,readonly`,"--env","PAASTACODE_CONSOLE=http://127.0.0.1:1","--env","PAASTACODE_CLOUD_SECRET_FILE=/run/control-token","--env","PAASTACODE_CLOUD_USER_ID=00000000-0000-4000-8000-000000000011","--env","PAASTACODE_CLOUD_TENANT_ID=00000000-0000-4000-8000-000000000012","--publish","127.0.0.1::8080",image]);created=true;
  const port=await docker(["port",name,"8080/tcp"]);assert.match(port,/^127\.0\.0\.1:\d+$/);const url="http://"+port;
  const deadline=Date.now()+60_000;
  while(Date.now()<deadline){try{if((await fetch(url+"/health",{signal:AbortSignal.timeout(1000)})).ok)return url;}catch{}await new Promise(done=>setTimeout(done,250));}
  throw new Error("Cloud container did not become ready");
}
try{
  await assert.rejects(docker(["run","--rm","--read-only","--cap-drop","ALL","--security-opt","no-new-privileges","--tmpfs","/tmp:rw,nosuid,nodev,size=67108864","--mount",`type=bind,source=${join(directory,"token")},target=/run/control-token,readonly`,"--env","PAASTACODE_CLOUD_DATA=/tmp/data","--env","PAASTACODE_CLOUD_SECRET_FILE=/run/control-token",image]),error=>error.stderr?.includes("صاحب فضای کار ابری معتبر نیست"));
  await docker(["volume","create",volume]);createdVolume=true;
  let url=await launch();const headers={"X-PaastaCode-Cloud-Token":secret};
  assert.equal((await fetch(url+"/api/state")).status,401);
  const first=await fetch(url+"/api/state",{headers});assert.equal(first.status,200);assert.equal(first.headers.get("x-paastacode-runtime"),"1");
  assert.equal((await fetch(url+"/api/state",{headers:{...headers,Origin:"https://code.paasta.cloud"}})).status,403);
  assert.equal((await fetch(url+"/api/shutdown",{method:"POST",headers})).status,404);
  assert.equal(await docker(["exec",name,"node","-e","process.stdout.write(String(process.getuid()))"]),"1000");
  await assert.rejects(docker(["exec",name,"node","-e","require('fs').writeFileSync('/opt/paastacode/should-not-exist','no')"]));
  await docker(["exec",name,"node","-e","require('fs').writeFileSync('/data/workspace/persistence.txt','retained synthetic project')"]);
  assert.match(await docker(["exec",name,"node","--input-type=module","-e","import {engineCommand} from './src/runtime.mjs'; const child=engineCommand(['--version'],{stdio:'inherit'}); child.once('exit',code=>process.exit(code));"]),/1\.19\.0/);
  await docker(["exec",name,"/opt/paastacode/engine/paasta","--version"]);
  await docker(["exec",name,"node","--input-type=module","-e",restoreCheck,"write"]);
  await docker(["exec",name,"node","-e","const fs=require('fs');fs.mkdirSync('/data/account',{recursive:true});fs.writeFileSync('/data/account/account.json',JSON.stringify({origin:'http://127.0.0.1:1',token:'paasta_'+ 'a'.repeat(43)}),{mode:0o600});"]);
  await docker(['exec',name,'node','-e',archiveCheck]);assert.equal(await docker(['exec',name,'python3','-c',verifyArchive]),'native ZIP verified');
  await docker(["stop","--time","40",name]);await docker(["rm",name]);created=false;
  url=await launch();const state=await fetch(url+"/api/state",{headers});assert.equal(state.status,200);assert.equal((await state.json()).connected,false);
  assert.equal(await docker(["exec",name,"node","-e","process.stdout.write(String(require('fs').existsSync('/data/account/account.json')))"]),"true");
  assert.equal(await docker(["exec",name,"node","-e","process.stdout.write(require('fs').readFileSync('/data/workspace/persistence.txt','utf8'))"]),"retained synthetic project");
  await docker(["exec",name,"node","--input-type=module","-e",restoreCheck,"read"]);
  await docker(['exec',name,'node','-e',archiveCheck]);assert.equal(await docker(['exec',name,'python3','-c',verifyArchive]),'native ZIP verified');
  console.log("Cloud container acceptance passed: required owner, unverified login recovery, private API, non-root/read-only runtime, real engine/CLI, project and restored-session persistence across container replacement; no tool/inference replay");
}finally{
  if(created){await docker(["stop","--time","40",name]).catch(()=>{});await docker(["rm","--force",name]).catch(()=>{});}
  if(createdVolume)await docker(["volume","rm",volume]);
  assert(directory.startsWith(join(await realpath(tmpdir()),"paastacode-cloud-qa-")));await rm(directory,{recursive:true,force:true});
}
