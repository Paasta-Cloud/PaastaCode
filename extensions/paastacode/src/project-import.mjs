import {lstat,realpath,readdir,open} from "node:fs/promises";
import {resolve,join,relative,isAbsolute} from "node:path";
import {createHash} from "node:crypto";

const sources=["codex","claude","cursor"],limit=90000;
const labels={codex:"Codex",claude:"Claude Code",cursor:"Cursor"};
// Import only explicit text. No settings, hooks, credentials, databases or linked files.
async function safeText(root,name){
  const path=resolve(root,name);let info;
  try{info=await lstat(path);}catch(error){if(error.code==="ENOENT")return null;throw error;}
  const rel=relative(root,await realpath(path));
  if(info.isSymbolicLink()||isAbsolute(rel)||rel===".."||rel.startsWith("..\\")||rel.startsWith("../"))throw new Error("فایل پیوندی یا خارج از پروژه وارد نمی‌شود.");
  if(!info.isFile()||info.size>limit)throw new Error("فایل قواعد بیش از حد بزرگ یا نامعتبر است.");
  const file=await open(path,"r");try{const bytes=Buffer.alloc(limit+1),{bytesRead}=await file.read(bytes,0,bytes.length,0);if(bytesRead>limit)throw new Error("فایل قواعد بیش از حد بزرگ است.");const text=bytes.subarray(0,bytesRead).toString("utf8");if(text.includes("\0"))throw new Error("فقط فایل متنی وارد می‌شود.");return text;}finally{await file.close();}
}
function conversation(text,source,format){
  if(!text)return [];
  if(typeof text!=="string"||Buffer.byteLength(text)>900000)throw new Error("فایل گفتگو بیش از حد بزرگ است.");
  if(format==="text")return [{role:"user",text:"متن خروجی گفتگوی "+labels[source]+":\n"+text}];
  if(format!=="jsonl"||source==="cursor")throw new Error("قالب گفتگو پشتیبانی نمی‌شود؛ خروجی متنی یا Markdown انتخاب کنید.");
  const messages=[];
  for(const line of text.split(/\r?\n/).filter(s=>s.trim())){
    let value;try{value=JSON.parse(line);}catch{throw new Error("فایل JSONL معتبر نیست.");}
    // Codex rollout response_item and Claude message records; omit tool calls/results and metadata.
    const message=source==="codex"&&value?.type==="response_item"&&value.payload?.type==="message"?value.payload:source==="claude"&&["user","assistant"].includes(value?.type)?value.message:null;
    if(!message||!["user","assistant"].includes(message.role))continue;
    const content=typeof message.content==="string"?message.content:Array.isArray(message.content)?message.content.filter(p=>["text","input_text","output_text"].includes(p?.type)&&typeof p.text==="string").map(p=>p.text).join("\n"):"";
    if(content.trim())messages.push({role:message.role,text:content});
  }
  if(!messages.length)throw new Error("متن گفتگویی در این فایل پیدا نشد؛ خروجی متنی یا Markdown انتخاب کنید.");
  return messages;
}
export async function previewImport(workspace,input){
  if(!sources.includes(input.source))throw new Error("ابزار مبدأ معتبر نیست.");
  if(input.rules!==undefined&&typeof input.rules!=="boolean")throw new Error("گزینهٔ قواعد معتبر نیست.");
  const root=await realpath(workspace),files=[],messages=[];
  if(input.rules!==false){
    let names=input.source==="codex"?["AGENTS.override.md","AGENTS.md"]:input.source==="claude"?["CLAUDE.md",".claude/CLAUDE.md"]:[".cursorrules"];
    if(input.source==="cursor"){
      const directory=join(root,".cursor/rules");
      try{const info=await lstat(directory),rel=relative(root,await realpath(directory));if(info.isSymbolicLink()||rel.startsWith("..")||isAbsolute(rel))throw new Error("پوشهٔ قواعد باید داخل پروژه باشد.");const entries=await readdir(directory,{withFileTypes:true});names.push(...entries.filter(e=>e.isFile()&&/\.(mdc|md)$/i.test(e.name)).map(e=>".cursor/rules/"+e.name).sort());}catch(error){if(error.code!=="ENOENT")throw error;}
    }
    if(names.length>50)throw new Error("تعداد فایل‌های قواعد بیش از حد مجاز است.");
    let total=0;
    for(const name of names){const text=await safeText(root,name);if(text===null)continue;total+=text.length;if(total>limit)throw new Error("قواعد برای ورود یکجا بیش از حد طولانی است.");files.push(name);messages.push({role:"user",text:"قواعد واردشده از "+labels[input.source]+" («"+name+"»). محدودهٔ مسیر و شرط‌های خود فایل را حفظ کن؛ ارجاع فایل و هوک را خودکار اجرا نکن:\n"+text});if(input.source==="codex")break;}
  }
  messages.push(...conversation(input.text,input.source,input.format||"text"));
  if(!messages.length)throw new Error("قواعدی در ریشهٔ پروژه پیدا نشد. پوشهٔ پروژه را باز کنید یا فایل خروجی گفتگو را انتخاب کنید.");
  if(messages.reduce((sum,m)=>sum+m.text.length,0)>limit)throw new Error("متن برای ورود یکجا بیش از حد طولانی است؛ خروجی کوتاه‌تری انتخاب کنید.");
  const digest=createHash("sha256").update(JSON.stringify({source:input.source,messages})).digest("hex");
  return {source:input.source,title:"ورود از "+labels[input.source],files,messages,digest};
}
