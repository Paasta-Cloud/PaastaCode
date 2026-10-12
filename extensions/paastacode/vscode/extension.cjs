const vscode=require("vscode");
const {spawn}=require("node:child_process");
const fs=require("node:fs");
const path=require("node:path");
const {pathToFileURL}=require("node:url");
let child;
const ownedServices=new Map();
function activate(context){
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
    if(connection.pid===child.pid)ownedServices.set(url.origin,connection.capability);
    const panel=vscode.window.createWebviewPanel("paastacode","پاستاکد",vscode.ViewColumn.One,{enableScripts:true,retainContextWhenHidden:true,
      portMapping:[{webviewPort:Number(url.port),extensionHostPort:Number(url.port)}]});
    panel.webview.html='<!doctype html><html lang="fa" dir="rtl"><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; frame-src '+url.origin+'; style-src \'unsafe-inline\';"><style>html,body,iframe{width:100%;height:100%;margin:0;border:0;overflow:hidden}</style></head><body><iframe title="پاستاکد" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox" src="'+url.origin+'/embed/'+connection.capability+'#cap='+connection.capability+'"></iframe></body></html>';
  }));
}
async function deactivate(){
  await Promise.all([...ownedServices].map(([url,capability])=>fetch(url+"/api/shutdown",{method:"POST",headers:{Authorization:"Bearer "+capability},signal:AbortSignal.timeout(4000)}).catch(()=>{})));
}
module.exports={activate,deactivate};
