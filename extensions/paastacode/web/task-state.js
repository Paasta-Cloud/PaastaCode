// Shared by the browser and VS Code's nonce-protected classic-script webview.
// Only summarize observed tool results; an idle engine is not proof of success.
globalThis.PaastaTasks = {
  toolStatus(part){return part.tool==='bash'&&part.state?.status==='completed'&&Number.isInteger(part.state.metadata?.exit)&&part.state.metadata.exit!==0?'error':part.state?.status||'completed';},
  checks(messages = []) {
    const start=messages.findLastIndex(message=>message.info?.role==='user');
    return messages.slice(start+1).filter(message=>message.info?.role==='assistant').flatMap(message=>message.parts||[])
      .filter(part=>part.type==='tool'&&part.tool==='bash')
      .filter(part=>/^(?:(?:npm|pnpm|yarn|bun) (?:test|run (?:test(?::[\w-]+)?|lint|typecheck|check|build))|node --test|(?:python(?:3)? -m )?pytest|go test|cargo (?:test|check|clippy)|dotnet test|mvn test|gradle test)(?:\s|$)/.test((part.state?.input?.command||'').trim())&&!/[;&|`\n]/.test(part.state.input.command))
      .map(part=>{const s=part.state,exit=Number.isInteger(s.metadata?.exit)?s.metadata.exit:null;return {command:s.input.command,status:['running','pending'].includes(s.status)?'running':s.status==='error'||exit!==null&&exit!==0?'failed':s.status==='completed'&&exit===0&&!/(?:# tests 0\b|no tests (?:found|ran)|skipping running files|collected 0 items)/i.test(s.output||'')?'passed':'unknown',exit,output:String(s.output||s.error||'').slice(-16000)};});
  },
  status(id, statuses = {}, permissions = []) {
    if (permissions.some(item => item.sessionID === id)) return 'waiting';
    return statuses[id] && statuses[id].type !== 'idle' ? 'running' : 'idle';
  },
  recap(messages = []) {
    const start = messages.findLastIndex(message => message.info?.role === 'user');
    const replies = messages.slice(start + 1).filter(message => message.info?.role === 'assistant');
    if (!replies.some(message => message.info?.error || (message.parts || []).some(part => part.type === 'tool' || part.type === 'text' && !part.synthetic && part.text?.trim()))) return null;
    const tools = replies.flatMap(message => message.parts || []).filter(part => part.type === 'tool');
    const completed = tools.filter(tool => tool.state?.status === 'completed');
    const errors = tools.filter(tool => tool.state?.status === 'error'||tool.tool==='bash'&&Number.isInteger(tool.state?.metadata?.exit)&&tool.state.metadata.exit!==0).length + replies.filter(message => message.info?.error).length;
    const unfinished = tools.some(tool => ['running', 'pending'].includes(tool.state?.status));
    const files = new Set();
    for (const tool of completed) {
      if (['write', 'edit'].includes(tool.tool) && tool.state?.input?.filePath) files.add(tool.state.input.filePath);
      if (tool.tool === 'apply_patch') for (const file of Array.isArray(tool.state?.metadata?.files) ? tool.state.metadata.files : []) {
        if (file.filePath) files.add(file.filePath);
      }
    }
    const commands = tools.filter(tool => tool.tool === 'bash');
    return {completed: completed.length, errors, unfinished, files: [...files], commands: commands.length, checks:globalThis.PaastaTasks.checks(messages),
      title: errors ? 'اجرا نیاز به بررسی دارد' : unfinished ? 'اجرای ناتمام' : 'خلاصهٔ آخرین اجرا',
      detail: errors ? 'خطاهای ثبت‌شده را پیش از ادامه بررسی کنید.' : unfinished ? 'موتور بیکار است، اما پایان بعضی ابزارها ثبت نشده است.' : 'نتیجهٔ ابزارها را بررسی کنید؛ پایان اجرا به معنی تأیید درستی کد نیست.'};
  }
};
