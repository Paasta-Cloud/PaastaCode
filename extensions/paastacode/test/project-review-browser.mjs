import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,realpath,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
process.env.PAASTACODE_HOME=resolve('.artifacts/knowledge-review-'+process.pid);
const {startServer}=await import('../src/server.mjs'),{WorkspaceGit}=await import('../src/git.mjs');
const workspace=await realpath(await mkdtemp(join(tmpdir(),'paastacode-review-browser-'))),git=new WorkspaceGit(workspace);
await git.action({action:'init'});await git.call(['config','user.name','Synthetic tester']);await git.call(['config','user.email','synthetic@example.test']);
await writeFile(join(workspace,'app.js'),'const value = 1;\n');await git.action({action:'commit',message:'Fixture base',paths:['app.js']});
await writeFile(join(workspace,'app.js'),'const value = 2;\n');await git.call(['add','--','app.js']);await writeFile(join(workspace,'app.js'),'const value = 3;\n');
const session={id:'ses_review',title:'بازبینی فرم ورود',directory:workspace};
const tool=(command,exit,output)=>({id:command,type:'tool',tool:'bash',state:{status:'completed',input:{command},metadata:exit===null?{}:{exit},output}});
const messages=[{info:{id:'user1',role:'user'},parts:[{type:'text',text:'فرم ورود را بررسی کن'}]},{info:{id:'assistant1',role:'assistant'},parts:[tool('npm test',0,'Synthetic tests passed'),tool('npm run build',1,'Synthetic build failed'),tool('pytest',null,'Synthetic output without exit status'),{type:'text',text:'نتیجهٔ بررسی آماده است.'}]}];
let configured;
const account={origin:'https://synthetic.test',credentials:{token:'synthetic',aiKey:'synthetic'},async context(){return {account:{id:'user',tenantId:'tenant'},models:[{id:'paasta/deepseek-v4-flash',supported_parameters:['tools'],input_toman_per_million:1,output_toman_per_million:1}]};},async request(){return {};}};
const runtime={url:null,async start(config){configured=config;this.url='http://127.0.0.1:1';},async stop(){this.url=null;},async call(path,options={}){if(path==='/session')return options.method==='POST'?session:[session];if(path==='/session/status')return {};if(path==='/permission')return [];if(path.endsWith('/message'))return messages;return session;}};
const app=await startServer({workspace,account,runtime}),browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(app.launchUrl);await page.locator('#knowledge-open:not([disabled])').waitFor();
  await page.locator('#knowledge-open').click();await page.locator('#knowledge-content').fill('## قراردادهای پروژه\nاز تست‌های متمرکز شروع کن.\n<script>throw new Error("must stay text")</script>');
  await page.getByRole('button',{name:'ذخیرهٔ دانش پروژه',exact:true}).click();await page.locator('#knowledge-status').filter({hasText:'ذخیره شد'}).waitFor();
  assert(configured.instructions.length===1);await page.getByRole('button',{name:'بستن',exact:true}).click();
  await page.reload();await page.locator('#knowledge-open:not([disabled])').waitFor();await page.locator('#knowledge-open').click();
  await page.waitForFunction(()=>document.querySelector('#knowledge-content').value.includes('قراردادهای پروژه'));
  const content=await page.locator('#knowledge-content').inputValue();assert(content.includes('<script>'));
  let releaseLoad;const delayedLoad=new Promise(done=>{releaseLoad=done;});await page.route('**/api/knowledge',async route=>{if(route.request().method()==='GET')await delayedLoad;await route.continue();});
  await page.getByRole('button',{name:'دریافت نسخهٔ تازه',exact:true}).click();await page.locator('#knowledge-content').fill('متن تایپ‌شده هنگام دریافت');releaseLoad();await page.waitForFunction(()=>!document.querySelector('#knowledge-status').textContent.includes('در حال دریافت'));assert.equal(await page.locator('#knowledge-content').inputValue(),'متن تایپ‌شده هنگام دریافت');await page.unroute('**/api/knowledge');await page.locator('#knowledge-content').fill(content);
  const headers={Authorization:'Bearer '+app.capability,'Content-Type':'application/json'},snapshot=await (await fetch(app.url+'/api/knowledge',{headers})).json();
  await fetch(app.url+'/api/knowledge',{method:'POST',headers,body:JSON.stringify({content:'ویرایش از پنجرهٔ دیگر',revision:snapshot.revision})});
  await page.locator('#knowledge-content').fill('متن ذخیره‌نشدهٔ من');await page.getByRole('button',{name:'ذخیرهٔ دانش پروژه',exact:true}).click();
  await page.locator('#knowledge-status').filter({hasText:'پنجرهٔ دیگری'}).waitFor();assert.equal(await page.locator('#knowledge-content').inputValue(),'متن ذخیره‌نشدهٔ من');
  await page.getByRole('button',{name:'دریافت نسخهٔ تازه',exact:true}).click();await page.locator('#knowledge-status').filter({hasText:'نسخهٔ تازه دریافت شد'}).waitFor();
  assert.equal(await page.locator('#knowledge-content').inputValue(),'متن ذخیره‌نشدهٔ من');assert(await page.locator('.knowledge-dialog details pre').textContent().then(t=>t.includes('پنجرهٔ دیگر')));
  await page.locator('#knowledge-content').fill('## ساختار پروژه\nفرم ورود در app.js قرار دارد.\n\n## بررسی‌ها\nپیش از کامیت، npm test و npm run build را اجرا کنید.');await page.getByRole('button',{name:'ذخیرهٔ دانش پروژه',exact:true}).click();await page.locator('#knowledge-status').filter({hasText:'ذخیره شد'}).waitFor();
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:width===320?640:900});assert.equal(await page.locator('.knowledge-dialog').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);await mkdir('.artifacts',{recursive:true});await page.screenshot({path:'.artifacts/knowledge-'+width+'.png'});}
  await page.locator('.knowledge-dialog').press('Escape');await page.setViewportSize({width:1440,height:1000});
  await page.locator('#sessions button').filter({hasText:'بازبینی فرم ورود'}).click();await page.locator('#run-checks').getByText('npm test',{exact:true}).waitFor();assert.equal(await page.locator('#messages .tool[data-status=error]').count(),1);
  assert.equal(await page.locator('#run-checks [data-outcome=passed]').count(),1);assert.equal(await page.locator('#run-checks [data-outcome=failed]').count(),1);assert.equal(await page.locator('#run-checks [data-outcome=unknown]').count(),1);
  await page.locator('#run-checks details').nth(1).locator('summary').click();assert(await page.locator('#run-checks').textContent().then(t=>t.includes('Synthetic build failed')));
  await page.screenshot({path:'.artifacts/project-verification.png'});
  await page.locator('#recap-review').click();await page.locator('#git-files button').filter({hasText:'app.js'}).click();await page.locator('#git-diff').filter({hasText:'const value = 3'}).waitFor();
  const diff=await page.locator('#git-diff').textContent();assert(diff.includes('const value = 2'));assert(diff.includes('آمادهٔ کامیت'));assert(await page.locator('#git-diff .diff-added').count()>0);assert(await page.locator('#git-diff .diff-removed').count()>0);
  await page.screenshot({path:'.artifacts/project-diff.png'});
  for(const width of [390,320]){await page.setViewportSize({width,height:720});assert.equal(await page.locator('#git-dialog').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);await page.screenshot({path:'.artifacts/project-diff-'+width+'.png'});}
  assert.deepEqual(errors,[]);console.log('Project knowledge, conflicting writes, verification evidence and staged/worktree diffs pass desktop/mobile browser checks.');
}finally{await browser.close();await app.close();assert(workspace.startsWith(join(await realpath(tmpdir()),'paastacode-review-browser-')));await rm(workspace,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
