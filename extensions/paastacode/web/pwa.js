import {icon} from "./components.js";
// The marker changes presentation only; account and workspace authorization stay on the server.
export const mobileApp = typeof location !== "undefined" && (new URLSearchParams(location.search).get("platform") === "android" || globalThis.matchMedia?.("(display-mode: standalone)").matches === true);
export function submitWithEnter(event, touch = matchMedia("(pointer: coarse)").matches) {
  return !touch && !event.isComposing && event.keyCode !== 229 && event.key === "Enter" && !event.shiftKey;
}
export function setupPwa() {
  const status = document.getElementById("network-status");
  const update = () => { status.hidden = navigator.onLine; };
  update();
  window.addEventListener("offline", update);
  window.addEventListener("online", () => { update(); window.dispatchEvent(new Event("focus")); });
  if (mobileApp) document.documentElement.dataset.mobileApp = "true";
  if (location.origin === "https://code.paasta.cloud" && "serviceWorker" in navigator) {
    // Never force a reload or replay an in-flight paid operation when updating.
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
  }
}

export function setupMobileNavigation(openDrawer) {
  if (!mobileApp) return;
  const nav=document.createElement("nav");nav.className="mobile-navigation";nav.setAttribute("aria-label","دسترسی سریع");
  const showHub=()=>{const hub=document.getElementById("hosted-hub");if(hub.hidden)document.getElementById("hosted-open").click();return hub;};
  for(const [label,symbol,action] of [
    ["پروژه‌ها","folder",()=>showHub().scrollTo({top:0})],
    ["گفتگوها","chat",()=>openDrawer(true)],
    ["حساب","wallet",()=>{showHub();const account=document.querySelector(".hosted-account");account.scrollIntoView({block:"start"});const link=account.querySelector("a:not([hidden])");link?.focus({preventScroll:true});}],
  ]){const button=document.createElement("button");button.type="button";button.append(icon(symbol),document.createTextNode(label));button.onclick=action;nav.append(button);}
  document.querySelector("main").append(nav);
  const editing=()=>document.documentElement.toggleAttribute("data-mobile-editing",!!document.activeElement?.matches("input,textarea,select"));
  document.addEventListener("focusin",editing);document.addEventListener("focusout",()=>queueMicrotask(editing));
}
