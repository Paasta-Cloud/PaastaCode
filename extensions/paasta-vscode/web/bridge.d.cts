export function validRequest(value:unknown): value is {id:number;method:string;args?:Record<string,unknown>};
export function acceptFrame(event:MessageEvent,frame:Window|null,nonce:string):boolean;
