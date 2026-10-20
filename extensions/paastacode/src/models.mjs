import {modelOptions,paidCodingModel} from "../web/model-policy.js";
export {modelOptions,paidCodingModel} from "../web/model-policy.js";
// Editorial order from https://opencode.ai/go, checked 2026-10-13; paid entries only.
// This is a preference list, never a model catalogue or a price source.
export const goModels = [
  "Kimi K3", "Kimi K2.7 Code", "Space Bunny", "MiniMax M3",
  "Claude Haiku 5.5", "GPT 6 Luna", "Qwen3.7 Plus", "GLM-5.3-Flash",
  "MiMo-V2.6-Flash", "DeepSeek V4.1 Flash", "Muse Spark 1.3",
];
export const domesticModelIds=['paasta/deepseek-v4-flash','paasta/qwen3.8-27b','paasta/gemma-4-31b','paasta/glm-5.3'];
export const domesticModelPriority=model=>domesticModelIds.includes(typeof model==='string'?model:model.id)?0:1;
export const codingModelLabel=model=>(model.name||model.id)+(domesticModelPriority(model)===0&&!String(model.name||'').includes('میزبانی ایران')?' · 🇮🇷 میزبانی ایران':'');
const normalize = value => String(value || "").split("/").at(-1).replace(/:free$/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const priorities = goModels.map(normalize);
function rank(model) {
  return priorities.findIndex(name => [model.id, model.name].some(value => normalize(value) === name));
}
export function codingModels(models) {
  return models.filter(model => paidCodingModel(model))
    .map(model => ({...model,name:codingModelLabel(model),hostingCountry:domesticModelPriority(model)===0?'IR':undefined, paastacodePreferred: domesticModelPriority(model)===0||rank(model) !== -1}))
    .sort((a, b) => domesticModelPriority(a)-domesticModelPriority(b)||(rank(a) === -1 ? priorities.length : rank(a)) - (rank(b) === -1 ? priorities.length : rank(b)));
}
export function workflowModels(models){
  return modelOptions(codingModels(models)).workflowModels;
}
