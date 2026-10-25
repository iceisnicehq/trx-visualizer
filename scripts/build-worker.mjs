import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const root=new URL('../',import.meta.url);
const checked=spawnSync(process.execPath,[new URL('scripts/check.mjs',root).pathname],{cwd:root,stdio:'inherit'});if(checked.status!==0)process.exit(1);
const names=['index.html','style.css','model.js','canvas.js','app.js','exports.js','tree-layout.js','dataset.json','demo.json'];
const types={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',json:'application/json; charset=utf-8'};
const assets=[];for(const name of names)assets.push(['/'+name,{body:await readFile(new URL('public/'+name,root),'utf8'),type:types[name.split('.').at(-1)]}]);
const model=(await readFile(new URL('public/model.js',root),'utf8')).replace(/^export\s+/gm,'');
const server=(await readFile(new URL('worker/index.js',root),'utf8')).replace(/^import[^\n]+\n/,'').replace(/^export default[^\n]+\n?/m,'');
const bundle=model+'\n'+server+'\nconst embeddedAssets=new Map('+JSON.stringify(assets)+');\nexport default createHandler(embeddedAssets);\n';
await rm(new URL('dist/',root),{recursive:true,force:true});await mkdir(new URL('dist/server/',root),{recursive:true});await mkdir(new URL('dist/.openai/',root),{recursive:true});
await writeFile(new URL('dist/server/index.js',root),bundle);
let manifest;try{manifest=await readFile(new URL('.openai/hosting.json',root));}catch(e){if(e.code!=='ENOENT')throw e;manifest=JSON.stringify({d1:null,r2:'BUCKET'});}
await writeFile(new URL('dist/.openai/hosting.json',root),manifest);
const compiled=await import('data:text/javascript;base64,'+Buffer.from(bundle).toString('base64'));
if(typeof compiled.default?.fetch!=='function')throw Error('Worker must export default.fetch');
const page=await compiled.default.fetch(new Request('https://test.invalid/'),{});
if(page.status!==200||!(await page.text()).includes('TRX Flow Atlas'))throw Error('Bundled page is missing');
console.log('Worker built and verified: persistent shared snapshots, public reads, password-protected publishing; '+Buffer.byteLength(bundle)+' bytes.');
