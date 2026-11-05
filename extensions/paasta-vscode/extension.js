const vscode = require("vscode");
const { hosted, managedSession, localProject, isProjectsRoot } = require("./managed-session");
const { openProject } = require("./open-project");
const { publishGit } = require("./publish-git");
const { importProject } = require("./import-project");
const { startHostedWorkspace } = require('./hosted-startup');
const { projectFolder, rememberEditor, containsDocument } = require('./project-workspace');
const { safePath: shareableSourcePath, containsKnownSecret } = require("./git-export");
const pathModule = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const TOKEN_KEY = "paasta.apiToken";
const TOKEN_SERVER_KEY = "paasta.apiTokenServer";
const MODEL_KEY = "paasta.code.model";
const WORKSPACE_KEY = "paasta.code.workspace";
const AI_CONSENT_KEY = "paasta.code.sourceConsent";

function userSetting(key, fallback) {
  // Imported project settings must never choose a server/executable that receives account credentials.
  const value = vscode.workspace.getConfiguration("paasta").inspect?.(key)?.globalValue;
  return typeof value === "string" ? value : fallback;
}

function server() {
  const managed = managedSession();
  if (managed) return managed.server;
  const url = new URL(userSetting("server", "https://paasta.cloud"));
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error("نشانی سرور باید HTTPS باشد؛ HTTP فقط برای توسعه روی localhost مجاز است.");
  return url.toString().replace(/\/$/, "");
}

async function sessionToken(context, target = server()) {
  if (hosted()) { const managed = managedSession(); return managed?.server === target ? managed.token : undefined; }
  const issuer = await context.secrets.get(TOKEN_SERVER_KEY);
  if (issuer ? issuer !== target : target !== "https://paasta.cloud") return undefined;
  return context.secrets.get(TOKEN_KEY);
}

