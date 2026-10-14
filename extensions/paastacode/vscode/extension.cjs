const vscode=require("vscode");
const {spawn}=require("node:child_process");
const fs=require("node:fs");
const path=require("node:path");
const {pathToFileURL}=require("node:url");
let child;
function activate(context){
  let updating=false;
  async function update(manual=false){
    if(updating)return;if(!manual&&!vscode.workspace.getConfiguration("paastacode").get("autoUpdate",true))return;updating=true;
    try{
      const root=path.join(__dirname,"client");
      if(!fs.existsSync(path.join(root,"package.json"))){if(manual)await vscode.window.showInformationMessage("به‌روزرسانی برای نسخهٔ نصب‌شدهٔ افزونه فعال است.");return;}
      const current=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8")).version;
      const {checkUpdate,downloadUpdate}=await import(pathToFileURL(path.join(root,"src/updates.mjs")).href);
      const release=await checkUpdate(current);if(!release){if(manual)await vscode.window.showInformationMessage("افزونهٔ پاستاکد به‌روز است.");return;}
      await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:"به‌روزرسانی پاستاکد"},async()=>{
        const download=await downloadUpdate(release,"vsix");await vscode.commands.executeCommand("workbench.extensions.installExtension",vscode.Uri.file(download.path));
      });
      const action=await vscode.window.showInformationMessage("نسخهٔ جدید پاستاکد نصب شد. برای استفاده، پنجره را دوباره بارگذاری کنید.","بارگذاری دوباره");if(action)await vscode.commands.executeCommand("workbench.action.reloadWindow");
    }catch{if(manual)await vscode.window.showErrorMessage("به‌روزرسانی پاستاکد انجام نشد؛ اتصال را بررسی و دوباره تلاش کنید.");}
    finally{updating=false;}
  }
  context.subscriptions.push(vscode.commands.registerCommand("paastacode.update",()=>update(true)));
  context.subscriptions.push(vscode.commands.registerCommand('paastacode.billing',async()=>{
    try{
      const custom=vscode.workspace.getConfiguration('paastacode').get('clientPath');
      if(custom&&!vscode.workspace.isTrusted)return vscode.window.showErrorMessage('برای استفاده از مسیر نصب سفارشی، اعتماد به پروژه را بررسی کنید.');
      const root=custom?path.dirname(path.dirname(custom)):fs.existsSync(path.join(__dirname,'client/src/account.mjs'))?path.join(__dirname,'client'):path.resolve(__dirname,'..');
      const {PaastaAccount,billingUrl}=await import(pathToFileURL(path.join(root,'src/account.mjs')).href),account=await new PaastaAccount().load(),current=await account.context(),url=billingUrl(account.origin,current.account);
      if(!url)throw new Error();await vscode.env.openExternal(vscode.Uri.parse(url));
    }catch{await vscode.window.showErrorMessage('مدیریت مصرف باز نشد؛ ابتدا از پاستاکد با حساب پاستا وارد شوید و دوباره تلاش کنید.');}
  }));
  const timer=setInterval(()=>void update(),6*60*60*1000);timer.unref();context.subscriptions.push({dispose:()=>clearInterval(timer)});
  if(!process.env.PAASTACODE_VSCODE_SMOKE&&!process.env.PAASTACODE_TEST_CDP)void update();
  context.subscriptions.push(vscode.commands.registerCommand("paastacode.open",async()=>{
    if(!vscode.workspace.isTrusted)return vscode.window.showErrorMessage("ابتدا اعتماد به پوشهٔ پروژه را تأیید کنید.");
    const folder=vscode.workspace.workspaceFolders?.[0];
    if(!folder)return vscode.window.showErrorMessage("ابتدا یک پوشهٔ پروژه باز کنید.");
    const workspace=fs.realpathSync(folder.uri.fsPath);
    const custom=vscode.workspace.getConfiguration("paastacode").get("clientPath");
    const bundled=path.join(__dirname,"client/bin/paastacode.mjs");
    const client=custom||(fs.existsSync(bundled)?bundled:path.resolve(__dirname,"../bin/paastacode.mjs"));
    if(!path.isAbsolute(client)||!fs.existsSync(client))return vscode.window.showErrorMessage("مسیر نصب پاستاکد را در تنظیمات VS Code وارد کنید.");
    const node=custom||!fs.existsSync(bundled)?"node":path.join(__dirname,"runtime",process.platform==="win32"?"node.exe":"node");
    child=spawn(node,[client,"web","--no-open","--workspace="+workspace],{cwd:workspace,windowsHide:true,stdio:["ignore","pipe","pipe"]});
    child.stdout.resume();child.stderr.resume();
    child.on("error",()=>vscode.window.showErrorMessage("اجرای پاستاکد ممکن نشد؛ نصب Node.js و مسیر برنامه را بررسی کنید."));
    const root=path.dirname(path.dirname(client));
    const {readPrivate,stateHome}=await import(pathToFileURL(path.join(root,"src/account.mjs")).href);
    const {workspaceKey}=await import(pathToFileURL(path.join(root,"src/runtime.mjs")).href);
    let connection;
    for(let attempt=0;attempt<30;attempt++){
      const saved=await readPrivate(path.join(stateHome,"workspace-"+workspaceKey(workspace)+".json"));
      if(saved)try{
        const address=new URL(saved.url);
        if(address.hostname==="127.0.0.1"&&address.protocol==="http:"&&/^[A-Za-z0-9_-]{43}$/.test(saved.capability)){
          const response=await fetch(address.origin+"/api/state",{headers:{Authorization:"Bearer "+saved.capability},signal:AbortSignal.timeout(1000)});
          if(response.ok){connection=saved;break;}
        }
      }catch{/* A previous editor may have crashed; wait for the new runtime. */}
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    if(!connection)return vscode.window.showErrorMessage("پاستاکد آماده نشد. یک بار آن را از ترمینال اجرا کنید.");
    const url=new URL(connection.url);
    if(url.hostname!=="127.0.0.1"||url.protocol!=="http:"||!/^[A-Za-z0-9_-]{43}$/.test(connection.capability))return;
    const panel=vscode.window.createWebviewPanel("paastacode","پاستاکد",vscode.ViewColumn.One,{enableScripts:true,retainContextWhenHidden:true,
      portMapping:[{webviewPort:Number(url.port),extensionHostPort:Number(url.port)}]});
    panel.webview.html='<!doctype html><html lang="fa" dir="rtl"><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; frame-src '+url.origin+'; style-src \'unsafe-inline\';"><style>html,body,iframe{width:100%;height:100%;margin:0;border:0;overflow:hidden}</style></head><body><iframe title="پاستاکد" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox" src="'+url.origin+'/embed/'+connection.capability+'#cap='+connection.capability+'"></iframe></body></html>';
  }));
}
function deactivate(){}
module.exports={activate,deactivate};
