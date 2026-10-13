import assert from "node:assert/strict";
import {readFile,mkdir} from "node:fs/promises";
import {resolve} from "node:path";
process.env.PAASTACODE_HOME=resolve(".artifacts/hosted-browser-state-"+process.pid);
const {chromium}=await import("playwright");
const {startServer}=await import("../src/server.mjs");
const app=await startServer({hosted:true,account:{credentials:null},runtime:{stop:async()=>{}}});
const browser=await chromium.launch({channel:process.env.PAASTACODE_BROWSER_CHANNEL||(process.platform==="win32"?"msedge":undefined)});
try{
  const context=await browser.newContext();
  const page=await context.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));page.on("requestfailed",request=>console.log("Browser request failed: "+new URL(request.url()).pathname+" "+request.failure()?.errorText));page.on("console",message=>{if(message.type()==="error")console.log(message.text());});
  await context.route("https://code.paasta.cloud/**",async route=>{
    const path=new URL(route.request().url()).pathname;
    const response=await fetch(app.url+(path==="/"?"/":path));
    await route.fulfill({status:response.status,headers:{"content-type":response.headers.get("content-type")||"text/plain"},body:Buffer.from(await response.arrayBuffer())});
  });
  const cdp=await context.newCDPSession(page);
  const {targetInfo}=await cdp.send("Target.getTargetInfo");
  for(const name of ["local-network-access","loopback-network"])await cdp.send("Browser.setPermission",{browserContextId:targetInfo.browserContextId,origin:"https://code.paasta.cloud",permission:{name},setting:"granted"});
  await page.goto("https://code.paasta.cloud/#local="+encodeURIComponent(app.url)+"&cap="+app.capability);
  await page.locator("#workspace-connect").waitFor({state:"visible"});
  assert.equal(await page.evaluate(()=>location.hash),"");
  for(const [name,width,height,scheme] of [["desktop",1365,900,"light"],["mobile",320,800,"light"],["dark",390,800,"dark"]]){
    await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:scheme});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const bounds=await page.locator("#workspace-connect").boundingBox();assert(bounds.x>=16&&bounds.x+bounds.width<=width-16);
    const colors=await page.locator("#workspace-link").evaluate(input=>{const style=getComputedStyle(input);return {foreground:style.color,background:style.backgroundColor};});
    assert.notEqual(colors.foreground,colors.background);
    if(scheme==="dark")assert.equal(colors.background,"rgb(27, 28, 32)");
    const link=await page.locator("#workspace-link").inputValue();await page.locator("#workspace-link").fill("");
    await mkdir(".artifacts",{recursive:true});await page.screenshot({path:resolve(".artifacts/hosted-pairing-"+name+".png"),fullPage:true});
    await page.locator("#workspace-link").fill(link);
  }
  await page.emulateMedia({colorScheme:"light"});await page.setViewportSize({width:1365,height:900});
  await page.locator("#workspace-connect button").click();
  try{await page.locator("#workspace-connect").waitFor({state:"hidden",timeout:15000});}catch(error){console.log(await page.locator("#workspace-connect-error").textContent());throw error;}
  await page.locator("#onboarding").waitFor({state:"visible"});
  assert.equal(await page.locator("#login").isEnabled(),true);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).fontFamily.includes("Vazirmatn")),true);
  for(const [name,width,height] of [["desktop",1365,900],["mobile",320,800]]){
    await page.setViewportSize({width,height});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await mkdir(".artifacts",{recursive:true});await page.screenshot({path:resolve(".artifacts/hosted-"+name+".png"),fullPage:true});
  }
  assert.deepEqual(errors,[]);console.log("Hosted HTTPS browser paired with the real loopback service; desktop/mobile and font passed");
}finally{await browser.close();await app.close();}
