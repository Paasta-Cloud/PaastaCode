import {test} from "node:test";
import assert from "node:assert/strict";
import {codingModels} from "../src/models.mjs";
import {providerConfig} from "../src/runtime.mjs";

test("Go preferences reorder only available tool models without changing identifiers or prices",()=>{
  const models=[
    {id:"other-a",name:"Other A",supported_parameters:["tools"]},
    {id:"vendor/minimax-m3",name:"MiniMax M3",supported_parameters:["tools"],input_toman_per_million:137},
    {id:"vendor/kimi-k3",supported_parameters:[]},
    {id:"moonshot/kimi-k2.7-code",supported_parameters:["tools"]},
    {id:"other-b",supported_parameters:["tools"]},
    {id:"vendor/kimi-k3-experimental",supported_parameters:["tools"]},
    {id:"custom-id",name:"GLM-5.3-Flash",supported_parameters:["tools"]},
  ];
  const original=structuredClone(models),ranked=codingModels(models);
  assert.deepEqual(ranked.map(m=>m.id),["moonshot/kimi-k2.7-code","vendor/minimax-m3","custom-id","other-a","other-b","vendor/kimi-k3-experimental"]);
  assert.equal(ranked[1].input_toman_per_million,137);
  assert.deepEqual(ranked.map(m=>m.paastacodePreferred),[true,true,true,false,false,false]);
  assert.deepEqual(models,original);
  assert.equal(providerConfig(models,"synthetic","https://example.test").model,"paasta/"+ranked[0].id);
  assert.deepEqual(codingModels([]),[]);
  assert.equal(codingModels([{id:"plain",supported_parameters:["tools"]}])[0].id,"plain");
});
