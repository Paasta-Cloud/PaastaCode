export const accessModes = ["review", "full"];
export function sessionPermissions(mode, phase="build",skillPaths=[]) {
  if (!accessModes.includes(mode)) throw new Error("حالت دسترسی معتبر نیست.");
  if(phase==="plan")return [{permission:"*",pattern:"*",action:"deny"},
    ...["read","glob","grep","skill"].map(permission=>({permission,pattern:"*",action:"allow"})),
    ...["*.env","*.env.*","*.pem","*.key"].map(pattern=>({permission:"read",pattern,action:"deny"})),
    {permission:"external_directory",pattern:"*",action:"deny"},...skillDirectories(skillPaths)];
  // Session rules override the provider defaults, including previously denied paths.
  return [{permission:"*",pattern:"*",action:mode==="full"?"allow":"ask"},
    ...(mode==="review"?[{permission:"read",pattern:"*",action:"allow"},{permission:"glob",pattern:"*",action:"allow"},{permission:"grep",pattern:"*",action:"allow"},{permission:"skill",pattern:"*",action:"allow"},
      ...["*.env","*.env.*","*.pem","*.key"].map(pattern=>({permission:"read",pattern,action:"deny"})),{permission:"external_directory",pattern:"*",action:"deny"},...skillDirectories(skillPaths)]:[]),
    {permission:"question",pattern:"*",action:"deny"}];
}
const skillDirectories=paths=>paths.flatMap(path=>[path,path.replaceAll('\\','/')+'/**'].map(pattern=>({permission:'external_directory',pattern,action:'allow'})));
