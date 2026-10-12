#!/usr/bin/env node
import {spawn} from "node:child_process";
import {join,resolve} from "node:path";
import {realpath} from "node:fs/promises";
import {pathToFileURL} from "node:url";
import {PaastaAccount,stateHome,readPrivate} from "../src/account.mjs";
import {startServer} from "../src/server.mjs";
import {engineCommand,workspaceKey} from "../src/runtime.mjs";

export function openBrowser(url){
  // PowerShell argument binding prevents URL metacharacters from becoming shell syntax.
  if(process.platform==="win32"){
    const child=spawn("powershell.exe",["-NoProfile","-NonInteractive","-Command","$u=[Console]::In.ReadToEnd(); Start-Process -FilePath $u"],{windowsHide:true,stdio:["pipe","ignore","ignore"]});child.stdin.end(url);child.on("error",()=>{});
  }else {const child=spawn(process.platform==="darwin"?"open":"xdg-open",[url],{stdio:"ignore"});child.on("error",()=>{});child.unref();}
}
async function main(){
  const args=process.argv.slice(2),command=args[0]||"web";
  const workspace=await realpath(resolve(args.find(a=>a.startsWith("--workspace="))?.slice(12)||process.cwd()));
  if(["help","--help","-h"].includes(command)){
    console.log("PaastaCode / پاستاکد\nPowered by OpenCode · MIT\nOpen-source fork: https://github.com/Paasta-Cloud/PaastaCode\n\n  paastacode web [--workspace=PATH]\n  paastacode login\n  paastacode cli [--workspace=PATH]\n  paastacode logout\n\nنسخهٔ اولیه: وب محلی و CLI مشترک. ورود و ذخیرهٔ حساب به API پاستاکد روی پاستا نیاز دارد.");return;
  }
  const account=await new PaastaAccount().load();
  if(command==="login"){
    const device=await account.begin();console.log("کد ورود: "+device.code+"\n"+device.url);openBrowser(device.url);
    while((await account.poll()).pending)await new Promise(r=>setTimeout(r,3000));
    console.log("ورود انجام شد. برای انتخاب مدل و تأیید سقف مصرف، paastacode web را اجرا کنید.");return;
  }
  if(command==="logout"){await account.logout();console.log("دسترسی دستگاه لغو شد.");return;}
  const saved=await readPrivate(join(stateHome,"workspace-"+workspaceKey(workspace)+".json"));
  let running;
  if(saved){
    try{const response=await fetch(saved.url+"/api/state",{headers:{Authorization:"Bearer "+saved.capability},signal:AbortSignal.timeout(1500)});if(response.ok)running=saved;}catch{}
  }
  if(command==="cli"){
    if(!running)throw new Error("ابتدا paastacode web را برای همین پوشه اجرا کنید.");
    if(!running.engineUrl)throw new Error("ابتدا مدل و سقف مصرف را در رابط وب تأیید کنید.");
    const child=engineCommand(["attach",running.engineUrl,"--dir",workspace],{stdio:"inherit",env:{...process.env,OPENCODE_SERVER_PASSWORD:running.enginePassword}});
    child.on("exit",code=>{process.exitCode=code||0;});return;
  }
  if(command!=="web")throw new Error("دستور ناشناخته است. paastacode help را اجرا کنید.");
  if(running){console.log("پاستاکد برای این پوشه باز است.");if(!args.includes("--no-open"))openBrowser(running.url+"/#cap="+running.capability);return;}
  const app=await startServer({workspace,account});
  console.log("پاستاکد: "+app.url+"\nبرای CLI مشترک: paastacode cli");
  if(!args.includes("--no-open"))openBrowser(app.launchUrl);
  for(const signal of ["SIGINT","SIGTERM"])process.once(signal,()=>void app.close().then(()=>process.exit()));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
