import assert from "node:assert/strict";
import {spawn,spawnSync} from "node:child_process";
import {mkdtemp,realpath,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {smokeBrowser} from './smoke-browser.mjs';
const packageVersion=JSON.parse(await readFile(new URL("../package.json",import.meta.url),"utf8")).version;
const bundle=resolve(process.argv[2]||".artifacts/package/PaastaCode-"+packageVersion+"-"+process.platform+"-"+process.arch);
const node=join(bundle,"runtime",process.platform==="win32"?"node.exe":"node");
const client=join(bundle,"client"),bin=join(client,"bin/paastacode.mjs");
const home=await realpath(await mkdtemp(join(tmpdir(),"paastacode-package-")));
process.env.PAASTACODE_HOME=home;
const {readPrivate}=await import(pathToFileURL(join(client,"src/account.mjs")).href);
const {workspaceKey}=await import(pathToFileURL(join(client,"src/runtime.mjs")).href);
let child;
try{
  assert((await readFile(join(client,'vendor/network.cjs'),'utf8')).length>0);
  const {startOutboundProxy}=await import(pathToFileURL(join(client,'src/outbound-proxy.mjs')).href);
  const proxy=await startOutboundProxy({enabled:true,url:'socks5://127.0.0.1:2080',username:'',password:''});await proxy.close();
  const {WorkspaceIntegrations}=await import(pathToFileURL(join(client,'src/integrations.mjs')).href);
  const integrations=new WorkspaceIntegrations(home,'package-fixture',{home});
  for(const name of ['ponytail','persian-writing','ui-ux-design'])await integrations.update({kind:'skill',action:'preset',name});
  assert.equal(Object.keys((await integrations.read()).skills).length,3);
  await smokeBrowser(node,client,home);
  const version=spawnSync(node,[bin,"--version"],{encoding:"utf8",cwd:home});assert.equal(version.status,0);assert.match(version.stdout,/PaastaCode 0\.2/);
  const engine=spawnSync(join(client,"engine",process.platform==="win32"?"opencode.exe":"opencode"),["--version"],{encoding:"utf8",cwd:home,timeout:30000});assert.equal(engine.status,0);assert.match(engine.stdout,/1\.19\.0/);
  const launcher=process.platform==="win32"?join(bundle,"paastacode.cmd"):join(bundle,"paastacode");
  const launch=spawnSync(launcher,["--version"],{encoding:"utf8",cwd:home,shell:process.platform==="win32"});assert.equal(launch.status,0);assert.match(launch.stdout,/PaastaCode 0\.2/);
  child=spawn(node,[bin,"web","--no-open","--workspace="+home],{cwd:home,env:{...process.env,PAASTACODE_HOME:home},stdio:["ignore","ignore","pipe"],windowsHide:true});child.stderr.resume();
  let connection;
  for(let i=0;i<50;i++){try{connection=await readPrivate(join(home,"workspace-"+workspaceKey(home)+".json"));if(connection)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  assert(connection,"Installed web server must start without npm or a system Node.js");
  assert.equal((await fetch(connection.url+"/api/state")).status,401);
  const taskState=await fetch(connection.url+"/task-state.js");assert.equal(taskState.status,200);assert((await taskState.text()).includes("PaastaTasks"),"Installed browser must serve its task helper");
  const state=await fetch(connection.url+"/api/state",{headers:{Authorization:"Bearer "+connection.capability}});assert.equal(state.status,200);assert.equal((await state.json()).connected,false);
  const font=await fetch(connection.url+"/fonts/Vazirmatn.woff2");assert.equal(font.status,200);assert.equal(Buffer.from(await font.arrayBuffer()).subarray(0,4).toString(),"wOF2");
  if(process.env.PAASTACODE_YEKAN_FONT){const yekan=await fetch(connection.url+"/fonts/YekanBakh.ttf");assert.equal(yekan.status,200,"Publisher package must serve Yekan");assert.deepEqual(Buffer.from(await yekan.arrayBuffer()),await readFile(process.env.PAASTACODE_YEKAN_FONT));}
  assert((await readFile(join(client,"licenses/Vazirmatn-OFL.txt"),"utf8")).includes("SIL OPEN FONT LICENSE"));
  const {stopWorkspace}=await import(pathToFileURL(join(client,"src/workspace-service.mjs")).href);
  await stopWorkspace(home);
  console.log("Installed portable web/CLI package smoke passed: bundled Node/engine, protected APIs, local Persian font");
}finally{
  if(child&&child.exitCode===null){child.kill();await new Promise(r=>{child.once("exit",r);setTimeout(r,3000).unref();});}
  assert(home.startsWith(join(await realpath(tmpdir()),"paastacode-package-")));await rm(home,{recursive:true,force:true});
}
