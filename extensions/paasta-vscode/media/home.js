const vscode = acquireVsCodeApi();
let signedIn = false;
const buttons = document.querySelectorAll("button[data-command]");
buttons.forEach((button) => button.addEventListener("click", () => vscode.postMessage({ command: button.dataset.command === "deploy" && !signedIn ? "login" : button.dataset.command })));
window.addEventListener("message", ({ data }) => {
  if (data.type !== "state") return;
  signedIn = data.signedIn;
  document.querySelector('[data-command="openProject"]').hidden = !data.hosted;
  document.querySelector('[data-command="openProject"]').classList.toggle('primary', !!data.hosted && !data.folder);
  document.querySelector('[data-command="openProject"]').classList.toggle('secondary', !!data.folder);
  const folder = document.getElementById("folderName"), hint = document.getElementById("deployHint"), footer = document.querySelector("footer"), connection = document.getElementById("connectionText"), deploy = document.querySelector('[data-command="deploy"]');
  folder.textContent = data.folder || "یک پروژه باز کنید";
  hint.textContent = data.folder ? "هزینه و تنظیمات در ترمینال نمایش داده می‌شود و فقط با تأیید شما انتشار شروع خواهد شد." : "پوشه پروژه را در VS Code باز کنید تا مستقیم روی پاستا منتشر شود.";
  const gitContext = document.getElementById('gitContext');
  gitContext.hidden = !data.hosted || !data.folder;
  gitContext.replaceChildren();
  if (data.git?.repository) {
    const identifier = text => { const value = document.createElement('bdi'); value.dir = 'ltr'; value.textContent = text; return value; };
    gitContext.append(identifier(({github:'GitHub',gitlab:'GitLab'}[data.git.provider] || 'Git')), ' · ', identifier(data.git.repository), ' · شاخهٔ انتشار در پاستا: ', identifier(data.git.ref));
    if (!data.git.connectionId) gitContext.append(' · حساب دارای دسترسی را از کنسول متصل کنید.');
  } else gitContext.textContent = data.git === null ? 'اتصال Git این پروژه بررسی نشد؛ وضعیت اتصال را در کنسول بررسی کنید.' : 'این پروژه به Git متصل نیست؛ با «انتقال پروژه به Git» می‌توانید مخزن آن را بسازید یا متصل کنید.';
  deploy.disabled = !data.folder;
  document.querySelector('[data-command="git"]').disabled = !data.folder;
  document.querySelector('[data-command="import"]').disabled = !data.folder;
  footer.classList.toggle("offline", !data.signedIn);
  connection.textContent = data.signedIn ? "حساب پاستا متصل است" : "برای انتشار ابتدا وارد حساب شوید";
});
