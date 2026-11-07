const vscode=require('vscode');
const wire=require('./wire.cjs');
const {nativeActions}=require('./native-actions.cjs');
exports.activate=async context=>{
 const bridge=async(method,args)=>{try{if(method==='write')args={...args,data:wire.encode(args.data)};const result=await vscode.commands.executeCommand('paasta.webBridge',{method,args});return result&&typeof result==='object'&&'bytesBase64'in result?wire.decode(result):result;}catch(error){if(error.message.includes('[FileNotFound]'))throw vscode.FileSystemError.FileNotFound(args?.path);throw error;}};
 const catalog=await bridge('catalog'),changes=new vscode.EventEmitter();
 let compact=!!catalog.compact;
 context.subscriptions.push(vscode.commands.registerCommand('paasta.web.compactLayout',async value=>{compact=value===true;if(compact)await vscode.commands.executeCommand('workbench.action.closeSidebar');}));
 const path=uri=>{if(!['paasta','paasta-original'].includes(uri.scheme)||uri.authority!==catalog.accountKey)throw vscode.FileSystemError.NoPermissions(uri);return uri.path.replace(/\/$/,'');};
 const fire=uri=>changes.fire([{type:vscode.FileChangeType.Changed,uri}]);
 const provider={
  onDidChangeFile:changes.event,watch:()=>new vscode.Disposable(()=>{}),
  stat:uri=>bridge('stat',{path:path(uri),original:uri.scheme==='paasta-original'}),readDirectory:uri=>bridge('list',{path:path(uri)}),
  readFile:async uri=>new Uint8Array(await bridge('read',{path:path(uri),original:uri.scheme==='paasta-original'})),
  writeFile:async(uri,data,options)=>{await bridge('write',{path:path(uri),data,create:options.create,overwrite:options.overwrite});fire(uri);},
  createDirectory:async uri=>{await bridge('mkdir',{path:path(uri)});fire(uri);},
  delete:async(uri,options)=>{await bridge('remove',{path:path(uri),recursive:options.recursive});changes.fire([{type:vscode.FileChangeType.Deleted,uri}]);},
  rename:async(uri,destination,options)=>{await bridge('rename',{path:path(uri),destination:path(destination),overwrite:options.overwrite});changes.fire([{type:vscode.FileChangeType.Deleted,uri},{type:vscode.FileChangeType.Created,uri:destination}]);},
 };
 context.subscriptions.push(changes,vscode.workspace.registerFileSystemProvider('paasta',provider,{isCaseSensitive:true}),vscode.workspace.registerFileSystemProvider('paasta-original',{...provider,writeFile(){throw vscode.FileSystemError.NoPermissions();},createDirectory(){throw vscode.FileSystemError.NoPermissions();},delete(){throw vscode.FileSystemError.NoPermissions();},rename(){throw vscode.FileSystemError.NoPermissions();}},{isCaseSensitive:true,isReadonly:true}));
 let selected=null;
 const current=()=>selected;
 async function selectActiveEditor(editor){
  const uri=editor?.document.uri;
  if(['paasta','paasta-help'].includes(uri?.scheme)&&uri.authority===catalog.accountKey){const name=uri.path.split('/')[2];if(catalog.projects.some(project=>project.name===name))selected=name;if(compact)await vscode.commands.executeCommand('workbench.action.closeSidebar');}
  return update();
 }
 context.subscriptions.push(vscode.commands.registerCommand('paasta.web.nativeAction',nativeActions(catalog,bridge,current)));
 const dirty=()=>bridge('dirty',{count:vscode.workspace.textDocuments.filter(document=>document.isDirty&&['paasta','untitled'].includes(document.uri.scheme)).length}).catch(()=>{});
 context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(dirty),vscode.workspace.onDidCloseTextDocument(dirty),vscode.workspace.onDidSaveTextDocument(dirty),vscode.commands.registerCommand('paasta.web.saveAll',async()=>{const saved=await vscode.workspace.saveAll(false);await dirty();if(!saved||vscode.workspace.textDocuments.some(document=>document.isDirty&&document.uri.scheme==='paasta'))throw Error('بعضی فایل‌ها ذخیره نشدند؛ پنجره را باز نگه دارید و خطای ذخیره را بررسی کنید.');return true;}));
 const roots=new Map(catalog.projects.map(project=>[project.name,vscode.Uri.from({scheme:'paasta',authority:catalog.accountKey,path:'/projects/'+project.name})]));
 context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('paasta-help',{provideTextDocumentContent(uri){const name=uri.path.split('/')[2];if(!roots.has(name)||uri.authority!==catalog.accountKey)throw vscode.FileSystemError.FileNotFound(uri);return '# '+name+'\n\nسورس این پروژه در پاستا موجود نیست. از دکمهٔ «واردکردن ZIP» بالای صفحه، سورس اصلی را وارد کنید.\n\nاین صفحه راهنماست و جزو فایل‌های پروژه نیست. برنامهٔ منتشرشده تغییر نمی‌کند.';}}));
 const status=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left,10);status.command='paasta.web.selectProject';status.text='$(cloud) پاستا · انتخاب پروژه';status.show();context.subscriptions.push(status);
 const scm=vscode.scm.createSourceControl('paasta','Paasta');
 const group=scm.createResourceGroup('changes','تغییرات محلی');context.subscriptions.push(scm);
 let updating=false;
 async function update(){
  const name=current();status.text='$(cloud) پاستا'+(name?' · '+name:' · انتخاب پروژه');if(!name||updating)return;updating=true;
  try{await bridge('project',{name});const files=await bridge('changes',{path:'/projects/'+name});if(current()!==name)return;group.resourceStates=files.map(file=>{const uri=roots.get(name).with({path:'/projects/'+name+'/'+file.path});return {resourceUri:uri,command:{command:'paasta.web.diff',title:'نمایش تغییرات',arguments:[uri,file.status]},decorations:{strikeThrough:file.status==='deleted'}};});}catch{}finally{updating=false;if(current()!==name)void update();}
 }
 async function open(name){
  if(!roots.has(name))throw Error('پروژه در دسترس نیست.');
  const root=roots.get(name);let entries;
  try{entries=await provider.readDirectory(root);}catch(error){
   if(catalog.projects.find(project=>project.name===name)?.sourceAvailable)throw error;
   const document=await vscode.workspace.openTextDocument(root.with({scheme:'paasta-help',path:root.path+'/SOURCE-REQUIRED.md'}));
   await vscode.window.showTextDocument(document,{viewColumn:vscode.ViewColumn.One,preview:true});selected=name;await update();return;
  }
  selected=name;await bridge('project',{name});
  const first=entries.find(([name,type])=>type===1&&/^readme(?:\.|$)/i.test(name))||entries.find(([name,type])=>type===1&&/\.(md|txt|json|js|ts|py|html|php|go|yml|yaml)$/.test(name));
  const reveal=first||entries[0];
  await vscode.commands.executeCommand('revealInExplorer',reveal?vscode.Uri.joinPath(root,reveal[0]):root);
  if(first)await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root,first[0])),{viewColumn:vscode.ViewColumn.One,preview:true});
  await update();
 }
 context.subscriptions.push(vscode.commands.registerCommand('paasta.web.selectProject',async()=>{const pick=await vscode.window.showQuickPick(catalog.projects.map(project=>({label:project.name,description:project.provider?[project.provider,project.ref].join(' · '):'سورس پروژه'})),{placeHolder:'پروژه را انتخاب کنید'});if(pick)try{await open(pick.label);}catch(error){vscode.window.showErrorMessage(error.message);}}));
 context.subscriptions.push(vscode.commands.registerCommand('paasta.web.openProject',open),vscode.commands.registerCommand('paasta.web.refreshProject',async name=>{if(!roots.has(name))throw Error('پروژه در دسترس نیست.');fire(roots.get(name));for(const document of vscode.workspace.textDocuments)if(document.uri.scheme==='paasta'&&document.uri.authority===catalog.accountKey&&document.uri.path.startsWith('/projects/'+name+'/'))fire(document.uri);await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');await open(name);}));
 context.subscriptions.push(vscode.commands.registerCommand('paasta.web.reloadProject',async name=>{if(!roots.has(name))throw Error('پروژه در دسترس نیست.');fire(roots.get(name));for(const document of vscode.workspace.textDocuments)if(document.uri.scheme==='paasta'&&document.uri.authority===catalog.accountKey&&document.uri.path.startsWith('/projects/'+name+'/'))fire(document.uri);await update();}));
 context.subscriptions.push(vscode.commands.registerCommand('paasta.web.diff',async(uri,status)=>{if(status==='added')return vscode.commands.executeCommand('vscode.open',uri);if(status==='deleted')return vscode.commands.executeCommand('vscode.open',uri.with({scheme:'paasta-original'}));return vscode.commands.executeCommand('vscode.diff',uri.with({scheme:'paasta-original'}),uri,'تغییرات · '+uri.path.split('/').pop());}));
 context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(selectActiveEditor),vscode.workspace.onDidSaveTextDocument(update),vscode.workspace.onDidCreateFiles(update),vscode.workspace.onDidDeleteFiles(update),vscode.workspace.onDidRenameFiles(update));
 if(vscode.window.onDidChangeTextEditorSelection)context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(event=>{const uri=event.textEditor.document.uri;if(compact&&uri.scheme==='paasta'&&uri.authority===catalog.accountKey)void vscode.commands.executeCommand('workbench.action.closeSidebar');}));
 const first=catalog.initialProject?catalog.projects.find(project=>project.name===catalog.initialProject):catalog.projects.find(project=>project.sourceAvailable);
 // File/Explorer commands wait for activation; awaiting them here deadlocks the provider.
 if(first)void open(first.name).catch(error=>vscode.window.showWarningMessage(error.message));
};
