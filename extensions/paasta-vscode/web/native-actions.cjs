const vscode=require('vscode');
const {filePath}=require('./archive.cjs');
const wire=require('./wire.cjs');
function nativeActions(catalog,bridge,selected){return async message=>{
 const project=selected();
 if(message.action==='folder'){await vscode.commands.executeCommand('paasta.web.selectProject');return {};}
 if(message.action==='sourceControl'){await vscode.commands.executeCommand('workbench.view.scm');return {};}
 if(!project||message.workspaceId!==project)throw Error('پروژهٔ فعال تغییر کرده است؛ درخواست را در پروژهٔ درست بررسی کنید.');
 if(message.action==='selection'){
  const editor=vscode.window.activeTextEditor;if(!editor||editor.selection.isEmpty||editor.document.uri.scheme!=='paasta'||editor.document.uri.authority!==catalog.accountKey||!editor.document.uri.path.startsWith('/projects/'+project+'/'))throw Error('بخشی از کد همین پروژه را انتخاب کنید.');
  const bytes=new TextEncoder().encode(editor.document.getText(editor.selection));if(bytes.length>64000)throw Error('انتخاب کد باید حداکثر ۶۴ کیلوبایت باشد.');return [{name:editor.document.uri.path.split('/').pop(),data:wire.encode(bytes).bytesBase64}];
 }
 if(message.action==='attach'){
  const files=await vscode.window.showOpenDialog({canSelectMany:true,canSelectFiles:true,canSelectFolders:false,defaultUri:vscode.Uri.from({scheme:'paasta',authority:catalog.accountKey,path:'/projects/'+project}),openLabel:'پیوست از پروژهٔ فعال'});
  if((files?.length||0)>5)throw Error('حداکثر ۵ فایل متنی کوچک پیوست کنید.');const result=[];
  for(const uri of files||[]){if(uri.scheme!=='paasta'||uri.authority!==catalog.accountKey||!uri.path.startsWith('/projects/'+project+'/'))throw Error('پیوست باید داخل همین پروژه باشد.');const bytes=await vscode.workspace.fs.readFile(uri);if(bytes.length>64000)throw Error('هر پیوست باید حداکثر ۶۴ کیلوبایت باشد.');new TextDecoder('utf-8',{fatal:true}).decode(bytes);result.push({name:uri.path.split('/').pop(),data:wire.encode(bytes).bytesBase64});}return result;
 }
 if(message.action==='file'||message.action==='diff'){
  const path=filePath(message.path),uri=vscode.Uri.from({scheme:'paasta',authority:catalog.accountKey,path:'/projects/'+project+'/'+path});
  if(message.action==='file')await vscode.window.showTextDocument(uri,{viewColumn:vscode.ViewColumn.One,preview:true});
  else{const changes=await bridge('changes',{path:'/projects/'+project});await vscode.commands.executeCommand('paasta.web.diff',uri,changes.find(change=>change.path===path)?.status||'modified');}return {};
 }
 if(message.action==='restore'){
  const sessions=await bridge('agent',{path:'/projects/'+project,request:{path:'sessions',method:'GET'}}),choice=await vscode.window.showQuickPick(sessions.map(session=>({label:session.title||'گفتگو',session})),{placeHolder:'گفتگوهای همین پروژه در این مرورگر'});return {session:choice?.session};
 }
 throw Error('این عملیات در نسخهٔ مرورگری فعال نیست.');
};}
module.exports={nativeActions};