async function api(context, path, options = {}) {
  const target = server();
  const token = await sessionToken(context, target);
  if (!token) throw new Error("ابتدا از فرمان «Paasta: ورود امن» وارد شوید.");
  const response = await fetch(`${target}${path}`, {
    redirect: "error",
    ...options,
    headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(typeof body === "object" && body?.error ? body.error : `درخواست ناموفق بود (${response.status}).`);
  return body;
}

async function authorizedFetch(context, path, options = {}) {
  const target = server();
  const token = await sessionToken(context, target);
  if (!token) throw new Error("ابتدا از فرمان «Paasta: ورود امن» وارد شوید.");
  return fetch(`${target}${path}`, { ...options, redirect: "error", headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
}

class AccountItem extends vscode.TreeItem {
  constructor(label, description, command, icon, tooltip) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.tooltip = tooltip;
    this.command = command ? { command, title: label } : undefined;
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

class AccountProvider {
  constructor(context) { this.context = context; this.changed = new vscode.EventEmitter(); this.onDidChangeTreeData = this.changed.event; }
  refresh() { this.changed.fire(); }
  getTreeItem(item) { return item; }
  async getChildren() {
    if (!await sessionToken(this.context)) return [];
    try {
      const result = await api(this.context, "/api/cli/context");
      const account = result.account || {};
      return [
        new AccountItem(account.name || "حساب پاستا", account.email || "متصل", undefined, "account", account.email ? `متصل به ${account.email}` : "متصل به پاستا"),
        new AccountItem("بازکردن کنسول", "مدیریت حساب و فضای کاری", "paasta.openConsole", "link-external"),
      ];
    } catch {
      return [new AccountItem("اتصال نیاز به ورود دوباره دارد", "برای بازیابی اتصال کلیک کنید", "paasta.signIn", "warning")];
    }
  }
}

async function updateConnectionUi(context, accountProvider, projectProvider, homeProvider, statusBar) {
  const signedIn = Boolean(await sessionToken(context));
  await vscode.commands.executeCommand("setContext", "paasta.signedIn", signedIn);
  await vscode.commands.executeCommand("setContext", "paasta.hosted", hosted());
  statusBar.text = signedIn ? "$(cloud) پاستا: متصل" : "$(sign-in) ورود به پاستا";
  statusBar.tooltip = signedIn ? "بازکردن پنل پاستا" : "برای اتصال امن افزونه به حساب پاستا کلیک کنید";
  statusBar.command = signedIn ? "paasta.openView" : "paasta.signIn";
  accountProvider.refresh(); projectProvider.refresh(); homeProvider.refresh();
  PaastaCodePanel.current?.postState();
}

const secretFile = (path) => !shareableSourcePath(path) || /(^|\/)(?:\.env(?:\..*)?|\.npmrc|\.pypirc|id_rsa|id_ed25519|.*\.(?:pem|key|p12|pfx))$/i.test(path);
const binaryFile = (path) => /\.(?:png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|eot|mp[34]|mov|avi|exe|dll|so|dylib)$/i.test(path);

async function collectWorkspaceFiles(prompt = "") {
  const folder = projectFolder(vscode);
  if ((!folder && hosted()) || isProjectsRoot(folder?.uri.fsPath)) throw new Error("ابتدا از «بازکردن پروژه‌ها» یک پروژه را انتخاب کنید تا فقط سورس همان پروژه بررسی شود.");
  if (!folder) throw new Error("ابتدا یک پوشه پروژه را در VS Code باز کنید.");
  if (!vscode.workspace.isTrusted) throw new Error("برای استفاده از Paasta Code ابتدا به این Workspace اعتماد کنید.");
  if (vscode.workspace.textDocuments.some(document => document.isDirty && containsDocument(folder, document))) throw new Error("ابتدا فایل‌های باز را ذخیره کنید تا AI همان نسخهٔ فعلی را بررسی کند.");
  const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, "**/*"), "**/{node_modules,.git,.next,dist,build,coverage,vendor,.venv}/**", 2000);
  const active = vscode.window.activeTextEditor?.document.uri.toString();
  const visible = new Set((vscode.window.visibleTextEditors || []).map(editor => editor.document.uri.toString()));
  const hints = [...new Set((prompt.toLowerCase().match(/[a-z0-9_@./-]{3,}/g) || []).filter(value => !/^\d+$/.test(value)))].slice(0, 24);
  const score = uri => {
    const name = vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/").toLowerCase();
    return (uri.toString() === active ? 10000 : visible.has(uri.toString()) ? 5000 : 0)
      + (/^(package\.json|(?:js|ts)config\.json|dockerfile|next\.config\.[a-z]+|readme\.md)$/.test(name) ? 2000 : 0)
      + hints.reduce((total, hint) => total + (name.includes(hint) ? 1000 : 0), 0);
  };
  uris.sort((left, right) => score(right) - score(left) || left.toString().localeCompare(right.toString()));
  const files = {}; let total = 0;
  for (const uri of uris) {
    const path = vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/");
    if (secretFile(path) || binaryFile(path) || Object.keys(files).length >= 80) continue;
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (bytes.byteLength > 120000 || total + bytes.byteLength > 700000) continue;
    const content = Buffer.from(bytes).toString("utf8").replace(/^\uFEFF/, "");
    if (content.includes("\u0000") || containsKnownSecret(content)) continue;
    files[path] = content; total += bytes.byteLength;
  }
  if (!Object.keys(files).length) throw new Error("فایل متنی قابل‌ارسالی در پوشه پیدا نشد.");
  return { folder, files };
}

async function selectCodeModel(context, provider, force = false) {
  const result = await api(context, "/api/ai-builder/models");
  if (!result.models?.length) throw new Error("هیچ مدل فعالی برای AI Coder تعریف نشده است.");
  const current = context.workspaceState.get(MODEL_KEY);
  if (!force && current && result.models.some((item) => item.id === current)) return current;
  const picked = await vscode.window.showQuickPick(result.models.map((item) => ({ label: item.label, description: item.hint, detail: item.id, id: item.id })), { placeHolder: "مدل کدنویسی را انتخاب کنید", matchOnDescription: true, matchOnDetail: true });
  if (!picked) return undefined;
  await context.workspaceState.update(MODEL_KEY, picked.id); provider?.refresh?.();
  return picked.id;
}

async function syncCodeWorkspace(context, localFiles) {
  let state = context.workspaceState.get(WORKSPACE_KEY);
  if (state?.id) {
    const response = await authorizedFetch(context, `/api/ai-builder/workspaces/${state.id}`);
    if (response.ok) {
      const remote = await response.json();
      state = { id: state.id, revision: remote.workspace.revision };
    } else if (response.status === 404) state = undefined;
    else { const body = await response.json(); throw new Error(body.error || "بازیابی نشست AI ممکن نشد."); }
  }
  if (!state) {
    const created = await api(context, "/api/ai-builder/workspaces", { method: "POST" });
    state = { id: created.workspace.id, revision: created.workspace.revision };
  }
  const saved = await api(context, `/api/ai-builder/workspaces/${state.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: localFiles, revision: state.revision }) });
  state = { id: state.id, revision: saved.workspace.revision };
  await context.workspaceState.update(WORKSPACE_KEY, state);
  return state;
}

async function generateCode(context, state, prompt, model, onActivity = () => undefined) {
  const requestId = randomUUID();
  const response = await authorizedFetch(context, `/api/ai-builder/workspaces/${state.id}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, model, revision: state.revision, requestId }) });
  if (!response.ok) { const body = await response.json(); throw new Error(body.error || "ساخت کد شروع نشد."); }
  if (!response.body) throw new Error("جریان زنده ساخت در دسترس نیست.");
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = "", completed;
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const frames = buffer.split("\n\n"); buffer = frames.pop() || "";
    for (const frame of frames) {
      const line = frame.split("\n").find((item) => item.startsWith("data: "));
      if (!line) continue;
      const event = JSON.parse(line.slice(6));
      if (event.type === "activity" && event.activity) onActivity(event.activity);
      if (event.type === "error") throw new Error(event.error || "ساخت کد کامل نشد.");
      if (event.type === "complete") completed = event;
    }
    if (done) break;
  }
  if (!completed?.workspace?.files) throw new Error("ساخت بدون فایل قابل‌استفاده پایان یافت.");
  await context.workspaceState.update(WORKSPACE_KEY, { id: state.id, revision: completed.workspace.revision });
  return { ...completed, requestId };
}

