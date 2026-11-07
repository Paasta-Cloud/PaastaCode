import test from 'node:test';
import assert from 'node:assert/strict';
import {estimatedModelCost,modelOptions} from '../web/model-policy.js';
import {defaultTaskBudget,taskBudgetLimit} from '../web/task-budget.js';
import {createServer} from 'node:http';
import {startTaskBudgetRelay} from '../src/task-budget-relay.mjs';
const model=(id,input,output,cache)=>({id,name:id,supported_parameters:['tools'],input_toman_per_million:input,output_toman_per_million:output,cache_read_toman_per_million:cache});
const local=model('paasta/deepseek-v4-flash',33500,66600,33500),mimo=model('xiaomi/mimo-v2.6-flash',84000,168000,1680);
test('measured long cached traffic changes the recommendation; cache is not assumed free',()=>{
  const profile={samples:18,modelCache:{[mimo.id]:{samples:18,cacheRatio:0.94}},inputTokens:60000,cachedTokens:56400,outputTokens:480};
  assert(estimatedModelCost(mimo,profile)<estimatedModelCost(local,profile)/4);
  assert(estimatedModelCost(local,{inputTokens:60000,outputTokens:480})<estimatedModelCost(mimo,{inputTokens:60000,outputTokens:480}));
  assert.equal(modelOptions([local,mimo],{samples:0}).defaultModel,local.id);
  assert.equal(modelOptions([local,mimo],{...profile,modelCache:{}}).defaultModel,local.id,'A fresh model cannot inherit another model’s cache');
  assert.equal(modelOptions([local,mimo],{...profile,modelCache:{[mimo.id]:{samples:2,cacheRatio:1}}}).defaultModel,local.id,'Insufficient samples must use cold cost');
  assert.equal(modelOptions([local,mimo],profile).defaultModel,mimo.id);
  assert.equal(modelOptions([local,mimo],profile).workflowModels.buildModel,mimo.id);
  for(const cache of [undefined,null,'',false,'bad'])assert.equal(estimatedModelCost({...mimo,cache_read_toman_per_million:cache},profile),estimatedModelCost({...mimo,cache_read_toman_per_million:mimo.input_toman_per_million},profile));
  assert.equal(modelOptions([local,{...mimo,customer_free:true}],profile).defaultModel,local.id);
});
test('personal task budgets are bounded, editable amounts, not changed plan quotas',()=>{
  assert.equal(defaultTaskBudget({}, {taskBudgetDefaultToman:43750}),43750);
  assert.equal(defaultTaskBudget({}),50000);
  for(const value of [0,-1,NaN,Infinity,1.5,1000000001,''])assert.throws(()=>taskBudgetLimit(value));
  assert.equal(taskBudgetLimit('875000'),875000);
});
test('local relay binds engine session, rejects unauthorized requests and fails closed before paid dispatch',async()=>{
 let allowed=true,forwarded=0;
 const upstream=createServer(async(req,res)=>{if(req.method==='GET'){assert.equal(req.headers.authorization,'Bearer broker-cap');assert.equal(new URL(req.url,'http://test').searchParams.get('id'),'ses_owned');res.writeHead(allowed?200:403,{'content-type':'application/json'}).end(JSON.stringify({id:'00000000-0000-4000-8000-000000000001',limitToman:43750}));return;}
  forwarded++;assert.equal(req.headers.authorization,'Bearer real-provider-key');assert.equal(req.headers['x-paasta-task-budget'],'43750');assert.equal(req.headers['x-paasta-task-id'],'00000000-0000-4000-8000-000000000001');assert.equal(req.headers['x-opencode-session-id'],undefined);for await(const _ of req){}res.end('data: OK\n\n');});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+upstream.address().port;
 const relay=await startTaskBudgetRelay({upstream:origin,apiKey:'real-provider-key',bridge:{url:origin+'/budget',capability:'broker-cap'}});
 const send=token=>fetch(relay.baseURL+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+token,'x-opencode-session-id':'ses_owned','x-paasta-task-budget':'999999'},body:'{}'});
 try{assert.equal((await send('forged')).status,403);assert.equal(forwarded,0);const response=await send(relay.apiKey);assert.equal(response.status,200);assert.equal(await response.text(),'data: OK\n\n');assert.equal(forwarded,1);allowed=false;assert.equal((await send(relay.apiKey)).status,503);assert.equal(forwarded,1,'a failed budget lookup must not reach the model');}finally{await relay.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));}
});
