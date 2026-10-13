import assert from "node:assert/strict";
import {mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import {chromium} from "playwright";
process.env.PAASTACODE_HOME=resolve(".artifacts/redesign-state-"+process.pid);
const {startServer}=await import("../src/server.mjs");
const titles=["گفتگوی جدید","گفتگوی جدید","بررسی تغییرات احراز هویت","افزودن تست‌های پرداخت","بهینه‌سازی جدول پروژه‌ها"];
const sessions=titles.map((title,i)=>({id:"ses_redesign"+i,title,directory:process.cwd(),time:{updated:Date.now()-i*86400000}}));
const text=(role,value,id)=>({info:{id,role},parts:[{type:"text",text:value}]});
const tool=(name,path,status="completed",command)=>({info:{id:"tool_"+name,role:"assistant"},parts:[{type:"tool",tool:name,callID:"call_"+name,state:{status,title:path,input:{...(command?{command}:{filePath:path})},output:"Synthetic test fixture: passed"}}]});
const histories={
  ses_redesign0:[text("user","فرم ورود را بازطراحی کن و خطاهای اعتبارسنجی را کنار هر فیلد نمایش بده.","req_login"),text("assistant","مسیر ورود و کامپوننت‌های فرم را بررسی کردم. خطاها کنار همان فیلد نمایش داده می‌شوند و درخواست تکراری هنگام ارسال فرم غیرفعال است.","answer_login"),tool("read","src/components/auth/login-form.tsx"),tool("edit","src/components/auth/login-form.tsx"),text("assistant","### بررسی تغییرات\n\n- ترتیب فوکوس و استفاده با صفحه‌کلید حفظ شد.\n- پیام خطا بدون پاک‌شدن اطلاعات فرم نمایش داده می‌شود.\n- برای مسیر موفق و پاسخ نامعتبر سرور، تست اضافه شد.\n\nحالا تست‌های فرم را اجرا می‌کنم.","answer_tests"),tool("bash","اجرای تست‌های ورود","running","npm test -- login-form")],
  ses_redesign1:[text("user","مشکل نمایش مبلغ در صفحهٔ صورتحساب را برطرف کن.","req_billing"),text("assistant","نمایش مبلغ با واحد تومان بررسی می‌شود.","answer_billing")],
};
let busy="ses_redesign0",delay=false;
const runtime={url:null,async start(){this.url="http://127.0.0.1:1";},async stop(){this.url=null;},async call(path,options={}){
  if(path==="/session"){if(options.method==="POST"){const item={id:"ses_redesign"+sessions.length,title:options.body.title,directory:process.cwd()};sessions.push(item);histories[item.id]=[];return structuredClone(item);}return structuredClone(sessions);}
  if(path==="/session/status")return busy?{[busy]:{type:"busy"}}:{};
  if(path==="/permission")return [];
  const id=path.split("/")[2];
  if(path.endsWith("/message")){if(delay&&id==="ses_redesign0")await new Promise(r=>setTimeout(r,500));return histories[id]||[];}
  if(path.endsWith("/prompt_async")){histories[id].push({info:{id:"req_new",role:"user"},parts:options.body.parts});return null;}
  if(path.endsWith("/abort")){busy=null;return true;}
  const item=sessions.find(s=>s.id===id);if(item){if(options.method==="PATCH")Object.assign(item,options.body);return structuredClone(item);}
  throw new Error("Unexpected fixture route "+path);
}};
const account={origin:"https://synthetic.test",credentials:{token:"synthetic",aiKey:"synthetic"},async context(){return {account:{id:"synthetic-user",tenantId:"synthetic-tenant",name:"حساب آزمایشی",balanceToman:10000},models:[{id:"synthetic",name:"مدل آزمایشی",supported_parameters:["tools"],input_toman_per_million:100,output_toman_per_million:300}]};}};
const app=await startServer({account,runtime});
const browser=await chromium.launch({headless:true,channel:process.env.PAASTACODE_BROWSER_CHANNEL||(process.platform==="win32"?"msedge":undefined)});
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];page.on("pageerror",error=>errors.push(error.message));
const active=()=>page.locator('#sessions button[aria-current="true"]');
try{
  await page.goto(app.launchUrl);await page.locator('#sessions button[data-session="ses_redesign0"]').waitFor();
  assert.equal(await active().count(),0);assert(!(await page.locator("#sessions").innerText()).includes("گفتگوی جدید"));
  await page.locator('[data-session="ses_redesign0"]').click();await page.getByText("حالا تست‌های فرم را اجرا می‌کنم.",{exact:false}).waitFor();
  assert.equal(await active().count(),1);assert.equal(await active().getAttribute("data-session"),"ses_redesign0");
  assert.match(await page.locator("#conversation-title").innerText(),/فرم ورود/);
  await page.evaluate(()=>document.fonts.ready);
  const yekan=await page.request.get(app.url+"/fonts/YekanBakh.ttf");
  if(yekan.ok())assert(await page.evaluate(()=>[...document.fonts].some(f=>f.family==="YekanBakh"&&f.status==="loaded")),"Yekan must actually render, not pass through fallback");
  await mkdir(".artifacts",{recursive:true});await page.screenshot({path:".artifacts/redesign-desktop-dark.png"});
  const colors=await page.locator("#sessions button").evaluateAll(buttons=>buttons.map(b=>({selected:b.getAttribute("aria-current")==="true",background:getComputedStyle(b).backgroundColor,border:getComputedStyle(b).borderColor})));
  assert.notEqual(colors.find(c=>c.selected).background,colors.find(c=>!c.selected).background);assert.notEqual(colors.find(c=>c.selected).border,colors.find(c=>!c.selected).border);
  await page.locator("#theme-toggle").click();assert.equal(await page.locator("html").getAttribute("data-theme"),"light");await page.waitForTimeout(220);await page.screenshot({path:".artifacts/redesign-desktop-light.png"});
  await page.locator("#session-search").fill("صورتحساب");assert.equal(await page.locator("#sessions button:visible").count(),1);await page.locator("#sessions button:visible").click();
  await page.getByText("نمایش مبلغ با واحد تومان بررسی می‌شود.",{exact:true}).waitFor();assert.equal(await active().count(),1);assert.equal(await active().getAttribute("data-session"),"ses_redesign1");
  await page.locator("#session-search").fill("نامی که نیست");assert(await page.locator("#session-no-results").isVisible());await page.locator("#session-search").fill("");
  delay=true;await page.locator('[data-session="ses_redesign0"]').click();await page.locator('[data-session="ses_redesign1"]').click();
  await page.getByText("نمایش مبلغ با واحد تومان بررسی می‌شود.",{exact:true}).waitFor();assert.equal(await active().count(),1);assert.match(await page.locator("#conversation-title").innerText(),/صورتحساب/);assert(!(await page.locator("#messages").innerText()).includes("خطاها کنار همان"));delay=false;
  await page.reload();await page.locator('[data-session="ses_redesign1"]').waitFor();assert.equal(await page.locator("html").getAttribute("data-theme"),"light");
  busy=null;await page.locator("#new").click();await page.locator("#prompt").fill("تست جدید برای گزارش خطا اضافه کن");await page.locator("#send").click();
  await page.waitForFunction(()=>document.querySelector('#sessions button[aria-current="true"]')?.textContent.includes("تست جدید"));assert.match(await page.locator("#conversation-title").innerText(),/تست جدید/);
  await page.locator('[data-session="ses_redesign0"]').click();busy="ses_redesign0";await page.locator("#activity").waitFor({state:"visible"});await page.locator("#theme-toggle").click();
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});await page.waitForTimeout(100);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const composer=await page.locator("#composer").boundingBox();assert(composer.y+composer.height<=844);assert(await page.locator("#activity").isVisible());
    await page.screenshot({path:`.artifacts/redesign-${width}.png`});await page.locator("#menu").click();assert(await active().isVisible());await page.locator("#rail-close").click();
  }
  assert.deepEqual(errors,[]);console.log("Redesign browser checks passed: legacy and new titles, exclusive selection, rapid switching, search, embedded font, persistent themes, desktop/390/320px");
}finally{await browser.close();await app.close();}