async function recordFileDecisions(context, state, requestId, changed, accepted) {
  try {
    await api(context, `/api/ai-builder/workspaces/${state.id}/generate/${requestId}/approvals`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        surface: "vscode",
        decisions: changed.map(([path]) => ({ path, decision: accepted.has(path) ? "approved" : "rejected" })),
      }),
    });
    return true;
  } catch {
    vscode.window.showWarningMessage("فایل‌های محلی محفوظ‌اند، اما ثبت نتیجه بازبینی در پاستا انجام نشد. اتصال را بررسی کنید.");
    return false;
  }
}

async function reviewAndApply(context, state, requestId, folder, before, generated) {
  const changed = Object.entries(generated).filter(([path, content]) => before[path] !== content);
  if (!changed.length) { vscode.window.showInformationMessage("Paasta Code تغییری در فایل‌ها پیشنهاد نکرد."); return; }
  const picked = await vscode.window.showQuickPick(changed.map(([path, content]) => ({ label: path, description: before[path] === undefined ? "فایل جدید" : "تغییر یافته", path, content, picked: true })), { canPickMany: true, placeHolder: "فایل‌هایی را که می‌خواهید اعمال شوند انتخاب کنید" });
  if (!picked) return;
  const accepted = new Set(picked.map((item) => item.path));
  if (picked[0]) {
    const preview = vscode.Uri.joinPath(context.globalStorageUri, "ai-preview", picked[0].path);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(pathModule.dirname(preview.fsPath)));
    await vscode.workspace.fs.writeFile(preview, Buffer.from(picked[0].content, "utf8"));
    const original = vscode.Uri.joinPath(folder.uri, picked[0].path);
    if (before[picked[0].path] === undefined) await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(preview), { preview: true });
    else await vscode.commands.executeCommand("vscode.diff", original, preview, `Paasta Code: ${picked[0].path}`);
  }
  const confirmation = await vscode.window.showWarningMessage(`${accepted.size} فایل انتخاب‌شده روی Workspace اعمال شود؟ ${changed.length - accepted.size} فایل رد می‌شود.`, { modal: true }, "اعمال فایل‌های انتخاب‌شده");
  if (confirmation !== "اعمال فایل‌های انتخاب‌شده") { await recordFileDecisions(context, state, requestId, changed, new Set()); return; }
  const edit = new vscode.WorkspaceEdit();
  for (const [path, content] of changed.filter(([path]) => accepted.has(path))) {
    const uri = vscode.Uri.joinPath(folder.uri, path);
    if (before[path] === undefined) {
      let exists = false;
      try { await vscode.workspace.fs.stat(uri); exists = true; } catch (error) { if (error.code !== "FileNotFound") throw error; }
      if (exists || vscode.workspace.textDocuments.some((document) => document.uri.toString() === uri.toString())) throw new Error("فایل جدید پیشنهادی قبلاً ساخته شده؛ پاسخ AI را دوباره بازبینی کنید.");
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(pathModule.dirname(uri.fsPath))); edit.createFile(uri, { overwrite: false }); edit.insert(uri, new vscode.Position(0, 0), content);
    }
    else {
      const document = await vscode.workspace.openTextDocument(uri);
      if (document.isDirty || document.getText() !== before[path]) throw new Error("فایل بعد از شروع درخواست تغییر کرده؛ پاسخ AI اعمال نشد. درخواست تازه‌ای با نسخهٔ فعلی بفرستید.");
      edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), content);
    }
  }
  if (!await vscode.workspace.applyEdit(edit)) throw new Error("VS Code نتوانست همه تغییرات را اعمال کند.");
  await vscode.workspace.saveAll(false);
  const recorded = await recordFileDecisions(context, state, requestId, changed, accepted);
  vscode.window.showInformationMessage(recorded ? `${accepted.size} فایل اعمال و تصمیم ${changed.length} فایل در پاستا ثبت شد.` : `${accepted.size} فایل روی Workspace محلی اعمال شد.`);
}

