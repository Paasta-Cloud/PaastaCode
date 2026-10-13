// The renderer can request actions, but can never choose an update URL or installer.
function createUpdates({updater,version,enabled,load,save,prepare,beforeInstall=()=>{},emit=()=>{}}){
  let state={phase:enabled?"idle":"unavailable",version,automatic:true,percent:0},checking=null,downloading=null,installing=false;
  const publish=patch=>{state={...state,...patch};emit({...state});return {...state};};
  updater.autoInstallOnAppQuit=false;updater.allowDowngrade=false;updater.allowPrerelease=version.includes("-");updater.logger=null;
  updater.on("checking-for-update",()=>publish({phase:"checking",error:null}));
  updater.on("update-available",info=>publish({phase:"available",availableVersion:info.version,error:null}));
  updater.on("update-not-available",()=>publish({phase:"current",error:null}));
  updater.on("download-progress",info=>publish({phase:"downloading",percent:Math.round(Math.max(0,Math.min(100,info.percent)))}));
  updater.on("update-downloaded",info=>publish({phase:"ready",availableVersion:info.version,percent:100,error:null}));
  updater.on("error",()=>publish({phase:"error",error:"به‌روزرسانی کامل نشد. اتصال را بررسی و دوباره تلاش کنید."}));
  async function check(){if(!enabled)return publish({phase:"unavailable"});if(["ready","downloading"].includes(state.phase))return {...state};if(!checking)checking=updater.checkForUpdates().catch(()=>publish({phase:"error",error:"بررسی نسخهٔ جدید ممکن نشد؛ دوباره تلاش کنید."})).finally(()=>{checking=null;});await checking;return {...state};}
  async function download(){if(!enabled||!["available","error"].includes(state.phase))return {...state};if(!downloading)downloading=updater.downloadUpdate().catch(()=>publish({phase:"error",error:"دریافت نسخهٔ جدید کامل نشد؛ دوباره تلاش کنید."})).finally(()=>{downloading=null;});await downloading;return {...state};}
  async function install(automatic=false){
    if(installing||state.phase!=="ready"||automatic&&!state.automatic)return false;
    installing=true;
    try{
      try{await prepare();}catch(error){if(!automatic)publish({error:error.message});return false;}
      try{beforeInstall();updater.quitAndInstall(false,!automatic);return true;}
      catch{publish({error:"نصب نسخهٔ جدید شروع نشد. برنامه را دوباره باز کنید و تلاش کنید."});return false;}
    }finally{installing=false;}
  }
  return {state:()=>({...state}),check,download,install,
    async start(){const preferences=await load();state.automatic=preferences.automatic!==false;updater.autoDownload=state.automatic;publish({});if(enabled&&state.automatic)await check();},
    async automatic(value){if(typeof value!=="boolean")throw new Error("تنظیم به‌روزرسانی معتبر نیست.");await save({automatic:value});updater.autoDownload=value;publish({automatic:value});if(value)await check();return {...state};}
  };
}
module.exports={createUpdates};
