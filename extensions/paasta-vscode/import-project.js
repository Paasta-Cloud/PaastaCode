const vscode = require('vscode');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const { managedSession } = require('./managed-session');

async function importProject(context, api, authorizedFetch, options) {
  const folder = options?.target ? { uri: vscode.Uri.file(options.target) } : vscode.workspace.workspaceFolders?.[0];
  if (!folder || folder.uri.scheme !== 'file' || !vscode.workspace.isTrusted) throw new Error('یک پوشهٔ خالی و مورداعتماد برای دریافت سورس باز کنید.');
  if ((await fs.readdir(folder.uri.fsPath)).length || vscode.workspace.textDocuments.some(doc => doc.isDirty && vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.toString() === folder.uri.toString())) throw new Error('پوشهٔ مقصد باید خالی باشد؛ فایل‌های موجود بازنویسی نمی‌شوند.');
  const catalog = await api(context, '/api/cli/context');
  const projects = catalog.projects.filter(item => ['upload', 'template'].includes(item.source_type));
  if (!projects.length) throw new Error('پروژهٔ آپلودشده یا قالب آماده پیدا نشد. پروژه‌های Git را از مخزن اصلی باز کنید.');
  const selected = options?.project ? projects.filter(item => item.name === options.project).map(item => ({ label: item.name }))[0] : await vscode.window.showQuickPick(projects.map(item => ({ label: item.name })), { placeHolder: 'سورس نسخهٔ فعال؛ نسخه‌های خارج از بازهٔ نگه‌داری قابل دریافت نیستند.' });
  if (!selected) return;
  const automatic = options?.automatic === true && Boolean(managedSession()) && Boolean(options?.target) && Boolean(options?.project);
  const confirmation = automatic ? 'دریافت سورس' : await vscode.window.showWarningMessage(`سورس نسخهٔ فعال «${selected.label}» در پوشهٔ خالی دریافت شود؟ متغیرهای محرمانه و داده‌های برنامه منتقل نمی‌شوند.`, { modal: true }, 'دریافت سورس');
  if (confirmation !== 'دریافت سورس') return;
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'paasta-source-'));
  let imported;
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'دریافت و بررسی سورس…' }, async () => {
      const response = await authorizedFetch(context, `/api/projects/${encodeURIComponent(selected.label)}/source`);
      if (!response.ok) { const body = await response.json(); throw new Error(body.error || 'دریافت سورس ناموفق بود.'); }
      const reader = response.body?.getReader(); if (!reader) throw new Error('پاسخ سورس خالی است.');
      const chunks = []; let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > 50 * 1024 * 1024) { await reader.cancel(); throw new Error('حجم سورس از سقف این نسخه بیشتر است.'); }
        chunks.push(value);
      }
      const archive = path.join(scratch, 'source.zip'); await fs.writeFile(archive, Buffer.concat(chunks), { mode: 0o600 });
      try { await execute(process.platform === 'win32' ? 'python' : 'python3', [path.join(__dirname, 'import-source.py'), archive, folder.uri.fsPath], { windowsHide: true, timeout: 120000, maxBuffer: 2048 }); }
      catch { throw new Error('استخراج سورس کامل نشد؛ خالی‌بودن پوشه، حجم و مسیرهای فایل‌ها را بررسی کنید. Python 3 باید نصب باشد. فایل‌های موجود حذف نمی‌شوند.'); }
      imported = { project: selected.label, root: decodeURIComponent(response.headers.get('X-Paasta-Build-Root') || '') };
      await context.workspaceState.update('paasta.importedSource', imported);
    });
    if (!automatic) vscode.window.showInformationMessage('سورس دریافت شد؛ اکنون می‌توانید با Paasta Code ویرایش کنید یا پروژه را به Git منتقل کنید.');
    return imported;
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
}
module.exports = { importProject };
