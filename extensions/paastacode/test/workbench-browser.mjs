import assert from "node:assert/strict";
import {mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import {chromium} from "playwright";
process.env.PAASTACODE_HOME=resolve(".artifacts/workbench-state-"+process.pid);
const {startServer}=await import("../src/server.mjs");
const id="ses_workbench",session={id,title:"بهبود تجربهٔ گفتگو",directory:process.cwd()};
const messages=Array.from({length:24},(_,i)=>({info:{id:"msg_"+i,role:i%2?"assistant":"user"},parts:[{type:"text",text:i%2?"ساختار پروژه بررسی شد. تغییرات را در همان بخش اعمال می‌کنم و سپس نتیجهٔ تست را بررسی می‌کنم.":"مسیر ورود و نمایش گفتگو را بررسی کنید."}]}));
messages.push({info:{id:"msg_tool",role:"assistant"},parts:[{id:"part_tool",callID:"call_read",type:"tool",tool:"read",state:{status:"running",title:"src/components/conversation.tsx",input:{filePath:"src/components/conversation.tsx"},output:"export function Conversation() {}"}}]});
messages.push({info:{id:"msg_empty",role:"assistant"},parts:[]});
let busy=true;
const account={origin:"https://example.test",credentials:{token:"synthetic",aiKey:"synthetic"},async context(){return {account:{id:"synthetic",tenantId:"synthetic",name:"حساب آزمایشی",balanceToman:10000},models:[{id:"synthetic",name:"مدل آزمایشی",supported_parameters:["tools"],input_toman_per_million:100,output_toman_per_million:300}]};}};
const runtime={url:null,async start(){this.url="http://127.0.0.1:1";},async stop(){this.url=null;},async call(path,options={}){
  if(path==="/session")return options.method==="POST"?session:[session];
  if(path==="/session/"+id)return session;
  if(path.endsWith("/message"))return messages;
  if(path==="/session/status")return busy?{[id]:{type:"busy"}}:{};
  if(path==="/permission")return [];
  throw new Error("Unexpected synthetic path "+path);
}};
const app=await startServer({account,runtime}),browser=await chromium.launch({headless:true,channel:process.env.PAASTACODE_BROWSER_CHANNEL||(process.platform==="win32"?"msedge":undefined)});
const page=await browser.newPage({viewport:{width:1440,height:1000},colorScheme:"dark"});
const errors=[];page.on("pageerror",error=>errors.push(error.message));
try{
  await page.goto(app.launchUrl);await page.locator("#sessions button").click();
  await page.locator("#activity").waitFor({state:"visible"});
  assert.equal(await page.locator(".message").count(),25,"Empty assistant records must not create blank transcript blocks");
  await page.waitForFunction(()=>{const e=document.querySelector("#conversation");return e.scrollHeight-e.scrollTop-e.clientHeight<4;});
  await page.locator(".tool summary").click();
  messages.at(-2).parts[0].state.output+="\n// Streaming output";
  await page.getByText("// Streaming output",{exact:false}).waitFor();
  assert(await page.locator(".tool").evaluate(e=>e.open),"Expanded tool reports survive updates");
  await page.evaluate(()=>document.querySelector("#conversation").scrollTo(0,0));
  await page.waitForTimeout(80);
  messages.push({info:{id:"msg_new",role:"assistant"},parts:[{type:"text",text:"این خروجی تازه است و نباید اسکرول دستی را جابه‌جا کند."}]});
  await page.getByText("این خروجی تازه است و نباید اسکرول دستی را جابه‌جا کند.",{exact:true}).waitFor();
  assert(await page.locator("#conversation").evaluate(e=>e.scrollTop<8),"Manual reading position must stay stable");
  await page.locator("#follow-output").click();
  await page.waitForFunction(()=>{const e=document.querySelector("#conversation");return e.scrollHeight-e.scrollTop-e.clientHeight<4;});
  assert(await page.locator("#activity-label").innerText());assert(await page.locator("#stop").isVisible());
  await mkdir(".artifacts",{recursive:true});await page.screenshot({path:".artifacts/workbench-running-desktop.png"});
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});await page.waitForTimeout(100);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const prompt=await page.locator("#composer").boundingBox();assert(prompt.y+prompt.height<=844,"Composer remains on screen");
    assert(await page.locator("#activity").isVisible());await page.screenshot({path:`.artifacts/workbench-running-${width}.png`});
  }
  busy=false;await page.locator("#activity").waitFor({state:"hidden"});assert.equal(errors.length,0,errors.join("\n"));
  console.log("Workbench browser acceptance passed: live activity, auto-follow/manual reading, persistent tool expansion, empty output, desktop/390/320px.");
}finally{await browser.close();await app.close();}
