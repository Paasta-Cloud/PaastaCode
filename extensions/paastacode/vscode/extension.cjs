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
  const {attachNative}=require('./native-workbench.cjs');
  const output=vscode.window.createOutputChannel('PaastaCode');context.subscriptions.push(output);
  let connecting,connectedWorkspace;
  async function connect(){
    if(!vscode.workspace.isTrusted)throw new Error('اعتماد به پروژه لازم است.');
    const folder=vscode.workspace.workspaceFolders?.[0];if(!folder)throw new Error('ابتدا پوشهٔ پروژه را باز کنید.');
    if(connectedWorkspace===folder.uri.fsPath&&connecting)return connecting;
    connectedWorkspace=folder.uri.fsPath;
    connecting=(async()=>{
    const workspace=fs.realpathSync(folder.uri.fsPath);
    const custom=vscode.workspace.getConfiguration("paastacode").get("clientPath");
    const bundled=path.join(__dirname,"client/bin/paastacode.mjs");
    const client=custom||(fs.existsSync(bundled)?bundled:path.resolve(__dirname,"../bin/paastacode.mjs"));
    if(!path.isAbsolute(client)||!fs.existsSync(client))throw new Error("مسیر نصب پاستاکد را در تنظیمات VS Code بررسی کنید.");
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
    if(!connection)throw new Error("موتور پروژه آماده نشد؛ خروجی PaastaCode را بررسی کنید و دوباره تلاش کنید.");
    const url=new URL(connection.url);
    if(url.hostname!=="127.0.0.1"||url.protocol!=="http:"||!/^[A-Za-z0-9_-]{43}$/.test(connection.capability))return;

      return {async request(route,method='GET',body,revision){
        try{
          const response=await fetch(url.origin+'/api/'+route,{method,headers:{Authorization:'Bearer '+connection.capability,...(revision===undefined?{}:{'X-PaastaCode-Account':String(revision)}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(90000)});
          const text=await response.text();let result;try{result=JSON.parse(text);}catch{throw new Error('پاسخ موتور کامل دریافت نشد؛ تازه‌سازی را بزنید.');}
          if(!response.ok)throw new Error(result.error||'درخواست انجام نشد.');return result;
        }catch(error){output.appendLine(method+' '+route.split('?')[0]+': '+(error.name==='TypeError'?'runtime connection failed':error.name));if(error.name==='TypeError'){connecting=null;throw new Error('ارتباط با موتور پروژه قطع شد. تازه‌سازی را بزنید؛ دستور قبلی خودکار تکرار نمی‌شود.');}throw error;}
      }};
    })().catch(error=>{connecting=null;throw error;});return connecting;
  }
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('paastacode.home',{resolveWebviewView(view){const bridge=attachNative(view.webview,context,connect);view.onDidDispose(()=>bridge.dispose());}},{webviewOptions:{retainContextWhenHidden:true}}));
  context.subscriptions.push(vscode.commands.registerCommand('paastacode.open',async()=>{if(!vscode.workspace.isTrusted)return vscode.window.showErrorMessage('ابتدا اعتماد به پوشهٔ پروژه را بررسی کنید.');if(!vscode.workspace.workspaceFolders?.length)return vscode.commands.executeCommand('workbench.action.files.openFolder');return vscode.commands.executeCommand('workbench.view.extension.paastacode');}));
  context.subscriptions.push(vscode.commands.registerCommand('paastacode.openEditor',()=>{const panel=vscode.window.createWebviewPanel('paastacode','پاستاکد',vscode.ViewColumn.One,{enableScripts:true,retainContextWhenHidden:true});const bridge=attachNative(panel.webview,context,connect);panel.onDidDispose(()=>bridge.dispose());}));
}
function deactivate(){}
module.exports={activate,deactivate};
