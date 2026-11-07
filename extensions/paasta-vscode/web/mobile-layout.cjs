// Keep the upstream editor; only its supported defaults and fixed commands change.
const compactQuery='(max-width:700px), (max-width:1024px) and (pointer:coarse)';
const editorCommands=Object.freeze({files:'workbench.view.explorer',find:'actions.find',undo:'undo',redo:'redo'});
function mobileSettings(compact){return compact?{
 'editor.fontSize':16,'editor.lineHeight':26,'editor.wordWrap':'on','editor.minimap.enabled':false,
 'editor.lineNumbers':'off','editor.glyphMargin':false,'editor.folding':false,
 'editor.stickyScroll.enabled':false,'editor.scrollBeyondLastLine':false,
 'workbench.editor.showTabs':'single','workbench.activityBar.location':'hidden',
 'workbench.statusBar.visible':false,'window.commandCenter':false,'breadcrumbs.enabled':false,
}:{};}
module.exports={compactQuery,mobileSettings,editorCommands};
