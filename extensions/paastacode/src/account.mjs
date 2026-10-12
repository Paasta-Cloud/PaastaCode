import {mkdir,readFile,writeFile,rename,rm} from "node:fs/promises";
import {homedir} from "node:os";
import {join} from "node:path";
import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";

export const stateHome=process.env.PAASTACODE_HOME||join(homedir(),".paastacode");
export function consoleUrl(value=process.env.PAASTACODE_CONSOLE||"https://console.paasta.cloud") {
  const url=new URL(value);
  if(url.username||url.password||url.search||url.hash||url.pathname!=="/"||
    (url.protocol!=="https:" && !(url.protocol==="http:"&&["127.0.0.1","localhost"].includes(url.hostname))))throw new Error("آدرس پاستا معتبر نیست.");
  return url.origin;
}
async function protect(bytes,decode=false){
  if(process.platform!=="win32")return bytes;
  // DPAPI binds saved tokens to the signed-in Windows account; bytes travel only over stdin/stdout.
  const script="Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $o=[Security.Cryptography.ProtectedData]::"+(decode?"Unprotect":"Protect")+"($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($o))";
  return new Promise((resolve,reject)=>{
    const child=spawn("powershell.exe",["-NoProfile","-NonInteractive","-Command",script],{windowsHide:true,stdio:["pipe","pipe","pipe"]});
    let out="";child.stdout.on("data",chunk=>out+=chunk);child.stderr.resume();
    child.on("error",reject);child.on("exit",code=>code===0?resolve(Buffer.from(out.trim(),"base64")):reject(new Error("ذخیرهٔ امن اطلاعات ورود ناموفق بود.")));
    child.stdin.end(bytes.toString("base64"));
  });
}
export async function writePrivate(path,value){
  await mkdir(stateHome,{recursive:true,mode:0o700});
  const temp=path+"."+randomUUID()+".tmp";
  try {await writeFile(temp,await protect(Buffer.from(JSON.stringify(value))),{mode:0o600});await rename(temp,path);}
  finally{await rm(temp,{force:true});}
}
export async function readPrivate(path){
  try{return JSON.parse((await protect(await readFile(path),true)).toString());}
  catch(error){if(error.code==="ENOENT")return null;throw error;}
}
export class PaastaAccount {
  constructor(origin=consoleUrl(),home=stateHome){this.origin=consoleUrl(origin);this.path=join(home,"account.json");this.credentials=null;this.device=null;}
  async load(){const saved=await readPrivate(this.path);this.credentials=saved?.origin===this.origin?saved:null;return this;}
  async request(path,{method="GET",body,token=this.credentials?.token}={}){
    const response=await fetch(this.origin+path,{method,headers:{...(token?{Authorization:"Bearer "+token}:{}),...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000),redirect:"error"});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){const error=new Error(typeof data.error==="string"?data.error:data.error?.message||"ارتباط با حساب پاستا ناموفق بود.");error.status=response.status;throw error;}
    return data;
  }
  async begin(){
    if(this.device && this.device.expires>Date.now())return this.device.public;
    const result=await this.request("/api/cli/device",{method:"POST",token:null,body:{clientId:"paastacode",clientName:"PaastaCode"}});
    const uri=new URL(result.verificationUriComplete);
    if(uri.origin!==this.origin || uri.pathname!=="/cli/authorize")throw new Error("آدرس تأیید ورود معتبر نیست.");
    this.device={code:result.deviceCode,expires:Date.now()+result.expiresIn*1000,nextPoll:0,public:{url:uri.href,code:result.userCode}};
    return this.device.public;
  }
  async poll(){
    if(!this.device||this.device.expires<Date.now())throw new Error("درخواست ورود منقضی شده؛ دوباره وارد شوید.");
    if(this.device.nextPoll>Date.now())return {pending:true};
    this.device.nextPoll=Date.now()+3000;
    const device=this.device;
    const result=await this.request("/api/cli/device/token",{method:"POST",token:null,body:{deviceCode:device.code}});
    if(this.device!==device)throw new Error("درخواست ورود لغو شده است.");
    if(result.error==="authorization_pending")return {pending:true};
    if(!/^paasta_[A-Za-z0-9_-]{43}$/.test(result.token))throw new Error("پاسخ ورود معتبر نیست.");
    this.credentials={origin:this.origin,token:result.token};
    await writePrivate(this.path,this.credentials);this.device=null;
    return {pending:false};
  }
  async connect(dailyLimitToman){
    const result=await this.request("/api/paastacode/connection",{method:"POST",body:{dailyLimitToman}});
    this.credentials={...this.credentials,aiKey:result.key,dailyLimitToman:result.dailyLimitToman};
    await writePrivate(this.path,this.credentials);
    return {dailyLimitToman:result.dailyLimitToman};
  }
  async context(){return this.request("/api/paastacode/connection");}
  async logout(){
    this.device=null;
    try{await this.request("/api/paastacode/connection",{method:"DELETE"});}
    catch(error){if(![401,403].includes(error.status))throw error;}
    await rm(this.path,{force:true});this.credentials=null;
  }
}
