export declare function paidCodingModel(model: Record<string, unknown>): boolean;
export declare function codingModels<T extends Record<string, unknown>>(models: T[]): (T & {paastacodePreferred: boolean})[];
export declare const goModels: string[];
export {modelOptions} from "../web/model-policy.js";
export declare function workflowModels(models: Record<string, unknown>[]): {planModel: string; buildModel: string} | null;
