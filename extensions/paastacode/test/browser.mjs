import assert from "node:assert/strict";
import {mkdir,readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {resolve} from "node:path";
process.env.PAASTACODE_HOME=resolve(".artifacts/browser-state-"+process.pid);
const {chromium}=createRequire(import.meta.url)("playwright");
const {startServer}=await import("../src/server.mjs");
const sessionId="ses_browserSynthetic";
const sessions=[{id:sessionId,title:"بررسی ساختار پروژه",directory:process.cwd()}];
const messages=[{info:{role:"user"},parts:[{type:"text",text:"ساختار پروژه را بررسی کن."}]},
  {info:{role:"assistant"},parts:[{type:"text",text:"مسیرهای پروژه بررسی شدن. برای شروع، فایل ورودی را باز کن.\n\n```js\nconst message = '<script>alert(1)</script>';\nconsole.log(message);\n```"}]}];
let grants=0,saves=0,deletes=0,safeDelete=true,connected=false,identity="synthetic-user",busy=false,lastParts,failCreate=false;
const account={origin:"https://console.paasta.cloud",credentials:null,
  async context(){return {account:{id:identity,tenantId:"synthetic-tenant",name:"حساب آزمایشی",balanceToman:100000},models:[{id:"synthetic",name:"مدل آزمایشی",supported_parameters:["tools"],input_toman_per_million:100,output_toman_per_million:300},{id:"test/kimi-k2.7-code",name:"Kimi K2.7 Code",supported_parameters:["tools"],input_toman_per_million:200,output_toman_per_million:400}]};},
  async begin(){return {url:"https://console.paasta.cloud/cli/authorize?code=TEST-TEST",code:"TEST-TEST"};},
  async poll(){this.credentials={token:"synthetic"};return {pending:false};},
  async connect(){this.credentials.aiKey="synthetic";connected=true;return {dailyLimitToman:50000};},
  async logout(){this.credentials=null;},
  async request(_path,options={}){
    if(options.method==="PUT"){saves++;this.saved={...options.body,revision:1};return {id:this.saved.id,revision:1};}
    if(options.method==="DELETE"){
      const revision=Number(new URL(_path,this.origin).searchParams.get("revision"));
      if(revision!==this.saved.revision)throw Object.assign(new Error("گفتگو در حساب تغییر کرده است. نسخهٔ تازه را باز کنید."),{status:409});
      deletes++;this.saved=null;return {ok:true,deleted:true};
    }
    if(_path.includes("?id="))return {...this.saved,features:safeDelete?{conditionalDelete:true}:undefined};return {sessions:this.saved?[this.saved]:[]};
  }};
let pending=true;
const runtime={url:null,password:"synthetic",
  async start(){this.url="http://127.0.0.1:1";},async stop(){this.url=null;},
  async call(path,options={}){
    if(path==="/session"){if(options.method==="POST"&&failCreate){failCreate=false;throw new Error("خطای آزمایشی ساخت گفتگو");}return options.method==="POST"?sessions[0]:sessions;}
    if(path==="/session/"+sessionId)return sessions[0];
    if(path.endsWith("/message"))return messages;
    if(path==="/session/status")return busy?{[sessionId]:{type:"busy"}}:{};
    if(path==="/permission")return pending?[{id:"per_test",sessionID:sessionId,permission:"edit",patterns:["src/index.ts"],metadata:{diff:"--- src/index.ts\n+++ src/index.ts\n+const safe = true;"}}]:[];
    if(path.endsWith("/reply")){pending=false;grants++;return true;}
    if(path.endsWith("prompt_async")){lastParts=options.body.parts;messages.push({info:{role:"user"},parts:lastParts});busy=true;return null;}
    throw new Error("Unexpected mock route "+path);
  }};
await mkdir(".artifacts",{recursive:true});
const app=await startServer({account,runtime});
const browser=await chromium.launch({headless:true,channel:process.env.PAASTACODE_BROWSER_CHANNEL||(process.platform==="win32"?"msedge":undefined)});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on("pageerror",error=>errors.push(error.message));
try{
  assert.equal((await fetch(app.url+"/api/state")).status,401);
  assert.equal((await fetch(app.url+"/api/login",{method:"POST",headers:{Authorization:"Bearer "+app.capability,Origin:"https://evil.test"}})).status,403);
  await page.goto(app.launchUrl);await page.locator("#login").waitFor();
  await page.evaluate(()=>document.fonts.ready);
  assert(await page.evaluate(()=>document.fonts.check("16px YekanBakh")||document.fonts.check("16px Vazirmatn")),"Licensed Yekan or bundled open-source fallback must load");
  assert.equal(await page.evaluate(()=>document.documentElement.dir),"rtl");
  assert.equal(await page.getByText("Powered by OpenCode",{exact:true}).getAttribute("href"),"https://opencode.ai");
  assert.equal(await page.getByText("فورک متن‌باز پاستا",{exact:true}).getAttribute("href"),"https://github.com/Paasta-Cloud/PaastaCode");
  await page.screenshot({path:".artifacts/onboarding-desktop.png"});
  await page.locator("#login").click();await page.locator("#budget").waitFor({state:"visible",timeout:10000});
  await page.locator("#budget-form button").click();await page.locator("#composer").waitFor({state:"visible"});
  assert(connected);
  assert.equal(await page.locator("#model").inputValue(),"test/kimi-k2.7-code");
  await page.locator("#model").selectOption("synthetic");
  failCreate=true;await page.locator("#prompt").fill("درخواست حفظ‌شده");await page.locator("#send").click();
  await page.getByText("خطای آزمایشی ساخت گفتگو",{exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector("#send").disabled);
  assert.equal(await page.locator("#prompt").inputValue(),"درخواست حفظ‌شده");await page.locator("#prompt").fill("");
  await page.locator("#sessions button").first().click();
  await page.getByText("فقط همین بار",{exact:true}).click();
  await page.locator("#permissions .permission").waitFor({state:"detached"});
  assert.equal(grants,1);
  assert.equal(await page.locator("#messages script").count(),0);
  await page.locator("#save").click();await page.locator("#confirm-save").click();
  await page.getByText("در حساب ذخیره شد",{exact:true}).waitFor();assert.equal(saves,1);
  await page.locator("#save").click();await page.keyboard.press("Escape");await page.waitForTimeout(200);assert.equal(saves,1,"Escape must not reuse previous save consent or upload again");
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:".artifacts/conversation-desktop.png",fullPage:true});
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,"mobile overflow "+width);
    await page.locator("#menu").click();assert.equal(await page.locator("#rail").isVisible(),true);
    await page.locator("#rail-close").click();assert.equal(await page.locator("#rail").isVisible(),false);
    assert(await page.locator("#price").isVisible());assert(await page.locator("#save-state").isVisible());
    await page.screenshot({path:".artifacts/conversation-"+width+".png",fullPage:true});
  }
  await page.emulateMedia({colorScheme:"dark"});
  await page.waitForFunction(()=>document.documentElement.dataset.theme==="dark");
  await page.screenshot({path:".artifacts/conversation-dark.png",fullPage:true,animations:"disabled"});
  await page.locator("#model-settings summary").click();await page.locator("#workflow-phase").selectOption("build");await page.locator("#model-settings summary").click();
  await page.locator("#prompt").fill("یک بررسی دیگر");
  await page.locator("#send").click();await page.waitForFunction(()=>document.querySelector("#prompt").value==="");
  assert.equal(messages.at(-1).parts[0].text,"یک بررسی دیگر");
  await page.waitForFunction(()=>document.querySelector("#send").disabled);
  await page.setViewportSize({width:1440,height:1000});
  await page.locator("#cloud-tab").click();pending=true;
  assert.equal(await page.locator("#composer").isVisible(),false,"Switching to account previews cannot keep the local send target");
  assert.equal(await page.locator("#messages").innerText(),"");assert.equal(await page.locator('#sessions [aria-current="true"]').count(),0);
  await page.locator("#local-tab").click();await page.locator("#sessions button").first().click();
  await page.getByText("فقط همین بار",{exact:true}).waitFor();
  await page.getByText("فقط همین بار",{exact:true}).click();assert.equal(grants,2,"Returning to the local conversation restores its pending approval");
  await page.locator("#cloud-tab").click();assert.equal(await page.locator("#messages").innerText(),"");
  busy=false;await page.locator("#sessions button").first().click();
  safeDelete=false;await page.locator("#sessions button").first().click();await page.getByText("حذف امن به نسخهٔ تازهٔ سرویس حساب و برنامهٔ محلی نیاز دارد. پاستاکد و سرویس آن را به‌روز کنید.",{exact:true}).waitFor();assert.equal(await page.getByRole("button",{name:"حذف از حساب",exact:true}).isDisabled(),true,"old servers must not be trusted for conditional deletion");
  safeDelete=true;await page.locator("#sessions button").first().click();await page.waitForFunction(()=>document.querySelector(".cloud-actions .danger-action")?.disabled===false);
  await page.route(app.url+"/api/state",async route=>{const response=await route.fetch();const data=await response.json();delete data.features;await route.fulfill({response,json:data});});
  await page.reload();await page.locator("#cloud-tab").click();await page.locator("#sessions button").first().click();
  await page.getByText("حذف امن به نسخهٔ تازهٔ سرویس حساب و برنامهٔ محلی نیاز دارد. پاستاکد و سرویس آن را به‌روز کنید.",{exact:true}).waitFor();
  assert.equal(await page.getByRole("button",{name:"حذف از حساب",exact:true}).isDisabled(),true,"an old local broker must not drop the revision check");
  await page.unroute(app.url+"/api/state");await page.reload();await page.locator("#cloud-tab").click();await page.locator("#sessions button").first().click();await page.waitForFunction(()=>document.querySelector(".cloud-actions .danger-action")?.disabled===false);
  const downloadPromise=page.waitForEvent("download");await page.getByText("دریافت فایل گفتگو",{exact:true}).click();
  const download=await downloadPromise;const exported=JSON.parse(await readFile(await download.path(),"utf8"));
  assert.deepEqual(exported,{version:1,title:account.saved.title,messages:account.saved.snapshot.messages});
  for(const width of [1440,320]){
    await page.setViewportSize({width,height:900});await page.getByRole("button",{name:"حذف از حساب",exact:true}).click();
    await page.locator("#cloud-delete-dialog").waitFor({state:"visible"});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:".artifacts/cloud-delete-"+width+".png",fullPage:true});
    await page.keyboard.press("Escape");assert.equal(deletes,0);
  }
  await page.setViewportSize({width:1440,height:1000});account.saved.revision=2;
  const deletedId=account.saved.id;
  await page.getByRole("button",{name:"حذف از حساب",exact:true}).click();await page.locator("#cloud-delete-confirm").click();
  await page.waitForFunction(()=>document.querySelector("#notice").textContent.includes("تغییر کرده"));assert.equal(deletes,0);assert.equal(account.saved.revision,2);
  await page.getByText("ادامه در این پروژه",{exact:true}).click();
  await page.reload();await page.locator("#sessions button").first().click();
  await page.locator("#prompt").fill("ادامه بعد از باز کردن صفحه");await page.locator("#send").click();
  await page.waitForFunction(()=>document.querySelector("#prompt").value==="");
  assert(lastParts.some(p=>p.synthetic&&p.text.includes("ساختار پروژه")),"restore context must survive reload");
  busy=false;
  await page.locator("#cloud-tab").click();await page.locator("#sessions button").first().click();
  await page.getByRole("button",{name:"حذف از حساب",exact:true}).click();await page.locator("#cloud-delete-confirm").click();
  await page.waitForFunction(()=>document.querySelector("#save-state").textContent==="نسخهٔ حساب حذف شد"&&!document.querySelector("#sessions button"));assert.equal(deletes,1);assert.equal(await page.locator("#sessions button").count(),0);
  await page.locator("#local-tab").click();await page.locator("#sessions button").first().click();
  await page.locator("#save").click();await page.locator("#confirm-save").click();await page.waitForFunction(()=>document.querySelector("#save-state").textContent.includes("ذخیره"));await page.locator("#cloud-tab").click();await page.locator("#sessions button").first().click();
  assert.notEqual(account.saved.id,deletedId,"an explicit fresh backup must not resurrect the deleted cloud ID");
  await page.getByRole("button",{name:"حذف از حساب",exact:true}).click();await page.keyboard.press("Escape");assert.equal(deletes,1,"Escape must reset the previous delete consent");
  await page.getByText("ادامه در این پروژه",{exact:true}).click();
  await page.locator("#logout").click();await page.locator("#login").waitFor({state:"visible"});
  assert.equal(await page.locator("#sessions button").count(),0);identity="synthetic-account-b";
  await page.locator("#login").click();await page.locator("#budget-form button").waitFor({state:"visible",timeout:10000});await page.locator("#budget-form button").click();
  await page.locator("#sessions button").first().click();await page.locator("#prompt").fill("حساب دوم");await page.locator("#send").click();
  await page.waitForFunction(()=>document.querySelector("#prompt").value==="");
  assert.equal(lastParts.length,1,"previous account context must never enter another account prompt");
  assert.deepEqual(errors,[]);
  console.log("PaastaCode browser tests passed: login, budget, permission, save/readback, XSS, desktop, 390/320px, dark, send.");
}finally{await browser.close();await app.close();}
