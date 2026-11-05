export const accessModes = ["review", "full"];
export function sessionPermissions(mode, phase="build") {
  if (!accessModes.includes(mode)) throw new Error("حالت دسترسی معتبر نیست.");
  if(phase==="plan")return [{permission:"*",pattern:"*",action:"deny"},
    ...["read","glob","grep"].map(permission=>({permission,pattern:"*",action:"allow"})),
    ...["*.env","*.env.*","*.pem","*.key"].map(pattern=>({permission:"read",pattern,action:"deny"})),
    {permission:"external_directory",pattern:"*",action:"deny"}];
  // Session rules override the provider defaults, including previously denied paths.
  return [{permission:"*",pattern:"*",action:mode==="full"?"allow":"ask"},
    ...(mode==="review"?[{permission:"read",pattern:"*",action:"allow"},{permission:"glob",pattern:"*",action:"allow"},{permission:"grep",pattern:"*",action:"allow"},
      ...["*.env","*.env.*","*.pem","*.key"].map(pattern=>({permission:"read",pattern,action:"deny"})),{permission:"external_directory",pattern:"*",action:"deny"}]:[]),
    {permission:"question",pattern:"*",action:"deny"}];
}
