import test from "node:test";
import assert from "node:assert/strict";
import {modelOptions,workflowModels,codingModels} from "../src/models.mjs";
import {providerConfig} from "../src/runtime.mjs";
const model=(id,input,output)=>({id,name:id,supported_parameters:["tools"],input_toman_per_million:input,output_toman_per_million:output});
export const models=[
  model("anthropic/claude-opus",1_000_000,5_000_000),
  model("paasta/deepseek-v4-flash",26800,53280),
  model("paasta/qwen3.8-27b",43200,160000),
  model("paasta/gemma-4-31b",43520,119680),
  model("qwen/qwen3-coder-30b-a3b-instruct",33600,134400),
];
test("domestic Qwen/DeepSeek defaults and cheaper alternatives are independent of catalogue order",()=>{
  const snapshot=structuredClone(models),options=modelOptions(models);
  assert.deepEqual(options.workflowModels,{planModel:models[2].id,buildModel:models[1].id});
  assert.deepEqual(workflowModels([...models].reverse()),options.workflowModels);
  assert.equal(options.defaultModel,models[1].id);
  assert.equal(providerConfig(models,"synthetic","https://example.test").model,"paasta/"+models[1].id);
  assert.deepEqual(options.modelPresets.map(p=>p.id),["iran-balanced","iran-light","qwen-coder","iran-direct"]);
  assert.equal(options.modelPresets.at(-1).phase,"build");
  assert.equal(options.costWarnings[models[0].id],true);
  assert.equal(options.costWarnings[models[2].id],false);
  assert.equal(codingModels(models).find(m=>m.id===models[4].id).hostingCountry,undefined);
  assert.deepEqual(models,snapshot);
});
test("unavailable, free, unsupported or repriced models never enter a recommendation",()=>{
  for(const override of [{supported_parameters:[]},{customer_free:true},{input_toman_per_million:null},{output_toman_per_million:1_000_000}]){
    const options=modelOptions(models.map(m=>m.id===models[2].id?{...m,...override}:m));
    assert(!options.modelPresets.some(p=>p.id==="iran-balanced"));
    assert.equal(options.workflowModels.planModel,models[3].id);
  }
  const noPlanner=modelOptions(models.filter(m=>![models[2].id,models[3].id].includes(m.id)));
  assert.equal(noPlanner.workflowModels,null,"External options require explicit selection");
  assert.equal(noPlanner.defaultModel,models[1].id);
  assert.deepEqual(modelOptions([]),{modelPresets:[],defaultModel:null,workflowModels:null,costWarnings:{}});
  assert.equal(modelOptions([models[0],models[2]]).workflowModels,null,"No domestic executor means no automatic pair");
  assert.equal(modelOptions([models[0],models[2]]).defaultModel,models[2].id);
});
