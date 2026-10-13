export declare function paidCodingModel(model: Record<string, unknown>): boolean;
export declare function codingModels<T extends Record<string, unknown>>(models: T[]): (T & {paastacodePreferred: boolean})[];
export declare const goModels: string[];
export declare function workflowModels(models: Record<string, unknown>[]): {planModel: string; buildModel: string} | null;
