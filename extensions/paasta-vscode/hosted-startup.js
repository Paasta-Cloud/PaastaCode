const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const { hosted, managedSession } = require('./managed-session');
const { openProject } = require('./open-project');

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
async function prepareLayout(context) {
  if (!context.globalState || !vscode.commands.getCommands) return false;
  const destination = 'workbench.view.extension.paasta-online';
  const commands = await vscode.commands.getCommands(true);
  if (!commands.includes(destination) || !commands.includes('vscode.moveViews')) return false;
  if (!context.globalState.get('paasta.hostedLayout.v1')) {
    await vscode.commands.executeCommand('vscode.moveViews', { viewIds: ['paasta.actions', 'paasta.account', 'paasta.projects', 'paasta.code'], destinationId: destination });
    await vscode.commands.executeCommand('paasta.code.focus');
    await context.globalState.update('paasta.hostedLayout.v1', true);
    // Native resizing respects the workbench's minimum editor width on narrow screens.
    for (let step = 0; step < 5; step++) await vscode.commands.executeCommand('workbench.action.increaseViewSize');
  } else await vscode.commands.executeCommand('paasta.code.focus');
  return true;
}
async function prepareTerminal(context) {
  if (!managedSession()) throw new Error('برای اتصال CLI از کنسول وارد محیط شوید.');
  const directory = path.join(path.dirname(process.env.PAASTA_EDITOR_SESSION_FILE), 'bin');
  if ((await fs.lstat(directory).catch(() => undefined))?.isSymbolicLink()) throw new Error('مسیر CLI محیط معتبر نیست.');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'paasta');
  const content = '#!/bin/sh\n# Managed by Paasta online editor.\nexec ' + quote(path.join(__dirname, 'runtime', 'node')) + ' ' + quote(path.join(__dirname, 'managed-cli.js')) + ' "$@"\n';
  const previous = await fs.lstat(file).catch(() => undefined);
  if (previous && (previous.isSymbolicLink() || !(await fs.readFile(file, 'utf8')).startsWith('#!/bin/sh\n# Managed by Paasta online editor.\n'))) throw new Error('فایل موجود CLI حفظ شد؛ مسیر مدیریت‌شده را بررسی کنید.');
  await fs.writeFile(file, content, { mode: 0o700 });
  await fs.chmod(file, 0o700);
  context.environmentVariableCollection.prepend('PATH', directory + path.delimiter);
}

async function startHostedWorkspace(context, api, authorizedFetch) {
  if (!hosted()) return;
  await prepareTerminal(context);
  if (!await prepareLayout(context)) await vscode.commands.executeCommand('workbench.view.extension.paasta');
  const catalog = await api(context, '/api/cli/context');
  const projects = catalog.projects.filter(project => ['git', 'upload', 'template'].includes(project.source_type));
  const failures = [];
  let ready = 0;
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'آماده‌سازی سورس پروژه‌های شما…' }, async progress => {
    for (const project of projects) {
      progress.report({ message: project.name });
      try {
        await openProject(context, (ctx, url) => url === '/api/cli/context' ? Promise.resolve(catalog) : api(ctx, url), authorizedFetch, project.name, { open: false, automatic: true });
        ready++;
      } catch (error) { failures.push(project.name + ': ' + error.message); }
    }
  });
  if (failures.length) {
    const output = vscode.window.createOutputChannel('Paasta Projects');
    context.subscriptions.push(output);
    output.appendLine(failures.join('\n'));
    const action = await vscode.window.showWarningMessage(`${ready} پروژه آماده شد؛ دریافت سورس ${failures.length} پروژه کامل نشد. فایل‌های قبلی حفظ شده‌اند.`, 'مشاهدهٔ جزئیات');
    if (action) output.show();
  } else if (ready) {
    vscode.window.showInformationMessage(`سورس ${ready} پروژه آماده است؛ از پنل پاستا پروژه را باز کنید. CLI هم به حساب شما متصل است.`);
  }
  await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
}
module.exports = { prepareTerminal, prepareLayout, startHostedWorkspace };
