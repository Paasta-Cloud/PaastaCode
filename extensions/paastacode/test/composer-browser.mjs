import assert from "node:assert/strict";
import {resolve} from "node:path";
import {mkdir,readFile} from "node:fs/promises";
import {chromium} from "playwright";
process.env.PAASTACODE_HOME=resolve(".artifacts/composer-browser-"+process.pid);
const {startServer}=await import("../src/server.mjs");
const sessions=[],messages=new Map(),prompts=[];let busy=false;
const runtime={url:null,async start(){this.url="http://127.0.0.1:1";},async stop(){},async call(path,options={}){
  if(path==="/session"){if(options.method==="POST"){const session={id:"ses_"+(sessions.length+1),title:options.body.title,directory:process.cwd()};sessions.push(session);messages.set(session.id,[]);return session;}return sessions;}
  if(path==="/session/status")return busy?{[sessions.at(-1)?.id]:{type:"busy"}}:{};
  if(path==="/permission")return [];
  const id=path.split("/")[2];if(path.endsWith("/message"))return messages.get(id);
  if(path.endsWith("/abort")){busy=false;return true;}
  if(path.endsWith("/prompt_async")){prompts.push(options.body);messages.get(id).push({info:{id:"msg_"+prompts.length,role:"user"},parts:options.body.parts});return null;}
  return sessions.find(s=>s.id===id);
}};
const account={origin:"https://example.test",credentials:{token:"synthetic",aiKey:"synthetic"},async context(){return {account:{id:"synthetic",tenantId:"synthetic"},models:[{id:"professional",name:"Kimi K3",input_modalities:["text","image"],supported_parameters:["tools"],input_toman_per_million:100,output_toman_per_million:300},{id:"economy",name:"GLM-5.3-Flash",input_modalities:["text"],supported_parameters:["tools"],input_toman_per_million:10,output_toman_per_million:30}]};}};
const app=await startServer({account,runtime}),browser=await chromium.launch({headless:true,channel:process.platform==="win32"?"msedge":undefined}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on("pageerror",error=>errors.push(error.message));
const wait=async count=>{for(let i=0;i<60&&prompts.length<count;i++)await page.waitForTimeout(100);assert.equal(prompts.length,count);await page.waitForFunction(()=>!document.querySelector("#send").disabled);};
try{
  await page.goto(app.launchUrl);await page.locator("#workflow-controls").waitFor();await page.locator("#model-settings summary").click();await page.locator("#workflow-phase").selectOption("build");
  await page.locator("#prompt").fill("سطر اول");await page.locator("#prompt").press("Shift+Enter");assert.equal(await page.locator("#prompt").inputValue(),"سطر اول\n");assert.equal(prompts.length,0);
  await page.locator("#prompt").dispatchEvent("keydown",{key:"Enter",isComposing:true});assert.equal(prompts.length,0);
  await page.locator("#attachment-files").setInputFiles({name:"sample.ts",mimeType:"text/plain",buffer:Buffer.from("export const sentinel = 'سلام';")});await page.getByRole("button",{name:"حذف پیوست sample.ts"}).waitFor();
  await page.locator("#prompt").press("Enter");await wait(1);assert(prompts[0].parts.some(part=>part.text?.includes("export const sentinel")));assert.equal(await page.locator("#attachments").textContent(),"");
  await page.locator("#attachment-files").setInputFiles({name:"binary.zip",mimeType:"application/zip",buffer:Buffer.from([0,1,2])});await page.getByRole("button",{name:"حذف پیوست binary.zip"}).waitFor();await page.locator("#prompt").fill("فایل را بخوان");await page.locator("#prompt").press("Enter");await page.waitForFunction(()=>document.querySelector("#notice").textContent.includes("باینری"));assert.equal(prompts.length,1);assert.equal(await page.locator("#prompt").inputValue(),"فایل را بخوان");await page.getByRole("button",{name:"حذف پیوست binary.zip"}).click();
  await page.locator("#attachment-files").setInputFiles({name:"broken.png",mimeType:"image/png",buffer:Buffer.from("invalid image")});await page.waitForFunction(()=>document.querySelector("#notice").textContent.includes("قابل خواندن نیست"));assert.equal(await page.locator("#attachments").textContent(),"");assert.equal(prompts.length,1);
  const png=await readFile(new URL("../desktop/icon.png",import.meta.url));
  await page.evaluate(bytes=>{const data=new DataTransfer();data.items.add(new File([new Uint8Array(bytes)],"screen.png",{type:"image/png"}));document.querySelector("#prompt").dispatchEvent(new ClipboardEvent("paste",{clipboardData:data,bubbles:true,cancelable:true}));},[...png]);await page.getByRole("button",{name:"حذف پیوست screen.png"}).waitFor();await page.locator("#model").selectOption("economy");await page.locator("#prompt").press("Enter");await page.waitForFunction(()=>document.querySelector("#notice").textContent.includes("مدل انتخاب‌شده"));assert.equal(prompts.length,1);await page.locator("#model").selectOption("professional");await page.locator("#prompt").press("Enter");await wait(2);assert(prompts[1].parts.some(part=>part.type==="file"&&part.mime==="image/png"));
  await page.evaluate(()=>{const data=new DataTransfer();data.items.add(new File(["dragged-source-sentinel"],"drop.txt",{type:"text/plain"}));document.querySelector("#composer").dispatchEvent(new DragEvent("drop",{dataTransfer:data,bubbles:true,cancelable:true}));});await page.getByRole("button",{name:"حذف پیوست drop.txt"}).waitFor();await page.locator("#prompt").fill("");await page.locator("#prompt").press("Enter");await wait(3);assert(prompts[2].parts.some(part=>part.text?.includes("dragged-source-sentinel")));
  await page.locator("#attachment-files").setInputFiles({name:"pending.txt",mimeType:"text/plain",buffer:Buffer.from("pending")});await page.getByRole("button",{name:"حذف پیوست pending.txt"}).waitFor();
  await mkdir(".artifacts",{recursive:true});for(const width of [1440,390,320]){await page.setViewportSize({width,height:width===1440?1000:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`.artifacts/composer-${width}.png`});}
  await page.evaluate(()=>window.dispatchEvent(new Event("paastacode:account-changed")));assert.equal(await page.locator("#attachments").textContent(),"");assert.deepEqual(errors,[]);
  console.log("Composer: Enter, Shift+Enter, IME, source/image delivery, failure retention, account isolation and desktop/mobile passed.");
}finally{await browser.close();await app.close();}
