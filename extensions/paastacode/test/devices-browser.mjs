import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {resolve} from "node:path";
process.env.PAASTACODE_HOME=resolve(".artifacts/devices-browser-"+process.pid);
const {chromium}=createRequire(import.meta.url)("playwright");
const {startServer}=await import("../src/server.mjs");
const peer="00000000-0000-4000-8000-000000000001",current="00000000-0000-4000-8000-000000000002";
const devices=[{id:peer,name:"<script>synthetic</script>",device_client_id:"paastacode-deploy",expires_at:"2099-01-01",last_used_at:"invalid"},{id:current,name:"PaastaCode",current:true,device_client_id:"paastacode",expires_at:"2099-01-01"}];
let revokes=0,stops=0,disconnects=0;
const account={credentials:{token:"synthetic"},context:async()=>({account:{name:"حساب آزمایشی"},models:[]}),
  async forget(){this.credentials=null;},async request(path,{method}={}){
    if(method==="DELETE"){revokes++;const device=devices.find(d=>path.endsWith(d.id));device.revoked_at="2026-10-12";return {ok:true,revoked:true,current:!!device.current};}
    return {devices};
  }};
const app=await startServer({account,runtime:{async stop(){stops++;}},deployment:{state:async()=>({connected:false}),async disconnect(){disconnects++;}}});
const browser=await chromium.launch({headless:true,channel:process.env.PAASTACODE_BROWSER_CHANNEL||(process.platform==="win32"?"msedge":undefined)});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on("pageerror",e=>errors.push(e.message));
try{
  await page.goto(app.launchUrl);await page.locator("#devices-open").click();
  await page.locator(".device-connection").first().waitFor();assert.equal(await page.locator("#device-connections script").count(),0);
  const peerButton=page.locator(".device-connection").first().getByRole("button");
  await peerButton.click();await page.keyboard.press("Escape");await page.waitForFunction(()=>!document.querySelector("#device-revoke-dialog").open);assert.equal(revokes,0);
  await peerButton.click();await page.locator('#device-revoke-dialog button[value="revoke"]').click();
  await page.getByText("اتصال قطع شد. گفتگوهای حساب و فایل‌های پروژه باقی می‌مانند.",{exact:true}).waitFor();assert.equal(revokes,1);assert.equal(stops,0);
  const currentButton=page.locator(".device-connection").nth(1).getByRole("button");
  await currentButton.click();await page.keyboard.press("Escape");await page.waitForFunction(()=>!document.querySelector("#device-revoke-dialog").open);assert.equal(revokes,1,"Escape cannot reuse prior revoke consent");
  for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator("#devices-dialog").evaluate(el=>el.scrollWidth<=el.clientWidth),true);}
  await page.screenshot({path:".artifacts/devices-mobile.png"});
  await currentButton.click();await page.locator('#device-revoke-dialog button[value="revoke"]').click();
  await page.locator("#login").waitFor({state:"visible"});assert.equal(revokes,2);assert.equal(stops,1);assert.equal(disconnects,1);assert(await page.locator("#devices-open").isDisabled());assert.deepEqual(errors,[]);
  console.log("Device management: escaped metadata, cancel/repeated Escape, peer/current revocation and 320px RTL passed");
}finally{await browser.close();await app.close();}
