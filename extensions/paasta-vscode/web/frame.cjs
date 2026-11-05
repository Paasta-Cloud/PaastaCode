const {validRequest}=require('./bridge.cjs');
const wire=require('./wire.cjs');
const {addons,selection}=require('./addons.cjs');
const lock=require('../../../deploy/vscode-web.lock.json');
const pending=new Map();let sequence=0,port,workbench;
function rpc(request){
 return new Promise((resolve,reject)=>{
  const id=++sequence,message={...request,id};
  if(!port||!validRequest(message)){reject(Error('ارتباط امن با کنسول برقرار نیست.'));return;}
  const timeout=setTimeout(()=>{pending.delete(id);reject(Error('پاسخ کنسول به‌موقع دریافت نشد.'));},200000);
  pending.set(id,{resolve,reject,timeout});port.postMessage(message);
 });
}
async function start(){
 const nonce=new URLSearchParams(location.hash.slice(1)).get('nonce');
 if(!/^[a-f0-9]{64}$/.test(nonce||'')||parent===self){location.replace('https://console.paasta.cloud/editor/workbench');return;}
 const channel=new MessageChannel();port=channel.port1;
 port.onmessage=async({data})=>{
  if(data?.type==='paasta:web-ide:control'){
   try{
    if(!workbench)throw Error('ویرایشگر هنوز آماده نیست.');
    if(data.action==='save')await workbench.commands.executeCommand('paasta.web.saveAll');
    else if(data.action==='open')await workbench.commands.executeCommand('paasta.web.openProject',data.project);
    else if(data.action==='refresh')await workbench.commands.executeCommand('paasta.web.refreshProject',data.project);
    else if(data.action==='reload')await workbench.commands.executeCommand('paasta.web.reloadProject',data.project);
    else if(data.action==='native'){const result=await workbench.commands.executeCommand('paasta.web.nativeAction',data.message);port.postMessage({type:'paasta:web-ide:control-result',id:data.id,result});return;}
    else throw Error('عملیات مجاز نیست.');
    port.postMessage({type:'paasta:web-ide:control-result',id:data.id,result:true});
   }catch(error){port.postMessage({type:'paasta:web-ide:control-result',id:data.id,error:error.message});}return;
  }
  const entry=pending.get(data?.id);if(!entry)return;pending.delete(data.id);clearTimeout(entry.timeout);data.error?entry.reject(Error(data.error)):entry.resolve(data.result);
 };
 parent.postMessage({type:'paasta:web-ide:ready',nonce},'https://console.paasta.cloud',[channel.port2]);
 const catalog=await rpc({method:'catalog'}),base=location.origin+'/vendor/vscode-web/'+lock.version+'/vscode/out';
 await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=base+'/vs/loader.js';script.onload=resolve;script.onerror=reject;document.head.append(script);});
 const amd=globalThis.require;amd.config({baseUrl:base});
 for(const name of ['nls.messages.js','vs/workbench/workbench.web.main.js'])await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=base+'/'+name;script.onload=resolve;script.onerror=reject;document.head.append(script);});
 const link=document.createElement('link');link.rel='stylesheet';link.href=base+'/vs/workbench/workbench.web.main.css';document.head.append(link);
 amd(['vs/workbench/workbench.web.main'],api=>{
  workbench=api;
  document.getElementById('loading')?.remove();
  api.create(document.body,{
   commands:[{id:'paasta.webBridge',handler:async request=>{
    if(request?.method==='write')request={...request,args:{...request.args,data:wire.decode(request.args?.data)}};
    const result=await rpc(request);return result instanceof Uint8Array?wire.encode(result):result;
   }}],
   workspaceProvider:{workspace:{folderUri:api.URI.from({scheme:'paasta',authority:catalog.accountKey,path:'/projects'})},trusted:true,open:async()=>false},
   additionalBuiltinExtensions:[api.URI.parse(location.origin+'/paasta-web-ide/extension'),...addons.filter(addon=>selection(catalog.enabledExtensions||[]).includes(addon.id)).map(addon=>api.URI.parse(location.origin+'/paasta-web-ide/addons/'+addon.folder))],
   configurationDefaults:{'workbench.colorTheme':'Default Light Modern','workbench.startupEditor':'none','security.workspace.trust.enabled':false,'telemetry.telemetryLevel':'off','files.autoSave':'afterDelay','files.autoSaveDelay':1000,'files.hotExit':'off','workbench.localHistory.enabled':false,'extensions.autoCheckUpdates':false,'extensions.autoUpdate':false},
   productConfiguration:{nameShort:'Paasta Web IDE',nameLong:'Paasta Web IDE',applicationName:'paasta-web-ide',enableTelemetry:false,extensionsGallery:undefined,webviewContentExternalBaseUrlTemplate:base+'/vs/workbench/contrib/webview/browser/pre/'},
  });
 });
}
start().catch(error=>{const loading=document.getElementById('loading');if(loading)loading.textContent=error.message||'بازکردن محیط کامل نشد. به کنسول برگردید و دوباره امتحان کنید.';});
