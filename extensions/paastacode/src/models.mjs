// Editorial order from https://opencode.ai/go, checked 2026-10-12.
// This is a preference list, never a model catalogue or a price source.
export const goModels = [
  "Kimi K3", "Kimi K2.7 Code", "Space Bunny", "MiniMax M3",
  "Claude Haiku 5.5", "GPT 6 Luna", "Qwen3.7 Plus", "GLM-5.3-Flash",
  "MiMo-V2.6-Flash", "DeepSeek V4.1 Flash", "Muse Spark 1.3",
  "LongCat 2.5 Preview", "Step 5 Preview",
];
const normalize = value => String(value || "").split("/").at(-1).replace(/:free$/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const priorities = goModels.map(normalize);
function rank(model) {
  return priorities.findIndex(name => [model.id, model.name].some(value => normalize(value) === name));
}
export function codingModels(models) {
  return models.filter(model => Array.isArray(model.supported_parameters) && model.supported_parameters.includes("tools"))
    .map(model => ({...model, paastacodePreferred: rank(model) !== -1}))
    .sort((a, b) => (rank(a) === -1 ? priorities.length : rank(a)) - (rank(b) === -1 ? priorities.length : rank(b)));
}
