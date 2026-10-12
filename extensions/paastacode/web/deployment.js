import {labelDialog} from "./components.js";
const $=id=>document.getElementById(id);
const money=value=>Number(value).toLocaleString("fa-IR",{maximumFractionDigits:4})+" تومان";
const states={review:"در انتظار بررسی",deploying:"در حال انتشار",ready:"آماده",complete:"انجام شد",failed:"ناموفق",rejected:"لغو شد",expired:"پیش‌نمایش منقضی شد"};
export function deploymentUI({api,run,notice,getState}){
  let connected=false,polling=false,jobs=[],current,loginTimer;
  labelDialog($("deployment-dialog"));
  const hideReview=()=>{$("deploy-review").hidden=true;current=null;};
  async function context(){
    const result=await api("deployment/context");
    for(const [id,items] of [["deploy-plan",result.plans],["deploy-region",result.clusters]])$(id).replaceChildren(...items.map(item=>{
      const option=document.createElement("option");option.value=item.id;option.textContent=item.name+(id==="deploy-plan"?" · "+money(item.monthly_price_toman)+" در ماه":"");return option;
    }));
    $("deploy-name").value=getState().workspace?.toLowerCase().replace(/[^a-z0-9-]/g,"-").slice(0,63)||"";
  }
  function review(job){
    current=job;$("deploy-review").hidden=false;$("deploy-form").hidden=true;
    $("deploy-target").textContent=job.project;
    $("deploy-summary").textContent=(job.name==="paasta.restart_project"?"راه‌اندازی دوبارهٔ سرویس":job.name==="paasta.redeploy_git"?"انتشار از مخزن متصل به پاستا":"انتشار سورس همین فضای کاری")+" · "+job.region.name+" · "+job.plan.name;
    $("deploy-cost").textContent=job.billing==="monthly"?"پرداخت ماهانهٔ پیشاپیش: "+money(job.plan.monthly_price_toman):"مصرف ساعتیِ سرویس: "+money(job.plan.hourly_price_toman)+". مصرف از اعتبار پاستا محاسبه می‌شود.";
    $("deploy-files").textContent=job.source?(job.source.files.length.toLocaleString("fa-IR")+" فایل · "+Number(job.source.bytes).toLocaleString("fa-IR")+" بایت\n"+job.source.files.map(file=>file.path).join("\n")):"سورس محلی فرستاده نمی‌شود.";
    $("deploy-result").textContent=(states[job.status]||job.status)+(job.error?" · "+job.error:"");
    $("deploy-logs").textContent=job.result?.logs||"هنوز گزارشی دریافت نشده است.";
    const link=$("deploy-url");link.hidden=true;link.removeAttribute("href");
    if(job.status==="ready"&&job.result?.domain)try{const url=new URL(job.result.domain.startsWith("https://")?job.result.domain:"https://"+job.result.domain);if(url.protocol==="https:"&&!url.username&&!url.password){link.href=url.href;link.textContent=url.hostname;link.hidden=false;}}catch{}
    $("deploy-confirm").disabled=job.status!=="review";$("deploy-reject").disabled=job.status!=="review";
  }
  function renderJobs(){
    $("deploy-jobs").replaceChildren();
    const pending=jobs.filter(job=>job.status==="review").length;
    $("deploy-open").textContent="انتشار روی پاستا"+(pending?" · "+pending.toLocaleString("fa-IR")+" درخواست":"");
    for(const job of jobs.slice().reverse()){
      const button=document.createElement("button");button.type="button";button.className="deploy-job";
      const title=document.createElement("bdi");title.dir="ltr";title.textContent=job.project;
      const status=document.createElement("span");status.textContent=states[job.status]||job.status;button.append(title,status);
      button.onclick=()=>{review(job);$("deployment-dialog").showModal();};$("deploy-jobs").append(button);
    }
    if(current){const job=jobs.find(job=>job.id===current.id);if(job)review(job);}
  }
  async function refresh(){
    if(!getState().connected||polling)return;polling=true;
    try{
      const result=await api("deployment/state");connected=result.connected;jobs=result.jobs;
      $("deploy-access").hidden=connected;$("deploy-form").hidden=!connected||!!current;$("deploy-disconnect").hidden=!connected;
      for(const job of jobs.filter(job=>job.status==="deploying")){
        const updated=await api("deployment/job?id="+encodeURIComponent(job.id));jobs=jobs.map(job=>job.id===updated.id?updated:job);
        if(current?.id===updated.id){$("deploy-result").textContent=states[updated.status]+(updated.error?" · "+updated.error:"");}
      }
      renderJobs();
    }catch(error){if(!error.stale&&$("deployment-dialog").open)notice(error.message,true);}finally{polling=false;}
  }
  $("deploy-open").onclick=()=>run($("deploy-open"),async()=>{hideReview();await refresh();if(connected)await context();$("deployment-dialog").showModal();});
  $("deploy-close").onclick=()=>$("deployment-dialog").close();
  $("deploy-connect").onclick=()=>run($("deploy-connect"),async()=>{
    const result=await api("deployment/login","POST");$("deploy-device").hidden=false;$("deploy-code").textContent=result.code;$("deploy-link").href=result.url;
    clearInterval(loginTimer);loginTimer=setInterval(async()=>{
      try{const result=await api("deployment/login/poll","POST");if(!result.pending){clearInterval(loginTimer);$("deploy-device").hidden=true;await refresh();await context();notice("اتصال انتشار و MCP پاستا تأیید شد.");}}
      catch(error){clearInterval(loginTimer);notice(error.message,true);}
    },3500);
  });
  $("deploy-form").onsubmit=event=>{event.preventDefault();run($("deploy-preview"),async()=>{
    const job=await api("deployment/request","POST",{name:"paasta.deploy_source",arguments:{name:$("deploy-name").value,plan:$("deploy-plan").value,region:$("deploy-region").value,billing:$("deploy-billing").value}});review(job);await refresh();
  });};
  $("deploy-confirm").onclick=()=>run($("deploy-confirm"),async()=>{const job=await api("deployment/approve","POST",{id:current.id});review(job);await refresh();}).finally(()=>{$("deploy-confirm").disabled=current?.status!=="review";});
  $("deploy-reject").onclick=()=>run($("deploy-reject"),async()=>{await api("deployment/reject","POST",{id:current.id});hideReview();await refresh();}).finally(()=>{$("deploy-reject").disabled=current?.status!=="review";});
  $("deploy-disconnect").onclick=()=>run($("deploy-disconnect"),async()=>{await api("deployment/disconnect","POST");hideReview();await refresh();});
  setInterval(refresh,3500);
  return {updateBase(state){$("deploy-open").disabled=!state.connected;if(!state.connected){clearInterval(loginTimer);jobs=[];current=null;$("deployment-dialog").close();$("deploy-device").hidden=true;$("deploy-link").removeAttribute("href");$("deploy-code").textContent="";renderJobs();}else void refresh();}};
}
