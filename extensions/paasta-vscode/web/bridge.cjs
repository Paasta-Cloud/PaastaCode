const methods=new Set(['catalog','stat','list','read','write','mkdir','remove','rename','changes','export','project','agent','billing','dirty']);
function validRequest(value){
 return !!value&&Number.isSafeInteger(value.id)&&value.id>0&&methods.has(value.method)
  &&(value.args===undefined||!!value.args&&typeof value.args==='object'&&!Array.isArray(value.args));
}
// A port is accepted only from the exact embedded window and the isolated editor origin.
function acceptFrame(event,frame,nonce){
 return event.origin==='https://code.paasta.app'&&event.source===frame
  &&event.data?.type==='paasta:web-ide:ready'&&event.data?.nonce===nonce
  &&typeof nonce==='string'&&/^[a-f0-9]{64}$/.test(nonce)&&event.ports?.length===1;
}
module.exports={validRequest,acceptFrame};
