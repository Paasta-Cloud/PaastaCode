import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat,symlink,chmod} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {createRequire,Module} from 'node:module';
const require=createRequire(import.meta.url),vault=require('../coding-credentials.cjs'),profiles=require('../coding-provider-config.cjs');
const file=require.resolve('../coding-tools.cjs'),native=new Module(file);native.filename=file;native.paths=Module._nodeModulePaths(path.dirname(file));native.require=id=>id==='vscode'?{}:createRequire(file)(id);native._compile(await readFile(file,'utf8'),file);
const {parseLink,environment,configure}=native.exports;
const scratch=await mkdtemp(path.join(os.tmpdir(),'paasta-tools-')),base=path.join(scratch,'private'),workspace=path.join(scratch,'workspace'),account='a'.repeat(64),foreign='b'.repeat(64),key='paasta_ai_'+'x'.repeat(43),before={...process.env};
const link=(query={})=>({scheme:'vscode',authority:'paasta-cloud.paasta',path:'/tools',fragment:'',query:new URLSearchParams({account,tool:'codex',provider:'paasta',project:'demo',...query}).toString()});
try{
 await mkdir(workspace);await vault.directory(base,account);
 assert.equal(parseLink(link()).project,'demo');assert.equal(parseLink(link({tool:'paasta'})).tool,'paasta');
 for(const item of [link({account:foreign+'bad'}),link({tool:'shell'}),link({provider:'unknown'}),link({project:'../other'}),{...link(),authority:'other'},{...link(),scheme:'http'},{...link(),fragment:'token'},link({command:'rm -rf /'}),{...link(),query:link().query+'&account='+foreign}])assert.throws(()=>parseLink(item));
 const env=environment({PATH:'/bin',ANTHROPIC_AUTH_TOKEN:'personal',OPENAI_API_KEY:'personal',PAASTA_API_KEY:'console',PAASTA_RUNTIME_TOKEN:'console',NODE_OPTIONS:'--require evil'},'paasta',path.join(base,account));
 for(const name of ['ANTHROPIC_AUTH_TOKEN','OPENAI_API_KEY','PAASTA_API_KEY','PAASTA_RUNTIME_TOKEN','NODE_OPTIONS'])assert(!(name in env));
 assert.equal(env.CODEX_HOME,path.join(base,account,'codex'));
 assert.equal(environment({},'personal',base,scratch).CODEX_HOME,path.join(scratch,'.codex'));
 assert.throws(()=>vault.quoteCommand(['bad\npath']));assert.throws(()=>vault.quoteCommand(['C:/%secret%/node.exe'],'win32'));
 const command=vault.configuration(account,'codex','provider/model','C:/Runtime/node.exe','C:/Helper/credential.cjs');assert(!command.text.includes(key));assert.match(command.text,/\[model_providers\.paasta\.auth\]/);assert(command.text.split(String.fromCharCode(10)).length>10);
 await configure(base,account,'codex','provider/model',key,'C:/Runtime/node.exe');
 assert.equal((await vault.readRecord(base,account,'codex')).key,key);
 const raw=await readFile(path.join(base,account,'codex.credential'));if(process.platform==='win32')assert(!raw.includes(Buffer.from(key)));else assert.equal((await stat(path.join(base,account,'codex.credential'))).mode&0o077,0);
 await assert.rejects(vault.readRecord(base,foreign,'codex').then(value=>{if(!value)throw Error('Missing')}));
 assert.throws(()=>vault.configuration(account,'codex','bad\nmodel','/node','/helper'));
 process.env.CODEX_HOME=path.join(scratch,'user-codex');await mkdir(process.env.CODEX_HOME,{mode:0o700});
 const original='model = "personal-model"\n[features]\nkeep = true\n';const target=path.join(process.env.CODEX_HOME,'config.toml');await writeFile(target,original,{mode:0o600});
 await profiles.activate(base,account,'codex',workspace,'C:/Runtime/node.exe');const applied=await readFile(target,'utf8');assert.match(applied,/profile = "paasta"/);assert.match(applied,/model = "personal-model"/);assert.match(applied,/keep = true/);assert(!applied.includes(key));
 await profiles.activate(base,account,'codex',workspace,'C:/Runtime/node.exe');
 await writeFile(target,applied+'# manual edit\n');await assert.rejects(profiles.restore(base,account,'codex'),/دستی/);assert((await readFile(target,'utf8')).includes('# manual edit'));
 await writeFile(target,applied);await profiles.restore(base,account,'codex');assert.equal(await readFile(target,'utf8'),original);
 assert.throws(()=>profiles.codexProfile('instructions = """text\nlong\n"""\n'));
 assert.match(profiles.codexProfile('profile = "old"\n[x]\na=true'),/^profile = "paasta"\n\[x\]/);
 const claude=profiles.claudeSettings(JSON.stringify({env:{KEEP:'value',ANTHROPIC_API_KEY:'old-secret'},permissions:{keep:true}}),vault.configuration(account,'claude-code','anthropic/claude','/node','/helper').text);
 assert.equal(JSON.parse(claude).env.KEEP,'value');assert.equal(JSON.parse(claude).env.ANTHROPIC_API_KEY,'');assert.equal(JSON.parse(claude).permissions.keep,true);assert(!claude.includes('old-secret'));
 let release;const held=vault.withLock(base,'test-lock',()=>new Promise(resolve=>release=resolve));await new Promise(resolve=>setTimeout(resolve,50));await assert.rejects(vault.withLock(base,'test-lock',async()=>true),/پنجره/);release();await held;
 try{const outside=path.join(scratch,'outside');await mkdir(outside);await symlink(outside,path.join(base,'linked'),'junction');await assert.rejects(vault.directory(path.join(base,'linked'),account),/Linked/);}catch(error){if(error.code!=='EPERM')throw error;}
 const stored=await vault.readRecord(base,account,'codex');await vault.writeRecord(base,account,'codex',{...stored,enabled:false});assert.equal((await vault.readRecord(base,account,'codex')).enabled,false);
 // Browser links cannot switch the signed-in native account or reach a prompt/command first.
 const commands=new Map(),errors=[],mock={commands:{registerCommand:(name,fn)=>{commands.set(name,fn);return {dispose(){}};}},window:{registerUriHandler:()=>({dispose(){}}),showErrorMessage:message=>errors.push(message)}};
 const isolated=new Module(file);isolated.filename=file;isolated.paths=native.paths;isolated.require=id=>id==='vscode'?mock:createRequire(file)(id);isolated._compile(await readFile(file,'utf8'),file);
 isolated.exports.activateTools({subscriptions:[]},{api:async()=>({account:{accountKey:account}}),hosted:()=>false});
 await commands.get('paasta.tools.manage')({account:foreign,tool:'codex',provider:'paasta'});assert.equal(errors.length,1);assert.match(errors[0],/مطابقت/);
 // No project PATH entry or symlinked project executable can become the native tool.
 const launcherFile=require.resolve('../coding-tool-launcher.cjs'),launcher=new Module(launcherFile);launcher.filename=launcherFile;launcher.paths=native.paths;
 let groups='S-1-16-8192';const exec=()=>{};const {promisify}=require('node:util');exec[promisify.custom]=async()=>({stdout:groups});
 launcher.require=id=>id==='node:child_process'?{execFile:exec}:createRequire(launcherFile)(id);launcher._compile(await readFile(launcherFile,'utf8'),launcherFile);
 const bin=path.join(scratch,'bin');await mkdir(bin);const name='codex'+(process.platform==='win32'?'.exe':'');
 await writeFile(path.join(workspace,name),'fixture');await writeFile(path.join(bin,name),'fixture');await chmod(path.join(bin,name),0o700);
 await assert.rejects(launcher.exports.resolveCli('codex',workspace,{PATH:workspace}),/پیدا نشد/);
 assert.equal(await launcher.exports.resolveCli('codex',workspace,{PATH:workspace+path.delimiter+bin}),path.join(bin,name));
 const terminals=[],ui={window:{showWarningMessage:async()=> 'بازکردن CLI',createTerminal:options=>{terminals.push(options);return {show(){}};}}};
 if(process.platform==='win32'||process.getuid?.()!==0){
  await launcher.exports.launchCli(ui,'codex',workspace,{PATH:bin,CODEX_HOME:base});assert.equal(terminals.length,1);
  assert.deepEqual(terminals[0].shellArgs,['--sandbox','read-only','--ask-for-approval','on-request']);assert.equal(terminals[0].shellPath,path.join(bin,name));assert(!JSON.stringify(terminals).includes(key));
 }
 if(process.platform==='win32'){groups='S-1-16-12288';await assert.rejects(launcher.exports.standardUser(),/administrator/);}
 else if(process.getuid?.()===0)await assert.rejects(launcher.exports.standardUser(),/root/);
 console.log('Native tools: constrained URI, environment separation, protected credentials, safe generated config, personal restore, manual-edit rejection, symlink and concurrency guards passed.');
}finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);assert(path.resolve(scratch).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(scratch,{recursive:true,force:true});}
