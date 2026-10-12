const assert=require("node:assert/strict");
const path=require("node:path");
const vscode=require("vscode");
exports.run=async()=>{
  const {chromium}=require("playwright");
  const browser=await chromium.connectOverCDP("http://127.0.0.1:9337");
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
    await found.page.screenshot({path:path.resolve(__dirname,"../.artifacts/vscode.png")});
    require("node:fs").writeFileSync(path.resolve(__dirname,"../.artifacts/vscode-result.txt"),"PaastaCode actual VS Code iframe smoke passed");
  }finally{await browser.close();}
};
