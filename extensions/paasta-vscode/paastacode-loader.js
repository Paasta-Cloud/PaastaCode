const fs = require('node:fs');
const path = require('node:path');
const { isProjectsRoot } = require('./managed-session');
const vscode = require('vscode');

// Native packages place both tools in one extension. The sibling path is for source development.
function activate(context) {
  const legacy=vscode.extensions.getExtension('paasta.paastacode');
  if(legacy){
    void vscode.commands.executeCommand('setContext','paasta.legacyExtension',true);
    void vscode.window.showInformationMessage('پاستاکد کامل در افزونهٔ پاستا قرار گرفته است. افزونهٔ قدیمی را حذف کنید؛ گفتگوها و فایل‌ها باقی می‌مانند.','حذف افزونهٔ قدیمی و بارگذاری دوباره').then(async action=>{
      if(!action)return;
      try{await vscode.commands.executeCommand('workbench.extensions.uninstallExtension','paasta.paastacode');await vscode.commands.executeCommand('workbench.action.reloadWindow');}
      catch{vscode.window.showErrorMessage('حذف افزونهٔ قدیمی انجام نشد؛ آن را از بخش افزونه‌ها حذف و پنجره را دوباره بارگذاری کنید.');}
    });
    // Let the installed legacy client own its commands until the requested migration completes.
    return;
  }
  const bundled = path.join(__dirname, 'paastacode.cjs');
  const { projectFolder } = require('./project-workspace');
  const entry = fs.existsSync(bundled) ? bundled : path.join(__dirname, '../paastacode/vscode/extension.cjs');
  return require(entry).activate(context, {
    container: 'paasta', viewId: 'paasta.code', embedded: true,
    clientPath: process.env.PAASTACODE_CLIENT_PATH,
    resolveWorkspace: () => projectFolder(vscode)?.uri.fsPath,
    folderCommand: 'paasta.openProject',
    validateWorkspace(folder) { if (isProjectsRoot(folder)) throw new Error('ابتدا از پنل پاستا یکی از پروژه‌ها را باز کنید.'); }
  });
}
module.exports = { activate };
