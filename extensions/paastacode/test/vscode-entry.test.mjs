import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import vm from "node:vm";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('../vscode/package.json',import.meta.url),'utf8'));

test('VS Code exposes a native entry before activation and handles an empty workspace without running code',async()=>{
  const container=manifest.contributes.viewsContainers.activitybar.find(item=>item.id==='paastacode');
  assert(container);assert(existsSync(new URL('../vscode/'+container.icon,import.meta.url)));
  assert(manifest.contributes.views.paastacode.some(view=>view.id==='paastacode.home'));
  assert.equal(manifest.contributes.views.paastacode[0].type,'webview');
  assert(manifest.contributes.menus['editor/title'].some(item=>item.command==='paastacode.open'));
  assert.equal(manifest.capabilities.untrustedWorkspaces.supported,false);
  const commands=new Map(),providers=new Map(),called=[],errors=[],subscriptions=[];
  let spawned=0;
  const vscode={workspace:{isTrusted:true,workspaceFolders:[]},commands:{registerCommand(id,fn){commands.set(id,fn);return {dispose(){}};},async executeCommand(id){called.push(id);}},window:{registerWebviewViewProvider(id,provider){providers.set(id,provider);return {dispose(){}};},showErrorMessage(message){errors.push(message);},createOutputChannel(){return {dispose(){},appendLine(){}};}}};
  const module={exports:{}};
  vm.runInNewContext(readFileSync(new URL('../vscode/extension.cjs',import.meta.url),'utf8'),{module,__dirname:new URL('../vscode',import.meta.url).pathname,process:{env:{PAASTACODE_VSCODE_SMOKE:'1'}},require:id=>id==='vscode'?vscode:id==='./native-workbench.cjs'?{attachNative(){}}:id==='node:child_process'?{spawn(){spawned++;}}:require(id),setInterval:()=>({unref(){}}),clearInterval(){}});
  module.exports.activate({subscriptions});
  assert(providers.has('paastacode.home'));assert.equal(typeof providers.get('paastacode.home').resolveWebviewView,'function');
  await commands.get('paastacode.open')();assert.deepEqual(called,['workbench.action.files.openFolder']);assert.equal(spawned,0);
  vscode.workspace.isTrusted=false;await commands.get('paastacode.open')();assert.equal(called.length,1);assert.equal(errors.length,1);assert.equal(spawned,0);
});
