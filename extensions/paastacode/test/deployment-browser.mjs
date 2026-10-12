import assert from "node:assert/strict";
import {resolve} from "node:path";
import {mkdir} from "node:fs/promises";
import {createRequire} from "node:module";
process.env.PAASTACODE_HOME=resolve(".artifacts/deployment-browser-state");
const {chromium}=createRequire(import.meta.url)("playwright");
const {startServer}=await import("../src/server.mjs");
let connected=false,approvals=0;const jobs=[];
const plan={id:"synthetic-plan",name:"پلن آزمایشی",hourly_price_toman:"12",monthly_price_toman:"8000"},region={id:"synthetic-region",name:"منطقهٔ آزمایشی"};
const account={origin:"https://console.paasta.cloud",credentials:{token:"synthetic"},async context(){return {account:{id:"synthetic",tenantId:"synthetic",name:"حساب آزمایشی",balanceToman:100000},models:[]};}};
const deployment={async state(){return {connected,jobs};},async begin(){return {url:"https://console.paasta.cloud/cli/authorize?code=TEST-TEST",code:"TEST-TEST"};},async poll(){connected=true;return {pending:false};},async context(){return {plans:[plan],clusters:[region],projects:[]};},
  async request(name,args){assert.equal(name,"paasta.deploy_source");const job={id:"synthetic-job",name,project:args.name,plan,region,billing:args.billing,status:"review",source:{files:[{path:"index.html",bytes:7}],bytes:7,environmentFiles:[".env"]}};jobs.push(job);return job;},
  async approve(id){assert.equal(id,"synthetic-job");assert.equal(jobs[0].status,"review");approvals++;jobs[0].status="deploying";return jobs[0];},async status(){return jobs[0];},async reject(){jobs[0].status="rejected";return jobs[0];},async disconnect(){connected=false;jobs.length=0;}};
const service=await startServer({account,runtime:{async stop(){}},deployment});
const browser=await chromium.launch({headless:true,channel:process.platform==="win32"?"msedge":undefined});const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on("pageerror",error=>errors.push(error.message));
await mkdir(".artifacts",{recursive:true});
try{
  await page.goto(service.launchUrl);await page.locator('#deploy-open').click();await page.locator('#deploy-connect').click();await page.locator('#deploy-form').waitFor({state:'visible',timeout:10000});
  await page.locator('#deploy-name').fill('fixture');await page.locator('#deploy-preview').click();await page.locator('#deploy-review').waitFor({state:'visible'});assert.equal(approvals,0);
  assert((await page.locator('#deploy-cost').textContent()).includes('۱۲'));assert((await page.locator('#deploy-files').textContent()).includes('index.html'));
  await page.screenshot({path:'.artifacts/deployment-review-desktop.png'});
  await page.setViewportSize({width:320,height:780});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await page.locator('#deploy-confirm').isVisible());
  await page.screenshot({path:'.artifacts/deployment-review-mobile.png'});
  await page.locator('#deploy-confirm').click();await page.waitForFunction(()=>document.getElementById('deploy-result').textContent.includes('در حال انتشار'));assert.equal(approvals,1);assert.equal(errors.length,0);
  console.log('Deployment browser review passed: separate grant, live price/source, explicit approval, 320px and desktop');
}finally{await browser.close();await service.close();}
