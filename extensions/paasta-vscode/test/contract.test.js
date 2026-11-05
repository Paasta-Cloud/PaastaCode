const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const source = fs.readFileSync(path.join(root, "extension.js"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const usage = fs.readFileSync(path.join(root, "USAGE.md"), "utf8");
const security = fs.readFileSync(path.join(root, "SECURITY.md"), "utf8");
const commands = new Set(manifest.contributes.commands.map((item) => item.command));
assert.equal(manifest.version, "0.8.5");
assert.equal(manifest.contributes.viewsContainers.activitybar.length,1);
assert(manifest.contributes.views.paasta.some(view=>view.id==='paasta.code'));
for(const command of ['paastacode.open','paastacode.openEditor','paastacode.billing','paastacode.update'])assert(commands.has(command));
assert.match(source,/require\('\.\/paastacode-loader'\)\.activate\(context\)/);
assert.equal(manifest.contributes.viewsContainers.activitybar[0].id, "paasta");
assert.equal(manifest.contributes.views.paasta[0].id, "paasta.actions");
assert.equal(manifest.contributes.views.paasta[0].type, "webview");
assert.ok(manifest.contributes.viewsWelcome.some((item) => item.view === "paasta.account" && item.contents.includes("command:paasta.signIn")));
assert.ok(manifest.contributes.walkthroughs.some((item) => item.id === "paasta.gettingStarted"));

for (const command of ["paasta.signIn", "paasta.openView", "paasta.deployWorkspace", "paasta.previewCost", "paasta.showStatus", "paasta.showLogs", "paasta.rollback", "paasta.openConsole"]) {
  assert(commands.has(command), `missing command ${command}`);
  assert(source.includes(`registerCommand(\"${command}\"`), `command ${command} is not registered`);
}
for (const command of ["paasta.code.ask", "paasta.code.selectModel"]) {
  assert(commands.has(command), `missing command ${command}`);
  assert(source.includes(`registerCommand("${command}"`), `command ${command} is not registered`);
}
assert.ok(commands.has("paasta.code.openChat"));
assert.match(source, /registerCommand\("paasta\.code\.openChat"/);

assert.match(source, /context\.secrets\.store\(TOKEN_KEY/);
assert.match(source, /context\.secrets\.delete\(TOKEN_KEY/);
assert.match(source, /createStatusBarItem/);
assert.match(source, /setContext", "paasta\.signedIn"/);
assert.match(source, /workbench\.view\.extension\.paasta/);
assert.match(source, /\/api\/cli\/context/);
assert.match(source, /clientName: "Paasta VS Code"/);
assert.match(source, /\/api\/cli\/device\/token/);
assert.match(source, /\/api\/projects\/\$\{encodeURIComponent\(name\)\}\/logs/);
assert.match(source, /\/api\/projects\/\$\{encodeURIComponent\(name\)\}\/rollback/);
assert.match(source, /showWarningMessage\([\s\S]*modal: true/);
assert.match(source, /new vscode\.ProcessExecution/);
assert.match(source, /PAASTA_API_KEY: token/);
assert.match(source, /registerWebviewViewProvider\("paasta\.actions"/);
assert.match(source, /createWebviewPanel\("paasta\.codeChat"/);
assert.match(source, /class PaastaCodePanel/);
assert.doesNotMatch(source, /terminal\.sendText/);
assert.doesNotMatch(source, /deleteProject|projects:delete/);
assert.match(source, /\/api\/ai-builder\/models/);
assert.match(source, /response\.body\.getReader/);
assert.match(source, /vscode\.diff/);
assert.match(source, /showWarningMessage\([\s\S]*اعمال فایل‌های انتخاب‌شده/);
assert.match(source, /secretFile/);
assert.match(source, /\.env/);
assert.match(source, /workspaceState\.update\(WORKSPACE_KEY/);
assert.match(source, /workspace\.applyEdit/);
assert.match(source, /canPickMany: true/);
assert.match(source, /\/approvals/);
assert.match(source, /decision: accepted\.has\(path\) \? "approved" : "rejected"/);
assert.match(source, /workspace\.isTrusted/);
assert.match(source, /AI_CONSENT_KEY/);
assert.match(source, /ادامه و ارسال/);
assert.equal(manifest.contributes.configuration.properties["paasta.server"].default, "https://paasta.cloud");
assert.match(readme, /Install from VSIX/);
assert.match(readme, /paasta\.cloud\/install\.ps1/);
assert.match(usage, /Workspace چندریشه‌ای/);
assert.match(usage, /تأیید Modal|پیام تأیید/);
assert.match(security, /Tenant-aware/);
assert.match(security, /SecretStorage/);

console.log("Paasta VS Code extension contract checks passed.");
