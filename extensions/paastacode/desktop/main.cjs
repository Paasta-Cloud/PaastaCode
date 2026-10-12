const {app,BrowserWindow,shell}=require("electron");
const path=require("node:path");
let service,window;
app.setName("PaastaCode");
app.whenReady().then(async()=>{
  const {startServer}=await import("../src/server.mjs");
  const workspace=process.argv.find(arg=>arg.startsWith("--workspace="))?.slice(12)||process.cwd();
  service=await startServer({workspace});
  window=new BrowserWindow({title:"پاستاکد | PaastaCode",width:1280,height:880,minWidth:360,minHeight:580,
    show:!process.env.PAASTACODE_DESKTOP_SMOKE,autoHideMenuBar:true,backgroundColor:"#f5f7fa",
    webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  window.webContents.setWindowOpenHandler(({url})=>{
    const target=new URL(url),allowed=new URL(process.env.PAASTACODE_CONSOLE||"https://console.paasta.cloud");
    const attribution=["https://opencode.ai/","https://github.com/Paasta-Cloud/PaastaCode"].includes(target.href);
    if(attribution||(target.origin===allowed.origin&&target.pathname==="/cli/authorize"))void shell.openExternal(url);
    return {action:"deny"};
  });
  window.webContents.on("will-navigate",(event,url)=>{if(new URL(url).origin!==service.url)event.preventDefault();});
  window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  await window.loadURL(service.launchUrl);
  if(process.env.PAASTACODE_DESKTOP_SMOKE){
    const result=await window.webContents.executeJavaScript("({title:document.title,rtl:document.documentElement.dir,login:!!document.getElementById('login')})");
    if(!result.rtl||!result.login)throw new Error("Desktop smoke failed.");
    const image=await window.webContents.capturePage();
    require("node:fs").writeFileSync(path.join(__dirname,"../.artifacts/desktop.png"),image.toPNG());
    console.log("PaastaCode desktop smoke passed");app.quit();
  }
}).catch(error=>{console.error(error.message);app.exit(1);});
app.on("window-all-closed",()=>app.quit());
let closing=false;
app.on("before-quit",event=>{
  if(service&&!closing){event.preventDefault();closing=true;service.close().finally(()=>app.quit());}
});
