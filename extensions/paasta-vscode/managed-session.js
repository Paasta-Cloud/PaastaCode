const fs = require('node:fs');
const path = require('node:path');

function hosted() { return Boolean(process.env.PAASTA_EDITOR_SESSION_FILE); }
function isProjectsRoot(folder) { return hosted() && !!process.env.PAASTA_EDITOR_PROJECTS_ROOT && !!folder && path.resolve(folder) === path.resolve(process.env.PAASTA_EDITOR_PROJECTS_ROOT); }
function managedSession() {
  if (!hosted()) return undefined;
  try {
    const session = JSON.parse(fs.readFileSync(process.env.PAASTA_EDITOR_SESSION_FILE, 'utf8'));
    const expires = new Date(session.expiresAt).getTime();
    if (!/^paasta_[A-Za-z0-9_-]{43}$/.test(session.token) || session.workspaceId !== process.env.PAASTA_EDITOR_WORKSPACE_ID
      || !['https://console.paasta.cloud', 'https://paasta.cloud'].includes(session.server) || !Number.isFinite(expires) || expires <= Date.now()) return undefined;
    return session;
  } catch { return undefined; }
}
function localProject(folder) {
  if (!hosted()) return undefined;
  try { const value = JSON.parse(fs.readFileSync(path.join(folder, '.paasta', 'workspace.json'), 'utf8')); return /^[a-z0-9][a-z0-9-]{0,62}$/.test(value.project) ? value : undefined; }
  catch { return undefined; }
}
module.exports = { hosted, managedSession, localProject, isProjectsRoot };
