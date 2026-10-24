import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
process.env.PAASTACODE_HOME=resolve('.artifacts/background-activity-'+process.pid);
const {startServer}=await import('../src/server.mjs');
const sessions=[{id:'ses_waiting',title:'گفت‌وگوی منتظر تأیید',directory:process.cwd()},{id:'ses_new',title:'گفت‌وگوی جدید',directory:process.cwd()}];
let waiting=true,replies=0,messages=[];
const account={origin:'https://synthetic.test',credentials:{token:'synthetic',aiKey:'synthetic'},async request(){return {active:true,plan:'حرفه‌ای',endsAt:'2026-12-01',quotas:{week:{remainingPercent:80,resetAt:'2026-11-01'}}};},async context(){return {features:{codingUsage:true},account:{id:'user',tenantId:'tenant',name:'حساب آزمایشی'},models:[{id:'synthetic',supported_parameters:['tools'],input_toman_per_million:10,output_toman_per_million:30}]};}};
const runtime={url:null,async start(){this.url='http://127.0.0.1:1';},async stop(){this.url=null;},async call(path,options={}){
  if(path==='/session')return sessions;
  if(path==='/session/status')return waiting?{ses_waiting:{type:'busy'}}:{};
  if(path==='/permission')return waiting?[{id:'per_synthetic',sessionID:'ses_waiting',permission:'bash',patterns:['echo synthetic']}]:[];
  if(path==='/permission/per_synthetic/reply'){replies++;waiting=false;return {};}
  if(path.endsWith('/message'))return path.includes('ses_waiting')?messages:[];
  return sessions.find(s=>path==='/session/'+s.id)||{};
}};
const app=await startServer({account,runtime}),browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto(app.launchUrl);await page.locator('[data-task=ses_new]').waitFor();
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:950});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'.artifacts/project-home-'+width+'.png'});}
  await page.setViewportSize({width:1440,height:950});await page.locator('[data-task=ses_new]').click();
  await page.locator('#background-activity button').waitFor();assert.equal(replies,0);
  await page.locator('[data-filter=waiting]').click();
  assert(await page.locator('[data-session=ses_waiting]').isVisible());assert.equal(await page.locator('[data-session=ses_new]').isVisible(),false);
  await page.locator('#session-search').fill('پیدا نمی‌شود');assert(await page.locator('#session-no-results').isVisible());
  await page.locator('#session-search').fill('');await page.locator('[data-filter=all]').click();
  assert.equal(await page.locator('[data-session=ses_new]').getAttribute('aria-current'),'true');
  assert.match(await page.locator('#background-activity').innerText(),/گفت‌وگوی منتظر تأیید/);
  await page.locator('#background-activity button').focus();
  await page.waitForTimeout(2200);
  assert(await page.locator('#background-activity button').evaluate(b=>document.activeElement===b),'Polling preserves keyboard focus');
  assert.match(await page.locator('[data-session="ses_waiting"]').innerText(),/منتظر تأیید/);
  assert.match(await page.locator('#thread-state').innerText(),/آماده/);
  await mkdir('.artifacts',{recursive:true});
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:950});assert(await page.locator('#background-activity button').isVisible());
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:'.artifacts/background-activity-'+width+'.png'});
  }
  await page.locator('#background-activity button').click();
  await page.locator('#permissions .permission').waitFor();assert.equal(replies,0,'Navigation must never grant permission');
  assert.equal(await page.locator('#background-activity').isVisible(),false);
  messages=[{info:{id:'u1',role:'user'},parts:[{type:'text',text:'بررسی ورود'}]},{info:{id:'a1',role:'assistant'},parts:[{id:'tool_error',type:'tool',tool:'bash',state:{status:'error',input:{command:'npm test'},error:'یک تست ناموفق بود.'}}]}];
  waiting=false;await page.locator('#permissions .permission').waitFor({state:'detached'});
  await page.waitForFunction(()=>!document.querySelector('.session-activity'));
  await page.locator('#run-recap').waitFor();assert.match(await page.locator('#recap-title').innerText(),/نیاز به بررسی/);
  await page.locator('#recap-output').click();assert(await page.locator('.tool').evaluate(node=>node.open));
  assert(await page.locator('.tool summary').evaluate(node=>node===document.activeElement));
  await page.route('**/api/git',route=>route.fulfill({json:{repository:true,branch:'main',files:[]}}));
  messages.push({info:{id:'u2',role:'user'},parts:[{type:'text',text:'اجرای دوباره'}]},{info:{id:'a2',role:'assistant'},parts:[{id:'tool_success',type:'tool',tool:'bash',state:{status:'completed',input:{command:'npm test'},output:'موفق'}}]});
  await page.waitForFunction(()=>document.querySelector('#recap-title').textContent==='خلاصهٔ آخرین اجرا');await page.locator('#recap-output').click();
  assert(await page.locator('[data-message=a2] summary').evaluate(node=>node===document.activeElement),'Recap output stays in the latest request, even when an older request failed');
  await page.locator('#recap-review').click();await page.locator('#git-dialog').waitFor();await page.locator('#git-close').click();
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:950});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'.artifacts/task-recap-'+width+'.png'});}
  await page.setViewportSize({width:1440,height:950});await page.locator('[data-session=ses_new]').click();assert.equal(await page.locator('#run-recap').isVisible(),false);
  await page.locator('#project-home').click();await page.locator('[data-task=ses_waiting]').click();await page.locator('#run-recap').waitFor();assert.equal(replies,0);
  await page.locator('#project-home').click();await page.waitForFunction(()=>!document.querySelector('#project-home').disabled);await page.locator('#project-task-list button').first().waitFor();
  for(const [width,height] of [[1280,720],[1280,560],[390,720],[320,640]]){
    await page.setViewportSize({width,height});
    await page.waitForFunction(()=>document.querySelector('#conversation').scrollTop===0);
    assert.equal(await page.locator('#follow-output').isVisible(),false,'Project overview is not a streaming transcript');
    if(width===1280&&height===720){const task=await page.locator('#project-task-list button').first().boundingBox(),viewport=await page.locator('#conversation').boundingBox();assert(task.y>=viewport.y&&task.y+task.height<=viewport.y+viewport.height,'Recent work appears in the first laptop viewport');}
    if(width<640)await page.locator('#menu').click();
    await page.locator('#sessions').scrollIntoViewIfNeeded();
    assert((await page.locator('#sessions').boundingBox()).height>=144,'Short windows retain usable task-list height beside an active subscription');
    await page.locator('#logout').scrollIntoViewIfNeeded();
    const logout=await page.locator('#logout').boundingBox();assert(logout.y>=0&&logout.y+logout.height<=height,'Account actions remain reachable within the rail');
    await page.locator('#sessions').scrollIntoViewIfNeeded();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:'.artifacts/short-window-'+width+'x'+height+'.png'});
    if(width<640)await page.locator('#rail-close').click();
  }
  assert.deepEqual(errors,[]);console.log('Background approval is visible at desktop and narrow widths, navigates without consent, and clears after completion.');
}finally{await browser.close();await app.close();}
