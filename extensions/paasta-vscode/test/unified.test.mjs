import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {assemble} from '../assemble.mjs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const target=await mkdtemp(join(process.env.PAASTA_TEST_TMP||tmpdir(),'paasta-unified-'));
try{
  await assemble(target);
  const manifest=JSON.parse(await readFile(join(target,'package.json'),'utf8'));
  assert.equal(manifest.publisher+'.'+manifest.name,'paasta-cloud.paasta');
  assert.equal(manifest.contributes.viewsContainers.activitybar.length,1);
  assert(manifest.contributes.views.paasta.some(view=>view.id==='paasta.code'));
  for(const [destination,source] of [['extension.js','../../paasta-vscode/extension.js'],['paastacode.cjs','../../paastacode/vscode/extension.cjs'],['native-workbench.cjs','../../paastacode/vscode/native-workbench.cjs'],['media/native.js','../../paastacode/vscode/media/native.js'],['PAASTACODE_LICENSE','../../paastacode/LICENSE']]){
    assert.equal(await readFile(join(target,destination),'utf8'),await readFile(new URL(source,import.meta.url),'utf8'));
  }
  const commands=manifest.contributes.commands.map(value=>value.command);assert.equal(new Set(commands).size,commands.length);
  assert(commands.includes('paasta.deployWorkspace'));assert(commands.includes('paastacode.openEditor'));
  const loader=await readFile(join(target,'paastacode-loader.js'),'utf8');
  for(const approved of [false,true]){
    const calls=[],loaded={exports:{}};
    const vscode={extensions:{getExtension:id=>id==='paasta.paastacode'?{isActive:true}:undefined},commands:{async executeCommand(...args){calls.push(args);}},window:{async showInformationMessage(){return approved?'remove':undefined;},showErrorMessage(){assert.fail('Migration should succeed');}}};
    new Function('require','module','__dirname',loader)(id=>id==='vscode'?vscode:id==='./managed-session'?{}:require(id),loaded,target);
    loaded.exports.activate({subscriptions:[]});await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls.some(call=>call[0]==='workbench.extensions.uninstallExtension'),approved);
    if(approved)assert.deepEqual(calls.at(-1),['workbench.action.reloadWindow']);
  }
  console.log('Unified extension: one identity/container, complete native client bridge, management, compatible commands and MIT notice passed.');
}finally{await rm(target,{recursive:true,force:true});}