function webviewAsset(webview, context, name) {
  return webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "media", name));
}

class PaastaHomeProvider {
  constructor(context) { this.context = context; this.view = undefined; }
  async resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")] };
    const css = webviewAsset(view.webview, this.context, "home.css"), script = webviewAsset(view.webview, this.context, "home.js");
    view.webview.html = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src ${view.webview.cspSource};"><link rel="stylesheet" href="${css}"></head><body><main><section class="launch"><p class="kicker">پوشه فعلی</p><h2 id="folderName">یک پروژه باز کنید</h2><p id="gitContext" dir="auto" role="status"></p><p id="deployHint">پوشه پروژه را در VS Code باز کنید تا مستقیم روی پاستا منتشر شود.</p><button class="primary" data-command="deploy">انتشار روی پاستا</button><button class="secondary" data-command="openProject" hidden>بازکردن پروژه‌ها</button><button class="secondary" data-command="chat">بازکردن Paasta Code</button><button class="secondary" data-command="git">انتقال پروژه به Git</button><button class="secondary" data-command="import">دریافت سورس پروژه</button></section><footer><span id="connectionDot"></span><span id="connectionText">در حال بررسی اتصال…</span></footer></main><script src="${script}"></script></body></html>`;
    view.webview.onDidReceiveMessage((message) => {
      if (message.command === "deploy") vscode.commands.executeCommand("paasta.deployWorkspace");
      if (message.command === "chat") vscode.commands.executeCommand("paasta.code.openChat");
      if (message.command === "git") vscode.commands.executeCommand("paasta.publishGit");
      if (message.command === "openProject") vscode.commands.executeCommand("paasta.openProject");
      if (message.command === "import") vscode.commands.executeCommand("paasta.importProject");
      if (message.command === "login") vscode.commands.executeCommand("paasta.signIn");
    });
    await this.refresh();
  }
  async refresh() {
    if (!this.view) return;
    const folder = projectFolder(vscode);
    const selected = folder?.uri.fsPath;
    const git = hosted() && folder ? await api(this.context, `/api/editor/projects/${folder.name}`).catch(() => null) : undefined;
    const signedIn = Boolean(await sessionToken(this.context));
    if (projectFolder(vscode)?.uri.fsPath !== selected) return;
    await this.view.webview.postMessage({ type: "state", hosted: hosted(), signedIn, folder: folder?.name || "", git });
  }
}

