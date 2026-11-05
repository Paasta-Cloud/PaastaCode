import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import {chromium} from "playwright";

const user="00000000-0000-4000-8000-000000000001",tenant="00000000-0000-4000-8000-000000000002",workspace="00000000-0000-4000-8000-000000000003";
const owner=user+":"+tenant,transfer="A".repeat(32),zip=Buffer.from("504b05060000000000000000000000000000000000000000","hex");
let origin,fail=false,starts=0,cancels=0;
const requests=[];
const server=createServer(async(request,response)=>{
  const url=new URL(request.url,origin),path=url.pathname;
  const json=(value,status=200)=>{response.writeHead(status,{"Content-Type":"application/json"});response.end(JSON.stringify(value));};
  try{
    if(path.startsWith("/api/paastacode/workspaces")){
      requests.push(path);
      if(path.endsWith('/runtime/projects'))return json({projects:[{id:'default',name:'پروژهٔ اصلی'}],activeProject:'default'});
      if(path.endsWith("/runtime/export")){
        assert.equal(request.headers["x-paastacode-owner"],owner);
        assert.equal(request.headers['x-paastacode-project'],'default');
        if(request.method==="POST"){starts++;request.resume();return json({id:transfer});}
        assert.equal(url.searchParams.get("id"),transfer);
        if(request.method==="DELETE"){cancels++;request.resume();return json({ok:true});}
        if(fail)return json({error:"خروجی پروژه کامل نشد؛ دوباره تلاش کنید."},502);
        assert.equal(url.searchParams.get("offset"),"0");return json({offset:0,nextOffset:zip.length,data:zip.toString("base64"),sha256:createHash("sha256").update(zip).digest("hex"),done:true});
      }
      if(path.endsWith("/export")){
        assert.equal(url.searchParams.get("id"),transfer);assert.equal(url.searchParams.get("owner"),owner);assert.equal(url.searchParams.get('project'),'default');
        response.writeHead(200,{"Content-Type":"application/zip","Content-Disposition":'attachment; filename="PaastaCode-project.zip"',"Content-Length":zip.length});response.end(zip);return;
      }
      if(path.endsWith("/catalog"))return json({enabled:false,plans:[],storage:[]});
      return json({account:{id:user,tenantId:tenant,name:"حساب آزمایشی",balanceToman:0},workspaces:[{id:workspace,name:"پروژهٔ دانلود",status:"ready",first_ready_at:new Date().toISOString(),current_period_end:new Date(Date.now()+86400000).toISOString()}]});
    }
    const name=path==="/"?"index.html":path.slice(1);
    if(!/^(?:[a-z-]+\.(?:js|css|html)|fonts\/(?:Vazirmatn\.woff2|YekanBakh\.ttf)|brand\.png)$/.test(name)){response.writeHead(404);response.end();return;}
    let bytes=await readFile(resolve("web",name));
    // Use the same hosted UI on the local fixture origin; no download request
    // is intercepted or mocked by Playwright.
    if(name==="hosted.js")bytes=Buffer.from(bytes.toString().replace('export const hostedOrigin="https://code.paasta.cloud";',`export const hostedOrigin=${JSON.stringify(origin)};`));
    response.writeHead(200,{"Content-Type":name.endsWith(".js")?"text/javascript":name.endsWith(".css")?"text/css":name.endsWith(".html")?"text/html":"application/octet-stream"});response.end(bytes);
  }catch(error){if(error.code!=="ENOENT")console.error(error.message);response.writeHead(error.code==="ENOENT"?404:500);response.end();}
});
await new Promise(done=>server.listen(0,"127.0.0.1",done));origin="http://127.0.0.1:"+server.address().port;
const browser=await chromium.launch({headless:true,channel:process.env.PAASTACODE_BROWSER_CHANNEL||(process.platform==="win32"?"msedge":undefined)});
try{
  const page=await browser.newPage({acceptDownloads:true}),errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(origin);const button=page.getByRole("button",{name:"دریافت پروژهٔ فعال",exact:true});await button.waitFor();
  const receive=async()=>{const pending=page.waitForEvent("download");await button.click();const download=await pending;assert.equal(await download.failure(),null);assert.equal(download.suggestedFilename(),"PaastaCode-project.zip");assert.deepEqual(await readFile(await download.path()),zip);};
  await receive();assert((await page.locator("#hosted-feedback").innerText()).includes("شروع شد"));
  fail=true;await button.click();await page.waitForFunction(()=>document.querySelector("#hosted-feedback").textContent.includes("خروجی پروژه کامل نشد"));assert.equal(cancels,1);
  fail=false;await receive();assert.equal(starts,3);assert.deepEqual(errors,[]);assert(requests.every(path=>path.startsWith("/api/paastacode/workspaces")));
  console.log("Native browser ZIP download passed: complete bytes, filename, failed preparation cleanup and retry; no full-file browser buffering.");
}finally{await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
