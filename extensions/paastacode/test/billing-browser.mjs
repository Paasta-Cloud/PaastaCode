import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const owner='00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002';
const artifacts=resolve('.artifacts/billing-browser');await mkdir(artifacts,{recursive:true});
let licensedFont=null;for(const path of [process.env.PAASTACODE_YEKAN_FONT,resolve('web/fonts/YekanBakh.ttf'),resolve('../../public/fonts/yekan-bakh/yekan-bakh-variable.ttf')].filter(Boolean)){try{licensedFont=await readFile(path);break;}catch(error){if(error.code!=='ENOENT')throw error;}}
const files=new Map([['/billing.html','billing.html'],['/billing.js','billing.js'],['/billing.css','billing.css'],['/style.css','style.css'],['/components.js','components.js'],['/brand.png','brand.png'],['/fonts/Vazirmatn.woff2','fonts/Vazirmatn.woff2']]);
const server=createServer(async(req,res)=>{try{let file=files.get(new URL(req.url,'http://example.test').pathname);const yekan=req.url==='/fonts/YekanBakh.ttf';if(!file&&!yekan||yekan&&!licensedFont){res.writeHead(404).end();return;}const data=yekan?licensedFont:await readFile(resolve('web',file));res.setHeader('Content-Type',yekan?'font/ttf':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':file.endsWith('.png')?'image/png':'font/woff2');res.end(data);}catch{res.writeHead(404).end();}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({...(process.platform==='win32'?{channel:'msedge'}:{}),headless:true});
const plan={id:'synthetic-start',name:'بستهٔ آزمایشی <img src=x onerror=alert(1)>',priceToman:900000,periodQuotaToman:1000000,weeklyQuotaToman:250000,models:[{id:'synthetic/planner',professional:true},{id:'synthetic/executor',professional:false}]};
const blank=()=>({account:{id:owner.split(':')[0],tenantId:owner.split(':')[1],name:'حساب آزمایشی',balanceToman:5000000},mode:'payg',preferencesRevision:0,state:'none',saleEnabled:true,paygBudget:{configured:false,limitToman:null,usedToman:0,remainingToman:null,startedAt:null,pendingRequests:0,reviewRequired:false},current:null,upcoming:null,catalogue:[structuredClone(plan)]});
const quota=(limit,used)=>({limitToman:limit,usedToman:used,remainingToman:limit-used,resetAt:new Date(Date.now()+3*86400000).toISOString()});
let status=blank(),posts=[],payments=0,loseAck=false,deny=false,expire=false,quotes=0,failRefresh=false,expiredAuth=false,holdPost=null,refunds=0,abortCancel=false;const receipts=new Map(),cancelQuotes=new Map(),refundReceipts=new Map();
try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/paastacode/subscription',async route=>{
    const request=route.request(),json=(value,code=200)=>route.fulfill({status:code,contentType:'application/json',body:JSON.stringify(value)});
    if(expiredAuth)return json({error:'ورود منقضی شده است.'},401);
    if(failRefresh&&request.method()==='GET')return route.abort('failed');
    if(deny)return json({error:'حساب فعال تغییر کرده است.'},403);
    if(request.method()==='GET'){assert.equal(request.headers()['x-paastacode-owner'],owner);return json(status);}
    assert.equal(request.headers()['x-paastacode-owner'],owner);assert.equal(request.headers().origin,origin);const body=request.postDataJSON();posts.push(body);
    if(holdPost)await holdPost;
    if(body.action==='cancelQuote'){const period=status.upcoming;assert.equal(period.id,body.id);quotes++;const value={id:period.id,token:'opaque-cancel-'+quotes,name:period.plan.name,refundToman:period.plan.priceToman,startsAt:period.startsAt,endsAt:period.endsAt,expiresAt:new Date(Date.now()+(expire?-1000:300000)).toISOString()};cancelQuotes.set(value.token,value);return json(value);}
    if(body.action==='cancel'){
      if(abortCancel){abortCancel=false;return route.abort('failed');}
      const quote=cancelQuotes.get(body.token);assert(quote);
      if(!refundReceipts.has(quote.id)){refunds++;status.account.balanceToman+=quote.refundToman;status.lastCancellation={id:quote.id,refundToman:quote.refundToman,startsAt:quote.startsAt,refundedAt:new Date().toISOString()};status.upcoming=null;refundReceipts.set(quote.id,status.lastCancellation);}
      if(loseAck){loseAck=false;return route.abort('failed');}return json(refundReceipts.get(quote.id));
    }
    if(body.action==='quote'){quotes++;return json({id:'00000000-0000-4000-8000-'+String(quotes+10).padStart(12,'0'),token:'opaque-synthetic-'+quotes,name:plan.name,priceToman:body.discountCode==='synthetic-discount'?810000:plan.priceToman,discountToman:body.discountCode==='synthetic-discount'?90000:0,periodQuotaToman:plan.periodQuotaToman,weeklyQuotaToman:plan.weeklyQuotaToman,startsAt:new Date().toISOString(),endsAt:new Date(Date.now()+30*86400000).toISOString(),expiresAt:new Date(Date.now()+(expire?-1000:300000)).toISOString()});}
    if(body.action==='preferences'){
      if(body.revision!==status.preferencesRevision)return json({error:'تنظیمات تغییر کرده است؛ تازه‌سازی کنید.'},409);
      status.mode=body.mode;status.preferencesRevision++;status.paygResumeAt=body.untilReset?status.current.quotas.week.resetAt:null;if(body.mode==='payg')status.paygBudget={...status.paygBudget,configured:true,limitToman:body.limitToman,usedToman:1000,remainingToman:body.limitToman-1000,startedAt:new Date().toISOString()};return json({mode:status.mode});
    }
    assert.equal(body.action,'buy');if(!receipts.has(body.token)){payments++;receipts.set(body.token,true);status.current={id:'00000000-0000-4000-8000-'+String(Number(body.token.split('-').at(-1))+10).padStart(12,'0'),plan,startsAt:new Date().toISOString(),endsAt:new Date(Date.now()+30*86400000).toISOString(),quotas:{period:quota(1000000,100000),week:quota(250000,10000),burst:quota(50000,1000),professional:quota(80000,1000)},pendingRequests:2};status.mode='subscription';status.state='active';}
    if(loseAck){loseAck=false;return route.abort('failed');}return json({existing:true,id:status.current.id});
  });
  const open=()=>page.goto(origin+'/billing.html#owner='+encodeURIComponent(owner));
  await open();await page.locator('#billing-content').waitFor({state:'visible'});await page.evaluate(()=>document.fonts.ready);assert(await page.evaluate(font=>document.fonts.check('16px '+font),licensedFont?'YekanBakh':'Vazirmatn'));
  assert.equal(await page.locator('#billing-plans img').count(),0,'API names are text, never injected HTML');
  failRefresh=true;await page.locator('#billing-refresh').click();await page.getByText(/اطلاعات نمایش‌داده‌شده قدیمی است/).waitFor();assert(await page.locator('#wallet-submit').isDisabled());assert(await page.locator('#billing-plans button').isDisabled());failRefresh=false;
  await page.locator('#billing-refresh').click();await page.waitForFunction(()=>!document.getElementById('wallet-submit').disabled);
  await page.locator('#billing-pause').click();await page.evaluate(()=>{window.savedStorage=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new Error('synthetic storage failure');};});await page.locator('#confirm-submit').click();await page.getByText(/ذخیرهٔ تأیید در مرورگر انجام نشد/).waitFor();assert.equal(posts.length,0,'storage failure must not send a mutation');await page.locator('#confirm-cancel').click();await page.evaluate(()=>{Storage.prototype.setItem=window.savedStorage;});assert(await page.locator('#wallet-submit').isEnabled(),'unsent storage failure permits a fresh choice');
  await page.locator('#wallet-limit').fill('۵۰٬۰۰۰');await page.locator('#wallet-submit').click();assert.equal(posts.length,0,'a review dialog does not authorize spending');await page.locator('#confirm-submit').click();await page.locator('#billing-confirm').waitFor({state:'hidden'});
  assert.deepEqual(posts[0],{action:'preferences',mode:'payg',revision:0,limitToman:50000});
  await page.locator('#billing-pause').click();status.preferencesRevision++;let releasePost;holdPost=new Promise(done=>{releasePost=done;});await page.locator('#confirm-submit').click();await page.waitForFunction(()=>document.getElementById('billing-confirm').dataset.busy==='true');await page.mouse.click(2,2);assert(await page.locator('#billing-confirm').isVisible(),'busy backdrop cannot dismiss the pending operation');releasePost();holdPost=null;await page.locator('#billing-confirm').waitFor({state:'hidden'});assert.equal(status.mode,'payg','stale dialog cannot overwrite a newer preference');
  await page.locator('#discount-code').fill('synthetic-discount');await page.locator('#billing-plans button').click();assert.equal(posts.at(-1).discountCode,'synthetic-discount');await page.locator('#billing-confirm').waitFor({state:'visible'});assert((await page.locator('#confirm-facts').innerText()).includes('۸۱۰٬۰۰۰'));loseAck=true;await page.locator('#confirm-submit').click();await page.getByText('پاسخ قطعی دریافت نشد. برای بررسی، همین درخواست را دوباره ارسال کنید.').waitFor();const token=posts.at(-1).token;
  await page.locator('#confirm-submit').click();await page.locator('#billing-confirm').waitFor({state:'hidden'});assert.equal(posts.at(-1).token,token);assert.equal(payments,1,'a lost acknowledgement retries the same purchase');
  plan.name='بستهٔ شروع آزمایشی';status.catalogue.forEach(p=>p.name=plan.name);await page.locator('#billing-refresh').click();await page.waitForFunction(()=>document.getElementById('subscription-detail').textContent.includes('بستهٔ شروع آزمایشی'));
  assert((await page.locator('#subscription-quotas').innerText()).includes('٪'));assert(!(await page.locator('#subscription-quotas').innerText()).includes('تومان'),'subscription allowance is presented as a percentage');
  await page.locator('#wallet-resume').check();await page.locator('#wallet-submit').click();assert((await page.locator('#confirm-terms').innerText()).includes('در بازنشانی سهمیه'));await page.locator('#confirm-cancel').click();
  const activeId=status.current.id,future=id=>({id:'00000000-0000-4000-8000-'+String(id).padStart(12,'0'),plan:structuredClone(plan),startsAt:new Date(Date.now()+30*86400000).toISOString(),endsAt:new Date(Date.now()+60*86400000).toISOString()});
  status.upcoming=future(99);status.catalogue=[];await page.locator('#billing-refresh').click();await page.locator('#subscription-cancel').waitFor({state:'visible'});
  for(const [width,theme] of [[1440,'dark'],[390,'light'],[320,'dark']]){
    await page.setViewportSize({width,height:1000});if(await page.evaluate(()=>document.documentElement.dataset.theme)!==theme)await page.locator('#billing-theme').click();
    await page.waitForTimeout(200);
    assert(await page.evaluate(()=>document.body.scrollWidth<=innerWidth),'billing has no horizontal overflow');
    await page.evaluate(()=>{document.body.scrollTop=0;window.scrollTo(0,0);});
    assert(await page.locator('#wallet-form').isVisible());
    assert(await page.getByRole('link',{name:'بازگشت به محیط کار'}).isVisible(),'mobile retains a labeled workbench return');
    await page.screenshot({path:resolve(artifacts,`active-${width}-${theme}.png`),fullPage:true});
  }
  expire=true;await page.locator('#subscription-cancel').click();assert(await page.locator('#confirm-submit').isDisabled(),'expired cancellation preview cannot credit the wallet');await page.locator('#confirm-cancel').click();expire=false;
  await page.locator('#subscription-cancel').click();assert.equal(refunds,0,'a cancellation preview cannot refund without consent');assert(!(await page.locator('#billing-confirm').textContent()).includes('NaN'));assert((await page.locator('#confirm-terms').textContent()).includes('کیف پول'));loseAck=true;await page.locator('#confirm-submit').click();await page.getByText('پاسخ قطعی دریافت نشد. برای بررسی، همین درخواست را دوباره ارسال کنید.').waitFor();
  const cancelPosts=posts.filter(p=>p.action==='cancel').length;await page.reload();try{await page.locator('#subscription-refund').waitFor({state:'visible'});}catch(error){console.error(JSON.stringify({refunds,lastCancellation:status.lastCancellation,feedback:await page.locator('#billing-feedback').textContent(),errors}));throw error;}assert.equal(refunds,1);assert.equal(posts.filter(p=>p.action==='cancel').length,cancelPosts,'owned receipt recovers a lost cancellation acknowledgement without another mutation');assert.equal(status.current.id,activeId);assert(await page.locator('#subscription-cancel').isHidden());
  status.upcoming=future(100);status.saleEnabled=false;await page.locator('#billing-refresh').click();await page.waitForFunction(()=>!document.getElementById('subscription-cancel').hidden);assert(await page.locator('#subscription-cancel').isEnabled(),'sales off still permits refund of an owned future purchase');assert(await page.locator('#wallet-submit').isDisabled());
  await page.locator('#subscription-cancel').click();abortCancel=true;await page.locator('#confirm-submit').click();await page.getByText('پاسخ قطعی دریافت نشد. برای بررسی، همین درخواست را دوباره ارسال کنید.').waitFor();const cancelToken=posts.at(-1).token;await page.locator('#confirm-close').click();assert(await page.locator('#wallet-submit').isDisabled());await page.locator('#billing-resume').click();await page.locator('#confirm-submit').click();await page.locator('#billing-confirm').waitFor({state:'hidden'});assert.equal(posts.at(-1).token,cancelToken);assert.equal(refunds,2,'frozen cancellation retry credits once');
  await page.screenshot({path:resolve(artifacts,'refunded-320.png'),fullPage:true});
  assert(await page.locator('#billing-pause').isEnabled(),'sales off still permits stopping fresh exposure');assert((await page.locator('#billing-unavailable').textContent()).includes('خرید اشتراک'));
  await page.locator('#billing-pause').click();await page.locator('#confirm-submit').click();await page.locator('#billing-confirm').waitFor({state:'hidden'});assert.equal(status.mode,'paused');
  status.saleEnabled=true;status.mode='payg';status.paygResumeAt=null;status.paygBudget={...status.paygBudget,configured:true,limitToman:50000};
  const resumeBody={action:'preferences',mode:'payg',limitToman:50000,revision:status.preferencesRevision,untilReset:true};
  await page.evaluate(({owner,body})=>sessionStorage.setItem('paastacode-billing-intent:'+owner,JSON.stringify({owner,phase:'uncertain',kind:'preferences',label:'ادامه تا بازنشانی',description:'بازیابی تأیید',body})),{owner,body:resumeBody});
  const beforeResume=posts.length;await page.reload();await page.locator('#billing-confirm').waitFor({state:'visible'});assert.equal(posts.length,beforeResume,'same wallet cap alone is not acknowledgment of a reset-return change');
  await page.locator('#confirm-submit').click();await page.locator('#billing-confirm').waitFor({state:'hidden'});assert.deepEqual(posts.at(-1),resumeBody);assert.equal(status.paygResumeAt,status.current.quotas.week.resetAt);status.saleEnabled=false;status.mode='paused';
  for(const saved of [{kind:'cancel',body:{action:'cancel',token:'missing-quote'}},{kind:'preferences',body:{action:'preferences',mode:'payg',revision:0,limitToman:-1}},{kind:'preferences'}]){
    const count=posts.length;await page.evaluate(({owner,saved})=>sessionStorage.setItem('paastacode-billing-intent:'+owner,JSON.stringify({owner,phase:'uncertain',label:'بازیابی آزمایشی',description:'تأیید آزمایشی',...saved})),{owner,saved});await page.reload();await page.getByText(/پیش‌نمایش ذخیره‌شده قابل بازیابی نیست/).waitFor();assert(await page.locator('#billing-resume').isHidden());assert(await page.locator('#wallet-submit').isDisabled());assert.equal(posts.length,count,'invalid recovery cannot send a mutation');assert.equal(await page.evaluate(owner=>sessionStorage.getItem('paastacode-billing-intent:'+owner),owner),null);
  }
  status={...blank(),saleEnabled:false,catalogue:[]};await page.locator('#billing-refresh').click();await page.waitForFunction(()=>!document.getElementById('billing-unavailable').hidden);assert(await page.locator('#wallet-submit').isDisabled());
  await page.screenshot({path:resolve(artifacts,'disabled-320.png'),fullPage:true});
  status=blank();await page.locator('#billing-refresh').click();await page.waitForFunction(()=>!document.getElementById('wallet-submit').disabled);expire=true;await page.locator('#billing-plans button').click();assert(await page.locator('#confirm-submit').isDisabled(),'expired preview cannot charge');await page.locator('#confirm-close').click();expire=false;
  await page.locator('#billing-pause').click();expiredAuth=true;await page.locator('#confirm-submit').click();await page.locator('#billing-login').waitFor({state:'visible'});assert(await page.locator('#billing-confirm').isHidden());assert.equal(await page.locator('#billing-balance').textContent(),'','expired login clears rendered financial information');assert(await page.locator('#billing-resume').isDisabled());expiredAuth=false;
  await page.locator('#billing-refresh').click();await page.locator('#billing-confirm').waitFor({state:'visible'});await page.locator('#confirm-submit').click();await page.locator('#billing-confirm').waitFor({state:'hidden'});
  const beforeDenied=posts.length;deny=true;await page.locator('#billing-refresh').click();await page.locator('#billing-login').waitFor({state:'visible'});assert(await page.locator('#billing-content').isHidden());assert.equal(posts.length,beforeDenied);
  assert.deepEqual(errors,[]);await context.close();console.log('Billing browser: owned account, font, RTL desktop/390/320, consent, stale revision, frozen retry, cancellation reload recovery, malformed journal, sales-off refund/pause, expiry and denied account passed.');
}finally{await browser.close();await new Promise(done=>server.close(done));}
