// Editorial order from https://opencode.ai/go, checked 2026-10-13; paid entries only.
// This is a preference list, never a model catalogue or a price source.
export const goModels = [
  "Kimi K3", "Kimi K2.7 Code", "Space Bunny", "MiniMax M3",
  "Claude Haiku 5.5", "GPT 6 Luna", "Qwen3.7 Plus", "GLM-5.3-Flash",
  "MiMo-V2.6-Flash", "DeepSeek V4.1 Flash", "Muse Spark 1.3",
];
export const domesticModelIds=['paasta/deepseek-v4-flash','paasta/gemma-4-31b','paasta/glm-5.3'];
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
export function paidCodingModel(model) {
  if(!Array.isArray(model.supported_parameters)||!model.supported_parameters.includes("tools"))return false;
  if(model.customer_free===true||model.customer_free==="true"||model.is_free===true)return false;
  if([model.id,model.name].some(value=>/(?:^|[\s/:(_-])free(?:$|[\s/):_-])|رایگان/i.test(String(value||""))))return false;
  const values=[model.input_toman_per_million,model.output_toman_per_million];
  if(values.some(value=>!["number","string"].includes(typeof value)||String(value).trim()===""||!Number.isFinite(Number(value))||Number(value)<0))return false;
  return values.some(value=>Number(value)>0);
}
// Explicit role preferences, intersected with the live paid catalogue. Price is a
// constraint for the executor, not evidence that a model is a capable planner.
export function workflowModels(models){
  const eligible=codingModels(models),label=m=>String(m.name||m.id).toLowerCase().replace(/[_-]/g," ");
  const planning=[/paasta.*glm.*5\.3/,/claude.*opus/,/gpt.*(?:codex|sol)(?!.*(?:mini|luna|nano))/,/kimi.*k3/,/kimi.*k2\.?7.*code/,/minimax.*m3/,/qwen.*plus/];
  const economy=/flash|haiku|luna|mini|deepseek|gemma/;
  for(const preference of planning){
    for(const planner of eligible.filter(m=>preference.test(label(m)))){
      const executor=eligible.filter(m=>m.id!==planner.id&&economy.test(label(m))&&Number(m.input_toman_per_million)<=Number(planner.input_toman_per_million)&&Number(m.output_toman_per_million)<=Number(planner.output_toman_per_million)&&(Number(m.input_toman_per_million)<Number(planner.input_toman_per_million)||Number(m.output_toman_per_million)<Number(planner.output_toman_per_million)))
        .sort((a,b)=>domesticModelPriority(a)-domesticModelPriority(b)||Number(b.paastacodePreferred)-Number(a.paastacodePreferred)||(Number(a.input_toman_per_million)+Number(a.output_toman_per_million))-(Number(b.input_toman_per_million)+Number(b.output_toman_per_million)))[0];
      if(executor)return {planModel:planner.id,buildModel:executor.id};
    }
  }
  return null;
}
