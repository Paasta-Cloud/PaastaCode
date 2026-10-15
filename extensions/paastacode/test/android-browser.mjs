import assert from "node:assert/strict";
import {mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import {chromium} from "playwright";
process.env.PAASTACODE_HOME=resolve(".artifacts/android-browser-"+process.pid);
const {startServer}=await import("../src/server.mjs");
const app=await startServer({account:{credentials:null},runtime:{stop:async()=>{}}});
const browser=await chromium.launch({channel:process.env.PAASTACODE_BROWSER_CHANNEL||(process.platform==="win32"?"msedge":undefined)});
const errors=[];
try {
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:"block"});
  let signedIn=false;
  await context.route("https://code.paasta.cloud/**",async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.startsWith("/api/")) {
      const body=!signedIn?{error:"ورود لازم است."}:url.pathname.endsWith("/catalog")?{enabled:false,plans:[],storage:[]}:{account:{id:"00000000-0000-4000-8000-000000000001",tenantId:"00000000-0000-4000-8000-000000000002",name:"حساب آزمایشی",balanceToman:0},workspaces:[]};
      return route.fulfill({status:signedIn?200:403,contentType:"application/json",body:JSON.stringify(body)});
    }
    const response=await fetch(app.url+url.pathname);
    await route.fulfill({status:response.status,contentType:response.headers.get("content-type"),body:Buffer.from(await response.arrayBuffer())});
  });
  const page=await context.newPage();page.on("pageerror",error=>errors.push(error.message));
  await page.goto("https://code.paasta.cloud/?platform=android");
  await page.locator("#hosted-login").waitFor({state:"visible"});
  assert.equal(await page.locator("#hosted-local").isVisible(),false);
  assert.equal(new URL(page.url()).search,"?platform=android");
  await page.getByRole("navigation",{name:"دسترسی سریع"}).getByRole("button",{name:"گفتگوها",exact:true}).click();
  await page.locator("#rail.open").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#rail").evaluate(node=>node.classList.contains("open")),false);
  assert.equal(await page.locator("main").evaluate(node=>node.inert),false);
  await page.getByRole("navigation").getByRole("button",{name:"حساب",exact:true}).click();
  assert.equal(await page.locator("#hosted-login").evaluate(node=>node===document.activeElement),true);
  signedIn=true;await page.locator("#hosted-refresh").click();
  await page.getByText("ساخت فضای کار ابری هنوز فعال نشده است. پروژهٔ تازه را پس از فعال‌شدن سرویس می‌توانید بسازید.",{exact:true}).waitFor();
  assert.equal(await page.locator("#hosted-create").isVisible(),false);
  await mkdir(".artifacts",{recursive:true});
  for(const width of [320,390,768]) {
    await page.setViewportSize({width,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"overflow at "+width);
    await page.screenshot({path:`.artifacts/android-hub-${width}.png`,fullPage:true});
  }
  await page.reload();await page.locator("#hosted-hub").waitFor({state:"visible"});
  assert.equal(await page.locator("#hosted-local").isVisible(),false,"reload retains Android mode");
  await context.close();

  // Real service worker, network and offline navigation, without mocked worker APIs.
  const offline=await browser.newContext({viewport:{width:390,height:844}}),offpage=await offline.newPage();
  await offpage.goto(app.url+"/offline.html");
  await offpage.evaluate(async()=>{await navigator.serviceWorker.register("/sw.js");await navigator.serviceWorker.ready;});
  await offpage.reload();await offpage.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const manifest=await (await offline.request.get(app.url+"/manifest.webmanifest")).json();
  assert.equal(manifest.start_url,"/?platform=android");
  for(const icon of manifest.icons)assert.equal((await offline.request.get(app.url+icon.src)).status(),200);
  await offline.setOffline(true);await offpage.goto(app.url+"/?platform=android");
  await offpage.getByRole("heading",{name:"اتصال به اینترنت برقرار نیست"}).waitFor();
  await offpage.screenshot({path:".artifacts/android-offline.png",fullPage:true});
  const cached=await offpage.evaluate(async()=>{const cache=await caches.open("paastacode-offline-v1");return (await cache.keys()).map(request=>new URL(request.url).pathname).sort();});
  assert.deepEqual(cached,["/brand.png","/fonts/Vazirmatn.woff2","/offline.css","/offline.html"]);
  await offline.setOffline(false);await offpage.getByRole("link",{name:"تلاش دوباره"}).click();
  await offpage.locator("#onboarding").waitFor({state:"visible"});
  await offline.close();assert.deepEqual(errors,[]);
  console.log("Android web: mobile layout, unavailable-cloud state, reload, manifest/icons and real offline recovery passed.");
} finally {await browser.close();await app.close();}
