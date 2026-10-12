const {app,BrowserWindow,shell,dialog,ipcMain,Menu}=require("electron");
const path=require("node:path"),fs=require("node:fs/promises");
let service,window,changing=false;
app.setName("PaastaCode");
// CI runners lack a usable GPU; keep native renderer acceptance on supported CPU rendering.
if(process.env.PAASTACODE_DESKTOP_SMOKE&&process.env.CI)app.disableHardwareAcceleration();
const requested=process.argv.find(arg=>arg.startsWith("--workspace="))?.slice(12);
const preferences=()=>path.join(app.getPath("userData"),"workspace.json");
async function folder(){
  const result=await dialog.showOpenDialog(...(window?[window]:[]),{title:"پوشهٔ پروژه را انتخاب کنید",properties:["openDirectory","createDirectory"],defaultPath:app.getPath("documents"),buttonLabel:"باز کردن پروژه"});
  return result.canceled?null:result.filePaths[0];
}
async function openWorkspace(workspace){
  const {startServer}=await import("../src/server.mjs");
  const next=await startServer({workspace});
  if(service&&service.url!==next.url)await service.close();service=next;
  await window.loadURL(service.launchUrl);
  if(!process.env.PAASTACODE_DESKTOP_SMOKE){await fs.mkdir(path.dirname(preferences()),{recursive:true});await fs.writeFile(preferences(),JSON.stringify({workspace}),{mode:0o600});}
}
app.whenReady().then(async()=>{
  let workspace=requested;
  if(!workspace&&!process.env.PAASTACODE_DESKTOP_SMOKE)try{workspace=JSON.parse(await fs.readFile(preferences(),"utf8")).workspace;await fs.access(workspace);}catch{workspace=null;}
  if(!workspace)workspace=process.env.PAASTACODE_DESKTOP_SMOKE?process.cwd():await folder();
  if(!workspace){app.quit();return;}
  window=new BrowserWindow({title:"پاستاکد | PaastaCode",width:1280,height:880,minWidth:360,minHeight:580,
    icon:path.join(__dirname,"icon.png"),show:!process.env.PAASTACODE_DESKTOP_SMOKE||process.env.PAASTACODE_DESKTOP_VISIBLE_SMOKE==="1",autoHideMenuBar:true,backgroundColor:"#f5f7fa",
    webPreferences:{preload:path.join(__dirname,"preload.cjs"),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  window.webContents.setWindowOpenHandler(({url})=>{
    let target;try{target=new URL(url);}catch{return {action:"deny"};}
    const allowed=new URL(process.env.PAASTACODE_CONSOLE||"https://console.paasta.cloud");
    const attribution=["https://opencode.ai/","https://github.com/Paasta-Cloud/PaastaCode","https://github.com/Paasta-Cloud/PaastaCode/releases"].includes(target.href);
    if(attribution||(target.origin===allowed.origin&&target.pathname==="/cli/authorize")||(target.protocol==="https:"&&!target.username&&!target.password&&target.origin!==allowed.origin))void shell.openExternal(url);
    return {action:"deny"};
  });
  window.webContents.on("will-navigate",(event,url)=>{if(new URL(url).origin!==service?.url)event.preventDefault();});
  window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  ipcMain.handle("paastacode:choose-workspace",async event=>{
    if(event.sender!==window.webContents||changing)return false;changing=true;
    try{
      const workspace=await folder();if(!workspace)return false;
      const result=await dialog.showMessageBox(window,{type:"question",title:"باز کردن پروژه",message:"پروژهٔ دیگری باز شود؟",detail:"اجرای این پنجره متوقف می‌شود. گفتگوهای ذخیره‌شده باقی می‌مانند.",buttons:["بازگشت","باز کردن پروژه"],defaultId:0,cancelId:0});
      if(result.response!==1)return false;await openWorkspace(workspace);return true;
    }finally{changing=false;}
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform==="darwin"?[{role:"appMenu"}]:[]),
    {label:"پروژه",submenu:[{label:"باز کردن پوشه…",accelerator:"CmdOrCtrl+O",click:()=>window.webContents.executeJavaScript("window.paastacodeDesktop.chooseWorkspace()")},{role:"quit",label:"خروج"}]},
    {role:"editMenu",label:"ویرایش"},{role:"viewMenu",label:"نمایش"},
    {label:"راهنما",submenu:[{label:"دریافت نسخهٔ جدید",click:()=>shell.openExternal("https://github.com/Paasta-Cloud/PaastaCode/releases")},{label:"دربارهٔ پاستاکد",click:()=>dialog.showMessageBox(window,{title:"پاستاکد",message:"PaastaCode "+app.getVersion(),detail:"Powered by OpenCode\nفورک متن‌باز با مجوز MIT\nفونت وزیرمتن با مجوز SIL OFL"})}]}
  ]));
  await openWorkspace(workspace);
  if(process.env.PAASTACODE_DESKTOP_SMOKE){
    if(process.env.PAASTACODE_EXPECT_VERSION&&app.getVersion()!==process.env.PAASTACODE_EXPECT_VERSION)throw new Error("Desktop package version does not match the release being verified.");
    const result=await window.webContents.executeJavaScript("document.fonts.ready.then(()=>({rtl:document.documentElement.dir,login:!!document.getElementById('login'),font:document.fonts.check('16px Vazirmatn'),desktop:!!window.paastacodeDesktop}))");
    if(result.rtl!=="rtl"||!result.login||!result.font||!result.desktop)throw new Error("Desktop smoke failed.");
    if(process.env.PAASTACODE_DESKTOP_VISIBLE_SMOKE==="1")await window.webContents.executeJavaScript("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    const directory=process.env.PAASTACODE_SMOKE_OUTPUT||path.join(app.getPath("temp"),"paastacode-smoke");await fs.mkdir(directory,{recursive:true});
    await fs.writeFile(path.join(directory,"desktop.png"),(await window.webContents.capturePage()).toPNG());
    console.log("PaastaCode desktop smoke passed");app.quit();
  }
}).catch(error=>{console.error(error.message);app.exit(1);});
app.on("window-all-closed",()=>app.quit());
let closing=false;
app.on("before-quit",event=>{
  if(service&&!closing){event.preventDefault();closing=true;service.close().finally(()=>app.quit());}
});
