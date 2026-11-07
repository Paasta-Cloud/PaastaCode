export type ModelPreset = {id:string; title:string; phase:"auto"|"build"; planModel:string; buildModel:string; description:string};
export declare const domesticModelIds:string[];
export declare function domesticModelPriority(model:string|Record<string,unknown>):number;
export declare function codingModelLabel(model:Record<string,unknown>):string;
export declare function prioritizeDomesticModels<T extends Record<string,unknown>>(models:T[]):(T & {name:string;hostingCountry:string|undefined;paastacodePreferred:boolean})[];
export declare function paidCodingModel(model:Record<string,unknown>):boolean;
export declare function modelOptions(models?:Record<string,unknown>[],profile?:{modelCache?:Record<string,{samples:number;cacheRatio:number}>;samples:number;inputTokens:number;outputTokens:number;cachedTokens:number}):{
  economicEstimate?:{basis:string;samples:number;costs:Record<string,number>};
  modelPresets:ModelPreset[];
  defaultModel:string|null;
  workflowModels:{planModel:string;buildModel:string}|null;
  costWarnings:Record<string,boolean>;
};

export declare function estimatedModelCost(model:Record<string,unknown>,profile?:{inputTokens?:number;outputTokens?:number;cachedTokens?:number}):number;
