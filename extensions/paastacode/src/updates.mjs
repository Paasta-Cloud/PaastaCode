import {createHash} from "node:crypto";
import {mkdir,mkdtemp,open,rename,readFile,realpath} from "node:fs/promises";
import {join,resolve,dirname,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {spawn} from "node:child_process";
import {stateHome,writePrivate,readPrivate} from "./account.mjs";

const repository="Paasta-Cloud/PaastaCode",api="https://api.github.com/repos/"+repository;
export function versionParts(value){const match=/^(?:paastacode-)?v?(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/.exec(value||"");return match?[+match[1],+match[2],+match[3],{alpha:0,beta:1,rc:2}[match[4]]??3,+(match[5]||0)]:null;}
export function newer(a,b){const left=versionParts(a),right=versionParts(b);if(!left||!right)return false;for(let i=0;i<left.length;i++)if(left[i]!==right[i])return left[i]>right[i];return false;}
export function chooseRelease(releases,current){return releases.filter(r=>!r.draft&&versionParts(r.tag_name)&&(!r.prerelease||current.includes("-"))&&newer(r.tag_name,current)).sort((a,b)=>newer(a.tag_name,b.tag_name)?-1:1)[0]||null;}
export async function checkUpdate(current,{fetcher=fetch}={}){
  const response=await fetcher(api+"/releases?per_page=50",{headers:{Accept:"application/vnd.github+json"},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error("بررسی نسخهٔ جدید ممکن نشد؛ اتصال به گیت‌هاب را بررسی کنید.");
  const releases=await response.json();if(!Array.isArray(releases))throw new Error("پاسخ سرویس به‌روزرسانی معتبر نیست.");
  return chooseRelease(releases,current);
}
export async function downloadUpdate(release,kind="portable",{platform=process.platform,arch=process.arch,fetcher=fetch,directory=join(stateHome,"updates")}={}){
  const version=release.tag_name.replace(/^(?:paastacode-)?v/,"");
  if(!versionParts(version)||!["portable","vsix"].includes(kind))throw new Error("نسخهٔ به‌روزرسانی معتبر نیست.");
  const name=`PaastaCode-${version}-${platform}-${arch}.${kind==="vsix"?"vsix":platform==="win32"?"zip":"tar.gz"}`;
  const asset=release.assets?.find(a=>a.name===name);
  if(!asset||!/^sha256:[a-f0-9]{64}$/.test(asset.digest||"")||!Number.isSafeInteger(asset.size)||asset.size<1||asset.size>2_000_000_000)throw new Error("بستهٔ معتبر برای این دستگاه در انتشار جدید موجود نیست.");
  const expected=`https://github.com/${repository}/releases/download/${encodeURIComponent(release.tag_name)}/${name}`;
  if(asset.browser_download_url!==expected)throw new Error("نشانی بستهٔ به‌روزرسانی معتبر نیست.");
  const response=await fetcher(expected,{signal:AbortSignal.timeout(15*60*1000)});
  if(!response.ok||!response.body)throw new Error("دریافت به‌روزرسانی ممکن نشد؛ دوباره تلاش کنید.");
  await mkdir(directory,{recursive:true,mode:0o700});const staging=await mkdtemp(join(directory,"download-")),partial=join(staging,name+".part"),file=await open(partial,"wx",0o600),hash=createHash("sha256");let bytes=0;
  try{for await(const chunk of response.body){bytes+=chunk.length;if(bytes>asset.size)throw new Error("اندازهٔ بستهٔ به‌روزرسانی معتبر نیست.");hash.update(chunk);await file.writeFile(chunk);}}finally{await file.close();}
  if(bytes!==asset.size||hash.digest("hex")!==asset.digest.slice(7))throw new Error("صحت بستهٔ دریافتی تأیید نشد؛ به‌روزرسانی نصب نشد.");
  const path=join(staging,name);await rename(partial,path);return {path,directory:staging,version,name};
}
function execute(command,args){return new Promise((done,fail)=>{const child=spawn(command,args,{windowsHide:true,stdio:["ignore","pipe","pipe"]});let output="";const timeout=setTimeout(()=>{child.kill();fail(new Error("آماده‌سازی به‌روزرسانی کامل نشد."));},120000);child.stdout.on("data",data=>{output+=data;if(output.length>2_000_000){child.kill();fail(new Error("فهرست فایل‌های بسته بیش از حد بزرگ است."));}});child.stderr.resume();child.once("error",()=>{clearTimeout(timeout);fail(new Error("ابزار بازکردن بسته در دسترس نیست."));});child.once("close",code=>{clearTimeout(timeout);code?fail(new Error("آماده‌سازی بستهٔ جدید ناموفق بود.")):done(output);});});}
export async function installPortable(download,installation){
  const root=await realpath(installation),node=process.platform==="win32"?"node.exe":"node";
  await readFile(join(root,"client/package.json"));await realpath(join(root,"runtime",node));
  const prefix=`PaastaCode-${download.version}-${process.platform}-${process.arch}`;
  const entries=(await execute("tar",["-tf",download.path])).trim().split(/\r?\n/);
  if(entries.some(entry=>entry!==prefix&&entry!==prefix+"/"&&(!entry.startsWith(prefix+"/")||entry.split(/[\\/]/).includes("..")||entry.includes("\\"))))throw new Error("مسیر فایل‌های بسته معتبر نیست.");
  await execute("tar",["-xf",download.path,"-C",download.directory]);
  const target=await realpath(join(download.directory,prefix));
  if(!target.startsWith(await realpath(download.directory)+sep))throw new Error("مسیر نصب معتبر نیست.");
  const metadata=JSON.parse(await readFile(join(target,"client/package.json"),"utf8"));if(metadata.version!==download.version)throw new Error("نسخهٔ بسته با انتشار مطابقت ندارد.");
  const output=await execute(join(target,"runtime",node),[join(target,"client/bin/paastacode.mjs"),"--version"]);if(output.trim()!=="PaastaCode "+download.version)throw new Error("اجرای نسخهٔ جدید تأیید نشد.");
  await writePrivate(join(root,"update-target.json"),{path:target,version:download.version});return target;
}
export async function portableTarget(packageRoot){
  try{
  const installation=process.env.PAASTACODE_INSTALL_ROOT||dirname(packageRoot),pointer=await readPrivate(join(installation,"update-target.json"));
  if(!pointer)return null;
  const current=JSON.parse(await readFile(join(packageRoot,"package.json"),"utf8"));if(!newer(pointer.version,current.version))return null;
  const destination=await realpath(pointer.path),updates=await realpath(join(stateHome,"updates"));
  if(!destination.startsWith(updates+sep)||resolve(destination,"client")===resolve(packageRoot)||!versionParts(pointer.version))return null;
  const metadata=JSON.parse(await readFile(join(destination,"client/package.json"),"utf8"));
  if(metadata.version!==pointer.version)return null;
  return {installation,path:destination};
  }catch{return null;} // A broken pointer leaves the original installation runnable.
}
export const currentPackage=fileURLToPath(new URL("../",import.meta.url));