class PaastaCodePanel {
  static current;
  static show(context, homeProvider) {
    if (PaastaCodePanel.current) { PaastaCodePanel.current.panel.reveal(vscode.ViewColumn.Active); return PaastaCodePanel.current; }
    const panel = vscode.window.createWebviewPanel("paasta.codeChat", "Paasta Code", vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")] });
    PaastaCodePanel.current = new PaastaCodePanel(context, homeProvider, panel);
    return PaastaCodePanel.current;
  }
  constructor(context, homeProvider, panel) {
    this.context = context; this.homeProvider = homeProvider; this.panel = panel; this.running = false;
    const css = webviewAsset(panel.webview, context, "chat.css"), script = webviewAsset(panel.webview, context, "chat.js");
    panel.webview.html = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src ${panel.webview.cspSource};"><link rel="stylesheet" href="${css}"></head><body><header><div><span class="brandMark" aria-hidden="true"></span><strong>Paasta Code</strong><small>عامل کدنویسی پاستا</small></div><button id="modelButton" title="انتخاب مدل">مدل خودکار</button></header><main id="conversation"><section class="empty" id="empty"><span class="emptyMark" aria-hidden="true"></span><h1>روی همین پروژه کار کنیم</h1><p>درخواستت را بنویس. فایل‌های حساس ارسال نمی‌شوند و هر تغییر قبل از اعمال در Diff خود VS Code بازبینی می‌شود.</p><div class="suggestions"><button data-prompt="ساختار پروژه را بررسی کن و مهم‌ترین بهبود بعدی را پیشنهاد بده">بررسی پروژه</button><button data-prompt="خطاهای فعلی پروژه را پیدا و برطرف کن">رفع خطاها</button><button data-prompt="برای تغییرات فعلی تست مناسب اضافه کن">افزودن تست</button></div></section></main><form id="composer"><textarea id="prompt" rows="1" placeholder="یک تغییر، فیچر یا خطا را توضیح بده…" aria-label="پیام به Paasta Code"></textarea><div><span id="workspaceName">Workspace فعلی</span><button id="send" type="submit" aria-label="ارسال درخواست">ارسال</button></div></form><script src="${script}"></script></body></html>`;
    panel.webview.onDidReceiveMessage((message) => {
      if (message.command === "send") void this.run(String(message.prompt || ""));
      if (message.command === "selectModel") void this.chooseModel();
    });
    panel.onDidDispose(() => { PaastaCodePanel.current = undefined; });
    void this.postState();
  }
  async postState() {
    await this.panel.webview.postMessage({ type: "state", model: this.context.workspaceState.get(MODEL_KEY, "مدل خودکار"), folder: vscode.workspace.workspaceFolders?.[0]?.name || "پوشه‌ای باز نیست", signedIn: Boolean(await sessionToken(this.context)) });
  }
  async chooseModel() {
    try { await selectCodeModel(this.context, this.homeProvider, true); await this.postState(); }
    catch (error) { await this.panel.webview.postMessage({ type: "error", message: error.message }); }
  }
  async run(prompt) {
    prompt = prompt.trim();
    if (!prompt || this.running) return;
    this.running = true;
    await this.panel.webview.postMessage({ type: "user", message: prompt });
    await this.panel.webview.postMessage({ type: "running", value: true, message: "در حال خواندن پروژه…" });
    try {
      if (!await sessionToken(this.context)) throw new Error("ابتدا از پنل پاستا وارد حساب شوید.");
      const model = await selectCodeModel(this.context, this.homeProvider);
      if (!model) throw new Error("مدلی برای ساخت انتخاب نشد.");
      if (!this.context.workspaceState.get(AI_CONSENT_KEY, false)) {
        const consent = await vscode.window.showWarningMessage("فایل‌های متنی امن این Workspace برای ساخت به فضای کاری پاستا ارسال می‌شوند. فایل‌های حساس و باینری حذف می‌شوند.", { modal: true }, "ادامه و ارسال");
        if (consent !== "ادامه و ارسال") throw new Error("ارسال فایل‌ها لغو شد؛ هیچ تغییری انجام نشد.");
        await this.context.workspaceState.update(AI_CONSENT_KEY, true);
      }
      const { folder, files } = await collectWorkspaceFiles(prompt);
      const state = await syncCodeWorkspace(this.context, files);
      const result = await generateCode(this.context, state, prompt, model, (activity) => this.panel.webview.postMessage({ type: "activity", activity }));
      await this.panel.webview.postMessage({ type: "assistant", message: result.summary || "تغییرات آماده بازبینی است.", files: Object.keys(result.workspace.files).filter((path) => files[path] !== result.workspace.files[path]).length });
      await reviewAndApply(this.context, state, result.requestId, folder, files, result.workspace.files);
      await this.panel.webview.postMessage({ type: "done", message: "بازبینی تغییرات تمام شد." });
    } catch (error) {
      await this.panel.webview.postMessage({ type: "error", message: error instanceof Error ? error.message : "ساخت کامل نشد. فایل‌های محلی محفوظ‌اند." });
    } finally {
      this.running = false;
      await this.panel.webview.postMessage({ type: "running", value: false });
    }
  }
}

class ProjectItem extends vscode.TreeItem {
  constructor(project) {
    super(project.name, vscode.TreeItemCollapsibleState.None);
    this.project = project;
    this.contextValue = "paastaProject";
    this.description = project.state === "Ready" ? "آماده" : project.state === "Paused" ? "متوقف" : "در حال استقرار";
    this.tooltip = `${project.name}\n${project.domain}`;
    this.iconPath = new vscode.ThemeIcon(project.state === "Ready" ? "pass-filled" : project.state === "Paused" ? "debug-pause" : "sync~spin");
    this.command = { command: hosted() ? "paasta.openProject" : "paasta.showStatus", title: hosted() ? "بازکردن پروژه" : "وضعیت پروژه", arguments: [this] };
  }
}

class ProjectProvider {
  constructor(context) { this.context = context; this.changed = new vscode.EventEmitter(); this.onDidChangeTreeData = this.changed.event; }
  refresh() { this.changed.fire(); }
  getTreeItem(item) { return item; }
  async getChildren() {
    if (!await sessionToken(this.context)) return [];
    try {
      const projects = await api(this.context, "/api/projects");
      return projects.map((project) => new ProjectItem(project));
    } catch (error) {
      if (String(error.message).includes("ابتدا")) return [];
      vscode.window.showErrorMessage(`پاستا: ${error.message}`);
      return [];
    }
  }
}

function projectName(value) { return value instanceof ProjectItem ? value.project.name : typeof value === "string" ? value : undefined; }

async function selectProject(context, value) {
  const direct = projectName(value);
  if (direct) return direct;
  const projects = await api(context, "/api/projects");
  const selected = await vscode.window.showQuickPick(projects.map((project) => ({ label: project.name, description: project.state, project })), { placeHolder: "یک پروژه را انتخاب کنید" });
  return selected?.project.name;
}

async function signIn(context, accountProvider, projectProvider, homeProvider, statusBar) {
  if (hosted()) {
    await vscode.env.openExternal(vscode.Uri.parse("https://console.paasta.cloud/editor"));
    vscode.window.showInformationMessage("برای تمدید نشست، از کنسول «ورود به محیط» را بزنید؛ ورود جداگانه در افزونه لازم نیست.");
    return;
  }
  const loginServer = server();
  const start = await fetch(`${loginServer}/api/cli/device`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ clientName: "Paasta VS Code" }),
  });
  const grant = await start.json();
  if (!start.ok) throw new Error(grant.error || "شروع ورود ناموفق بود.");
  await vscode.env.clipboard.writeText(grant.userCode);
  await vscode.env.openExternal(vscode.Uri.parse(grant.verificationUriComplete));
  statusBar.text = "$(loading~spin) در انتظار تأیید ورود";
  statusBar.command = "paasta.openView";
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `کد ${grant.userCode} کپی شد؛ ورود را در مرورگر تأیید کنید`, cancellable: true }, async (_progress, cancellation) => {
    const deadline = Date.now() + grant.expiresIn * 1000;
    while (!cancellation.isCancellationRequested && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(2, grant.interval) * 1000));
      const response = await fetch(`${loginServer}/api/cli/device/token`, { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ deviceCode: grant.deviceCode }) });
      const result = await response.json();
      if (response.ok) {
        if (server() !== loginServer) throw new Error("سرور هنگام ورود تغییر کرده؛ دوباره وارد شوید.");
        await context.secrets.store(TOKEN_KEY, result.token);
        await context.secrets.store(TOKEN_SERVER_KEY, loginServer);
        await updateConnectionUi(context, accountProvider, projectProvider, homeProvider, statusBar);
        await vscode.commands.executeCommand("workbench.view.extension.paasta");
        vscode.window.showInformationMessage("ورود انجام شد. Paasta Code و پروژه‌ها آماده‌اند.", "ساخت با AI").then((action) => { if (action) vscode.commands.executeCommand("paasta.code.ask"); });
        return;
      }
      if (response.status !== 202) throw new Error(result.message || "ورود تکمیل نشد.");
    }
    if (!cancellation.isCancellationRequested) throw new Error("مهلت ورود تمام شد؛ دوباره تلاش کنید.");
  });
  await updateConnectionUi(context, accountProvider, projectProvider, homeProvider, statusBar);
}

