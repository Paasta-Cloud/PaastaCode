const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const vault=require('./coding-credentials.cjs');
function codexProfile(text){
 if(text.charCodeAt(0)===0xfeff)throw Error('BOM config requires manual review');
 if(Buffer.byteLength(text)>512*1024)throw Error('Config too large');
 const lines=text.match(/[^\n]*\n|[^\n]+$/g)||[];let index=0,found=-1;
 for(;index<lines.length;index++){
  const line=lines[index];if(/^\s*#/.test(line))continue;
  if(line.includes('"'.repeat(3))||line.includes("'".repeat(3)))throw Error('Multiline root settings require manual review');
  if(/^\s*\[/.test(line))break;
  if(/^\s*(?:profile|"profile"|'profile')\s*=/.test(line)){
   if(found>=0||!/^\s*(?:profile|"profile"|'profile')\s*=\s*(?:"(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?(?:\r?\n)?$/.test(line))throw Error('Ambiguous profile setting');found=index;
  }
 }
 if(found>=0)lines[found]='profile = "paasta"\n';else lines.splice(index,0,(index&&!lines[index-1].endsWith('\n')?'\n':'')+'profile = "paasta"\n');return lines.join('');
}
function claudeSettings(text,generated){
 const current=text?JSON.parse(text):{};if(!current||Array.isArray(current)||typeof current!=='object'||current.env&&(typeof current.env!=='object'||Array.isArray(current.env)))throw Error('Invalid Claude settings');
 const next=JSON.parse(generated);const env={...current.env,...next.env};
 return JSON.stringify({...current,apiKeyHelper:next.apiKeyHelper,env},null,2)+'\n';
}
async function settingsPath(tool,workspace){
 const home=tool==='codex'?(process.env.CODEX_HOME||path.join(os.homedir(),'.codex')):(process.env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude'));
 if(!path.isAbsolute(home))throw Error('مسیر تنظیمات باید مطلق باشد.');
 const folder=path.resolve(home),relative=path.relative(workspace,folder);if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw Error('تنظیمات حساب نباید داخل پروژه باشد.');
 let cursor=path.parse(folder).root;for(const part of path.relative(cursor,folder).split(path.sep)){cursor=path.join(cursor,part);try{if((await fs.lstat(cursor)).isSymbolicLink())throw Error('پوشهٔ تنظیمات نباید پیوند باشد.');}catch(error){if(error.code!=='ENOENT')throw error;await fs.mkdir(cursor,{mode:0o700});}}
 return path.join(folder,tool==='codex'?'config.toml':'settings.json');
}
async function activateOwned(base,account,tool,workspace,node){
 vault.validate(account,tool);await vault.directory(base,account);
 const record=await vault.readRecord(base,account,tool);if(!record?.enabled)throw Error('ابتدا اتصال پاستا را تنظیم کنید.');
 const target=await settingsPath(tool,workspace),backup=path.join(base,'active-'+tool+'.backup');
 let original='',existed=false,previous=null;
 try{previous=await vault.readProtected(backup);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(previous&&previous.account!==account)throw Error('اتصال حساب دیگری فعال است؛ ابتدا از همان حساب غیرفعال کنید.');
 try{const bytes=await vault.safeRead(target,512*1024,false);original=bytes.toString();if(!Buffer.from(original).equals(bytes))throw Error('تنظیمات UTF-8 معتبر نیست؛ فایل حفظ شد.');existed=true;}catch(error){if(error.code!=='ENOENT')throw error;}
 if(previous&&(previous.target!==target||(vault.digest(original)!==previous.appliedHash&&vault.digest(original)!==vault.digest(previous.original))))throw Error('تنظیمات بیرون از پاستا تغییر کرده‌اند؛ برای حفظ آن‌ها فعال‌سازی متوقف شد.');
 const generated=vault.configuration(account,tool,record.model,node,path.join(__dirname,'coding-credentials.cjs'));
 const updated=tool==='codex'?codexProfile(original):claudeSettings(original,generated.text);
 if(tool==='codex'){
  const profile=path.join(path.dirname(target),'paasta.config.toml');
  try{const bytes=await vault.safeRead(profile);if(!previous?.profileHash||vault.digest(bytes)!==previous.profileHash)throw Error('فایل paasta.config.toml از قبل وجود دارد؛ بازنویسی نشد.');}catch(error){if(error.code!=='ENOENT')throw error;}
  await vault.atomicPrivate(profile,generated.text);
 }
 // Save recovery before changing user config; snapshots are DPAPI protected on Windows.
 const next={account,tool,target,original:previous?previous.original:original,existed:previous?previous.existed:existed,appliedHash:vault.digest(updated),profileHash:tool==='codex'?vault.digest(generated.text):null};
 await vault.writeProtected(backup,next);await vault.atomicPrivate(target,updated);return target;
}
async function restoreOwned(base,account,tool){
 vault.validate(account,tool);const backup=path.join(base,'active-'+tool+'.backup');let value;
 try{value=await vault.readProtected(backup);}catch(error){if(error.code==='ENOENT')return false;throw error;}
 if(value.account!==account||value.tool!==tool)throw Error('اتصال متعلق به حساب دیگری است.');
 const parent=path.dirname(value.target),normalize=value=>process.platform==='win32'?value.toLowerCase():value;if(normalize(await fs.realpath(parent))!==normalize(path.resolve(parent)))throw Error('مسیر بازیابی تغییر کرده است.');
 let current;try{current=await vault.safeRead(value.target,512*1024);}catch(error){if(error.code==='ENOENT'&&!value.existed){await fs.rm(backup);return true;}throw error;}if(value.existed&&vault.digest(current)===vault.digest(value.original)){await fs.rm(backup);return true;}if(vault.digest(current)!==value.appliedHash)throw Error('تنظیمات دستی تغییر کرده‌اند؛ برای حفظ آن‌ها بازیابی خودکار انجام نشد.');
 if(value.existed)await vault.atomicPrivate(value.target,value.original);else await fs.rm(value.target);
 await fs.rm(backup);return true;
}
async function activate(base,account,tool,workspace,node){vault.validate(account,tool);await vault.directory(base,account);return vault.withLock(base,'active-'+tool,()=>activateOwned(base,account,tool,workspace,node));}
async function restore(base,account,tool){vault.validate(account,tool);await vault.directory(base,account);return vault.withLock(base,'active-'+tool,()=>restoreOwned(base,account,tool));}
module.exports={codexProfile,claudeSettings,activate,restore,settingsPath};
