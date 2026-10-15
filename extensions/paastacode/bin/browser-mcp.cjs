#!/usr/bin/env node
// Microsoft Playwright MCP runs in a separate, temporary profile; it never attaches to personal tabs.
const path=require('node:path');
const {existsSync}=require('node:fs');
const bundled=path.join(__dirname,'../vendor/browser/@playwright/mcp');
const root=existsSync(path.join(bundled,'package.json'))?bundled:path.dirname(require.resolve('@playwright/mcp/package.json'));
const from=require('node:module').createRequire(path.join(root,'package.json'));
const chromium=from('playwright-core').chromium.executablePath();
const args=process.argv.includes('--install')?['install-browser','chromium']:['--isolated','--caps','vision','--output-max-size','52428800','--output-dir',path.join(require('node:os').tmpdir(),'paastacode-browser-'+process.pid)];
if(!process.argv.includes('--install')){
  if(process.env.PAASTACODE_BROWSER_EXECUTABLE)args.push('--executable-path',process.env.PAASTACODE_BROWSER_EXECUTABLE);
  else if(existsSync(chromium))args.push('--executable-path',chromium);
  else {const system=['/usr/bin/chromium','/usr/bin/chromium-browser'].find(file=>existsSync(file));if(process.platform==='linux'&&system)args.push('--executable-path',system);else args.push('--browser',process.platform==='win32'?'msedge':'chrome');}
}
if(process.env.PAASTACODE_CLOUD_DATA&&!process.argv.includes('--install'))args.push('--headless');
process.argv=[process.execPath,path.join(root,'cli.js'),...args];
require(path.join(root,'cli.js'));