async function runCli(context, mode) {
  const folder = projectFolder(vscode)?.uri.fsPath;
  if ((!folder && hosted()) || isProjectsRoot(folder)) throw new Error("ابتدا از «بازکردن پروژه‌ها» یک پروژه را انتخاب کنید؛ پوشهٔ همهٔ پروژه‌ها قابل انتشار نیست.");
  if (!folder) throw new Error("ابتدا یک پوشه پروژه را در VS Code باز کنید.");
  if (!vscode.workspace.isTrusted) throw new Error("پیش از اجرای CLI، فضای کاری را بازبینی و مورداعتماد کنید.");
  const projectMetadata = localProject(folder);
  const binding = projectMetadata?.gitBinding || (!hosted() ? context.workspaceState.get("paasta.gitBinding") : undefined);
  if (binding) {
    const action = await vscode.window.showWarningMessage(`ساخت از آخرین کامیت پوش‌شدهٔ شاخهٔ «${binding.ref || 'main'}» انجام می‌شود. تغییرات محلی را ابتدا کامیت و پوش کنید. ادامه می‌دهید؟`, { modal: true }, "ادامه از گیت");
    if (action !== "ادامه از گیت") return;
  }
  const cli = hosted() ? pathModule.join(__dirname, 'client', 'engine', 'paasta') : userSetting("cliPath", "paasta");
  const target = server();
  const token = await sessionToken(context, target);
  if (!token) throw new Error("ابتدا از پنل پاستا وارد حساب شوید.");
  if (!hosted()) await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "آماده‌سازی انتشار امن…", cancellable: false }, async () => {
    try {
      await execFileAsync(String(cli), ["login", "--api-key", "--server", target], { cwd: folder, windowsHide: true, env: { ...process.env, PAASTA_API_KEY: token }, timeout: 30_000 });
    } catch (error) {
      if (error?.code === "ENOENT") throw new Error("Paasta CLI پیدا نشد. از راهنمای نصب داخل مستندات افزونه استفاده کنید.");
      throw new Error("اتصال خط فرمان به حساب پاستا آماده نشد. دوباره وارد افزونه شوید و تلاش کنید.");
    }
  });
  const label = mode === "deploy" ? "Paasta Deploy" : "Paasta Cost Preview";
  const imported = projectMetadata || (!hosted() ? context.workspaceState.get("paasta.importedSource") : undefined);
  const arguments_ = binding
    ? ["deploy", "--name", binding.project, "--git", binding.repository, "--connection", binding.connectionId, "--ref", binding.ref || "main", "--root", binding.root || ""]
    : ["deploy", folder];
  if (!binding && imported?.project) arguments_.push("--name", imported.project);
  const task = new vscode.Task(
    { type: "paasta", mode },
    vscode.TaskScope.Workspace,
    label,
    "Paasta",
    new vscode.ProcessExecution(String(cli), arguments_, { cwd: folder, ...(hosted() ? { env: { ...process.env, PAASTA_RUNTIME_SERVER: target, PAASTA_RUNTIME_TOKEN: token } } : {}) })
  );
  task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated, clear: true, focus: true };
  await vscode.tasks.executeTask(task);
  if (mode === "cost") vscode.window.showInformationMessage("پاستا هزینه را پیش از تأیید استقرار در ترمینال نمایش می‌دهد؛ برای پیش‌نمایش، تأیید نهایی نکنید.");
}

