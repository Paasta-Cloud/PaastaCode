import test from 'node:test';
import assert from 'node:assert/strict';
import {estimatedModelCost,modelOptions} from '../web/model-policy.js';
import {defaultTaskBudget,taskBudgetLimit} from '../web/task-budget.js';
import plugin from '../src/task-budget-plugin.mjs';
const model=(id,input,output,cache)=>({id,name:id,supported_parameters:['tools'],input_toman_per_million:input,output_toman_per_million:output,cache_read_toman_per_million:cache});
const local=model('paasta/deepseek-v4-flash',33500,66600,33500),mimo=model('xiaomi/mimo-v2.6-flash',84000,168000,1680);
test('measured long cached traffic changes the recommendation; cache is not assumed free',()=>{
  const profile={samples:18,inputTokens:60000,cachedTokens:56400,outputTokens:480};
  assert(estimatedModelCost(mimo,profile)<estimatedModelCost(local,profile)/4);
  assert(estimatedModelCost(local,{inputTokens:60000,outputTokens:480})<estimatedModelCost(mimo,{inputTokens:60000,outputTokens:480}));
  assert.equal(modelOptions([local,mimo],{samples:0}).defaultModel,local.id);
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
test('trusted engine hook sends per-task headers and fails closed if its broker fails',async()=>{
  const saved={fetch:globalThis.fetch,url:process.env.PAASTA_TASK_BUDGET_BRIDGE,cap:process.env.PAASTA_TASK_BUDGET_CAPABILITY};
  process.env.PAASTA_TASK_BUDGET_BRIDGE='http://127.0.0.1:1234/api/engine-budget';process.env.PAASTA_TASK_BUDGET_CAPABILITY='synthetic';
  try{
    globalThis.fetch=async(url,options)=>{assert.equal(url.searchParams.get('id'),'ses_owned');assert.equal(options.headers.Authorization,'Bearer synthetic');return Response.json({id:'00000000-0000-4000-8000-000000000001',limitToman:43750});};
    const hook=(await plugin())['chat.headers'],output={headers:{existing:'retained'}};await hook({sessionID:'ses_owned'},output);
    assert.equal(output.headers['x-paasta-task-budget'],'43750');assert.equal(output.headers.existing,'retained');
    globalThis.fetch=async()=>Response.json({},{status:403});await assert.rejects(hook({sessionID:'ses_owned'},{headers:{}}));
  }finally{globalThis.fetch=saved.fetch;for(const [key,value] of [['PAASTA_TASK_BUDGET_BRIDGE',saved.url],['PAASTA_TASK_BUDGET_CAPABILITY',saved.cap]])if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
