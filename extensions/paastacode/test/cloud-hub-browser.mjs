import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { chromium } from "playwright";
process.env.PAASTACODE_HOME=resolve(".artifacts/cloud-hub-browser-"+process.pid);
const {startServer}=await import("../src/server.mjs");
const app=await startServer({account:{credentials:null},runtime:{stop:async()=>{}}});
const browser=await chromium.launch({channel:process.env.PAASTACODE_BROWSER_CHANNEL||(process.platform==="win32"?"msedge":undefined)});
const userA="00000000-0000-4000-8000-000000000001",userB="00000000-0000-4000-8000-000000000002",tenant="00000000-0000-4000-8000-000000000003",existingId="00000000-0000-4000-8000-000000000004",createdId="00000000-0000-4000-8000-000000000005";
let loggedIn=false,enabled=true,account={id:userA,tenantId:tenant,name:"حساب آزمایشی",balanceToman:1000000},quotes=0,creates=0,confirmations=0,loseAck=true,exportFailure=false,emptyAccountReply=false;
const savedId='00000000-0000-4000-8000-000000000006';
const exportId="A".repeat(32),zip=Buffer.from("504b05060000000000000000000000000000000000000000","hex");
let quotaFailure=true;
let workspaces=[{id:existingId,name:"وب‌سایت فروشگاه",status:"ready",current_period_end:new Date(Date.now()+86400000*25).toISOString(),first_ready_at:new Date().toISOString()}];
const calls=[],errors=[],requests=[];
try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  await context.addCookies([{name:"paasta_session",value:"synthetic-browser-session",domain:".paasta.cloud",path:"/",secure:true,httpOnly:true,sameSite:"Lax"}]);
  page.on("pageerror",error=>errors.push(error.message));page.on("request",request=>requests.push(request.url()));
  await context.route("https://code.paasta.cloud/**",async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    const json=(body,status=200)=>route.fulfill({status,contentType:"application/json",body:JSON.stringify(body)});
    if(path==='/api/cloud')return route.fulfill({status:404,body:''});
    if(path==='/api/paastacode/sessions'){
      assert.equal(request.method(),'GET');assert.equal(request.headers()['x-paastacode-owner'],account.id+':'+account.tenantId);assert(request.headers().cookie?.includes('synthetic-browser-session'));assert.equal(request.headers().authorization,undefined);
      if(!loggedIn)return json({error:'ورود لازم است.'},403);
      if(emptyAccountReply)return route.fulfill({status:200,contentType:'application/json',body:''});
      if(url.searchParams.has('id')){assert.equal(url.searchParams.get('id'),savedId);return json({id:savedId,title:'گفتگوی حساب آزمایشی',revision:1,snapshot:{version:1,messages:[{role:'assistant',text:'متن حساب بدون اتصال پروژه'}]},features:{conditionalDelete:true}});}
      return json({sessions:[{id:savedId,title:'گفتگوی حساب آزمایشی',revision:1,updated_at:new Date().toISOString()}]});
    }
    if(path.startsWith("/api/paastacode/workspaces")){
      calls.push({path,method:request.method(),headers:request.headers(),body:request.postDataJSON()});
      if(!loggedIn)return json({error:"ورود لازم است.",workspaceError:true},403);
      if(request.headers()["x-paastacode-owner"]&&request.headers()["x-paastacode-owner"]!==account.id+":"+account.tenantId)return json({error:"حساب تغییر کرده است.",workspaceError:true},403);
      assert(request.headers().cookie?.includes("synthetic-browser-session"));assert.equal(request.headers().authorization,undefined);
      if(path.endsWith("/runtime/export")){
        if(request.method()==="POST")return json({id:exportId,name:"PaastaCode-project.zip",chunkBytes:1048576});
        assert.equal(url.searchParams.get("id"),exportId);
        if(request.method()==="DELETE")return json({ok:true});
        if(exportFailure)return json({error:"خروجی پروژه کامل نشد؛ دوباره تلاش کنید."},502);
        assert.equal(url.searchParams.get("offset"),"0");return json({offset:0,nextOffset:zip.length,data:zip.toString("base64"),sha256:createHash("sha256").update(zip).digest("hex"),done:true});
      }
      if(path.endsWith("/export")){
        assert.equal(url.searchParams.get("id"),exportId);assert.equal(url.searchParams.get("owner"),account.id+":"+account.tenantId);
        return route.fulfill({contentType:"application/zip",headers:{"Content-Disposition":'attachment; filename="PaastaCode-project.zip"'},body:zip});
      }
      if(path.endsWith('/runtime/quota'))return quotaFailure?json({error:'مسیر درخواست مجاز نیست.',workspaceError:true},404):json({active:true,plan:'پایه',startsAt:new Date().toISOString(),endsAt:new Date(Date.now()+25*86400000).toISOString(),quotas:{week:{remainingPercent:75,resetAt:new Date(Date.now()+86400000).toISOString()}}});
      if(path.endsWith('/runtime/projects')||path.endsWith('/runtime/projects/select'))return json({projects:[{id:'default',name:'پروژهٔ اصلی'}],activeProject:'default'});
      if(path.endsWith("/runtime/state"))return json({connected:true,configured:true,workspace:"/data/private-path",account:{...account,balanceToman:1000000},models:[{id:"synthetic",name:"مدل پاستا",input_toman_per_million:100,output_toman_per_million:200}],features:{independentRuntime:true,workspaceAccess:true,subscriptionUsage:true},accountRevision:1,accessMode:"review"});
      if(path.includes("/runtime/"))return json(path.endsWith("/status")?{}:[]);
      if(path.endsWith("/catalog"))return json({enabled,plans:[{id:"basic",name:"پایه",cpu_millicores:1000,memory_mib:2048,monthly_price_toman:"100000"}],storage:[{id:existingId,name:"دیسک پروژه",region:"تهران",min_size_gb:1,max_size_gb:50,price_per_gb_month_toman:"2000"}]});
      if(path.endsWith("/quote")){quotes++;const body=request.postDataJSON();assert.equal(body.sizeGiB,5);return json({id:createdId,token:"synthetic-create-token",name:body.name,computeToman:100000,storageToman:10000,totalToman:110000,retentionDays:7,expiresAt:new Date(Date.now()+300000).toISOString()});}
      if(path.endsWith("/lifecycle")){
        const body=request.postDataJSON();if(body.action==="quote")return json({id:"synthetic-operation",token:"synthetic-"+body.operation,name:"وب‌سایت فروشگاه",operation:body.operation,chargeToman:body.operation==="renew"?110000:0,refundToman:100000,deletesFiles:body.operation==="cancel",retentionDays:7,expiresAt:new Date(Date.now()+300000).toISOString()});
        confirmations++;return json({status:"pending"});
      }
      if(request.method()==="POST"){
        creates++;assert.deepEqual(request.postDataJSON(),{id:createdId,quote:"synthetic-create-token"});
        if(!workspaces.some(row=>row.id===createdId))workspaces.push({id:createdId,name:"اپلیکیشن تازه",status:"starting",current_period_end:new Date(Date.now()+86400000*30).toISOString(),first_ready_at:null});
        if(loseAck){loseAck=false;return route.abort("failed");}return json({workspace:workspaces.find(row=>row.id===createdId),existing:true});
      }
      return json({workspaces,account});
    }
    const response=await fetch(app.url+path);await route.fulfill({status:response.status,headers:{"content-type":response.headers.get("content-type")||"text/plain","content-security-policy":"default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self' http://127.0.0.1:*; form-action 'none'; frame-ancestors 'none'; base-uri 'none'"},body:Buffer.from(await response.arrayBuffer())});
  });
  await page.goto("https://code.paasta.cloud/");await page.locator("#hosted-login").waitFor({state:"visible"});
  assert.equal(await page.locator(".thread-heading").isVisible(),false);assert.equal(await page.locator(".header-actions").isVisible(),false);
  assert.equal(await page.locator("#hosted-create").isVisible(),false);
  loggedIn=true;await page.locator("#hosted-refresh").click();await page.locator(".hosted-project").waitFor();
  await page.locator('#cloud-tab').click();await page.locator('[data-session="'+savedId+'"]').click();await page.getByText('متن حساب بدون اتصال پروژه',{exact:true}).waitFor();assert(await page.locator('#conversation').isVisible());assert(await page.locator('#hosted-hub').isHidden());assert(await page.getByRole('button',{name:'انتخاب فضای کار',exact:true}).isEnabled());assert.equal(await page.locator('[aria-current="true"][data-session]').count(),1);assert.equal(await page.getByRole('button',{name:'حذف از حساب',exact:true}).count(),0);await mkdir('.artifacts',{recursive:true});await page.screenshot({path:resolve('.artifacts/account-preview-desktop.png')});await page.getByRole('button',{name:'انتخاب فضای کار',exact:true}).click();assert(await page.locator('#hosted-hub').isVisible());
  await page.locator('#local-tab').click();assert(await page.locator('#hosted-hub').isVisible());assert(await page.locator('#composer').isHidden());emptyAccountReply=true;await page.locator('#cloud-tab').click();await page.getByText('پاسخ سرویس کامل دریافت نشد؛ دوباره تلاش کنید.',{exact:true}).waitFor();emptyAccountReply=false;await page.locator('#cloud-tab').click();await page.locator('[data-session="'+savedId+'"]').waitFor();assert(await page.locator('#notice').isHidden());await page.locator('#local-tab').click();await page.setViewportSize({width:320,height:800});await page.locator('#menu').click();await page.locator('#cloud-tab').click();await page.locator('[data-session="'+savedId+'"]').click();await page.getByText('متن حساب بدون اتصال پروژه',{exact:true}).waitFor();assert(await page.evaluate(()=>document.body.scrollWidth<=innerWidth));await page.screenshot({path:resolve('.artifacts/account-preview-320.png')});await page.locator('#menu').click();await page.locator('#local-tab').click();await page.locator('#rail-close').click();await page.setViewportSize({width:1440,height:1000});assert(!requests.some(url=>/^https:\/\/code\.paasta\.cloud\/api\/(?:cloud|sessions)(?:[/?]|$)/.test(url)),'no runtime request before selecting a workspace');
  await mkdir(".artifacts",{recursive:true});
  for(const [name,width,height,scheme] of [["desktop",1440,1000,"light"],["mobile",390,844,"dark"],["narrow",320,800,"light"]]){
    await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:scheme});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const downloadButton=await page.getByRole("button",{name:"دریافت پروژهٔ فعال",exact:true}).boundingBox();assert(downloadButton.y+downloadButton.height<=height,"Workspace download must be visible before scrolling");
    await page.screenshot({path:resolve(".artifacts/cloud-hub-"+name+".png"),animations:"disabled"});
  }
  await page.setViewportSize({width:1440,height:1000});await page.emulateMedia({colorScheme:"light"});
  const downloadStarted=page.waitForEvent("download");await page.getByRole("button",{name:"دریافت پروژهٔ فعال",exact:true}).click();
  // Native Chromium downloads bypass route mocks; real ZIP receipt is covered
  // by download-browser.mjs against an actual HTTP fixture server.
  const download=await downloadStarted;assert.equal(download.suggestedFilename(),"PaastaCode-project.zip");
  assert((await page.locator("#hosted-feedback").innerText()).includes("شروع شد"));assert(await page.locator("#hosted-export-note").isVisible());
  exportFailure=true;const cancelledBefore=calls.filter(call=>call.method==="DELETE").length;
  await page.getByRole("button",{name:"دریافت پروژهٔ فعال",exact:true}).click();await page.waitForFunction(()=>document.querySelector("#hosted-feedback").textContent.includes("خروجی پروژه کامل نشد"));
  assert.equal(calls.filter(call=>call.method==="DELETE").length,cancelledBefore+1,"Failed preparation must release the export lock");exportFailure=false;
  await page.locator("#hosted-create summary").click();await page.locator("#hosted-name").fill("اپلیکیشن تازه");await page.locator("#hosted-quote").click();await page.locator("#hosted-review").waitFor({state:"visible"});
  assert((await page.locator("#hosted-terms").textContent()).includes("۷ روز"));assert((await page.locator("#hosted-costs").textContent()).includes("۱۱۰٬۰۰۰"));assert.equal(creates,0);
  await page.locator("#hosted-confirm").scrollIntoViewIfNeeded();
  await page.screenshot({path:resolve(".artifacts/cloud-hub-review.png"),animations:"disabled"});
  await page.setViewportSize({width:320,height:800});await page.locator("#hosted-confirm").scrollIntoViewIfNeeded();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:resolve(".artifacts/cloud-hub-review-narrow.png"),animations:"disabled"});
  await page.setViewportSize({width:1440,height:1000});
  await page.locator("#hosted-confirm").click();await page.waitForFunction(()=>document.querySelector("#hosted-confirm").textContent.includes("تلاش دوباره"));
  assert.equal(await page.locator("#hosted-dismiss").isDisabled(),true);await page.reload();await page.locator("#hosted-review").waitFor({state:"visible"});
  await page.locator("#hosted-confirm").click();await page.locator("#hosted-review").waitFor({state:"hidden"});assert.equal(quotes,1);assert.equal(creates,2);assert.equal(workspaces.filter(row=>row.id===createdId).length,1);
  workspaces.find(row=>row.id===createdId).status="ready";workspaces.find(row=>row.id===createdId).first_ready_at=new Date().toISOString();
  await page.locator("#hosted-refresh").click();await page.locator(".hosted-project").filter({hasText:"اپلیکیشن تازه"}).getByRole("button",{name:"باز کردن"}).click();await page.locator('.cloud-project-option').click();
  await page.locator("#composer").waitFor({state:"visible"});assert.equal(await page.locator("#workspace-name").textContent(),"اپلیکیشن تازه / پروژهٔ اصلی");assert.equal(await page.locator("#local-tab").textContent(),"این فضای کار");
  await page.waitForFunction(()=>document.querySelector('#subscription-plan').textContent.includes('وضعیت اشتراک دریافت نشد'));assert.equal(await page.locator('#hosted-hub').isVisible(),false);assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('paastacode-cloud-workspace')).id),createdId,'Quota failure must preserve the chosen workspace');quotaFailure=false;await page.reload();await page.locator('#composer').waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelector('#subscription-week-label').textContent.includes('۷۵'));assert.equal(await page.locator('#workspace-name').textContent(),'اپلیکیشن تازه / پروژهٔ اصلی');
  assert(await page.locator(".thread-heading").isVisible());assert(await page.locator(".header-actions").isVisible());
  assert(!requests.some(url=>url.startsWith("http://127.0.0.1")),"cloud mode must never need a loopback runtime");
  await page.locator("#prompt").fill("پیش‌نویس پروژهٔ تازه");
  await page.locator("#hosted-open").click();await page.locator(".hosted-project").filter({hasText:"وب‌سایت فروشگاه"}).getByRole("button",{name:"باز کردن"}).click();await page.locator('.cloud-project-option').click();
  await page.waitForFunction(()=>document.querySelector("#workspace-name").textContent==="وب‌سایت فروشگاه / پروژهٔ اصلی");assert.equal(await page.locator("#prompt").inputValue(),"");
  await page.locator("#hosted-open").click();await page.locator(".hosted-project").filter({hasText:"اپلیکیشن تازه"}).getByRole("button",{name:"باز کردن"}).click();await page.locator('.cloud-project-option').click();
  await page.waitForFunction(()=>document.querySelector("#workspace-name").textContent==="اپلیکیشن تازه / پروژهٔ اصلی");assert.equal(await page.locator("#prompt").inputValue(),"پیش‌نویس پروژهٔ تازه");
  await page.locator("#hosted-open").click();await page.locator(".hosted-project").filter({hasText:"وب‌سایت فروشگاه"}).getByRole("button",{name:"لغو",exact:true}).click();
  await page.locator("#hosted-review").waitFor({state:"visible"});assert((await page.locator("#hosted-terms").textContent()).includes("برای همیشه حذف"));
  for(const scheme of ["light","dark"]){
    await page.emulateMedia({colorScheme:scheme});await page.locator("#hosted-confirm").hover();
    await page.screenshot({path:resolve(".artifacts/cloud-hub-cancel-"+scheme+".png"),animations:"disabled"});
    const contrast=await page.locator("#hosted-confirm").evaluate(button=>{
      const luminance=rgb=>rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
      const style=getComputedStyle(button),a=luminance(style.color),b=luminance(style.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    });assert(contrast>=4.5,"destructive action must be legible in both themes, including hover");
  }
  await page.keyboard.press("Escape");assert.equal(confirmations,0);
  await page.locator("#hosted-open").click();await page.locator("#hosted-dismiss").click();await page.locator("#hosted-close").click();
  await page.locator("#prompt").fill("پیش‌نویس خصوصی حساب اول");
  account={...account,id:userB,name:"حساب دوم"};workspaces=[];
  await page.waitForFunction(()=>document.querySelector("#hosted-account-name").textContent==="حساب دوم",{},{timeout:12000});
  assert.equal(await page.locator("#hosted-hub").isVisible(),true);assert.equal(await page.locator("#prompt").inputValue(),"");assert.equal(await page.locator("#hosted-list").locator("h3").count(),0);
  enabled=false;workspaces=[{id:existingId,name:'<img src=x onerror="alert(1)">',status:"ready",current_period_end:new Date(Date.now()-1000).toISOString(),first_ready_at:new Date().toISOString()}];
  await page.locator("#hosted-refresh").click();await page.getByText("نیاز به تمدید",{exact:true}).waitFor();
  assert.equal(await page.locator("#hosted-create").isVisible(),false);assert.equal(await page.locator("#hosted-list img").count(),0);assert.equal(await page.locator("#hosted-list").getByRole("button",{name:"باز کردن"}).count(),0);
  await page.locator("#hosted-local summary").click();assert.equal(await page.locator("#workspace-connect").isVisible(),true);
  account={id:userA,tenantId:tenant,name:'حساب مرورگر',balanceToman:1000000};loggedIn=true;enabled=false;workspaces=[];
  await context.route(app.url+'/api/**',async route=>{
    const headers={'Access-Control-Allow-Origin':'https://code.paasta.cloud','Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Private-Network':'true'};
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    const path=new URL(route.request().url()).pathname;if(path==='/api/deployment/state')return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify({connected:false,jobs:[]})});assert.equal(path,'/api/state');return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify({connected:true,configured:false,workspace:'local-fixture',features:{},models:[],account:{id:userB,tenantId:tenant,name:'حساب اجرای محلی',balanceToman:5000}})});
  });
  const localPage=await context.newPage();localPage.on('pageerror',error=>errors.push(error.message));await localPage.goto('https://code.paasta.cloud/');await localPage.waitForFunction(()=>document.getElementById('account-name').textContent==='حساب مرورگر');await localPage.locator('#hosted-local summary').click();await localPage.locator('#workspace-link').fill(app.url+'/#cap='+app.capability);await localPage.locator('#workspace-connect button').click();await localPage.waitForFunction(()=>document.getElementById('account-name').textContent==='حساب اجرای محلی');
  const browserProfileRefresh=localPage.waitForResponse(r=>new URL(r.url()).pathname==='/api/paastacode/workspaces'&&r.request().method()==='GET');await localPage.locator('#hosted-open').click();await browserProfileRefresh;await localPage.waitForFunction(()=>document.getElementById('hosted-account-name').textContent==='حساب مرورگر');assert.equal(await localPage.locator('#account-name').textContent(),'حساب اجرای محلی','browser account refresh cannot replace the connected local runtime identity');assert((await localPage.locator('#account-detail').textContent()).includes('۵٬۰۰۰'));await localPage.close();
  assert.deepEqual(errors,[]);assert(calls.some(call=>call.path.includes("/runtime/")&&call.headers["x-paastacode-owner"]===userA+":"+tenant));
  console.log("Hosted cloud browser: desktop/mobile, same-origin transport, cost review/retry, project switch/drafts, account isolation, expiry, safe names, local fallback and cancellation contrast passed.");
}finally{await browser.close();await app.close();}
