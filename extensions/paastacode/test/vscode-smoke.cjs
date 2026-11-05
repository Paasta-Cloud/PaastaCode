const assert=require("node:assert/strict");
const path=require("node:path");
const vscode=require("vscode");
async function checkNativeTools(extension){
 const fs=require('node:fs/promises'),{promisify}=require('node:util'),exec=promisify(require('node:child_process').execFile);
 const home=path.join(process.env.PAASTACODE_VSCODE_OUTPUT,'native-tool-account');await fs.mkdir(home,{recursive:true});
 const account='a'.repeat(64),tool='codex',key='paasta_ai_'+'x'.repeat(43),helper=path.join(extension.extensionPath,'coding-credentials.cjs'),vault=require(helper);
 const node=path.join(extension.extensionPath,'runtime',process.platform==='win32'?'node.exe':'node'),env={...process.env,HOME:home,USERPROFILE:home,NODE_OPTIONS:'',NODE_PATH:''};
 const base=path.join(home,'.paasta','coding-tools');
 assert.equal((await exec(node,['-e','process.stdout.write(require(process.argv[1]).root())',helper],{env,windowsHide:true,timeout:15000})).stdout,base);
 await vault.writeRecord(base,account,tool,{account,tool,key,enabled:true,model:'fixture/model'});
 const result=await exec(node,[helper,account,tool],{env,windowsHide:true,timeout:15000});assert.equal(result.stdout,key);assert.equal(result.stderr,'');
 await vault.writeRecord(base,account,tool,{account,tool,key,enabled:false,model:'fixture/model'});
 await assert.rejects(exec(node,[helper,account,tool],{env,windowsHide:true,timeout:15000}),error=>error.stdout===''&&!error.stderr.includes(key));
 const commands=await vscode.commands.getCommands(true);for(const id of ['paasta.tools.manage','paasta.tools.status'])assert(commands.includes(id));
 console.log('Installed native tools: registered manager, packaged Node helper, private credentials and disabled-key rejection passed without provider requests.');
}
async function checkBundledCli(extension){
  const token='paasta_'+'q'.repeat(43),http=require('node:http');let authenticated=false;
  const server=http.createServer((req,res)=>{if(req.url==='/api/cli/context')authenticated=req.headers.authorization==='Bearer '+token;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({fixture:true}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const {promisify}=require('node:util'),exec=promisify(require('node:child_process').execFile);
    const isolated=path.join(process.env.PAASTACODE_VSCODE_OUTPUT,'cli-account');require('node:fs').mkdirSync(isolated,{recursive:true});
    const result=await exec(path.join(extension.extensionPath,'client','engine','paasta'+(process.platform==='win32'?'.exe':'')),['api','GET','/api/cli/context'],{timeout:15000,windowsHide:true,env:{...process.env,HOME:isolated,APPDATA:isolated,XDG_CONFIG_HOME:isolated,PAASTA_RUNTIME_SERVER:'http://127.0.0.1:'+server.address().port,PAASTA_RUNTIME_TOKEN:token}});
    assert(authenticated,'Installed CLI must use the scoped runtime grant without a saved login');assert.equal(JSON.parse(result.stdout).fixture,true);
  }finally{await new Promise(resolve=>server.close(resolve));}
}
exports.run=async()=>{
  const {chromium}=require("playwright");
  const browser=await chromium.connectOverCDP("http://127.0.0.1:"+(process.env.PAASTACODE_TEST_CDP||"9337"));
  const extension=vscode.extensions.getExtension(process.env.PAASTACODE_EXPECT_EXTENSION_ID||"paasta.paastacode");assert(extension,"Installed PaastaCode extension must be registered");
  if(process.env.PAASTACODE_INSTALLED_ROOT){
    const normalized=value=>process.platform==="win32"?path.resolve(value).toLowerCase():path.resolve(value);
    assert(normalized(extension.extensionPath).startsWith(normalized(process.env.PAASTACODE_INSTALLED_ROOT)+path.sep),"Acceptance must activate the installed customer package, not the source tree");
    assert.equal(extension.packageJSON.version,process.env.PAASTACODE_EXPECT_EXTENSION_VERSION);
    assert.equal(vscode.workspace.getConfiguration("paastacode").get("clientPath"),"","No source launcher override is permitted");
    const fs=require("node:fs");for(const file of ["client/bin/paastacode.mjs","client/engine/"+(process.platform==="win32"?"opencode.exe":"opencode"),"runtime/"+(process.platform==="win32"?"node.exe":"node")])assert(fs.existsSync(path.join(extension.extensionPath,file)),"Bundled executable missing: "+file);
  }
  if(extension.id==='paasta-cloud.paasta'){await extension.activate();await checkBundledCli(extension);await checkNativeTools(extension);}
  try{
    const page=browser.contexts().flatMap(context=>context.pages()).find(page=>page.url().includes('workbench'))||browser.contexts()[0].pages()[0];
    const activity=page.getByRole('tab',{name:/^(?:PaastaCode|پاستا)/}).first();
    await activity.waitFor({state:'visible'});await activity.click();
    if(extension.id==='paasta-cloud.paasta'&&vscode.workspace.workspaceFolders?.length)await vscode.commands.executeCommand('paastacode.open');
    let found;
    for(let attempt=0;attempt<160&&!found;attempt++){
      for(const context of browser.contexts())for(const page of context.pages())for(const frame of page.frames()){
        if(frame.url().startsWith("vscode-webview:")&&await frame.locator("#login").count())found={page,frame};
      }
      if(!found)await new Promise(resolve=>setTimeout(resolve,250));
    }
    assert(found,"Native PaastaCode sidebar must render in the actual VS Code webview");
    assert.equal(await found.frame.locator("iframe").count(),0,"Desktop iframe must not return");
    if(process.env.PAASTACODE_VSCODE_EMPTY==='1'){
      assert.equal(vscode.workspace.workspaceFolders?.length||0,0);await found.frame.locator("#folder").waitFor({state:"visible"});const output=process.env.PAASTACODE_VSCODE_OUTPUT;await found.page.screenshot({path:path.join(output,"vscode-empty.png")});require("node:fs").writeFileSync(path.join(output,"vscode-empty-result.json"),JSON.stringify({installed:true,version:extension.packageJSON.version,emptyWorkspace:true,activityBar:true,folderAction:true,native:true}));return;
    }
    await found.frame.locator("#login").waitFor({state:"visible"});
    assert.equal(await found.frame.locator("html").getAttribute("dir"),"rtl");
    assert(await found.frame.evaluate(()=>typeof globalThis.PaastaTasks?.recap==="function"),"Installed task helper must load under the actual webview CSP");
    assert.equal(await found.frame.locator("#tasks-toggle").count(),1);
    assert.equal(await found.frame.locator("#run-recap").count(),1);
    await found.frame.evaluate(()=>document.fonts.ready);
    assert(await found.frame.evaluate(()=>[...document.fonts].some(face=>face.family==="PaastaPersian"&&face.status==="loaded")),"Installed Persian font must load inside the native editor webview");
    const output=process.env.PAASTACODE_VSCODE_OUTPUT||path.resolve(__dirname,"../.artifacts");
    await found.page.screenshot({path:path.join(output,"vscode.png")});
    require("node:fs").writeFileSync(path.join(output,"vscode-result.json"),JSON.stringify({installed:!!process.env.PAASTACODE_INSTALLED_ROOT,version:extension.packageJSON.version,activityBar:true,sidebarOpen:true,native:true,rtl:true,font:true,platform:process.platform,arch:process.arch}));
    require("node:fs").writeFileSync(path.join(output,"vscode-result.txt"),"PaastaCode actual VS Code native sidebar smoke passed");
  }finally{await browser.close();}
};
