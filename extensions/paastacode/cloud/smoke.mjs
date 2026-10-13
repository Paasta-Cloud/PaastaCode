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
async function launch(){
  await docker(["run","--detach","--name",name,"--read-only","--cap-drop","ALL","--security-opt","no-new-privileges","--memory","1g","--cpus","1","--pids-limit","512","--tmpfs","/tmp:rw,nosuid,nodev,size=268435456","--mount",`type=volume,source=${volume},target=/data`,"--mount",`type=bind,source=${join(directory,"token")},target=/run/control-token,readonly`,"--env","PAASTACODE_CLOUD_SECRET_FILE=/run/control-token","--publish","127.0.0.1::8080",image]);created=true;
  const port=await docker(["port",name,"8080/tcp"]);assert.match(port,/^127\.0\.0\.1:\d+$/);const url="http://"+port;
  const deadline=Date.now()+60_000;
  while(Date.now()<deadline){try{if((await fetch(url+"/health",{signal:AbortSignal.timeout(1000)})).ok)return url;}catch{}await new Promise(done=>setTimeout(done,250));}
  throw new Error("Cloud container did not become ready");
}
try{
  await docker(["volume","create",volume]);createdVolume=true;
  let url=await launch();const headers={Authorization:"Bearer "+secret};
  assert.equal((await fetch(url+"/api/state")).status,401);
  assert.equal((await fetch(url+"/api/state",{headers})).status,200);
  assert.equal((await fetch(url+"/api/state",{headers:{...headers,Origin:"https://code.paasta.cloud"}})).status,403);
  assert.equal((await fetch(url+"/api/shutdown",{method:"POST",headers})).status,404);
  assert.equal(await docker(["exec",name,"node","-e","process.stdout.write(String(process.getuid()))"]),"1000");
  await assert.rejects(docker(["exec",name,"node","-e","require('fs').writeFileSync('/opt/paastacode/should-not-exist','no')"]));
  await docker(["exec",name,"node","-e","require('fs').writeFileSync('/data/workspace/persistence.txt','retained synthetic project')"]);
  assert.match(await docker(["exec",name,"node","--input-type=module","-e","import {engineCommand} from './src/runtime.mjs'; const child=engineCommand(['--version'],{stdio:'inherit'}); child.once('exit',code=>process.exit(code));"]),/1\.19\.0/);
  await docker(["exec",name,"/opt/paastacode/engine/paasta","--version"]);
  await docker(["stop","--time","40",name]);await docker(["rm",name]);created=false;
  url=await launch();assert.equal((await fetch(url+"/api/state",{headers})).status,200);
  assert.equal(await docker(["exec",name,"node","-e","process.stdout.write(require('fs').readFileSync('/data/workspace/persistence.txt','utf8'))"]),"retained synthetic project");
  console.log("Cloud container acceptance passed: private API, non-root/read-only runtime, real engine/CLI, project persistence across container replacement");
}finally{
  if(created){await docker(["stop","--time","40",name]).catch(()=>{});await docker(["rm","--force",name]).catch(()=>{});}
  if(createdVolume)await docker(["volume","rm",volume]);
  assert(directory.startsWith(join(await realpath(tmpdir()),"paastacode-cloud-qa-")));await rm(directory,{recursive:true,force:true});
}