async function showStatus(context, value) {
  const name = await selectProject(context, value); if (!name) return;
  const result = await api(context, `/api/projects/${encodeURIComponent(name)}/deployments`);
  const latest = result.deployments?.[0];
  const detail = latest ? `آخرین نسخه: ${latest.status}\nپشته: ${latest.stack}\nزمان: ${new Date(latest.created_at).toLocaleString("fa-IR")}` : "هنوز استقراری ثبت نشده است.";
  const action = await vscode.window.showInformationMessage(`${name}\n${detail}`, "بازکردن کنسول");
  if (action) await openConsole(name);
}

async function showLogs(context, value) {
  const name = await selectProject(context, value); if (!name) return;
  const logs = await api(context, `/api/projects/${encodeURIComponent(name)}/logs?tail=300&since=3600`);
  const document = await vscode.workspace.openTextDocument({ language: "log", content: String(logs) });
  await vscode.window.showTextDocument(document, { preview: true });
}

async function rollback(context, value, provider) {
  const name = await selectProject(context, value); if (!name) return;
  const result = await api(context, `/api/projects/${encodeURIComponent(name)}/deployments`);
  const candidates = (result.deployments || []).filter((item) => item.status === "ready" || item.status === "succeeded");
  const selected = await vscode.window.showQuickPick(candidates.map((item) => ({ label: item.active ? `${item.id} (فعال)` : item.id, description: `${item.stack} · ${new Date(item.created_at).toLocaleString("fa-IR")}`, buildId: item.id })), { placeHolder: "نسخه مقصد را انتخاب کنید" });
  if (!selected) return;
  const confirmation = await vscode.window.showWarningMessage(`نسخه فعال «${name}» به ${selected.buildId} بازگردانده شود؟ داده‌های سرویس حذف نمی‌شوند.`, { modal: true }, "بازگردانی");
  if (confirmation !== "بازگردانی") return;
  await api(context, `/api/projects/${encodeURIComponent(name)}/rollback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ buildId: selected.buildId }) });
  provider.refresh();
  vscode.window.showInformationMessage("بازگردانی شروع شد؛ نسخه قبلی تا آماده‌شدن نسخه مقصد حفظ می‌شود.");
}

async function openConsole(value) {
  const name = projectName(value) || value;
  const path = name ? `/projects/${encodeURIComponent(name)}` : "/projects";
  await vscode.env.openExternal(vscode.Uri.parse(`${server()}${path}`));
}

function guarded(handler) { return async (...args) => { try { await handler(...args); } catch (error) { vscode.window.showErrorMessage(`پاستا: ${error.message}`); } }; }

function activate(context) {
  rememberEditor(vscode.window.activeTextEditor);
  require('./paastacode-loader').activate(context);
  require('./coding-tools.cjs').activateTools(context, {api,hosted,projectFolder,showStatus,getCliSession:async()=>({server:server(),token:await sessionToken(context)})});
  const provider = new ProjectProvider(context);
  const accountProvider = new AccountProvider(context);
  const homeProvider = new PaastaHomeProvider(context);
  const connectionStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
  connectionStatus.name = "اتصال پاستا";
  connectionStatus.show();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("paasta.account", accountProvider),
    vscode.window.registerTreeDataProvider("paasta.projects", provider),
    vscode.window.registerWebviewViewProvider("paasta.actions", homeProvider),
    connectionStatus,
    vscode.commands.registerCommand("paasta.publishGit", guarded(() => publishGit(context, api))),
    vscode.commands.registerCommand("paasta.importProject", guarded(() => hosted() ? openProject(context, api, authorizedFetch) : importProject(context, api, authorizedFetch))),
    vscode.commands.registerCommand("paasta.openProject", guarded(value => openProject(context, api, authorizedFetch, value))),
    vscode.commands.registerCommand("paasta.openView", guarded(() => vscode.commands.executeCommand("workbench.view.extension.paasta"))),
    vscode.commands.registerCommand("paasta.signIn", guarded(() => signIn(context, accountProvider, provider, homeProvider, connectionStatus))),
    vscode.commands.registerCommand("paasta.signOut", guarded(async () => { if (hosted()) { await vscode.env.openExternal(vscode.Uri.parse(server() + "/editor")); vscode.window.showInformationMessage("برای پایان دسترسی محیط، از حساب کنسول خارج شوید یا محیط را خاموش کنید."); return; } await context.secrets.delete(TOKEN_KEY); await context.secrets.delete(TOKEN_SERVER_KEY); await updateConnectionUi(context, accountProvider, provider, homeProvider, connectionStatus); vscode.window.showInformationMessage("از پاستا خارج شدید. Token محلی حذف شد."); })),
    vscode.commands.registerCommand("paasta.refreshProjects", () => provider.refresh()),
    vscode.commands.registerCommand("paasta.deployWorkspace", guarded(() => runCli(context, "deploy"))),
    vscode.commands.registerCommand("paasta.previewCost", guarded(() => runCli(context, "cost"))),
    vscode.commands.registerCommand("paasta.showStatus", guarded((value) => showStatus(context, value))),
    vscode.commands.registerCommand("paasta.showLogs", guarded((value) => showLogs(context, value))),
    vscode.commands.registerCommand("paasta.rollback", guarded((value) => rollback(context, value, provider))),
    vscode.commands.registerCommand("paasta.openConsole", guarded((value) => openConsole(projectName(value)))),
    vscode.commands.registerCommand("paasta.code.selectModel", guarded(() => vscode.commands.executeCommand("paastacode.openEditor"))),
    vscode.commands.registerCommand("paasta.code.openChat", () => vscode.commands.executeCommand('paastacode.openEditor')),
    vscode.commands.registerCommand("paasta.code.ask", () => vscode.commands.executeCommand('paastacode.openEditor'))
  );
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => homeProvider.refresh()));
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => { rememberEditor(editor); homeProvider.refresh(); }));
  void updateConnectionUi(context, accountProvider, provider, homeProvider, connectionStatus);
  void guarded(async () => { await startHostedWorkspace(context, api, authorizedFetch); provider.refresh(); homeProvider.refresh(); })();
}

function deactivate() {}

module.exports = { activate, deactivate };
