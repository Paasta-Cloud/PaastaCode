export type ModelPreset = {id:string; title:string; phase:"auto"|"build"; planModel:string; buildModel:string; description:string};
export declare function paidCodingModel(model:Record<string,unknown>):boolean;
export declare function modelOptions(models?:Record<string,unknown>[]):{
  modelPresets:ModelPreset[];
  defaultModel:string|null;
  workflowModels:{planModel:string;buildModel:string}|null;
  costWarnings:Record<string,boolean>;
};
