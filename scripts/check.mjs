import {readFile,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {normaliseDataset} from '../dist/model.js';
for(const name of ['dist/index.html','dist/style.css','dist/model.js','dist/canvas.js','dist/app.js','dist/dataset.json'])await access(new URL('../'+name,import.meta.url));
for(const name of ['model.js','canvas.js','app.js']){
  const result=spawnSync(process.execPath,['--check',new URL('../dist/'+name,import.meta.url).pathname],{stdio:'inherit'});if(result.status!==0)process.exit(1);
}
const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const app=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);if(new Set(ids).size!==ids.length)throw Error('Duplicate HTML IDs');
for(const [,id] of app.matchAll(/\$\('([^']+)'\)/g))if(!ids.includes(id))throw Error('Missing UI element: '+id);
const data=normaliseDataset(JSON.parse(await readFile(new URL('../dist/dataset.json',import.meta.url),'utf8')));
console.log(`Static build verified: ${ids.length} UI controls/elements; ${data.transactions.length} sample transfers; no runtime dependencies.`);
