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
