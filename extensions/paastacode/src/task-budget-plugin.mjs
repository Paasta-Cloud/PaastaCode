// Trusted, bundled engine hook. Never infer a task from model-generated text.
export default async function(){return {'chat.headers':async(input,output)=>{
  const endpoint=process.env.PAASTA_TASK_BUDGET_BRIDGE;
  if(!endpoint)return;
  const url=new URL(endpoint);url.searchParams.set('id',input.sessionID);
  const response=await fetch(url,{headers:{Authorization:'Bearer '+process.env.PAASTA_TASK_BUDGET_CAPABILITY},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('بودجهٔ تسک دریافت نشد؛ پیش از ادامه وضعیت اتصال را بررسی کنید.');
  const budget=await response.json();
  if(!budget.id)return;
  output.headers['x-paasta-task-id']=budget.id;
  output.headers['x-paasta-task-budget']=String(budget.limitToman);
}};}
