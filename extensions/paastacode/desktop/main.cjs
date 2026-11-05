const {app,BrowserWindow,shell,dialog,ipcMain,Menu}=require("electron");
const path=require("node:path"),fs=require("node:fs/promises");
const {allowedExternal}=require('./external-links.cjs');
let service,window,changing=false,updates;
app.setName("PaastaCode");
// CI runners lack a usable GPU; keep native renderer acceptance on supported CPU rendering.
if(process.env.PAASTACODE_DESKTOP_SMOKE&&process.env.CI)app.disableHardwareAcceleration();
const requested=process.argv.find(arg=>arg.startsWith("--workspace="))?.slice(12);
const preferences=()=>path.join(app.getPath("userData"),"workspace.json");
async function folder(){
  const result=await dialog.showOpenDialog(...(window?[window]:[]),{title:"پوشهٔ پروژه را انتخاب کنید",properties:["openDirectory","createDirectory"],defaultPath:app.getPath("documents"),buttonLabel:"باز کردن پروژه"});
  return result.canceled?null:result.filePaths[0];
}
async function openWorkspace(workspace,{local=false}={}){
  const {connectWorkspace}=await import("../src/workspace-service.mjs");
  const next=await connectWorkspace({workspace});
  if(service&&service.url!==next.url)await service.close();service=next;
  await window.loadURL(service.launchUrl.replace('/#','/'+(workspace===path.join(app.getPath('userData'),'cloud-client')?'?cloud=1':local?'?local=1':'')+'#'));
  window.setTitle("پاستاکد | PaastaCode "+app.getVersion());
  const {newer}=await import("../src/updates.mjs");
  if(service.version&&newer(app.getVersion(),service.version)){
    await window.webContents.executeJavaScript(`(()=>{const note=document.createElement('div');note.id='runtime-upgrade-notice';note.setAttribute('role','status');note.textContent='نسخهٔ جدید باز شده، اما این پروژه هنوز با اجرای قبلی کار می‌کند. پس از پایان کار، از منوی پروژه «توقف اجرای محلی پروژه و خروج» را انتخاب کنید و برنامه را دوباره باز کنید.';note.style.cssText='padding:12px 20px;background:#24344d;color:#f0f1f3;font:14px/1.9 Tahoma,sans-serif;flex-shrink:0';document.querySelector('main').prepend(note);})()`);
  }
  if(!process.env.PAASTACODE_DESKTOP_SMOKE){await fs.mkdir(path.dirname(preferences()),{recursive:true});await fs.writeFile(preferences(),JSON.stringify({workspace}),{mode:0o600});}
}
app.whenReady().then(async()=>{
  let workspace=requested;
  if(!workspace&&!process.env.PAASTACODE_DESKTOP_SMOKE)try{workspace=JSON.parse(await fs.readFile(preferences(),"utf8")).workspace;await fs.access(workspace);}catch{workspace=null;}
  if(!workspace&&!process.env.PAASTACODE_DESKTOP_SMOKE){
    const choice=await dialog.showMessageBox({type:'question',title:'پاستاکد',message:'پروژه را کجا توسعه می‌دهید؟',buttons:['فضای کار ابری','پوشه روی این کامپیوتر'],defaultId:0,cancelId:1});
    if(choice.response===0){workspace=path.join(app.getPath('userData'),'cloud-client');await fs.mkdir(workspace,{recursive:true});}else workspace=await folder();
  }
  if(!workspace&&process.env.PAASTACODE_DESKTOP_SMOKE)workspace=process.cwd();
  if(!workspace){app.quit();return;}
  window=new BrowserWindow({title:"پاستاکد | PaastaCode",width:1280,height:880,minWidth:360,minHeight:580,
    icon:path.join(__dirname,"icon.png"),show:!process.env.PAASTACODE_DESKTOP_SMOKE||process.env.PAASTACODE_DESKTOP_VISIBLE_SMOKE==="1",autoHideMenuBar:true,backgroundColor:"#f5f7fa",
    webPreferences:{preload:path.join(__dirname,"preload.cjs"),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  window.webContents.setWindowOpenHandler(({url})=>{
    if(allowedExternal(url,process.env.PAASTACODE_CONSOLE||"https://console.paasta.cloud"))void shell.openExternal(url).catch(()=>dialog.showErrorBox('مرورگر باز نشد','صفحهٔ اشتراک را در console.paasta.cloud/paastacode باز کنید.'));
    return {action:"deny"};
  });
  window.webContents.on("page-title-updated",event=>event.preventDefault());
  window.webContents.on("will-navigate",(event,url)=>{if(new URL(url).origin!==service?.url)event.preventDefault();});
  window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  ipcMain.handle("paastacode:choose-workspace",async event=>{
    if(event.sender!==window.webContents||changing)return false;changing=true;
    try{
      const workspace=await folder();if(!workspace)return false;
      const result=await dialog.showMessageBox(window,{type:"question",title:"باز کردن پروژه",message:"پروژهٔ دیگری باز شود؟",detail:"کار جاری پروژهٔ قبلی در اجرای مشترک ادامه می‌یابد. بستن این پنجره آن را متوقف نمی‌کند. گفتگوها و فایل‌ها باقی می‌مانند.",buttons:["بازگشت","باز کردن پروژه"],defaultId:0,cancelId:0});
      if(result.response!==1)return false;await openWorkspace(workspace,{local:true});return true;
    }finally{changing=false;}
  });
  const {createUpdates}=require("./update-controller.cjs");
  let autoUpdater;try{({autoUpdater}=require("./updater-vendor.cjs"));}catch{({autoUpdater}=require("electron-updater"));}
  const {prepareDesktopUpdate}=await import("../src/workspace-service.mjs");
  const updatePreferences=path.join(app.getPath("userData"),"updates.json");
  updates=createUpdates({updater:autoUpdater,version:app.getVersion(),enabled:app.isPackaged&&!process.env.PAASTACODE_DESKTOP_SMOKE&&!process.env.PORTABLE_EXECUTABLE_FILE,
    load:async()=>{try{return JSON.parse(await fs.readFile(updatePreferences,"utf8"));}catch{return {};}},
    save:async value=>{await fs.mkdir(path.dirname(updatePreferences),{recursive:true});await fs.writeFile(updatePreferences,JSON.stringify(value),{mode:0o600});},
    prepare:()=>prepareDesktopUpdate(path.resolve(__dirname,"..").replace(/app\.asar(?=[\\/]|$)/,"app.asar.unpacked")+path.sep),beforeInstall:()=>{closing=true;},
    emit:state=>{if(!window.isDestroyed())window.webContents.send("paastacode:update-state",state);}});
  ipcMain.handle("paastacode:update",async(event,action,value)=>{
    if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)throw new Error("دسترسی مجاز نیست.");
    if(action==="state")return updates.state();
    if(action==="check")return updates.check();
    if(action==="download")return updates.download();
    if(action==="automatic")return updates.automatic(value);
    if(action==="install"){await updates.install();return updates.state();}
    throw new Error("عملیات معتبر نیست.");
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform==="darwin"?[{role:"appMenu"}]:[]),
    {label:"پروژه",submenu:[{label:"باز کردن پوشه…",accelerator:"CmdOrCtrl+O",click:()=>window.webContents.executeJavaScript("window.paastacodeDesktop.chooseWorkspace()")},{label:"توقف اجرای محلی پروژه و خروج",click:async()=>{
      const result=await dialog.showMessageBox(window,{type:"question",title:"توقف اجرای پروژه",message:"اجرای محلی این پروژه متوقف شود؟",detail:"ارتباط وب، CLI و افزونهٔ همین پروژه قطع می‌شود. فایل‌ها و گفتگوها باقی می‌مانند. انتشارهایی که روی پاستا شروع شده‌اند، آنجا ادامه دارند.",buttons:["بازگشت","توقف و خروج"],defaultId:0,cancelId:0});
      if(result.response===1){await fetch(service.url+"/api/shutdown",{method:"POST",headers:{Authorization:"Bearer "+service.capability}});app.quit();}
    }},{role:"quit",label:"بستن پنجره"}]},
    {role:"editMenu",label:"ویرایش"},{role:"viewMenu",label:"نمایش"},
    {label:"راهنما",submenu:[{label:"به‌روزرسانی برنامه",click:()=>window.webContents.executeJavaScript("document.getElementById('updates-open').click()")},{label:"دربارهٔ پاستاکد",click:()=>dialog.showMessageBox(window,{title:"پاستاکد",message:"PaastaCode "+app.getVersion(),detail:"Powered by OpenCode\nفورک متن‌باز با مجوز MIT\nیکان با مجوز پاستا؛ وزیرمتن جایگزین متن‌باز با مجوز SIL OFL"})}]}
  ]));
  await openWorkspace(workspace);
  void updates.start();const updateTimer=setInterval(()=>{if(updates.state().automatic)void updates.check();},6*60*60*1000);updateTimer.unref();
  if(process.env.PAASTACODE_DESKTOP_SMOKE){
    if(process.env.PAASTACODE_EXPECT_VERSION&&app.getVersion()!==process.env.PAASTACODE_EXPECT_VERSION)throw new Error("Desktop package version does not match the release being verified.");
    const result=await window.webContents.executeJavaScript("document.fonts.ready.then(()=>({rtl:document.documentElement.dir,login:!!document.getElementById('login'),fonts:[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family.replaceAll(String.fromCharCode(34),'')),desktop:!!window.paastacodeDesktop,updates:!!document.getElementById('updates-open')}))");
    const requiredFont=process.env.PAASTACODE_YEKAN_FONT?"YekanBakh":null;
    const loaded=requiredFont?result.fonts.includes(requiredFont):result.fonts.some(font=>["YekanBakh","Vazirmatn"].includes(font));
    if(result.rtl!=="rtl"||!result.login||!loaded||!result.desktop||!result.updates)throw new Error("Desktop smoke failed: "+(requiredFont||"Persian font")+" must actually load.");
    if(process.env.PAASTACODE_DESKTOP_VISIBLE_SMOKE==="1")await window.webContents.executeJavaScript("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    const directory=process.env.PAASTACODE_SMOKE_OUTPUT||path.join(app.getPath("temp"),"paastacode-smoke");await fs.mkdir(directory,{recursive:true});
    await fs.writeFile(path.join(directory,"desktop.png"),(await window.webContents.capturePage()).toPNG());
    console.log("PaastaCode desktop smoke passed");app.quit();
  }
}).catch(error=>{console.error(error.message);app.exit(1);});
app.on("window-all-closed",()=>app.quit());
let closing=false;
app.on("before-quit",event=>{
  if(service&&!closing){event.preventDefault();closing=true;Promise.resolve(updates?.install(true)).then(installed=>{if(!installed)service.close().finally(()=>app.quit());});}
});
