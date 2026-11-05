const vscode = require('vscode');
const exporter = require('./git-export');
const { hosted, isProjectsRoot, localProject } = require('./managed-session');
const { projectFolder, containsDocument } = require('./project-workspace');

async function publishGit(context, api) {
  const folder = projectFolder(vscode);
  if (isProjectsRoot(folder?.uri.fsPath)) throw new Error('ابتدا از «بازکردن پروژه‌ها» یک پروژه را انتخاب کنید؛ مجموعهٔ پروژه‌ها منتقل نمی‌شود.');
  if (!folder || folder.uri.scheme !== 'file' || !vscode.workspace.isTrusted) throw new Error('پوشهٔ پروژه را در یک فضای کاری مورداعتماد باز کنید.');
  if (vscode.workspace.textDocuments.some(doc => doc.isDirty && containsDocument(folder, doc))) throw new Error('ابتدا فایل‌های باز را ذخیره کنید تا همان نسخهٔ بازبینی‌شده منتقل شود.');
  const plan = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'بررسی سورس و تاریخچهٔ Git…' }, () => exporter.inspect(folder.uri.fsPath));
  const target = await vscode.window.showQuickPick([
    { label: 'انتخاب مخزن خالی موجود', url: null },
    { label: 'ساخت مخزن در GitHub', description: 'در صفحهٔ ساخت، Private را انتخاب کنید و README اولیه نسازید.', url: 'https://github.com/new' },
    { label: 'ساخت مخزن در GitLab', description: 'مخزن خصوصی و خالی بسازید.', url: 'https://gitlab.com/projects/new' },
  ], { placeHolder: 'مخزن مقصد؛ اتصال پروژهٔ میزبانی‌شده تغییر نمی‌کند.' });
  if (!target) return;
  if (target.url) await vscode.env.openExternal(vscode.Uri.parse(target.url));
  const url = await vscode.window.showInputBox({ title: 'انتقال پروژه به Git', prompt: 'نشانی HTTPS یک مخزن خالی در GitHub یا GitLab؛ مخزن را ترجیحاً خصوصی بسازید.', placeHolder: 'https://github.com/owner/project', validateInput(value) { try { exporter.destination(value); } catch (error) { return error.message; } } });
  if (!url) return;
  const identity = {};
  if (!plan.repository) {
    identity.name = await vscode.window.showInputBox({ prompt: 'نام نویسندهٔ اولین کامیت' });
    if (!identity.name) return;
    identity.email = await vscode.window.showInputBox({ prompt: 'ایمیل نویسندهٔ کامیت؛ می‌توانید از ایمیل خصوصی GitHub/GitLab استفاده کنید.' });
    if (!identity.email) return;
  }
  const review = await vscode.workspace.openTextDocument({ language: 'plaintext', content: `مقصد: ${exporter.destination(url)}\n\nفایل‌های فعلی: ${plan.files.length}\n${plan.files.join('\n')}\n\nفایل‌های محرمانهٔ شناخته‌شده و خروجی‌های تولیدشده از انتقال اولیه حذف می‌شوند. بررسی خودکار جای بازبینی شما را نمی‌گیرد.\n${plan.repository ? 'تاریخچهٔ شاخهٔ فعلی حفظ می‌شود.' : 'یک مخزن محلی و اولین کامیت ساخته می‌شود؛ قواعد فایل‌های خصوصی به .gitignore افزوده می‌شوند.'}\n\nپس از تأیید پوش، می‌توانید با تأیید جداگانه مخزن را به پروژهٔ پاستا متصل کنید. انتشار خودکار فعال نمی‌شود.` });
  await vscode.window.showTextDocument(review, { preview: true });
  const automation = plan.files.some(name => name.startsWith('.github/workflows/') || name === '.gitlab-ci.yml');
  const confirm = await vscode.window.showWarningMessage(`فهرست فایل‌ها و مقصد را بررسی کنید. سورس در شاخهٔ main مخزن خالی ارسال شود؟${automation ? ' فایل CI در پروژه وجود دارد؛ پوش ممکن است آن را اجرا کند. هزینه و دسترسی‌های CI مقصد را بررسی کنید.' : ''}`, { modal: true }, 'کامیت و انتقال');
  if (confirm !== 'کامیت و انتقال') return;
  const prepared = await exporter.prepare(plan, identity);
  const token = await vscode.window.showInputBox({ password: true, ignoreFocusOut: true, prompt: 'Token با مجوز خواندن اطلاعات و نوشتن فقط در مخزن مقصد؛ فقط برای همین انتقال استفاده می‌شود و ذخیره نمی‌شود.' });
  if (!token) return;
  const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'انتقال و تأیید کامیت مقصد…' }, () => exporter.publish(prepared, url, token));
  const action = await vscode.window.showInformationMessage(`انتقال کامل شد؛ کامیت ${result.commit.slice(0, 8)} در مقصد تأیید شد.`, 'بازکردن مخزن', 'اتصال به پروژهٔ پاستا');
  if (action === 'بازکردن مخزن') await vscode.env.openExternal(vscode.Uri.parse(result.url.replace(/\.git$/, '')));
  if (action === 'اتصال به پروژهٔ پاستا') {
    try {
      const catalog = await api(context, '/api/cli/context');
      const importedProject = hosted() ? localProject(folder.uri.fsPath)?.project : undefined;
      const projects = catalog.projects.filter(project => ['upload', 'template'].includes(project.source_type) && (!hosted() || project.name === importedProject));
      if (!projects.length) throw new Error('پروژهٔ آپلودشده یا قالب آماده در فضای کاری فعلی پیدا نشد.');
      const project = await vscode.window.showQuickPick(projects.map(item => ({ label: item.name })), { placeHolder: 'پروژه‌ای که همین سورس به آن تعلق دارد را انتخاب کنید.' });
      if (!project) return;
      const provider = new URL(result.url).hostname === 'github.com' ? 'github' : 'gitlab';
      const accounts = await api(context, '/api/integrations/git/connections');
      const choices = accounts.connections.filter(item => item.provider === provider).map(item => ({ label: item.username, description: item.provider, id: item.id }));
      if (!choices.length) throw new Error('ابتدا حساب Git مقصد را از کنسول پاستا متصل کنید؛ مخزن منتقل‌شده محفوظ است.');
      const account = await vscode.window.showQuickPick(choices, { placeHolder: 'حساب متصل به پاستا با دسترسی به همین مخزن' });
      if (!account) return;
      const imported = hosted() ? localProject(folder.uri.fsPath) : context.workspaceState.get('paasta.importedSource');
      const root = await vscode.window.showInputBox({ prompt: 'پوشهٔ ساخت در مخزن؛ مسیر نسخهٔ دریافت‌شده را بررسی کنید. خالی یعنی تشخیص خودکار.', value: imported?.project === project.label ? imported.root : '', placeHolder: 'apps/api' });
      if (root === undefined) return;
      const confirmed = await vscode.window.showWarningMessage(`پروژهٔ «${project.label}» به این مخزن، شاخهٔ main و مسیر «${root || 'تشخیص خودکار'}» متصل شود؟ نسخهٔ فعال تغییر نمی‌کند و انتشار خودکار خاموش می‌ماند.`, { modal: true }, 'اتصال مخزن');
      if (confirmed !== 'اتصال مخزن') return;
      const attached = await api(context, `/api/projects/${encodeURIComponent(project.label)}/git/attach`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository: result.url, ref: 'main', root, revision: result.commit, connectionId: account.id, confirm: true }) });
      if (!hosted()) await context.workspaceState.update('paasta.gitBinding', { project: project.label, repository: attached.repository, connectionId: account.id, root: attached.root });
      if (hosted()) {
        const metadata = await api(context, `/api/editor/projects/${encodeURIComponent(project.label)}`);
        await require('./open-project').configureHostedGit(folder.uri.fsPath, metadata);
      }
      vscode.window.showInformationMessage('مخزن به پروژهٔ پاستا متصل شد؛ نسخهٔ فعال حفظ شده و انتشار خودکار خاموش است.');
    } catch (error) { vscode.window.showWarningMessage(`انتقال به Git کامل شد، اما اتصال پاستا انجام نشد: ${error.message}`); }
  }
}

module.exports = { publishGit };
