import assert from "node:assert/strict";
import {mkdir} from "node:fs/promises";
import {createRequire} from "node:module";
import {resolve} from "node:path";
process.env.PAASTACODE_HOME=resolve(".artifacts/browser-state-"+process.pid);
const {chromium}=createRequire(import.meta.url)("playwright");
const {startServer}=await import("../src/server.mjs");
const sessionId="ses_browserSynthetic";
const sessions=[{id:sessionId,title:"بررسی ساختار پروژه",directory:process.cwd()}];
const messages=[{info:{role:"user"},parts:[{type:"text",text:"ساختار پروژه را بررسی کن."}]},
  {info:{role:"assistant"},parts:[{type:"text",text:"مسیرهای پروژه بررسی شدن. برای شروع، فایل ورودی را باز کن.\n\n```js\nconst message = '<script>alert(1)</script>';\nconsole.log(message);\n```"}]}];
let grants=0,saves=0,connected=false,identity="synthetic-user",busy=false,lastParts,failCreate=false;
const account={origin:"https://console.paasta.cloud",credentials:null,
  async context(){return {account:{id:identity,tenantId:"synthetic-tenant",name:"حساب آزمایشی",balanceToman:100000},models:[{id:"synthetic",name:"مدل آزمایشی",supported_parameters:["tools"],input_toman_per_million:100,output_toman_per_million:300},{id:"test/kimi-k2.7-code",name:"Kimi K2.7 Code",supported_parameters:["tools"],input_toman_per_million:200,output_toman_per_million:400}]};},
  async begin(){return {url:"https://console.paasta.cloud/cli/authorize?code=TEST-TEST",code:"TEST-TEST"};},
  async poll(){this.credentials={token:"synthetic"};return {pending:false};},
  async connect(){this.credentials.aiKey="synthetic";connected=true;return {dailyLimitToman:50000};},
  async logout(){this.credentials=null;},
  async request(_path,options={}){
    if(options.method==="PUT"){saves++;this.saved={...options.body,revision:1};return {id:this.saved.id,revision:1};}
    if(_path.includes("?id="))return this.saved;return {sessions:this.saved?[this.saved]:[]};
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
const browser=await chromium.launch({headless:true,channel:"msedge"});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on("pageerror",error=>errors.push(error.message));
try{
  assert.equal((await fetch(app.url+"/api/state")).status,401);
  assert.equal((await fetch(app.url+"/api/login",{method:"POST",headers:{Authorization:"Bearer "+app.capability,Origin:"https://evil.test"}})).status,403);
  await page.goto(app.launchUrl);await page.locator("#login").waitFor();
  await page.evaluate(()=>document.fonts.ready);
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
  assert.equal(grants,1);
  assert.equal(await page.locator("#messages script").count(),0);
  await page.locator("#save").click();await page.locator("#confirm-save").click();
  await page.getByText("در حساب ذخیره شد",{exact:true}).waitFor();assert.equal(saves,1);
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
  await page.waitForFunction(()=>getComputedStyle(document.querySelector("#save")).backgroundColor==="rgb(17, 21, 30)");
  await page.screenshot({path:".artifacts/conversation-dark.png",fullPage:true,animations:"disabled"});
  await page.locator("#prompt").fill("یک بررسی دیگر");
  await page.locator("#send").click();await page.waitForFunction(()=>document.querySelector("#prompt").value==="");
  assert.equal(messages.at(-1).parts[0].text,"یک بررسی دیگر");
  await page.waitForFunction(()=>document.querySelector("#send").disabled);
  await page.setViewportSize({width:1440,height:1000});
  await page.locator("#cloud-tab").click();pending=true;
  await page.getByText("فقط همین بار",{exact:true}).waitFor();
  await page.getByText("فقط همین بار",{exact:true}).click();assert.equal(grants,2,"cloud list must not stop local approval polling");
  busy=false;await page.locator("#sessions button").first().click();
  await page.getByText("ادامه در این پروژه",{exact:true}).click();
  await page.reload();await page.locator("#sessions button").first().click();
  await page.locator("#prompt").fill("ادامه بعد از باز کردن صفحه");await page.locator("#send").click();
  await page.waitForFunction(()=>document.querySelector("#prompt").value==="");
  assert(lastParts.some(p=>p.synthetic&&p.text.includes("ساختار پروژه")),"restore context must survive reload");
  busy=false;
  await page.locator("#cloud-tab").click();await page.locator("#sessions button").first().click();
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
