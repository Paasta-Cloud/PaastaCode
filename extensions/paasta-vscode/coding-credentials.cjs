// Invoked by official clients as a token helper. Never import vscode or print stored records.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {randomUUID,createHash}=require('node:crypto');
const {spawn}=require('node:child_process');
const tools=new Set(['codex','claude-code']);
function validate(account,tool){if(!/^[a-f0-9]{64}$/.test(account)||!tools.has(tool))throw Error('Invalid tool identity');}
const root=()=>path.join(os.homedir(),'.paasta','coding-tools');
async function directory(base,account){
 if(!/^[a-f0-9]{64}$/.test(account))throw Error('Invalid account');
 // Only these owned paths are writable; no workspace-relative config or symlink targets.
 let current=path.parse(path.resolve(base)).root;for(const part of path.relative(current,path.resolve(base)).split(path.sep)){current=path.join(current,part);try{if((await fs.lstat(current)).isSymbolicLink())throw Error('Linked tools directory');}catch(error){if(error.code!=='ENOENT')throw error;await fs.mkdir(current,{mode:0o700});}}
 for(const folder of [base,path.join(base,account)]){
  await fs.mkdir(folder,{recursive:true,mode:0o700});const stat=await fs.lstat(folder);
  if(!stat.isDirectory()||stat.isSymbolicLink()||(process.platform!=='win32'&&((stat.mode&0o077)||stat.uid!==process.getuid())))throw Error('Private tools directory required');
 }
 return path.join(base,account);
}
async function safeRead(file,limit=16384,privateFile=true){
 const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>limit||(process.platform!=='win32'&&(stat.uid!==process.getuid()||(stat.mode&(privateFile?0o077:0o022)))))throw Error('Owned regular file required');return fs.readFile(file);
}
async function atomicPrivate(file,bytes){
 try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Unsafe file');}catch(error){if(error.code!=='ENOENT')throw error;}
 const temporary=file+'.'+randomUUID()+'.tmp';
 try{await fs.writeFile(temporary,bytes,{flag:'wx',mode:0o600});await fs.rename(temporary,file);}finally{await fs.rm(temporary,{force:true});}
}
async function protect(bytes,decode=false){
 if(process.platform!=='win32')return bytes;
 const binary=path.join(process.env.SystemRoot||'C:\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const script='Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $o=[Security.Cryptography.ProtectedData]::'+(decode?'Unprotect':'Protect')+'($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($o))';
 return new Promise((resolve,reject)=>{const child=spawn(binary,['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='';const timer=setTimeout(()=>child.kill(),5000);child.stdout.on('data',part=>{out+=part;if(out.length>3*1024*1024)child.kill();});child.stderr.resume();child.on('error',()=>{clearTimeout(timer);reject(Error('Credential protection failed'));});child.on('exit',code=>{clearTimeout(timer);code===0?resolve(Buffer.from(out.trim(),'base64')):reject(Error('Credential protection failed'));});child.stdin.on('error',()=>{});child.stdin.end(bytes.toString('base64'));});
}
async function readRecord(base,account,tool){validate(account,tool);const folder=await directory(base,account);try{const bytes=await safeRead(path.join(folder,tool+'.credential'));const record=JSON.parse((await protect(bytes,true)).toString());if(record.account!==account||record.tool!==tool||!/^paasta_ai_[A-Za-z0-9_-]{43}$/.test(record.key))throw Error('Credential identity mismatch');return record;}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function writeRecord(base,account,tool,record){validate(account,tool);if(record.account!==account||record.tool!==tool||!/^paasta_ai_[A-Za-z0-9_-]{43}$/.test(record.key))throw Error('Invalid credential');const folder=await directory(base,account);await atomicPrivate(path.join(folder,tool+'.credential'),await protect(Buffer.from(JSON.stringify(record))));}
function quoteCommand(parts,platform=process.platform){return parts.map(value=>{if(/[\r\n\x00]/.test(value))throw Error('Invalid helper path');if(platform==='win32'){if(/[%!"^&|<>]/.test(value))throw Error('Unsupported helper path');return '"'+value+'"';}return "'"+value.replaceAll("'","'\"'\"'")+"'";}).join(' ');}
function configuration(account,tool,model,node,helper){
 validate(account,tool);if(!/^[A-Za-z0-9][A-Za-z0-9/_.:+-]{0,199}$/.test(model))throw Error('Invalid model');
 const args=[helper,account,tool];
 if(tool==='codex')return {file:'config.toml',text:`# Managed by Paasta; separate CODEX_HOME, not your personal config.\nmodel_provider = "paasta"\nmodel = ${JSON.stringify(model)}\nsandbox_mode = "read-only"\napproval_policy = "on-request"\n\n[model_providers.paasta]\nname = "Paasta Coding"\nbase_url = "https://console.paasta.cloud/api/ai/v1"\nwire_api = "responses"\nsupports_websockets = false\nrequest_max_retries = 0\nstream_max_retries = 0\n\n[model_providers.paasta.auth]\ncommand = ${JSON.stringify(node)}\nargs = ${JSON.stringify(args)}\ntimeout_ms = 10000\n`};
 return {file:'settings.json',text:JSON.stringify({apiKeyHelper:quoteCommand([node,...args]),env:{ANTHROPIC_API_KEY:'',ANTHROPIC_AUTH_TOKEN:'',CLAUDE_CODE_OAUTH_TOKEN:'',CLAUDE_CODE_USE_BEDROCK:'0',CLAUDE_CODE_USE_VERTEX:'0',CLAUDE_CODE_USE_FOUNDRY:'0',ANTHROPIC_BASE_URL:'https://console.paasta.cloud/api/ai',ANTHROPIC_MODEL:model,ANTHROPIC_DEFAULT_HAIKU_MODEL:model,ANTHROPIC_DEFAULT_SONNET_MODEL:model,ANTHROPIC_DEFAULT_OPUS_MODEL:model},permissions:{defaultMode:'default'}},null,2)+'\n'};
}
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function withLock(base,name,work){
 if(!/^[a-z0-9-]{1,150}$/.test(name))throw Error('Invalid lock');
 const file=path.join(base,name+'.lock'),token=randomUUID();let handle;
 for(let attempt=0;attempt<2;attempt++){
  try{handle=await fs.open(file,'wx',0o600);await handle.writeFile(JSON.stringify({pid:process.pid,token}));break;}
  catch(error){
   if(error.code!=='EEXIST')throw error;
   const bytes=await safeRead(file);let old;try{old=JSON.parse(bytes);}catch{throw Error('وضعیت قفل اتصال نیاز به بررسی دارد.');}
   if(!Number.isInteger(old.pid)||old.pid<=0)throw Error('Invalid lock owner');
   try{process.kill(old.pid,0);throw Error('اتصال در پنجرهٔ دیگری در حال تغییر است.');}catch(status){if(status.code!=='ESRCH')throw status;}
   if(digest(await safeRead(file))===digest(bytes))await fs.rm(file);
  }
 }
 if(!handle)throw Error('اتصال هم‌زمان قابل ثبت نیست؛ دوباره تلاش کنید.');
 try{return await work();}finally{await handle.close();try{const latest=JSON.parse(await safeRead(file));if(latest.token===token)await fs.rm(file);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
async function readProtected(file){return JSON.parse((await protect(await safeRead(file,3*1024*1024),true)).toString());}
async function writeProtected(file,value){const bytes=Buffer.from(JSON.stringify(value));if(bytes.length>2*1024*1024)throw Error('Private record too large');await atomicPrivate(file,await protect(bytes));}
module.exports={withLock,readProtected,writeProtected,root,validate,directory,safeRead,atomicPrivate,readRecord,writeRecord,configuration,quoteCommand,digest};
if(require.main===module){(async()=>{if(process.argv.length!==4)throw Error();const [account,tool]=process.argv.slice(2);const record=await readRecord(root(),account,tool);if(!record?.enabled)throw Error();process.stdout.write(record.key);})().catch(()=>{process.stderr.write('Paasta tool credential is unavailable. Reconnect the tool in Paasta.\n');process.exitCode=1;});}
