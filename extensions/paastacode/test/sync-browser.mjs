import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {resolve} from "node:path";
process.env.PAASTACODE_HOME=resolve(".artifacts/sync-browser-"+process.pid);
const {chromium}=createRequire(import.meta.url)("playwright"),{startServer}=await import("../src/server.mjs");
const sessionId="ses_syncBrowser",session={id:sessionId,title:"گفتگوی آزمایشی",directory:process.cwd()};
let text="متن روی دستگاه",writes=0;
const cloud=new Map();
const account={origin:"https://paasta.test",credentials:{token:"synthetic",aiKey:"synthetic"},context:async()=>({account:{id:"user",tenantId:"tenant",name:"حساب آزمایشی",balanceToman:0},models:[]}),
  async request(path,options={}){
    if(options.method==="PUT"){
      const body=options.body,previous=cloud.get(body.id);if((previous?.revision||0)!==body.revision)throw Object.assign(new Error("گفتگو در حساب تغییر کرده است."),{status:409});
      writes++;const saved={...structuredClone(body),revision:body.revision+1};cloud.set(body.id,saved);return {id:saved.id,revision:saved.revision};
    }
    return cloud.get(path.split("?id=")[1]);
  }};
const runtime={url:"http://127.0.0.1:1",async stop(){},async call(path){
  if(path==="/session")return [session];if(path==="/session/"+sessionId)return session;
  if(path==="/session/"+sessionId+"/message")return [{info:{role:"user"},parts:[{type:"text",text},{type:"tool",tool:"read",state:{status:"completed",title:"خواندن فایل",output:"synthetic-private-tool-output"}}]}];
  if(path==="/session/status")return {};if(path==="/permission")return [];throw new Error("Unexpected synthetic route");
}};
const hosted=process.env.PAASTACODE_SYNC_HOSTED==="true";
const app=await startServer({account,runtime,hosted,deployment:{state:async()=>({connected:false})}});
const browser=await chromium.launch({headless:true,channel:process.platform==="win32"?"msedge":undefined}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on("pageerror",error=>errors.push(error.message));
try{
  if(hosted){
    const cdp=await page.context().newCDPSession(page),{targetInfo}=await cdp.send("Target.getTargetInfo");
    for(const name of ["local-network-access","loopback-network"])await cdp.send("Browser.setPermission",{browserContextId:targetInfo.browserContextId,origin:"https://code.paasta.cloud",permission:{name},setting:"granted"});
    await page.goto("https://code.paasta.cloud/#local="+encodeURIComponent(app.url)+"&cap="+app.capability);await page.locator("#workspace-connect button").click();await page.locator("#workspace-connect").waitFor({state:"hidden"});
  }else await page.goto(app.launchUrl);
  await page.locator("#sessions button").click();await page.locator("#sync-open").waitFor({state:"visible"});
  assert.equal(writes,0);await page.locator("#sync-open").click();await page.locator("#sync-enabled").check();await page.keyboard.press("Escape");assert.equal(writes,0);
  await page.locator("#sync-open").click();assert.equal(await page.locator("#sync-enabled").isChecked(),false);
  await page.locator("#sync-enabled").check();await page.locator('#sync-dialog button[value="apply"]').click();
  await page.getByText("ذخیرهٔ خودکار: روشن",{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector("#sync-detail").textContent.startsWith("آخرین ذخیره:"),{},{timeout:16000});
  assert.equal(writes,1);const oldId=[...cloud.keys()][0];assert(!JSON.stringify(cloud.get(oldId)).includes("synthetic-private-tool-output"));
  cloud.get(oldId).revision++;cloud.get(oldId).snapshot.messages[0].text="<script>متن دستگاه دیگر</script>";text="متن تازهٔ محلی";
  await page.locator("#sync-copy").waitFor({state:"visible",timeout:16000});
  await page.getByText("ذخیرهٔ خودکار: متوقف",{exact:true}).waitFor();
  await page.locator("#sync-review").click();await page.locator("#sync-review-dialog").waitFor({state:"visible"});assert.equal(await page.locator("#sync-review-messages script").count(),0);await page.locator("#sync-review-close").click();
  await page.locator("#sync-copy").click();await page.keyboard.press("Escape");assert.equal(cloud.size,1);
  for(const width of [390,320]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.screenshot({path:".artifacts/sync-conflict-mobile.png"});
  await page.emulateMedia({colorScheme:"dark"});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:".artifacts/sync-conflict-dark.png"});await page.emulateMedia({colorScheme:"light"});
  await page.locator("#sync-copy").click();await page.locator('#sync-copy-dialog button[value="apply"]').click();await page.getByText("نسخهٔ مستقلی از متن محلی در حساب ذخیره شد. نسخهٔ قبلی تغییری نکرد.",{exact:true}).waitFor();
  assert.equal(cloud.size,2);assert.equal(cloud.get(oldId).snapshot.messages[0].text,"<script>متن دستگاه دیگر</script>");
  await page.locator("#sync-open").click();await page.locator("#sync-enabled").uncheck();await page.locator('#sync-dialog button[value="apply"]').click();await page.getByText("ذخیرهٔ خودکار: خاموش",{exact:true}).waitFor();assert.deepEqual(errors,[]);
  console.log("Optional sync browser passed: explicit consent, Escape, automatic text-only backup, conflict review/copy and 320px RTL");
}finally{await browser.close();await app.close();}
