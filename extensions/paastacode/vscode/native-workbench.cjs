const vscode=require('vscode');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const {existsSync}=require('node:fs');

const routes={GET:['state','quota','sessions','messages','status','permissions','workflow','git','git/diff','sync'],POST:['login','login/poll','connect','sessions','prompt','abort','permission','access','save','sync','logout']};
function allowedRoute(method,value){
  if(typeof value!=='string'||value.length>500||!['GET','POST'].includes(method))return false;
  const [route,query]=value.split('?');if(!routes[method].includes(route))return false;
  if(!query)return true;
  const params=new URLSearchParams(query);
  return [...params].every(([key,value])=>key==='id'?/^ses_[A-Za-z0-9]+$/.test(value):route==='git/diff'&&key==='path'&&value.length<300);
}
function attachNative(webview,context,connect){
  const nonce=randomBytes(24).toString('hex');
  const media=vscode.Uri.joinPath(context.extensionUri,'media');
  let fontStyle='',fontRoot;
  if(context.extensionUri.fsPath){
    const bundled=path.join(context.extensionUri.fsPath,'client/web/fonts'),fonts=existsSync(bundled)?bundled:path.resolve(context.extensionUri.fsPath,'../web/fonts');
    const licensed=existsSync(path.join(fonts,'YekanBakh.ttf')),font=path.join(fonts,licensed?'YekanBakh.ttf':'Vazirmatn.woff2');
    if(existsSync(font)){fontRoot=vscode.Uri.file(fonts);const uri=webview.asWebviewUri(vscode.Uri.file(font));fontStyle=`<style nonce="${nonce}">@font-face{font-family:PaastaPersian;src:url('${uri}');font-display:swap;unicode-range:U+0600-06FF,U+0750-077F,U+08A0-08FF,U+FB50-FDFF,U+FE70-FEFF}body{font-family:PaastaPersian,var(--vscode-font-family)}</style>`;}
  }
  webview.options={enableScripts:true,localResourceRoots:[media,...(fontRoot?[fontRoot]:[])]};
  const script=webview.asWebviewUri(vscode.Uri.joinPath(media,'native.js'));
  const style=webview.asWebviewUri(vscode.Uri.joinPath(media,'native.css'));
  webview.html=`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${style}">${fontStyle}</head><body><header><strong>PaastaCode</strong><button id="new" title="گفتگوی جدید" aria-label="گفتگوی جدید">＋</button><button id="billing">اشتراک</button><button id="refresh">تازه‌سازی</button></header><div id="notice" role="status" hidden></div><section id="welcome"><h2>از پروژهٔ شما شروع کنیم.</h2><p id="welcome-text">در حال اتصال به پاستاکد…</p><button id="folder" hidden>باز کردن پوشه</button><button id="login" hidden>ورود با پاستا</button><button id="configure" hidden>انتخاب سقف مصرف و اتصال</button></section><section id="work" hidden><p id="quota" role="status"></p><label class="sr-only" for="sessions">گفتگو</label><select id="sessions"></select><main id="messages" aria-label="پیام‌ها"></main><button id="latest" hidden>رفتن به آخرین خروجی ↓</button><div id="activity" role="status"></div><section id="permissions" aria-label="تأیید ابزارها"></section><form id="composer"><div id="files"></div><label class="sr-only" for="prompt">درخواست شما</label><textarea id="prompt" placeholder="چه تغییری می‌خواهید؟" rows="3"></textarea><div class="controls"><button id="attach" type="button">پیوست فایل</button><button id="selection" type="button">انتخاب ویرایشگر</button><label class="sr-only" for="model">مدل</label><select id="model"></select><label class="sr-only" for="access">دسترسی</label><select id="access"><option value="review">با تأیید شما</option><option value="full">Full Access</option></select><button id="send" type="submit" aria-label="ارسال درخواست">↑</button><button id="stop" type="button" hidden>توقف</button></div><details><summary>مدل برنامه‌ریزی و اجرا</summary><label>مدل برنامه‌ریزی<select id="planner"></select></label><p>برنامه‌ریزی با مدل انتخابی بالا و اجرا با مدل کدنویسی انجام می‌شود.</p></details></form><footer><button id="save">ذخیره در حساب</button><button id="changes">تغییرات پروژه</button><span>Powered by OpenCode</span></footer></section><script nonce="${nonce}" src="${script}"></script></body></html>`;
  let revision,disposed=false;
  const subscription=webview.onDidReceiveMessage(async message=>{
    const id=message?.id;if(!Number.isSafeInteger(id)||id<1)return;
    try{
      if(!vscode.workspace.isTrusted)throw new Error('ابتدا اعتماد به پوشهٔ پروژه را بررسی کنید.');
      let result;
      if(message.action==='folder'){await vscode.commands.executeCommand('workbench.action.files.openFolder');result={};}
      else if(message.action==='billing'){await vscode.commands.executeCommand('paastacode.billing');result={};}
      else if(message.action==='sourceControl'){await vscode.commands.executeCommand('workbench.view.scm');result={};}
      else if(!vscode.workspace.workspaceFolders?.length){result={noWorkspace:true};}
      else if(message.action==='attach'){
        const uris=await vscode.window.showOpenDialog({canSelectMany:true,canSelectFolders:false,openLabel:'پیوست به درخواست'});result=[];
        for(const uri of uris||[]){if(uri.scheme!=='file')throw new Error('فایل محلی انتخاب کنید.');const stat=await fs.stat(uri.fsPath);if(!stat.isFile()||stat.size>4*1024*1024)throw new Error('هر فایل باید حداکثر ۴ مگابایت باشد.');result.push({name:path.basename(uri.fsPath),data:(await fs.readFile(uri.fsPath)).toString('base64')});}
      }else if(message.action==='selection'){
        const editor=vscode.window.activeTextEditor;if(!editor||editor.selection.isEmpty)throw new Error('ابتدا بخشی از کد را در ویرایشگر انتخاب کنید.');
        const text=editor.document.getText(editor.selection);if(Buffer.byteLength(text)>4*1024*1024)throw new Error('انتخاب کد بیش از حد بزرگ است.');result=[{name:path.basename(editor.document.uri.fsPath),data:Buffer.from(text).toString('base64')}];
      }else if(message.action==='file'||message.action==='diff'){
        if(typeof message.path!=='string')throw new Error('مسیر فایل معتبر نیست.');
        const root=await fs.realpath(vscode.workspace.workspaceFolders[0].uri.fsPath),file=await fs.realpath(path.resolve(root,message.path));
        if(file!==root&&!file.startsWith(root+path.sep))throw new Error('فایل باید داخل همین پروژه باشد.');
        if(message.action==='diff')await vscode.commands.executeCommand('git.openChange',vscode.Uri.file(file));
        else await vscode.window.showTextDocument(vscode.Uri.file(file),{preview:true});result={};
      }else if(message.action==='configure'){
        const connection=await connect(),current=await connection.request('state','GET');revision=current.accountRevision;
        if(current.billingStatus){if(current.billingStatus.canConnectWithoutLimit)result=await connection.request('connect','POST',{},revision);else{await vscode.commands.executeCommand('paastacode.billing');result={};}}
        else{const value=await vscode.window.showInputBox({title:'سقف روزانهٔ کلید پاستاکد، تومان',value:'100000',validateInput:value=>/^\d+$/.test(value)&&Number(value)>=1&&Number(value)<=1000000?undefined:'عددی بین ۱ و ۱٬۰۰۰٬۰۰۰ تومان وارد کنید.'});
        if(value===undefined)return webview.postMessage({id,result:{cancelled:true}});
        result=await connection.request('connect','POST',{dailyLimitToman:Number(value)},revision);}
      }else if(message.action==='api'){
        const method=message.method||'GET';if(!allowedRoute(method,message.path))throw new Error('درخواست این پنل مجاز نیست.');
        const connection=await connect();result=await connection.request(message.path,method,message.body,revision);
        if(message.path==='state')revision=result.accountRevision;
        if(message.path==='login'&&result.url){const uri=new URL(result.url);if(uri.protocol!=='https:'||!['console.paasta.cloud','paasta.cloud'].includes(uri.hostname)||uri.pathname!=='/cli/authorize')throw new Error('نشانی ورود معتبر نیست.');await vscode.env.openExternal(vscode.Uri.parse(uri.href));}
      }else throw new Error('عملیات پشتیبانی نمی‌شود.');
      if(!disposed)await webview.postMessage({id,result});
    }catch(error){if(!disposed)await webview.postMessage({id,error:error.message||'عملیات انجام نشد؛ دوباره بررسی کنید.'});}
  });
  return {dispose(){disposed=true;subscription.dispose();}};
}
module.exports={attachNative,allowedRoute};
