// Static, reviewed contributions only. No extension-supplied executable or network access.
const addons=Object.freeze([
 Object.freeze({id:'GitHub.github-vscode-theme',folder:'github',name:'GitHub Theme',version:'6.3.5',description:'تم‌های روشن، تاریک و کنتراست بالا',license:'MIT'}),
 Object.freeze({id:'dracula-theme.theme-dracula',folder:'dracula',name:'Dracula',version:'2.25.1',description:'تم تاریک Dracula و Dracula Soft',license:'MIT'})
]);
function selection(value){if(!Array.isArray(value)||value.length>addons.length||value.some(id=>typeof id!=='string'||!addons.some(addon=>addon.id===id))||new Set(value).size!==value.length)throw Error('فهرست افزونه‌ها معتبر نیست.');return addons.filter(addon=>value.includes(addon.id)).map(addon=>addon.id);}
function preferenceKey(account){if(!/^[a-f0-9]{64}$/.test(account))throw Error('حساب محیط معتبر نیست.');return 'paasta.web.extensions.'+account;}
module.exports={addons,selection,preferenceKey};
