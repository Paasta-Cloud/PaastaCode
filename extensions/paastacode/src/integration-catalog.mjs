import {readFile,readdir} from 'node:fs/promises';

// Curated official endpoints. Listing a preset never starts or installs it.
export const mcpPresets=[
  {id:'figma',name:'Figma',icon:'design',description:'خواندن طرح، اندازه‌ها و اجزای رابط از فایل‌های فیگما.',setup:'به ورود و مجوز حساب Figma نیاز دارد.',url:'https://mcp.figma.com/mcp',source:'https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/'},
  {id:'context7',name:'Context7',icon:'book',description:'مستندات و نمونه‌کد به‌روز کتابخانه‌ها در کنار کد پروژه.',setup:'پس از فعال‌سازی، ورود به Context7 را تکمیل کنید.',url:'https://mcp.context7.com/mcp/oauth',source:'https://context7.com/docs/resources/all-clients'},
  {id:'linear',name:'Linear',icon:'tasks',description:'بررسی و مدیریت مسئله‌ها و کارهای تیم.',setup:'دسترسی تابع فضای کار و مجوز حساب Linear است.',url:'https://mcp.linear.app/mcp',source:'https://linear.app/docs/mcp'},
  {id:'notion',name:'Notion',icon:'book',description:'جست‌وجو و کار با مستندات و صفحه‌های تیم.',setup:'در زمان ورود، فقط صفحه‌های موردنیاز را مجاز کنید.',url:'https://mcp.notion.com/mcp',source:'https://developers.notion.com/guides/mcp/get-started-with-mcp'},
  {id:'figma-desktop',name:'Figma Desktop',icon:'desktop',description:'اتصال به فایل بازشده در برنامهٔ فیگما روی همین کامپیوتر.',setup:'ابتدا MCP را در Dev Mode برنامهٔ Figma فعال کنید.',url:'http://127.0.0.1:3845/mcp',source:'https://developers.figma.com/docs/figma-mcp-server/local-server-installation/'},
];
export const skillPresets=[
  {id:'ponytail',name:'Ponytail',icon:'code',description:'حل کامل مسئله با تغییر کوچک، خوانا و آزمون متناسب.',setup:'دستورالعمل مهارت؛ افزونه و هوک‌های Ponytail نصب نمی‌شوند.',version:'5.3.2',license:'MIT',source:'https://github.com/DietrichGebert/ponytail'},
  {id:'ui-ux-design',name:'UI/UX Design',icon:'design',description:'طراحی رابط، کامپوننت، دسترس‌پذیری و بررسی نمایش موبایل و RTL.',setup:'مهارت اختصاصی پاستا؛ از طراحی موجود پروژه پیروی می‌کند.',version:'1.0.0',license:'MIT',source:'https://github.com/Paasta-Cloud/PaastaCode'},
  {id:'persian-writing',name:'Persian Writing',icon:'text',description:'نگارش طبیعی فارسی، نیم‌فاصله و چیدمان درست متن راست‌به‌چپ.',setup:'راهنمای نگارش و رابط فارسی؛ مرجع مرتبط هنگام نیاز خوانده می‌شود.',version:'1.3.6',license:'MIT',source:'https://github.com/ali2000hos/persian-writing'},
];

export async function presetSkill(id){
  if(!skillPresets.some(item=>item.id===id))throw new Error('مهارت آماده پیدا نشد.');
  const root=new URL('./bundled-skills/'+id+'/',import.meta.url),files=[];
  async function walk(path=''){
    for(const entry of await readdir(new URL(path,root),{withFileTypes:true})){
      const name=path+entry.name;
      if(entry.isDirectory())await walk(name+'/');
      else if(name!=='SKILL.md')files.push({path:name,data:(await readFile(new URL(name,root))).toString('base64')});
    }
  }
  await walk();return {markdown:await readFile(new URL('SKILL.md',root),'utf8'),files};
}
