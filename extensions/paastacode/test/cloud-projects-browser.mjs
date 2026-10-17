import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
process.env.PAASTACODE_HOME=resolve('.artifacts/cloud-project-browser-'+process.pid);
const {startServer}=await import('../src/server.mjs');
const app=await startServer({account:{credentials:null},runtime:{stop:async()=>{}}}),browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
const id='00000000-0000-4000-8000-000000000001',projectId='00000000-0000-4000-8000-000000000002',account={id,tenantId:id,name:'حساب آزمایشی',balanceToman:1000};
const projects=[{id:'default',name:'وب‌سایت پاستا'},{id:projectId,name:'داشبورد مشتریان'}];let active='default',busy=false,loseAck=false,created=0;
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{window.paastacodeDesktop={chooseWorkspace:async()=>false,update:async()=>({enabled:false}),onUpdate:()=>{}};});
  await page.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname,json=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
    assert.equal(req.headers().authorization,'Bearer '+app.capability);
    if(path==='/api/remote/workspaces')return json({account,workspaces:[{id,name:'فضای کار تیم',status:'ready',current_period_end:new Date(Date.now()+86400000).toISOString()}]});
    if(path.endsWith('/projects/select')){if(busy)return json({error:'پروژهٔ فعلی هنوز در حال کار است.'},409);active=req.postDataJSON().id;return json({projects,activeProject:active});}
    if(path.endsWith('/projects')){if(req.method()==='POST'){const next=req.postDataJSON();if(!projects.find(p=>p.id===next.id)){projects.push(next);created++;}if(loseAck){loseAck=false;return route.abort();}}return json({projects,activeProject:active});}
    if(path.includes('/runtime/')){assert.equal(req.headers()['x-paastacode-owner'],id+':'+id);if(req.headers()['x-paastacode-project']!==active)return json({error:'پروژهٔ دیگری انتخاب شده است.',projectChanged:true},409);}
    if(path.endsWith('/state'))return json({connected:true,configured:path.includes('/runtime/'),account,models:[{id:'synthetic',name:'مدل آزمایشی',input_toman_per_million:1,output_toman_per_million:1}],features:{integrations:true,promptAttachments:true},workspace:'local'});
    if(path.endsWith('/integrations'))return json({cloud:true,catalog:{mcp:[],skills:[]},servers:[],skills:[],browser:{available:false,enabled:false,status:'unavailable'}});
    return json(path.endsWith('/status')?{}:[]);
  });
  await page.goto(app.url+'/?cloud=1#cap='+app.capability);
  await page.getByRole('button',{name:'فضای کار تیم',exact:true}).click({timeout:5000}).catch(async error=>{console.log('UI errors',errors,'dialog',await page.locator('dialog[open]').allTextContents());throw error;});
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await mkdir('.artifacts',{recursive:true});await page.screenshot({path:'.artifacts/cloud-projects-'+width+'.png'});}
  busy=true;await page.getByRole('button',{name:'داشبورد مشتریان',exact:true}).click();await page.getByText('پروژهٔ فعلی هنوز در حال کار است.',{exact:true}).waitFor();assert.equal(active,'default');busy=false;
  await page.getByRole('button',{name:'داشبورد مشتریان',exact:true}).click();await page.locator('#composer').waitFor({state:'visible'});assert.match(await page.locator('#workspace-name').textContent(),/داشبورد مشتریان/);
  await page.setViewportSize({width:1440,height:900});await page.locator('#integrations-open').click();await page.locator('[data-tab=browser]').click();assert.equal(await page.locator('[data-browser-toggle]').isDisabled(),true);await page.locator('.integrations-dialog').press('Escape');
  await page.reload();await page.locator('#composer').waitFor({state:'visible'});assert.match(await page.locator('#workspace-name').textContent(),/داشبورد مشتریان/);
  await page.locator('#hosted-open').click();await page.getByRole('button',{name:'فضای کار تیم',exact:true}).click();await page.locator('#cloud-project-name').fill('پروژهٔ سوم');loseAck=true;await page.getByRole('button',{name:'ساخت و باز کردن',exact:true}).click();await page.getByRole('button',{name:'ساخت و باز کردن',exact:true}).waitFor();await page.getByRole('button',{name:'ساخت و باز کردن',exact:true}).click();await page.locator('#composer').waitFor({state:'visible'});assert.equal(created,1);assert.equal(projects.length,3);await page.waitForFunction(()=>document.querySelector('#workspace-name').textContent.includes('پروژهٔ سوم'));
  await page.locator('#prompt').fill('پیش‌نویس حفظ شود');await page.locator('#attachment-files').setInputFiles({name:'draft.txt',mimeType:'text/plain',buffer:Buffer.from('synthetic attachment')});await page.locator('.attachment').waitFor();const previous=active;active='default';await page.locator('#integrations-open').click();await page.getByRole('button',{name:'فضای کار تیم',exact:true}).waitFor();assert.equal(await page.locator('#prompt').inputValue(),'پیش‌نویس حفظ شود');assert.equal(await page.locator('.attachment').count(),1);
  await page.getByRole('button',{name:'فضای کار تیم',exact:true}).click();assert.match(await page.locator('.cloud-project-option[aria-current=true]').textContent(),/وب‌سایت پاستا/);await Promise.all([page.waitForEvent('domcontentloaded'),page.getByRole('button',{name:'پروژهٔ سوم',exact:true}).click()]);await page.locator('#composer').waitFor({state:'visible'});assert.equal(active,previous);assert.equal(await page.locator('#prompt').inputValue(),'پیش‌نویس حفظ شود');assert.equal(await page.locator('.attachment').count(),1);
  await page.goto(app.url+'/?local=1#cap='+app.capability);await page.waitForFunction(()=>sessionStorage.getItem('paastacode-desktop-cloud')===null);assert.equal(await page.locator('dialog[open]').count(),0);
  assert.deepEqual(errors,[]);console.log('Desktop cloud browser: no local folder, project picker at 1440/390/320, busy denial, project headers, persisted selection, retry identity and cloud tool policy passed');
}finally{await browser.close();await app.close();}
