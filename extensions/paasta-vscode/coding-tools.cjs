const vscode=require('vscode');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const vault=require('./coding-credentials.cjs');
const definitions=Object.freeze({codex:{id:'openai.chatgpt',name:'Codex'},'claude-code':{id:'Anthropic.claude-code',name:'Claude Code'},paasta:{id:'paasta-cloud.paasta',name:'Paasta CLI'}});
function parseLink(uri){
 if(!['vscode','vscode-insiders'].includes(uri.scheme)||uri.authority!=='paasta-cloud.paasta'||uri.path!=='/tools'||uri.fragment)throw Error('پیوند اتصال معتبر نیست.');
 const query=new URLSearchParams(uri.query),keys=[...query.keys()];
 if(keys.some(key=>!['account','project','tool','provider'].includes(key))||new Set(keys).size!==keys.length)throw Error('پیوند اتصال معتبر نیست.');
 const input=Object.fromEntries(query);if(input.tool==='paasta'){if(!/^[a-f0-9]{64}$/.test(input.account))throw Error('Invalid account');}else vault.validate(input.account,input.tool);
 if(input.project&&!/^[a-z0-9][a-z0-9-]{0,62}$/.test(input.project)||!['personal','paasta'].includes(input.provider))throw Error('پیوند اتصال معتبر نیست.');return input;
}
function environment(base,provider,folder,home=os.homedir()){
 const env={...base};for(const key of Object.keys(env))if(/^(ANTHROPIC_|CLAUDE_CODE_|OPENAI_|AZURE_OPENAI_|CODEX_HOME$|CLAUDE_CONFIG_DIR$|PAASTA_CODING_KEY$|PAASTA_API_KEY$|PAASTA_RUNTIME_TOKEN$|PAASTA_RUNTIME_SERVER$|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/.test(key.toUpperCase()))delete env[key];
 env.CODEX_HOME=provider==='paasta'?path.join(folder,'codex'):(base.CODEX_HOME||path.join(home,'.codex'));
 env.CLAUDE_CONFIG_DIR=provider==='paasta'?path.join(folder,'claude-code'):(base.CLAUDE_CONFIG_DIR||path.join(home,'.claude'));return env;
}
async function configureOwned(base,account,tool,model,key,node){
 const folder=await vault.directory(base,account),previous=await vault.readRecord(base,account,tool);
 const configRoot=path.join(folder,tool);await fs.mkdir(configRoot,{recursive:true,mode:0o700});if((await fs.lstat(configRoot)).isSymbolicLink())throw Error('پوشهٔ تنظیمات نباید پیوند باشد.');
 const generated=vault.configuration(account,tool,model,node,path.join(__dirname,'coding-credentials.cjs'));
 const file=path.join(configRoot,generated.file);let original;
 try{const old=await vault.safeRead(file);original=old;if(!previous?.configHash||vault.digest(old)!==previous.configHash)throw Error('تنظیمات این پروفایل دستی تغییر کرده است؛ فایل را پیش از جایگزینی بازبینی کنید.');}catch(error){if(error.code!=='ENOENT')throw error;}
 await vault.atomicPrivate(file,generated.text);
 try{await vault.writeRecord(base,account,tool,{account,tool,model,key,enabled:true,configHash:vault.digest(generated.text)});}catch(error){if(original)await vault.atomicPrivate(file,original);else await fs.rm(file,{force:true});throw error;}
 return folder;
}
async function configure(base,account,tool,model,key,node){vault.validate(account,tool);await vault.directory(base,account);return vault.withLock(base,'configure-'+account+'-'+tool,()=>configureOwned(base,account,tool,model,key,node));}
function activateTools(context,{api,hosted,projectFolder,showStatus,getCliSession}){
 let running=false;
 async function exclusive(input){if(running)throw Error('ابتدا پنجرهٔ فعلی مدیر ابزارها را ببندید.');running=true;try{return await manage(input);}finally{running=false;}}
 const guard=run=>async(...args)=>{try{return await run(...args);}catch(error){vscode.window.showErrorMessage('پاستا: '+error.message);}};
 async function claudeOverride(account,provider){
  const settings=vscode.workspace.getConfiguration('claudeCode'),backup=path.join(vault.root(),'claude-vscode.backup');
  let previous;try{previous=await vault.readProtected(backup);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(previous&&previous.account!==account)throw Error('تنظیم VS Code متعلق به اتصال حساب دیگری است.');
  const current=settings.inspect('environmentVariables')?.globalValue;
  if(previous&&![previous.appliedHash,vault.digest(JSON.stringify(previous.env||[]))].includes(vault.digest(JSON.stringify(current||[]))))throw Error('متغیرهای ابزار دستی تغییر کرده‌اند؛ بازنویسی انجام نشد.');
  if(provider==='paasta'){
   const record=await vault.readRecord(vault.root(),account,'claude-code');const values=JSON.parse(vault.configuration(account,'claude-code',record.model,path.join(__dirname,'runtime',process.platform==='win32'?'node.exe':'node'),path.join(__dirname,'coding-credentials.cjs')).text).env;
   const next=[...(current||[]).filter(item=>!(item.name in values)),...Object.entries(values).map(([name,value])=>({name,value}))];
   await vault.writeProtected(backup,{account,login:previous?previous.login:settings.inspect('disableLoginPrompt')?.globalValue,env:previous?previous.env:current,appliedHash:vault.digest(JSON.stringify(next))});
   await settings.update('environmentVariables',next,vscode.ConfigurationTarget.Global);await settings.update('disableLoginPrompt',true,vscode.ConfigurationTarget.Global);
  }else if(previous){await settings.update('environmentVariables',previous.env,vscode.ConfigurationTarget.Global);await settings.update('disableLoginPrompt',previous.login,vscode.ConfigurationTarget.Global);await fs.rm(backup);}
 }
 async function actor(expected){if(hosted())throw Error('این ابزارها روی دستگاه شخصی اجرا می‌شوند.');const data=await api(context,'/api/cli/context');const account=data.account?.accountKey;if(!/^[a-f0-9]{64}$/.test(account||'')||expected&&account!==expected)throw Error('حساب افزونه با حساب ویرایشگر وب مطابقت ندارد؛ از پنل پاستا وارد حساب درست شوید.');return {account,data};}
 async function folderFor(project,data){
  const folder=projectFolder(vscode);if(!folder||folder.uri.scheme!=='file'||!vscode.workspace.isTrusted)throw Error('یک پوشهٔ محلی و مورداعتماد برای پروژه باز کنید.');
  if(project&&!data.projects.some(item=>item.name===project))throw Error('پروژه در حساب افزونه مجاز نیست.');
  const real=await fs.realpath(folder.uri.fsPath);
  const approved=await vscode.window.showWarningMessage((project?'پروژهٔ '+project+' · ':'')+'ابزار روی این پوشه اجرا شود؟\n'+real,{modal:true},'تأیید پوشه');
  return approved==='تأیید پوشه'?real:null;
 }
 async function verifyKey(key,account,tool){
  if(!/^paasta_ai_[A-Za-z0-9_-]{43}$/.test(key))throw Error('کلید مخصوص ابزار کدنویسی معتبر نیست.');
  const response=await fetch('https://console.paasta.cloud/api/ai/v1/coding-connection',{headers:{Authorization:'Bearer '+key,'X-Paasta-Coding-Account':account,'X-Paasta-Coding-Tool':tool},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('اتصال کلید به همین حساب و روش مصرف فعال تأیید نشد ('+response.status+'). تنظیمات قبلی حفظ شدند.');
  const text=await response.text();if(text.length>1024*1024)throw Error('پاسخ اتصال بیش از حد بزرگ است.');const value=JSON.parse(text);
  if(value.account!==account||value.tool!==tool||!['subscription','payg'].includes(value.mode)||!Array.isArray(value.models))throw Error('هویت اتصال ابزار معتبر نیست.');return value;
 }
 async function manage(input={}){
  const {account,data}=await actor(input.account);
  await vault.directory(vault.root(),account);
  return vault.withLock(vault.root(),'manager',()=>manageOwned(input,account,data));
 }
 async function manageOwned(input,account,data){
  await require('./coding-tool-launcher.cjs').standardUser();
  const picked=input.tool?definitions[input.tool]&&{tool:input.tool,...definitions[input.tool]}:await vscode.window.showQuickPick(Object.entries(definitions).map(([tool,item])=>({label:item.name,tool,...item})),{placeHolder:'ابزار رسمی را انتخاب کنید'});if(!picked)return;
  const tool=picked.tool,definition=definitions[tool];
  if(tool==='paasta'){
   const project=input.project||((await vscode.window.showQuickPick(data.projects.map(item=>({label:item.name,name:item.name})),{placeHolder:'پروژهٔ مجاز را انتخاب کنید'}))?.name);if(!project)return;
   if(!/^[a-z0-9][a-z0-9-]{0,62}$/.test(project)||!data.projects.some(item=>item.name===project))throw Error('پروژه در این حساب مجاز نیست.');
   const folder=await folderFor(project,data);if(!folder)return;
   await require('./coding-tool-launcher.cjs').standardUser();
   const session=await getCliSession();if(!session.token)throw Error('ورود امن پاستا لازم است.');
   const executable=path.join(__dirname,'client','engine',process.platform==='win32'?'paasta.exe':'paasta');await fs.access(executable);
   if(await vscode.window.showWarningMessage('فرمان فقط‌خواندنی paasta status برای '+project+' در ترمینال اجرا شود؟',{modal:true},'نمایش وضعیت')!=='نمایش وضعیت')return;
   const terminal=vscode.window.createTerminal({name:'Paasta · status',shellPath:executable,shellArgs:['status',project],cwd:folder,env:{PAASTA_RUNTIME_TOKEN:session.token,PAASTA_RUNTIME_SERVER:session.server}});terminal.show();return;
  }
  vault.validate(account,tool);
  const action=await vscode.window.showQuickPick([{label:'نصب یا مدیریت افزونهٔ رسمی',id:'install'},{label:'اتصال به اشتراک یا PAYG پاستا',id:'configure'},{label:'برگشت افزونه به حساب شخصی',id:'personal'},{label:'فعال‌سازی پاستا در همین افزونه',id:'open'},{label:'اجرای CLI با حساب شخصی',id:'cli-personal'},{label:'اجرای CLI با حساب پاستا',id:'cli'},{label:'غیرفعال‌کردن اتصال پاستا',id:'disable'}],{placeHolder:definition.name+' · '+(input.provider==='paasta'?'پاستا':'حساب شخصی یا پاستا')});if(!action)return;
  if(action.id==='install'){
   if(!vscode.extensions.getExtension(definition.id)){
    if(await vscode.window.showWarningMessage('افزونهٔ رسمی '+definition.name+' از Marketplace نصب شود؟',{modal:true},'نصب افزونه')!=='نصب افزونه')return;
    await vscode.commands.executeCommand('workbench.extensions.installExtension',definition.id);
   }
   await vscode.commands.executeCommand('extension.open',definition.id);return;
  }
  const node=path.join(__dirname,'runtime',process.platform==='win32'?'node.exe':'node');
  if(action.id==='configure'){
   await fs.access(node);
   const key=await vscode.window.showInputBox({title:'اتصال '+definition.name+' به پاستا',prompt:'کلید مخصوص همین ابزار را از صفحهٔ اشتراک بگیرید؛ کلید در تنظیمات پروژه نوشته نمی‌شود.',password:true,ignoreFocusOut:true});if(!key)return;
   const value=await verifyKey(key,account,tool);
   const chosen=await vscode.window.showQuickPick(value.models.filter(model=>/^[A-Za-z0-9][A-Za-z0-9/_.:+-]{0,199}$/.test(model.id)).map(model=>({label:model.name,description:model.id,id:model.id})),{placeHolder:'مدل مجاز · روش مصرف '+value.mode});if(!chosen)return;
   if(await vscode.window.showWarningMessage('اتصال '+definition.name+' به '+value.mode+' پاستا ذخیره شود؟ درخواست مدل آغاز نمی‌شود. تنظیمات حساب شخصی دست‌نخورده می‌مانند.',{modal:true},'ذخیرهٔ اتصال')!=='ذخیرهٔ اتصال')return;
   await configure(vault.root(),account,tool,chosen.id,key,node);
   vscode.window.showInformationMessage('اتصال ذخیره شد. از مدیر ابزارها، پنجره یا CLI پاستا را باز کنید.');return;
  }
  const record=action.id.includes('personal')?null:await vault.readRecord(vault.root(),account,tool);
  if(action.id==='disable'){
   if(!record)return;
   if(await vscode.window.showWarningMessage('شروع جدید با این اتصال غیرفعال شود؟ پنجره‌ها و درخواست‌های باز را خودتان ببندید. برای لغو فوری کلید از کنسول استفاده کنید.',{modal:true},'غیرفعال‌کردن')!=='غیرفعال‌کردن')return;
   await vault.writeRecord(vault.root(),account,tool,{...record,enabled:false});try{await require('./coding-provider-config.cjs').restore(vault.root(),account,tool);if(tool==='claude-code')await claudeOverride(account,'personal');}catch{vscode.window.showWarningMessage('اتصال محلی غیرفعال شد؛ تنظیمات دستی تغییر کرده‌اند و بازیابی نشدند. پنجره‌های باز را ببندید و در صورت نیاز کلید را از کنسول لغو کنید.');}return;
  }
  const provider=action.id.includes('personal')?'personal':'paasta';
  if(provider==='paasta'){
   if(!record?.enabled)throw Error('ابتدا اتصال پاستا را فعال کنید.');
   const current=await verifyKey(record.key,account,tool);if(!current.models.some(model=>model.id===record.model))throw Error('مدل قبلی دیگر مجاز نیست؛ اتصال را دوباره تنظیم کنید.');
   // Refresh only untouched managed config when the extension/runtime path changes after an update.
   await configure(vault.root(),account,tool,record.model,record.key,node);
  }
  const folder=await folderFor(input.project,data);if(!folder)return;
  const scope=await vault.directory(vault.root(),account),env=environment(process.env,provider,scope);
  if(action.id.startsWith('cli')){
   if(provider==='personal'){
    if(await vscode.window.showWarningMessage('CLI با تنظیمات قبلی حساب شخصی باز شود؟ اگر پاستا در افزونه فعال بوده، تنظیمات همان ابزار هم بازیابی می‌شوند.',{modal:true},'استفاده از حساب شخصی')!=='استفاده از حساب شخصی')return;
    await require('./coding-provider-config.cjs').restore(vault.root(),account,tool);if(tool==='claude-code')await claudeOverride(account,'personal');
   }
   const {launchCli}=require('./coding-tool-launcher.cjs');await launchCli(vscode,tool,folder,env);return;
  }
  if(!vscode.extensions.getExtension(definition.id))throw Error('ابتدا افزونهٔ رسمی را نصب یا فعال کنید.');
  const approved=await vscode.window.showWarningMessage((provider==='paasta'?'روش مصرف ابزار در همین حساب سیستم‌عامل به پاستا تغییر می‌کند. این انتخاب روی CLI و افزونهٔ رسمی اثر دارد.':'تنظیمات قبلی حساب شخصی بازیابی می‌شوند؛ رمز یا ورود آن سرویس تغییر نمی‌کند.')+' گفتگوهای فعال ابزار را ابتدا متوقف کنید. ادامه می‌دهید؟',{modal:true},'اعمال انتخاب');if(approved!=='اعمال انتخاب')return;
  const profiles=require('./coding-provider-config.cjs');
  if(provider==='paasta')await profiles.activate(vault.root(),account,tool,folder,node);else await profiles.restore(vault.root(),account,tool);
  if(tool==='claude-code')await claudeOverride(account,provider);

  const reload=await vscode.window.showInformationMessage('روش اتصال اعمال شد. برای دریافت تنظیم جدید، پس از ذخیرهٔ فایل‌ها پنجره را دوباره بارگذاری کنید.','ذخیره و بارگذاری مجدد');
  if(reload==='ذخیره و بارگذاری مجدد'&&await vscode.workspace.saveAll(false))await vscode.commands.executeCommand('workbench.action.reloadWindow');

 }
 context.subscriptions.push(vscode.commands.registerCommand('paasta.tools.manage',guard(exclusive)),vscode.window.registerUriHandler({handleUri:guard(async uri=>exclusive(parseLink(uri)))}));
 context.subscriptions.push(vscode.commands.registerCommand('paasta.tools.status',guard(()=>showStatus(context))));
}
module.exports={activateTools,parseLink,environment,configure,definitions};
