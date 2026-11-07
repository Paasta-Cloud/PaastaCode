// Recommendations intersect the live paid/tool catalogue. These are preferences,
// never model availability, prices or a promise about task quality.
const deepseek = "paasta/deepseek-v4-flash";
const qwen = "paasta/qwen3.8-27b";
const gemma = "paasta/gemma-4-31b";
export const domesticModelIds = [deepseek, qwen, gemma, "paasta/glm-5.3"];
const domestic = new Set(domesticModelIds);
export const domesticModelPriority = model => domestic.has(typeof model === "string" ? model : model.id) ? 0 : 1;
export const codingModelLabel = model => (model.name || model.id) + (domesticModelPriority(model) === 0 && !String(model.name || "").includes("میزبانی ایران") ? " · 🇮🇷 میزبانی ایران" : "");
// Hosted pages can be newer than a paid workspace's pinned runtime.
export function prioritizeDomesticModels(models) {
  return models.map(model => ({...model, name: codingModelLabel(model),
    hostingCountry: domesticModelPriority(model) === 0 ? "IR" : undefined,
    paastacodePreferred: domesticModelPriority(model) === 0 || !!model.paastacodePreferred}))
    .sort((a, b) => domesticModelPriority(a) - domesticModelPriority(b));
}
const price = model => Number(model.input_toman_per_million) + Number(model.output_toman_per_million);
export const paidCodingModel = model => Array.isArray(model.supported_parameters) && model.supported_parameters.includes("tools")
  && ![true, "true"].includes(model.customer_free) && model.is_free !== true
  && !/(?:^|[\s/:(_-])free(?:$|[\s/):_-])|رایگان/i.test(model.id + " " + (model.name || ""))
  && [model.input_toman_per_million, model.output_toman_per_million].every(value =>
    ["number", "string"].includes(typeof value) && String(value).trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0)
  && price(model) > 0;
const cheaper = (executor, planner) => ["input_toman_per_million", "output_toman_per_million"]
  .every(key => Number(executor[key]) <= Number(planner[key])) && price(executor) < price(planner);

export function estimatedModelCost(model,profile={}) {
  const input=Math.max(1,Number(profile.inputTokens)||32000),output=Math.max(1,Number(profile.outputTokens)||1000);
  const cached=Math.min(input,Math.max(0,Number(profile.cachedTokens)||0));
  const cache=model.cache_read_toman_per_million;
  const cacheRate=['number','string'].includes(typeof cache)&&String(cache).trim()!==''&&Number.isFinite(Number(cache))&&Number(cache)>=0?Number(cache):Number(model.input_toman_per_million);
  return ((input-cached)*Number(model.input_toman_per_million)+cached*cacheRate+output*Number(model.output_toman_per_million))/1e6;
}
const economicIds=new Set([...domesticModelIds,'xiaomi/mimo-v2.6-flash','deepseek/deepseek-v4.1-flash','deepseek/deepseek-v4.1-flash-1017','minimax/minimax-m3.1-flash','minimax/minimax-m2.5','z-ai/glm-5.3-flash']);
export function modelOptions(models = [], profile) {
  const eligible = models.filter(paidCodingModel), byId = new Map(eligible.map(model => [model.id, model]));
  const executor = byId.get(deepseek), presets = [];
  for (const [id, title, planModel, description] of [
    ["iran-balanced", "متعادل · میزبانی ایران", qwen, "برنامه‌ریزی با Qwen و اجرا با DeepSeek؛ پیشنهاد شروع برای توسعهٔ روزمره."],
    ["iran-light", "سبک · میزبانی ایران", gemma, "برنامه‌ریزی با Gemma و اجرا با DeepSeek؛ گزینه‌ای دیگر برای درخواست‌های ساده‌تر."],
    ["qwen-coder", "Qwen Coder + DeepSeek", "qwen/qwen3-coder-30b-a3b-instruct", "برنامه‌ریزی با Qwen Coder خارج از ایران؛ اجرا با DeepSeek در ایران."],
  ]) {
    const planner = byId.get(planModel);
    if (!executor || !planner || !cheaper(executor, planner)) continue;
    // A recommendation must not silently become a premium option after repricing.
    if (Number(planner.input_toman_per_million) > Number(executor.input_toman_per_million) * 4
      || Number(planner.output_toman_per_million) > Number(executor.output_toman_per_million) * 4) continue;
    presets.push({id, title, phase: "auto", planModel, buildModel: deepseek, description});
  }
  if (executor) presets.push({id: "iran-direct", title: "اقتصادی · فقط DeepSeek", phase: "build", planModel: deepseek, buildModel: deepseek,
    description: "برای تغییرهای کوچک؛ اجرای مستقیم بدون هزینهٔ یک مرحلهٔ جداگانهٔ برنامه‌ریزی."});
  const observed=Number(profile?.samples)>=3, priced=!!profile;
  const costProfile=model=>{if(!observed)return;const cache=profile.modelCache?.[model.id];
    const ratio=cache?.samples>=3&&Number.isFinite(Number(cache.cacheRatio))?Math.min(1,Math.max(0,Number(cache.cacheRatio))):0;
    return {...profile,cachedTokens:Math.max(1,Number(profile.inputTokens)||32000)*ratio};};
  const ranked=eligible.filter(model=>economicIds.has(model.id)).sort((a,b)=>estimatedModelCost(a,costProfile(a))-estimatedModelCost(b,costProfile(b))||domesticModelPriority(a)-domesticModelPriority(b)||a.id.localeCompare(b.id));
  const economical=ranked[0];
  if(priced&&economical)presets.unshift({id:'economic-context',title:observed?'اقتصادی · بر اساس مصرف اخیر':'اقتصادی · شروع کم‌هزینه',phase:'auto',planModel:economical.id,buildModel:economical.id,description:'انتخاب بر اساس تعرفهٔ واقعی ورودی، کش و خروجی و الگوی مصرف حساب؛ در شروع، ورودی بدون کش برآورد می‌شود. کشِ مدل تازه و کیفیت یکسان تضمین نمی‌شوند.'});
  const recommended = presets.find(preset=>preset.id==='economic-context')||presets.find(preset => preset.phase === "auto" && domestic.has(preset.planModel));
  const fallback = executor || [...eligible].sort((a, b) => Number(domestic.has(b.id)) - Number(domestic.has(a.id))
    || price(a) - price(b) || a.id.localeCompare(b.id))[0];
  const reference = priced&&economical?economical:byId.get(qwen) || byId.get(gemma) || fallback;
  const costWarnings = Object.fromEntries(eligible.map(model => [model.id, !!reference &&
    (priced?estimatedModelCost(model,costProfile(model))>estimatedModelCost(reference,costProfile(reference))*4:["input_toman_per_million", "output_toman_per_million"].some(key => Number(model[key]) > Number(reference[key]) * 2))]));
  return {modelPresets: presets, defaultModel: (priced?economical:undefined)?.id || fallback?.id || null,
    ...(priced?{economicEstimate:{basis:observed?"recent_usage":"cold_start",samples:profile.samples,costs:Object.fromEntries(eligible.map(model=>[model.id,Math.ceil(estimatedModelCost(model,costProfile(model)))]))}}:{}),
    workflowModels: recommended ? {planModel: recommended.planModel, buildModel: recommended.buildModel} : null, costWarnings};
}
