const {contextBridge,ipcRenderer}=require("electron");
contextBridge.exposeInMainWorld("paastacodeDesktop",Object.freeze({chooseWorkspace:()=>ipcRenderer.invoke("paastacode:choose-workspace")}));
