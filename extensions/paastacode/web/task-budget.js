export function defaultTaskBudget(coding,profile){
  if(Number.isSafeInteger(profile?.taskBudgetDefaultToman)&&profile.taskBudgetDefaultToman>0)return profile.taskBudgetDefaultToman;
  const weekly=Number(coding?.quotas?.week?.limitToman);
  return Number.isSafeInteger(weekly)&&weekly>0?Math.max(1,Math.floor(weekly*0.05)):50000;
}
export function taskBudgetLimit(value){
  const limit=Number(value);
  if(!Number.isSafeInteger(limit)||limit<1||limit>1_000_000_000)throw new Error('بودجهٔ تسک باید مبلغی بین ۱ و یک میلیارد تومان باشد.');
  return limit;
}
