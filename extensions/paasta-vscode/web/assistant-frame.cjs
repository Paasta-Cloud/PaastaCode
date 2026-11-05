// The existing PaastaCode UI runs in an opaque sandbox, without console cookies or editor DOM access.
const nonce=document.currentScript?.nonce,queue=[];let port;
globalThis.acquireVsCodeApi=()=>({postMessage(message){if(port)port.postMessage(message);else if(queue.length<128)queue.push(message);},getState(){return undefined;},setState(){}});
addEventListener('message',event=>{
 if(port||event.source!==parent||event.origin!=='https://console.paasta.cloud'||event.data?.type!=='paasta:assistant:init'||event.data?.nonce!==nonce||event.ports.length!==1)return;
 port=event.ports[0];port.onmessage=({data})=>dispatchEvent(new MessageEvent('paasta:host-message',{data}));port.start();for(const message of queue.splice(0))port.postMessage(message);
});
