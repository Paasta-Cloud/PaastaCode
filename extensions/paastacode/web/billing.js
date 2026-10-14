import {labelDialog,icon} from './components.js';
/** @param {Document | HTMLElement} root
 * @param {{ signal?: AbortSignal, standalone?: boolean }} [options] */
export function mountBilling(root = document, options = {}) {
const signal=options.signal;
const $=id=>root.querySelector('#'+id),dialog=$('billing-confirm');labelDialog(dialog);
if(location.pathname.startsWith('/api/paastacode/web/'))root.querySelectorAll('.billing-return,.brand').forEach(link=>{link.href='./index.html';});
const title=dialog.querySelector('h2'),description=dialog.querySelector('p');
$('subscription-cancel').prepend(icon('wallet'));
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',ownerPattern=new RegExp(`^${uuid}:${uuid}$`,'i');
let expectedOwner=new URLSearchParams(location.search).get('owner')||new URLSearchParams(location.hash.slice(1)).get('owner')||null,state=null,busy=false,intent=null,limitDirty=false,verified=false,invalidRecovery=false;
if(expectedOwner&&!ownerPattern.test(expectedOwner))expectedOwner='invalid';
const money=value=>Number(value).toLocaleString('fa-IR')+' تومان',date=value=>new Date(value).toLocaleDateString('fa-IR');
const modeName=mode=>({payg:'مصرف با کیف پول',subscription:'اشتراک',paused:'مصرف تازه متوقف است'}[mode]||'نامشخص');
const node=(tag,text,cls)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(cls)element.className=cls;return element;};
const feedback=(message,error=false)=>{if(signal?.aborted)return;$('billing-feedback').textContent=message;$('billing-feedback').dataset.error=String(error);};
const storageKey=()=>`paastacode-billing-intent:${expectedOwner}`;
function saveIntent(value){try{value?sessionStorage.setItem(storageKey(),JSON.stringify(value)):sessionStorage.removeItem(storageKey());return true;}catch{return false;}}
function restoreIntent(){
  invalidRecovery=false;
  try{
    const saved=JSON.parse(sessionStorage.getItem(storageKey())||'null');if(saved===null)return null;
    const body=saved.body,quote=saved.quote,amount=value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
    const common=saved.owner===expectedOwner&&saved.phase==='uncertain'&&typeof saved.label==='string'&&typeof saved.description==='string'&&body&&typeof body==='object'&&!Array.isArray(body);
    const funding=saved.kind==='preferences'&&body.action==='preferences'&&['payg','paused','subscription'].includes(body.mode)&&Number.isSafeInteger(body.revision)&&body.revision>=0&&Object.keys(body).every(key=>['action','mode','revision','limitToman','untilReset'].includes(key))&&(body.mode==='payg'?amount(body.limitToman)&&body.limitToman<=1e9&&(body.untilReset===undefined||body.untilReset===true):body.limitToman===undefined&&body.untilReset===undefined);
    const purchase=['buy','cancel'].includes(saved.kind)&&body?.action===saved.kind&&typeof body.token==='string'&&body.token.length>0&&body.token.length<=50000&&Object.keys(body).every(key=>['action','token'].includes(key))&&quote&&quote.token===body.token&&new RegExp('^'+uuid+'$','i').test(quote.id)&&Number.isFinite(Date.parse(quote.expiresAt))&&Number.isFinite(Date.parse(quote.startsAt))&&Date.parse(quote.endsAt)>Date.parse(quote.startsAt)&&(saved.kind==='cancel'?amount(quote.refundToman):amount(quote.priceToman)&&amount(quote.weeklyQuotaToman)&&amount(quote.periodQuotaToman));
    if(common&&(funding||purchase))return saved;
  }catch{}
  invalidRecovery=true;saveIntent(null);return null;
}
function clearIntent(){saveIntent(null);intent=null;}
function setTheme(light){document.documentElement.dataset.theme=light?'light':'dark';$('billing-theme').textContent=light?'نمای تیره':'نمای روشن';$('billing-theme').setAttribute('aria-pressed',String(light));try{localStorage.setItem('paastacode-theme',light?'light':'dark');}catch{}}
if(options.standalone!==false){try{setTheme(localStorage.getItem('paastacode-theme')==='light');}catch{setTheme(false);}}
$('billing-theme').onclick=()=>setTheme(document.documentElement.dataset.theme!=='light');
async function api(body){
  const response=await fetch('/api/paastacode/subscription',{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{...(body?{'Content-Type':'application/json'}:{}),...(expectedOwner?{'X-PaastaCode-Owner':expectedOwner}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  const result=await response.json().catch(()=>null);
  if(signal?.aborted)throw new DOMException('Billing view closed','AbortError');
  if([401,403].includes(response.status)){verified=false;state=null;$('billing-content').hidden=true;$('billing-login').hidden=false;$('billing-name').textContent='ورود با حساب درست لازم است';$('billing-balance').textContent='';if(dialog.open)dialog.close();controls();}
  if(!response.ok||!result)throw Object.assign(new Error(result?.error||'اطلاعات حساب دریافت نشد؛ دوباره تلاش کنید.'),{status:response.status,reason:result?.reason});
  return result;
}
function quota(label,value,reset){
  const remaining=Math.max(0,Math.min(100,Math.floor(value.remainingToman/Math.max(1,value.limitToman)*100))),percent=n=>n.toLocaleString('fa-IR')+'٪';
  const wrap=node('div',undefined,'billing-quota'),top=node('div',undefined,'billing-quota-top'),bar=node('progress'),foot=node('div',undefined,'billing-quota-foot');
  top.append(node('strong',label),node('span',percent(remaining)+' باقی‌مانده'));bar.max=Math.max(1,value.limitToman);bar.value=Math.min(value.limitToman,value.usedToman);bar.setAttribute('aria-label',label+'؛ '+percent(100-remaining)+' مصرف و رزرو');
  foot.append(node('span',percent(100-remaining)+' مصرف و رزرو'),node('span',reset?'بازنشانی '+date(reset):'بدون بازنشانی خودکار'));wrap.append(top,bar,foot);return wrap;
}
function controls(){
  if(signal?.aborted)return;
  const enabled=verified&&state?.saleEnabled===true&&Number.isSafeInteger(state.preferencesRevision);
  document.querySelectorAll('#billing-content button,#wallet-limit').forEach(element=>{element.disabled=busy||!enabled||intent?.phase==='uncertain';});
  $('subscription-cancel').disabled=busy||!verified||!state?.upcoming||intent?.phase==='uncertain';
  $('billing-pause').disabled=busy||!verified||!state||state.mode==='paused'||intent?.phase==='uncertain';
  $('billing-resume').hidden=intent?.phase!=='uncertain';$('billing-resume').disabled=busy||!verified;
  dialog.dataset.busy=String(busy);
  $('billing-refresh').disabled=busy;$('confirm-submit').disabled=busy||!verified||!intent||intent.phase!=='uncertain'&&intent.quote&&Date.parse(intent.quote.expiresAt)<=Date.now();
  $('confirm-close').disabled=busy;$('confirm-cancel').disabled=busy;
}
function render(){
  if(signal?.aborted)return;
  $('billing-content').hidden=false;$('billing-login').hidden=true;$('billing-name').textContent=state.account.name;$('billing-balance').textContent='موجودی آزاد: '+money(state.account.balanceToman);
  $('billing-mode').textContent=modeName(state.mode);$('billing-unavailable').hidden=state.saleEnabled===true;
  $('billing-unavailable').textContent='خرید اشتراک و تغییر سقف کیف پول فعلاً در دسترس نیست. توقف مصرف تازه همچنان ممکن است.'+(state.upcoming?' لغو تمدیدِ شروع‌نشده را می‌توانید از بخش اشتراک بررسی کنید.':'');
  $('billing-review').hidden=!(state.mode==='subscription'?state.current?.reviewRequired:state.mode==='payg'?state.paygBudget?.reviewRequired:false);
  $('subscription-period').textContent=state.current?'تا '+date(state.current.endsAt):'';if(options.standalone===false)$('subscription-detail').closest('section').hidden=!state.current&&!state.upcoming&&!state.lastCancellation&&state.state==='none';
  $('subscription-detail').replaceChildren();$('subscription-quotas').replaceChildren();
  if(state.current){
    $('subscription-detail').append(node('strong',state.current.plan.name),node('p','دوره از '+date(state.current.startsAt)+' تا '+date(state.current.endsAt),'billing-help'));
    const quotas=[['week','سهمیهٔ این هفته'],['period','سهمیهٔ ماهانه']];for(const [key,label] of [['burst','مصرف کوتاه‌مدت'],['professional','مدل‌های حرفه‌ای']])if(state.current.quotas[key].limitToman<state.current.quotas.week.limitToman)quotas.push([key,label]);for(const [key,label] of quotas){const value=state.current.quotas[key];$('subscription-quotas').append(quota(label,value,value.resetAt));}
  }else $('subscription-detail').append(node('p',state.state==='expired'?'اشتراک پایان یافته است. ادامه با کیف پول نیاز به انتخاب جداگانه دارد.':'اشتراک فعالی ندارید. بستهٔ مناسب خود را از بالای صفحه انتخاب کنید.','billing-help'));
  $('subscription-use').hidden=!state.current||state.mode==='subscription';
  $('subscription-pending').hidden=!state.current?.pendingRequests;$('subscription-pending').textContent=(state.current?.pendingRequests||0).toLocaleString('fa-IR')+' درخواست در انتظار تعیین هزینهٔ نهایی است؛ رزرو آن‌ها هنوز آزاد نشده است.';
  $('subscription-upcoming').hidden=!state.upcoming;$('subscription-upcoming').textContent=state.upcoming?state.upcoming.plan.name+' از '+date(state.upcoming.startsAt)+' فعال می‌شود. دورهٔ فعلی تا پایان باقی می‌ماند.':'';
  $('subscription-cancel').hidden=!state.upcoming;
  $('subscription-refund').hidden=!state.lastCancellation;$('subscription-refund').textContent=state.lastCancellation?'تمدید با آغاز '+date(state.lastCancellation.startsAt)+' لغو شد؛ '+money(state.lastCancellation.refundToman)+' در '+date(state.lastCancellation.refundedAt)+' به کیف پول برگشت.':'';
  $('wallet-resume-label').hidden=!state.current;if(!state.current)$('wallet-resume').checked=false;
  const budget=state.paygBudget;$('wallet-quota').replaceChildren();$('wallet-state').textContent=budget.configured?'از '+date(budget.startedAt):'سقف مشترک انتخاب نشده';
  if(budget.configured)$('wallet-quota').append(quota('سقف مشترک کیف پول',{limitToman:budget.limitToman,usedToman:budget.usedToman,remainingToman:budget.remainingToman}));
  $('wallet-pending').hidden=!budget.pendingRequests;$('wallet-pending').textContent=budget.pendingRequests.toLocaleString('fa-IR')+' رزرو تا دریافت هزینهٔ قطعی در سقف و کیف پول باقی می‌ماند؛ مانده پس از تسویه برمی‌گردد.';
  if(!limitDirty)$('wallet-limit').value=budget.limitToman?.toLocaleString('fa-IR')||'';
  $('billing-pause').textContent=state.mode==='paused'?'مصرف متوقف است':'توقف مصرف';
  $('plans-help').textContent=state.current?'برای دورهٔ بعد، بستهٔ موردنظر را انتخاب کنید. اشتراک فعلی تا پایان دوره در دسترس است.':'اشتراک ماهانه برای کدنویسی با پاستاکد. سهمیهٔ مناسب کار خود را انتخاب کنید.';
  $('billing-plans').replaceChildren();
  const plans=[...(state.catalogue||[])].sort((a,b)=>a.priceToman-b.priceToman);
  const baseQuota=plans[0]?.weeklyQuotaToman||1;
  for(const plan of plans){
    const row=node('article',undefined,'billing-plan'),details=node('div'),button=node('button',state.current?'تمدید اشتراک':'انتخاب بسته');
    details.append(node('h3',plan.name),node('p',plan.id==='paastacode-base'?'برای کارهای روزمره':plan.id==='paastacode-pro'?'برای پروژه‌های بزرگ‌تر':'برای استفادهٔ سنگین و پیوسته'));
    const features=node('ul');for(const text of [plan.weeklyQuotaToman===baseQuota?'سهمیهٔ پایه':Number(plan.weeklyQuotaToman/baseQuota).toLocaleString('fa-IR')+' برابر سهمیهٔ پایه','بازنشانی هفتگی سهمیه','مدل‌های منتخب کدنویسی','وب، دسکتاپ، ترمینال و افزونه'])features.append(node('li',text));
    button.type='button';button.onclick=()=>preparePurchase(plan);row.append(details,node('span',money(plan.priceToman)+' / ماه','billing-plan-price'),features,button);$('billing-plans').append(row);
  }
  if(!state.catalogue?.length)$('billing-plans').append(node('p',state.upcoming?'یک دورهٔ آینده از قبل خریداری شده است.':state.saleEnabled?'بستهٔ قابل خرید فعلاً موجود نیست؛ کمی بعد تازه‌سازی کنید.':'پس از فعال‌شدن فروش، قیمت و مدل‌های هر بسته اینجا نمایش داده می‌شوند.','billing-help'));
  controls();
}
async function refresh(){
  if(busy)return;busy=true;verified=false;controls();feedback('در حال دریافت وضعیت حساب…');
  try{
    const result=await api(),owner=`${result.account?.id}:${result.account?.tenantId}`;
    if(!ownerPattern.test(owner)||expectedOwner&&expectedOwner!==owner)throw Object.assign(new Error('حساب فعال با حساب پاستاکد یکسان نیست؛ با حساب درست وارد شوید.'),{status:403});
    expectedOwner=owner;state=result;verified=true;render();intent=restoreIntent();
    const acknowledged=intent?.kind==='buy'?[state.current?.id,state.upcoming?.id].includes(intent.quote?.id):intent?.kind==='cancel'?state.lastCancellation?.id===intent.quote?.id:intent?.kind==='preferences'&&state.preferencesRevision>intent.body.revision&&state.mode===intent.body.mode&&(intent.body.mode!=='payg'||state.paygBudget.limitToman===intent.body.limitToman&&(intent.body.untilReset?!!state.paygResumeAt:!state.paygResumeAt));
    if(intent?.phase==='uncertain'&&!acknowledged){showIntent();feedback('نتیجهٔ درخواست قبلی مشخص نیست. همان درخواست را بررسی کنید تا خرید تکراری ساخته نشود.');}else {clearIntent();feedback(invalidRecovery?'پیش‌نمایش ذخیره‌شده قابل بازیابی نیست. وضعیت حساب را بررسی کنید و پیش‌نمایش تازه بگیرید.':acknowledged?'درخواست قبلی ثبت شده است؛ وضعیت حساب به‌روز شد.':'آخرین وضعیت دریافت شد.',invalidRecovery);}
  }catch(error){
    if(error.status===401||error.status===403){state=null;$('billing-content').hidden=true;$('billing-login').hidden=false;$('billing-name').textContent='ورود با حساب درست لازم است';$('billing-balance').textContent='';if(dialog.open)dialog.close();}
    feedback(error.message+(state?' اطلاعات نمایش‌داده‌شده قدیمی است؛ پیش از تغییر، دوباره تازه‌سازی کنید.':''),true);
  }finally{busy=false;$('billing-loading').hidden=true;controls();}
}
function showIntent(){
  title.textContent=intent.label;description.textContent=intent.description;$('confirm-facts').replaceChildren();
  const facts=intent.kind==='cancel'?[['بازگشت به کیف پول',money(intent.quote.refundToman)],['آغاز دورهٔ لغوشونده',date(intent.quote.startsAt)]]:intent.quote?[['مبلغ پرداخت',money(intent.quote.priceToman)],['آغاز دوره',date(intent.quote.startsAt)],['پایان دوره',date(intent.quote.endsAt)],...(intent.quote.discountToman?[['تخفیف خرید',money(intent.quote.discountToman)]]:[])]:intent.body.mode==='payg'?[['سقف کل',money(intent.body.limitToman)],['مصرف و رزرو فعلی',money(state.paygBudget.usedToman)]]:[['روش انتخاب‌شده',modeName(intent.body.mode)]];
  for(const [key,value] of facts)$('confirm-facts').append(node('dt',key),node('dd',value));
  $('confirm-terms').textContent=intent.kind==='cancel'?'تمدیدِ شروع‌نشده لغو می‌شود و مبلغ خرید آن به کیف پول حساب پاستا برمی‌گردد. دورهٔ فعال تا پایان در دسترس است.':intent.quote?'پرداخت پیش از فعال‌سازی انجام می‌شود. ماندهٔ سهمیه به دورهٔ بعد منتقل نمی‌شود. پایان سهمیه برداشت خودکار از کیف پول ایجاد نمی‌کند.':intent.body.mode==='payg'?'این انتخاب روی همهٔ دستگاه‌ها اعمال می‌شود. سقف هزینه خودکار بازنشانی نمی‌شود؛ رزروهای نامشخص تا تعیین هزینه باقی می‌مانند. '+(intent.body.untilReset?'در بازنشانی سهمیه، مصرف تازه به اشتراک برمی‌گردد.':'')+'':'این انتخاب روی همهٔ دستگاه‌ها اعمال می‌شود. رزروهای قبلی و دورهٔ خریداری‌شده حفظ می‌شوند.';
  $('confirm-submit').textContent=intent.phase==='uncertain'?'بررسی دوبارهٔ همان درخواست':intent.kind==='cancel'?'تأیید لغو و بازگشت اعتبار':intent.quote?'پرداخت '+money(intent.quote.priceToman)+' و فعال‌سازی':'تأیید انتخاب';$('confirm-feedback').textContent=intent.phase==='uncertain'?(intent.kind==='cancel'?'تکرار همین درخواست، اعتبار دوباره اضافه نمی‌کند.':'تکرار همین درخواست، پرداخت دوباره ایجاد نمی‌کند.'):'';
  if(!dialog.open)dialog.showModal();controls();
}
async function preparePurchase(plan){
  if(busy||!verified||intent?.phase==='uncertain')return;busy=true;controls();feedback('در حال بررسی قیمت و دوره…');
  try{const quote=await api({action:'quote',planId:plan.id,...($('discount-code').value.trim()?{discountCode:$('discount-code').value.trim()}: {})});intent={owner:expectedOwner,kind:'buy',phase:'prepared',body:{action:'buy',token:quote.token},quote,label:state.current?'بررسی تمدید اشتراک':'بررسی خرید اشتراک',description:quote.name};showIntent();feedback('قیمت نهایی را پیش از پرداخت بررسی کنید.');}catch(error){feedback(error.message,true);}finally{busy=false;controls();}
}
function prepareMode(mode,limitToman){
  if(busy||!verified||!state||(mode!=='paused'&&!state.saleEnabled)||intent?.phase==='uncertain')return;
  intent={owner:expectedOwner,kind:'preferences',phase:'prepared',body:{action:'preferences',mode,revision:state.preferencesRevision,...(mode==='payg'?{limitToman,...($('wallet-resume').checked?{untilReset:true}: {})}:{})},label:mode==='paused'?'توقف مصرف تازه':mode==='subscription'?'استفاده از اشتراک':'انتخاب سقف کیف پول',description:'روش مصرف و سقف این حساب برای همهٔ دستگاه‌ها مشترک است.'};showIntent();
}
$('wallet-form').onsubmit=event=>{event.preventDefault();const text=$('wallet-limit').value.replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[٬,\s]/g,'');const limit=Number(text);if(!/^\d+$/.test(text)||!Number.isSafeInteger(limit)||limit<1||limit>1_000_000_000||limit<state.paygBudget.usedToman){feedback('سقف باید عددی بین ۱ تا ۱٬۰۰۰٬۰۰۰٬۰۰۰ تومان و دست‌کم برابر مصرف و رزرو فعلی باشد.',true);$('wallet-limit').focus();return;}prepareMode('payg',limit);};
$('wallet-limit').oninput=()=>{limitDirty=true;};
$('billing-pause').onclick=()=>prepareMode('paused');$('subscription-use').onclick=()=>prepareMode('subscription');$('billing-refresh').onclick=refresh;
$('billing-resume').onclick=()=>{if(intent&&!busy)showIntent();};
$('subscription-cancel').onclick=async()=>{
  if(busy||!verified||!state?.upcoming||intent?.phase==='uncertain')return;busy=true;controls();feedback('در حال بررسی رسید تمدید…');
  try{const quote=await api({action:'cancelQuote',id:state.upcoming.id});intent={owner:expectedOwner,kind:'cancel',phase:'prepared',body:{action:'cancel',token:quote.token},quote,label:'بررسی لغو تمدید آینده',description:quote.name};showIntent();feedback('مبلغ بازگشت اعتبار و دوره را پیش از تأیید بررسی کنید.');}catch(error){feedback(error.message,true);}finally{busy=false;controls();}
};
$('confirm-close').onclick=$('confirm-cancel').onclick=()=>{if(!busy)dialog.close();};dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
dialog.addEventListener('close',()=>{if(intent?.phase==='prepared')clearIntent();});
$('confirm-submit').onclick=async()=>{
  if(busy||!verified||!intent||intent.owner!==expectedOwner)return;
  if(intent.quote&&intent.phase!=='uncertain'&&Date.parse(intent.quote.expiresAt)<=Date.now()){$('confirm-feedback').textContent='مهلت پیش‌نمایش تمام شد. آن را ببندید و دوباره بررسی کنید.';controls();return;}
  const pending={...intent,phase:'uncertain'};if(!saveIntent(pending)){$('confirm-feedback').textContent='ذخیرهٔ تأیید در مرورگر انجام نشد؛ امکان ذخیره‌سازی مرورگر را فعال و دوباره تلاش کنید.';return;}intent=pending;
  busy=true;controls();$('confirm-feedback').textContent='در حال ثبت درخواست…';
  try{await api(intent.body);limitDirty=false;clearIntent();dialog.close();feedback('انتخاب شما ثبت شد.');busy=false;await refresh();}
  catch(error){$('confirm-feedback').textContent=error.message;if([400,409].includes(error.status)||error.reason==='sale_disabled'){clearIntent();dialog.close();busy=false;await refresh();feedback(error.message,true);}else if([401,403].includes(error.status)){busy=false;await refresh();}else{$('confirm-submit').textContent='بررسی دوبارهٔ همان درخواست';feedback('پاسخ قطعی دریافت نشد. برای بررسی، همین درخواست را دوباره ارسال کنید.',true);}}
  finally{busy=false;controls();}
};
const timer=setInterval(()=>{if(intent?.quote&&intent.phase==='prepared'&&Date.parse(intent.quote.expiresAt)<=Date.now()){$('confirm-feedback').textContent='مهلت پیش‌نمایش تمام شد؛ پیش‌نمایش تازه بگیرید.';controls();}},1000);
void refresh();
const dispose=()=>{clearInterval(timer);if(dialog.open)dialog.close();};
signal?.addEventListener('abort',dispose,{once:true});
return dispose;
}
if(typeof document!=='undefined'&&document.documentElement.classList.contains('billing-document')) {
  let pending=false;try{pending=Object.keys(sessionStorage).some(key=>key.startsWith('paastacode-billing-intent:'));}catch{pending=true;}
  if(location.hostname==='code.paasta.cloud'&&!pending){
    const owner=new URLSearchParams(location.hash.slice(1)).get('owner');
    location.replace('https://console.paasta.cloud/paastacode'+(owner?'?owner='+encodeURIComponent(owner):''));
  }else mountBilling(document);
}
