const assert=require("node:assert/strict");
const path=require("node:path");
const vscode=require("vscode");
exports.run=async()=>{
  const {chromium}=require("playwright");
  const browser=await chromium.connectOverCDP("http://127.0.0.1:"+(process.env.PAASTACODE_TEST_CDP||"9337"));
  const extension=vscode.extensions.getExtension("paasta.paastacode");assert(extension,"Installed PaastaCode extension must be registered");
  if(process.env.PAASTACODE_INSTALLED_ROOT){
    const normalized=value=>process.platform==="win32"?path.resolve(value).toLowerCase():path.resolve(value);
    assert(normalized(extension.extensionPath).startsWith(normalized(process.env.PAASTACODE_INSTALLED_ROOT)+path.sep),"Acceptance must activate the installed customer package, not the source tree");
    assert.equal(extension.packageJSON.version,process.env.PAASTACODE_EXPECT_EXTENSION_VERSION);
    assert.equal(vscode.workspace.getConfiguration("paastacode").get("clientPath"),"","No source launcher override is permitted");
    const fs=require("node:fs");for(const file of ["client/bin/paastacode.mjs","client/engine/"+(process.platform==="win32"?"opencode.exe":"opencode"),"runtime/"+(process.platform==="win32"?"node.exe":"node")])assert(fs.existsSync(path.join(extension.extensionPath,file)),"Bundled executable missing: "+file);
  }
  await vscode.commands.executeCommand("paastacode.open");
  try{
    let found;
    for(let attempt=0;attempt<160&&!found;attempt++){
      for(const context of browser.contexts())for(const page of context.pages())for(const frame of page.frames()){
        if(frame.url().startsWith("http://127.0.0.1:")&&await frame.locator("#login").count())found={page,frame};
      }
      if(!found)await new Promise(resolve=>setTimeout(resolve,250));
    }
    assert(found,"PaastaCode iframe must render in the actual VS Code webview");
    await found.frame.locator("#login").waitFor({state:"visible"});
    assert.equal(await found.frame.locator("html").getAttribute("dir"),"rtl");
    await found.frame.evaluate(()=>document.fonts.ready);
    assert(await found.frame.evaluate(()=>document.fonts.check("16px Vazirmatn")),"Installed font must load inside the actual editor webview");
    const output=process.env.PAASTACODE_VSCODE_OUTPUT||path.resolve(__dirname,"../.artifacts");
    await found.page.screenshot({path:path.join(output,"vscode.png")});
    require("node:fs").writeFileSync(path.join(output,"vscode-result.json"),JSON.stringify({installed:!!process.env.PAASTACODE_INSTALLED_ROOT,version:extension.packageJSON.version,rtl:true,font:true,platform:process.platform,arch:process.arch}));
    require("node:fs").writeFileSync(path.join(output,"vscode-result.txt"),"PaastaCode actual VS Code iframe smoke passed");
  }finally{await browser.close();}
};
