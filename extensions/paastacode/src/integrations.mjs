import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPrivate,writePrivate,stateHome} from './account.mjs';

const namePattern=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function integrationName(value){if(typeof value!=='string'||value.length>64||!namePattern.test(value)||['paasta','browser','constructor','prototype'].includes(value))throw new Error('نام باید انگلیسی کوچک باشد؛ برای جدا کردن واژه‌ها از خط تیره استفاده کنید.');return value;}
function strings(value){if(value===undefined)return {};if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>32||Object.entries(value).some(([key,value])=>!key||key.length>128||typeof value!=='string'||value.length>8192||/[\r\n\0]/.test(key+value)))throw new Error('متغیرها و هدرها باید یک شیء JSON با مقدارهای متنی باشند.');return {...value};}
export function mcpConfig(value){
  if(!value||typeof value!=='object'||!['local','remote'].includes(value.type))throw new Error('نوع اتصال MCP معتبر نیست.');
  const config={type:value.type,enabled:value.enabled!==false,timeout:15000};
  if(value.type==='local'){
    if(!Array.isArray(value.command)||!value.command.length||value.command.length>32||value.command.some(v=>typeof v!=='string'||!v||v.length>4096||v.includes('\0')))throw new Error('فرمان باید آرایهٔ JSON شامل برنامه و آرگومان‌های آن باشد.');
    config.command=[...value.command];config.environment=strings(value.environment);
  }else{
    let url;try{url=new URL(value.url);}catch{throw new Error('نشانی MCP معتبر نیست.');}
    if(url.username||url.password||url.hash||url.search||!['https:','http:'].includes(url.protocol)||(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('نشانی HTTPS وارد کنید؛ HTTP فقط برای سرور روی همین دستگاه مجاز است.');
    if(url.href.length>2048)throw new Error('نشانی MCP بیش از حد طولانی است.');config.url=url.href;config.headers=strings(value.headers);if(value.oauth===false)config.oauth=false;
    else if(value.oauth!==undefined){const oauth=strings(value.oauth);if(Object.keys(oauth).some(k=>!['clientId','clientSecret','scope'].includes(k)))throw new Error('تنظیمات OAuth معتبر نیست.');config.oauth=oauth;}
  }
  return config;
}
export function skillBundle(input){
  const name=integrationName(input?.name),description=input.description?.trim();
  if(typeof description!=='string'||!description||description.length>1024||/[\r\n\0]/.test(description))throw new Error('توضیح کوتاهی برای زمان استفاده از مهارت بنویسید.');
  if(typeof input.instructions!=='string'||!input.instructions.trim()||Buffer.byteLength(input.instructions)>128000)throw new Error('دستورهای مهارت را بنویسید؛ حداکثر ۱۲۸ کیلوبایت.');
  const files=input.files||[];if(!Array.isArray(files)||files.length>64)throw new Error('هر مهارت حداکثر ۶۴ فایل همراه دارد.');
  let size=Buffer.byteLength(input.instructions);const names=new Set();
  for(const file of files){
    if(typeof file.path!=='string'||file.path.length>240||/[\\:\0]/.test(file.path)||file.path.startsWith('/')||file.path.split('/').some(p=>!p||p==='.'||p==='..')||file.path.toLowerCase()==='skill.md'||names.has(file.path.toLowerCase())||typeof file.data!=='string'||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data))throw new Error('مسیر یا محتوای فایل همراه مهارت معتبر نیست.');
    names.add(file.path.toLowerCase());size+=Buffer.byteLength(file.data,'base64');
  }
  if(size>750000)throw new Error('حجم کل مهارت باید کمتر از ۷۵۰ کیلوبایت باشد.');
  return {name,description,instructions:input.instructions,files:files.map(f=>({path:f.path,data:f.data})),enabled:input.enabled!==false};
}
export function parseSkillMarkdown(text){
  const match=text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);if(!match)throw new Error('فایل SKILL.md باید نام و توضیح YAML داشته باشد.');
  const name=match[1].match(/^name:\s*["']?([a-z0-9-]+)["']?\s*$/m)?.[1];
  const description=match[1].match(/^description:\s*(.+)(?:\r?\n[ \t]+[^\r\n]+)*/m)?.[0].replace(/^description:\s*/,'').replace(/^[>|][-+]?\s*/,'').replace(/\s*\r?\n\s*/g,' ').replace(/^["']|["']$/g,'');
  return skillBundle({name,description,instructions:match[2]});
}
export class WorkspaceIntegrations{
  constructor(workspace,identity,{home=stateHome}={}){const key=createHash('sha256').update(identity+'\0'+workspace).digest('hex');this.root=join(home,'integrations',key);this.path=join(this.root,'settings.json');this.pending=Promise.resolve();}
  engineName(name){return name.slice(0,20)+'_'+createHash('sha256').update(this.root+'\0'+name).digest('hex').slice(0,8);}
  async read(){return await readPrivate(this.path)||{servers:{},skills:{},browser:false};}
  change(work){const result=this.pending.then(async()=>{const state=await this.read();await work(state);await writePrivate(this.path,state);return state;});this.pending=result.catch(()=>{});return result;}
  async update(input){
    if(input.kind==='browser'){if(typeof input.enabled!=='boolean')throw new Error('وضعیت مرورگر معتبر نیست.');return this.change(s=>{s.browser=input.enabled;});}
    if(!['mcp','skill'].includes(input.kind))throw new Error('نوع ابزار معتبر نیست.');const name=integrationName(input.name);
    return this.change(state=>{const entries=input.kind==='mcp'?state.servers:state.skills;
      if(input.action==='remove'){delete entries[name];return;}
      if(input.action==='toggle'){if(!entries[name]||typeof input.enabled!=='boolean')throw new Error('ابزار پیدا نشد.');entries[name].enabled=input.enabled;return;}
      if(input.action!=='save')throw new Error('عملیات معتبر نیست.');if(!entries[name]&&Object.keys(entries).length>=32)throw new Error('حداکثر ۳۲ مورد برای هر پروژه فعال کنید.');
      entries[name]=input.kind==='mcp'?mcpConfig(input.config):skillBundle(input);
    });
  }
  async config(){
    const state=await this.read(),skillsPath=join(this.root,'skills-'+randomUUID());await mkdir(skillsPath,{recursive:true,mode:0o700});
    for(const skill of Object.values(state.skills).filter(s=>s.enabled)){
      const directory=join(skillsPath,skill.name);await mkdir(directory,{mode:0o700});
      await writeFile(join(directory,'SKILL.md'),'---\nname: '+skill.name+'\ndescription: '+JSON.stringify(skill.description)+'\n---\n\n'+skill.instructions,{mode:0o600});
      for(const file of skill.files){const target=join(directory,...file.path.split('/'));await mkdir(join(target,'..'),{recursive:true,mode:0o700});await writeFile(target,Buffer.from(file.data,'base64'),{mode:0o600});}
    }
    // Keep the previous materialization until the engine has switched; no project files are edited.
    const old=this.materialized;this.materialized=skillsPath;this.previous=old;
    const mcp=Object.fromEntries(Object.entries(state.servers).map(([name,config])=>[this.engineName(name),config]));if(state.browser)mcp.browser=browserConfig();
    return {mcp,skills:{paths:[skillsPath]}};
  }
  async cleanPrevious(){if(this.previous){await rm(this.previous,{recursive:true,force:true});this.previous=null;}}
  async publicState(runtime){
    const state=await this.read();let statuses={};try{statuses=await runtime.call('/mcp');}catch{}
    // Engine errors can contain remote response bodies, headers or credentials; never forward them.
    return {servers:Object.entries(state.servers).map(([name,config])=>({name,type:config.type,enabled:config.enabled,status:statuses[this.engineName(name)]?.status||'disconnected',endpoint:config.type==='remote'?new URL(config.url).origin:config.command[0],hasSecrets:!!Object.keys(config.headers||config.environment||{}).length})),skills:Object.values(state.skills).map(({name,description,enabled})=>({name,description,enabled})),browser:{enabled:state.browser,status:statuses.browser?.status||'disabled'}};
  }
}
export function browserConfig(){
  const launcher=fileURLToPath(new URL('../bin/browser-mcp.cjs',import.meta.url)).replace(/app\.asar([\\/])/,'app.asar.unpacked$1');
  const dependencies=fileURLToPath(new URL('../vendor/browser',import.meta.url)).replace(/app\.asar([\\/])/,'app.asar.unpacked$1');
  return {type:'local',command:[process.execPath,launcher],environment:{ELECTRON_RUN_AS_NODE:'1',NODE_PATH:dependencies},enabled:true,timeout:20000};
}
