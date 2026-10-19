import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
process.env.PAASTACODE_HOME=resolve('.artifacts/background-activity-'+process.pid);
const {startServer}=await import('../src/server.mjs');
const sessions=[{id:'ses_waiting',title:'گفت‌وگوی منتظر تأیید',directory:process.cwd()},{id:'ses_new',title:'گفت‌وگوی جدید',directory:process.cwd()}];
let waiting=true,replies=0;
const account={origin:'https://synthetic.test',credentials:{token:'synthetic',aiKey:'synthetic'},async context(){return {account:{id:'user',tenantId:'tenant',name:'حساب آزمایشی'},models:[{id:'synthetic',supported_parameters:['tools'],input_toman_per_million:10,output_toman_per_million:30}]};}};
const runtime={url:null,async start(){this.url='http://127.0.0.1:1';},async stop(){this.url=null;},async call(path,options={}){
  if(path==='/session')return sessions;
  if(path==='/session/status')return waiting?{ses_waiting:{type:'busy'}}:{};
  if(path==='/permission')return waiting?[{id:'per_synthetic',sessionID:'ses_waiting',permission:'bash',patterns:['echo synthetic']}]:[];
  if(path==='/permission/per_synthetic/reply'){replies++;waiting=false;return {};}
  if(path.endsWith('/message'))return [];
  return sessions.find(s=>path==='/session/'+s.id)||{};
}};
const app=await startServer({account,runtime}),browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto(app.launchUrl);await page.locator('[data-session="ses_new"]').click();
  await page.locator('#background-activity button').waitFor();assert.equal(replies,0);
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
  waiting=false;await page.locator('#permissions .permission').waitFor({state:'detached'});
  await page.waitForFunction(()=>!document.querySelector('.session-activity'));
  assert.deepEqual(errors,[]);console.log('Background approval is visible at desktop and narrow widths, navigates without consent, and clears after completion.');
}finally{await browser.close();await app.close();}
