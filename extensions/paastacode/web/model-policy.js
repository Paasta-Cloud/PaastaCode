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

export function modelOptions(models = []) {
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
  const recommended = presets.find(preset => preset.phase === "auto" && domestic.has(preset.planModel));
  const fallback = executor || [...eligible].sort((a, b) => Number(domestic.has(b.id)) - Number(domestic.has(a.id))
    || price(a) - price(b) || a.id.localeCompare(b.id))[0];
  const reference = byId.get(qwen) || byId.get(gemma) || fallback;
  const costWarnings = Object.fromEntries(eligible.map(model => [model.id, !!reference &&
    ["input_toman_per_million", "output_toman_per_million"].some(key => Number(model[key]) > Number(reference[key]) * 2)]));
  return {modelPresets: presets, defaultModel: fallback?.id || null,
    workflowModels: recommended ? {planModel: recommended.planModel, buildModel: recommended.buildModel} : null, costWarnings};
}
