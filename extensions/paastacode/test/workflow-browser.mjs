import assert from "node:assert/strict";
import {resolve} from "node:path";
import {mkdir} from "node:fs/promises";
import {chromium} from "playwright";
process.env.PAASTACODE_HOME=resolve(".artifacts/workflow-browser-"+process.pid);
const {startServer}=await import("../src/server.mjs");
let busy=false,aborts=0;const sessions=[],messages=new Map(),prompts=[];
const runtime={url:null,async start(){this.url="http://127.0.0.1:1";},async stop(){},async call(path,options={}){
  if(path==="/session"){if(options.method==="POST"){const session={id:"ses_"+(sessions.length+1),title:options.body.title,directory:process.cwd()};sessions.push(session);messages.set(session.id,[]);return session;}return sessions;}
  if(path==="/session/status")return busy?{[sessions[0].id]:{type:"busy"}}:{};
  if(path==="/permission")return [];
  const id=path.split("/")[2];
  if(path.endsWith("/message"))return messages.get(id);
  if(path.endsWith("/abort")){busy=false;aborts++;return true;}
  if(path.endsWith("/prompt_async")){prompts.push(options.body);messages.get(id).push({info:{id:"msg_"+prompts.length,role:"user"},parts:options.body.parts});busy=true;return null;}
  return sessions.find(s=>s.id===id);
}};
const account={origin:"https://example.test",credentials:{token:"synthetic",aiKey:"synthetic"},async context(){return {account:{id:"synthetic",tenantId:"synthetic",name:"حساب آزمایشی",balanceToman:1000},models:[{id:"professional",name:"Kimi K3",supported_parameters:["tools"],input_toman_per_million:100,output_toman_per_million:300},{id:"economy",name:"GLM-5.3-Flash",supported_parameters:["tools"],input_toman_per_million:10,output_toman_per_million:30}]};}};
const app=await startServer({account,runtime}),browser=await chromium.launch({headless:true,channel:process.env.PAASTACODE_BROWSER_CHANNEL||(process.platform==="win32"?"msedge":undefined)});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on("pageerror",error=>errors.push(error.message));
try{
  await page.goto(app.launchUrl);await page.locator("#workflow-controls").waitFor();
  assert.equal(await page.locator("#workflow-phase").inputValue(),"auto");assert.equal(await page.locator("#model").inputValue(),"professional");assert.equal(await page.locator("#execution-model").inputValue(),"economy");assert.equal(await page.locator("#model-settings").getAttribute("open"),null);
  await page.locator("#model-settings summary").click();await page.locator("#workflow-phase").selectOption("plan");await page.locator("#model").selectOption("professional");assert.equal(await page.locator("#execution-model").inputValue(),"economy");
  await page.locator("#prompt").fill("برنامهٔ بهبود ورود را بنویسید.");await page.locator("#send").click();await page.locator("#activity").waitFor();
  await page.waitForFunction(()=>document.querySelector("#model-restart").hidden);
  await page.locator("#model").selectOption("economy");await page.locator("#model-restart").click();
  for(let i=0;i<50&&prompts.length<2;i++)await page.waitForTimeout(100);assert.equal(aborts,1);assert.equal(prompts.at(-1).model.modelID,"economy");assert.equal(prompts.at(-1).agent,"paasta-plan");
  busy=false;messages.get(sessions[0].id).push({info:{id:"msg_plan",role:"assistant",agent:"paasta-plan",time:{completed:1}},parts:[{type:"text",text:"ابتدا اعتبارسنجی ورود را اصلاح کنید؛ سپس تست ورود ناموفق و موفق را اجرا کنید."}]});
  await page.waitForFunction(()=>!document.querySelector("#execute-plan").disabled);
  await mkdir(".artifacts",{recursive:true});await page.screenshot({path:".artifacts/workflow-desktop.png"});
  for(const width of [390,320]){await page.setViewportSize({width,height:844});await page.waitForTimeout(100);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const composer=await page.locator("#composer").boundingBox();assert(composer.y+composer.height<=844);await page.screenshot({path:`.artifacts/workflow-${width}.png`});}
  await page.locator("#execute-plan").click();for(let i=0;i<30&&prompts.length<3;i++)await page.waitForTimeout(100);assert.equal(prompts.at(-1).agent,"build");assert.equal(prompts.at(-1).model.modelID,"economy");
  busy=false;await page.locator("#activity").waitFor({state:"hidden"});
  const otherClient=await fetch(app.url+"/api/prompt",{method:"POST",headers:{Authorization:"Bearer "+app.capability,"Content-Type":"application/json"},body:JSON.stringify({id:sessions[0].id,phase:"plan",model:"professional",executionModel:"economy",text:"Plan from another client"})});assert.equal(otherClient.status,200);
  await page.waitForFunction(()=>document.querySelector("#workflow-phase").value==="plan",{},{timeout:7000});assert.equal(await page.locator("#model").inputValue(),"professional","Another client's model selection must appear without reopening the session");busy=false;
  await page.setViewportSize({width:1440,height:1000});await page.locator("#import-open").click();await page.locator("#import-rules").uncheck();await page.locator("#import-source").selectOption("cursor");
  await page.locator("#import-file").setInputFiles({name:"conversation.md",mimeType:"text/markdown",buffer:Buffer.from("# Context\nKeep RTL. <script>window.importExecuted=true</script>")});
  await page.locator("#import-form button").click();await page.locator("#import-review").waitFor();assert.equal(sessions.length,1,"Preview must not create a session");
  await page.setViewportSize({width:320,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:".artifacts/import-320.png"});
  await page.locator("#import-confirm").click();await page.locator("#import-dialog").waitFor({state:"hidden"});await page.locator("#messages").getByText(/Keep RTL/).waitFor();
  assert.equal(await page.evaluate(()=>window.importExecuted),undefined);assert.equal(sessions.length,2);assert.equal(prompts.length,4,"Import cannot run inference or execute old tools");assert.deepEqual(errors,[]);
  await page.setViewportSize({width:1440,height:1000});await page.locator("#new").click();
  assert.equal(await page.locator("#workflow-phase").inputValue(),"auto");await page.locator("#prompt").fill("فرم ورود را اصلاح کن");await page.locator("#send").click();
  for(let i=0;i<50&&prompts.length<5;i++)await page.waitForTimeout(100);
  busy=false;messages.get(sessions.at(-1).id).push({info:{id:"msg_auto_plan",role:"assistant",agent:"paasta-plan",time:{created:Date.now(),completed:Date.now()}},parts:[{type:"text",text:"Plan the validation change"}]});
  for(let i=0;i<80&&prompts.length<6;i++)await page.waitForTimeout(100);assert.equal(prompts.at(-1).agent,"build");assert.equal(prompts.at(-1).model.modelID,"economy");
  await page.waitForFunction(()=>document.querySelector("#workflow-summary").textContent.includes("GLM-5.3-Flash"));assert.match(await page.locator("#price").innerText(),/GLM-5.3-Flash/);
  assert(!(await page.locator("#price").innerText()).includes("Kimi K3"),"Active execution must show the actual economy model price");
  console.log("Workflow browser acceptance passed: plan/executor pricing, live model restart, desktop/390/320px, text import preview and no script execution.");
}finally{await browser.close();await app.close();}
