import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
process.env.PAASTACODE_HOME=resolve('.artifacts/model-presets-'+process.pid);
const {startServer}=await import('../src/server.mjs');
const model=(id,input,output)=>({id,name:id,supported_parameters:['tools'],input_toman_per_million:input,output_toman_per_million:output});
let catalogue=[model('paasta/qwen3.8-27b',43200,160000),model('paasta/deepseek-v4-flash',26800,53280),model('paasta/gemma-4-31b',43520,119680),model('anthropic/claude-opus',1000000,5000000)];
const prompts=[],session={id:'ses_economy',title:'بررسی ترکیب مدل‌ها',directory:process.cwd()};
const account={origin:'https://synthetic.test',credentials:{token:'synthetic',aiKey:'synthetic'},async context(){return {account:{id:'user',tenantId:'tenant'},models:catalogue};}};
const runtime={url:null,async start(){this.url='http://127.0.0.1:1';},async stop(){this.url=null;},async call(path,options={}){
  if(path==='/session')return options.method==='POST'?session:[session];
  if(path==='/session/status')return {};
  if(path==='/permission'||path.endsWith('/message'))return [];
  if(path.endsWith('/prompt_async')){prompts.push(options.body);return {};}
  return session;
}};
const app=await startServer({account,runtime}),browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.goto(app.launchUrl);
  await page.waitForFunction(()=>document.querySelector('#model').value==='paasta/qwen3.8-27b');
  assert.equal(await page.locator('#execution-model').inputValue(),'paasta/deepseek-v4-flash');
  await page.locator('#model-settings summary').click();
  assert.equal(await page.locator('#model-preset').inputValue(),'iran-balanced');
  await page.locator('#model-preset').selectOption('iran-direct');
  assert.equal(await page.locator('#workflow-phase').inputValue(),'build');
  assert.equal(await page.locator('#model').inputValue(),'paasta/deepseek-v4-flash');
  assert.equal(prompts.length,0);
  await page.locator('#model').selectOption('anthropic/claude-opus');
  assert(await page.locator('#model-cost-warning').isVisible());
  assert.equal(await page.locator('#model-preset').inputValue(),'');
  await page.locator('#model-preset').selectOption('iran-balanced');
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:1000});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    assert(await page.locator('#model-preset').isVisible());
    await page.screenshot({path:'.artifacts/economy-models-'+width+'.png'});
  }
  await page.locator('#model-preset').selectOption('iran-direct');
  await page.locator('#prompt').fill('بررسی ساده');await page.locator('#prompt').press('Enter');
  await page.waitForFunction(()=>document.querySelector('#prompt').value==='');
  assert.equal(prompts.length,1);assert.equal(prompts[0].agent,'build');
  assert.equal(prompts[0].model.modelID,'paasta/deepseek-v4-flash');
  await page.setViewportSize({width:1440,height:1000});await page.reload();await page.locator('[data-session="ses_economy"]').click();
  await page.waitForFunction(()=>document.querySelector('#model').value==='paasta/deepseek-v4-flash');
  assert.equal(await page.locator('#workflow-phase').inputValue(),'build','persisted explicit direct choice survives reopening');
  catalogue=catalogue.filter(m=>m.id!=='paasta/deepseek-v4-flash');
  await page.waitForFunction(()=>document.querySelector('#model').value==='');
  await page.waitForTimeout(6000);
  assert.equal(await page.locator('#model').inputValue(),'','missing explicit model stays unselected across subsequent polls');
  await page.reload();await page.locator('[data-session="ses_economy"]').click();
  await page.waitForFunction(()=>document.querySelector('#model').value==='');
  await page.waitForTimeout(6000);
  assert.equal(await page.locator('#model').inputValue(),'','reopening a saved missing model cannot silently select a replacement');
  catalogue=[];
  await page.waitForFunction(()=>document.querySelector('#model').options.length===0);
  assert.equal(await page.locator('#model').inputValue(),'','empty catalogue removes stale choices');
  assert.equal(prompts.length,1,'refresh cannot dispatch a replacement model');
  assert.deepEqual(errors,[]);
  console.log('Economy presets: shared real broker, domestic defaults, explicit premium hint, direct dispatch, persisted choice and desktop/mobile passed.');
}finally{await browser.close();await app.close();}
