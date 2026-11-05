const fs=require('node:fs/promises'),path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const execute=promisify(execFile);
function inWorkspace(root,file){const relative=path.relative(root,file);return !relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));}
async function standardUser(){
 if(process.platform!=='win32'){if(process.getuid?.()===0)throw Error('ابزار را با کاربر معمولی اجرا کنید؛ اجرای root مجاز نیست.');return;}
 const binary=path.join(process.env.SystemRoot||'C:\\Windows','System32','whoami.exe');
 const result=await execute(binary,['/groups','/fo','csv','/nh'],{windowsHide:true,timeout:5000,maxBuffer:128*1024});
 if(/S-1-16-(12288|16384)|S-1-5-18/.test(result.stdout))throw Error('VS Code را بدون Run as administrator باز کنید.');
}
async function resolveCli(tool,folder,env=process.env){
 if(!['codex','claude-code'].includes(tool))throw Error('ابزار مجاز نیست.');const name=tool==='claude-code'?'claude':'codex';
 const candidates=[];
 for(const directory of (env.PATH||env.Path||'').split(path.delimiter)){
  if(!path.isAbsolute(directory)||inWorkspace(folder,path.resolve(directory)))continue;
  candidates.push(path.join(directory,name+(process.platform==='win32'?'.exe':'')));
  if(process.platform==='win32'&&tool==='codex')for(const vendor of ['vendor','node_modules/@openai/codex-win32-'+process.arch+'/vendor'])candidates.push(path.join(directory,'node_modules/@openai/codex',vendor,process.arch==='arm64'?'aarch64-pc-windows-msvc':'x86_64-pc-windows-msvc','codex/codex.exe'));
 }
 for(const file of candidates)try{const real=await fs.realpath(file),stat=await fs.stat(real);if(stat.isFile()&&!inWorkspace(folder,real)&&(process.platform==='win32'||stat.mode&0o111))return real;}catch{}
 throw Error('نسخهٔ اجرایی رسمی '+name+' پیدا نشد. آن را از راهنمای رسمی ابزار نصب کنید؛ فایل‌های پروژه و wrapperهای cmd اجرا نمی‌شوند.');
}
async function launchCli(vscode,tool,folder,env){
 await standardUser();const executable=await resolveCli(tool,folder,env);
 if(await vscode.window.showWarningMessage('CLI رسمی با مجوز کاربر معمولی در پوشهٔ انتخاب‌شده باز شود؟ فرمان دلخواه از وب دریافت نمی‌شود؛ تأییدهای خود ابزار برقرار می‌مانند.',{modal:true},'بازکردن CLI')!=='بازکردن CLI')return;
 const args=tool==='codex'?['--sandbox','read-only','--ask-for-approval','on-request']:['--permission-mode','default'];
 // Explicit executable + argv; no shell command string, no prompt/credential on argv.
 const terminalEnv={...env};for(const key of Object.keys(process.env))if(!(key in env))terminalEnv[key]=null;
 for(const key of ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','OPENAI_API_KEY','CLAUDE_CODE_OAUTH_TOKEN','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY','PAASTA_API_KEY','PAASTA_RUNTIME_TOKEN','NODE_OPTIONS','NODE_PATH'])if(!(key in env))terminalEnv[key]=null;
 const terminal=vscode.window.createTerminal({name:'Paasta · '+tool,shellPath:executable,shellArgs:args,cwd:folder,env:terminalEnv});terminal.show();return terminal;
}
module.exports={launchCli,resolveCli,inWorkspace,standardUser};
