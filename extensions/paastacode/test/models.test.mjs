import {test} from "node:test";
import assert from "node:assert/strict";
import {codingModels,paidCodingModel,workflowModels} from "../src/models.mjs";
import {providerConfig} from "../src/runtime.mjs";

test('Iran-hosted Paasta models lead every coding catalogue without relabeling other providers',()=>{
  const paid={supported_parameters:['tools'],input_toman_per_million:100,output_toman_per_million:300};
  const models=[{...paid,id:'openai/gpt-sol',name:'GPT Sol'},...['deepseek-v4-flash','gemma-4-31b','glm-5.3'].map(id=>({...paid,id:'paasta/'+id,name:id})),{...paid,id:'other/glm-5.3',name:'GLM 5.3'}];
  const ranked=codingModels(models);
  assert.deepEqual(ranked.slice(0,3).map(m=>m.id),models.slice(1,4).map(m=>m.id));
  assert(ranked.slice(0,3).every(m=>m.hostingCountry==='IR'&&m.name.includes('🇮🇷')&&m.name.includes('میزبانی ایران')));
  assert.equal(codingModels(ranked)[0].name,ranked[0].name,'labels remain stable after repeated filtering');
  assert(!ranked.find(m=>m.id==='other/glm-5.3').name.includes('🇮🇷'));
});

test("Go preferences reorder only available tool models without changing identifiers or prices",()=>{
  const models=[
    {id:"other-a",name:"Other A",input_toman_per_million:100,output_toman_per_million:300,supported_parameters:["tools"]},
    {id:"vendor/minimax-m3",name:"MiniMax M3",input_toman_per_million:137,output_toman_per_million:300,supported_parameters:["tools"]},
    {id:"vendor/kimi-k3",supported_parameters:[]},
    {id:"moonshot/kimi-k2.7-code",input_toman_per_million:100,output_toman_per_million:300,supported_parameters:["tools"]},
    {id:"other-b",input_toman_per_million:100,output_toman_per_million:300,supported_parameters:["tools"]},
    {id:"vendor/kimi-k3-experimental",input_toman_per_million:100,output_toman_per_million:300,supported_parameters:["tools"]},
    {id:"custom-id",name:"GLM-5.3-Flash",input_toman_per_million:100,output_toman_per_million:300,supported_parameters:["tools"]},
  ];
  const original=structuredClone(models),ranked=codingModels(models);
  assert.deepEqual(ranked.map(m=>m.id),["moonshot/kimi-k2.7-code","vendor/minimax-m3","custom-id","other-a","other-b","vendor/kimi-k3-experimental"]);
  assert.equal(ranked[1].input_toman_per_million,137);
  assert.deepEqual(ranked.map(m=>m.paastacodePreferred),[true,true,true,false,false,false]);
  assert.deepEqual(models,original);
  assert.equal(providerConfig(models,"synthetic","https://example.test").model,"paasta/"+ranked[0].id);
  assert.deepEqual(codingModels([]),[]);
  assert.equal(codingModels([{id:"plain",input_toman_per_million:100,output_toman_per_million:300,supported_parameters:["tools"]}])[0].id,"plain");
});

test("PaastaCode excludes free, mislabeled and unpriced models at the provider boundary",()=>{
  const paid={id:"paid",name:"Paid model",supported_parameters:["tools"],input_toman_per_million:"100",output_toman_per_million:"300"};
  const denied=[{customer_free:true},{customer_free:"true"},{is_free:true},{id:"vendor/model:free"},{id:"free/model"},{name:"Trial (Free)"},{name:"مدل رایگان"},{input_toman_per_million:0,output_toman_per_million:0},{input_toman_per_million:null},{output_toman_per_million:""},{output_toman_per_million:undefined},{output_toman_per_million:-1},{input_toman_per_million:Infinity},{supported_parameters:[]}].map((override,i)=>({...paid,id:"denied"+i,...override}));
  assert(denied.every(model=>!paidCodingModel(model)));
  assert(paidCodingModel({...paid,input_toman_per_million:0}),"A billed output-only model remains eligible");
  assert.deepEqual(codingModels([...denied,paid]).map(m=>m.id),["paid"]);
  assert.deepEqual(Object.keys(providerConfig([...denied,paid],"synthetic","https://example.test").provider.paasta.models),["paid"]);
  assert.throws(()=>providerConfig(denied,"synthetic","https://example.test"),/کاتالوگ/);
});
test("automatic role defaults require a recognized planner and a strictly cheaper eligible executor",()=>{
  const model=(id,name,input,output)=>({id,name,supported_parameters:["tools"],input_toman_per_million:input,output_toman_per_million:output});
  const planner=model("planner","Kimi K3",100,300),executor=model("executor","GLM-5.3-Flash",10,30),expensive=model("expensive","GLM-5.3-Flash",100,400),unknown=model("unknown","Unknown costly model",1000,5000);
  assert.deepEqual(workflowModels([executor,unknown,planner,expensive]),{planModel:"planner",buildModel:"executor"});
  assert.equal(workflowModels([executor,unknown]),null,"High price is not evidence of planner quality");
  assert.equal(workflowModels([planner,expensive]),null,"Do not promise savings when output costs more");
  assert.equal(workflowModels([planner,{...executor,customer_free:true}]),null);
  assert.equal(workflowModels([executor]),null,"Never label one cheap model as a premium/economy pair");
});
