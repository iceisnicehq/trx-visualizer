import {test} from 'node:test';
import {strictEqual,ok,deepStrictEqual} from 'node:assert';
import {readFile} from 'node:fs/promises';
import {normaliseDataset,datasetFromCsv,buildFrames,createReplay,ownerPositions,SUN} from '../public/model.js';
import {treeLayout} from '../public/tree-layout.js';
import {journeyCsv} from '../public/exports.js';
const data=normaliseDataset(JSON.parse(await readFile(new URL('../public/dataset.json',import.meta.url),'utf8')));
test('the initial row is explicit, wallet columns stay fixed, days descend and crowded days receive more space',()=>{
  const frames=buildFrames(data),tree=treeLayout(data,frames);
  strictEqual(frames[0].period.type,'LEGACY');ok(frames[0].boundary);strictEqual(frames[0].period.initial.length,17);
  for(let i=1;i<tree.rows.length;i++)ok(tree.rows[i].y>tree.rows[i-1].y+200);
  strictEqual(tree.columns.size,17);strictEqual(new Set(tree.columns.values()).size,17);
  const largest=frames.findIndex(f=>f.events.length>30);ok(largest>=0);ok(tree.rows[largest].height>250);
});
test('everyone CSV keeps every native transfer once after import, including pre-plan rebalances and returns',()=>{
  const csv=journeyCsv(data),imported=datasetFromCsv([{text:csv}]);
  strictEqual(imported.transactions.length,data.transactions.length);
  strictEqual(imported.transactions.filter(t=>t.attribution==='FIFO').length,data.transactions.filter(t=>t.attribution==='FIFO').length);
  deepStrictEqual(imported.wallets.map(w=>[w.address,w.ordinal,w.role]),data.wallets.map(w=>[w.address,w.ordinal,w.role]));
});
test('personal CSV follows the original stake through other addresses and replays exactly 1 TRX in every period',()=>{
  const owner=data.wallets[9].address,csv=journeyCsv(data,{owner}),personal=datasetFromCsv([{text:csv}]);
  const wanted=data.transactions.filter(t=>t.allocations.some(a=>a.ownerAddress===owner));
  strictEqual(personal.transactions.length,wanted.length);ok(personal.transactions.some(t=>t.from!==owner&&t.to!==owner));
  ok(personal.transactions.some(t=>t.amountSun>t.allocations.find(a=>a.ownerAddress===owner).amountSun));
  const frames=buildFrames(personal),replay=createReplay(frames);
  for(let i=0;i<frames.length;i++){const result=replay(i);strictEqual(result.issue,null);strictEqual(ownerPositions(result.after,owner).reduce((n,p)=>n+p.amountSun,0),SUN);}
  strictEqual(personal.wallets[9].ordinal,9);strictEqual(personal.wallets[9].label,'Node 10');
});
test('CSV confirmation filtering is explicit and never turns planned movements into confirmed history',()=>{
  const imported=datasetFromCsv([{text:journeyCsv(data,{confirmedOnly:true})}]);
  strictEqual(imported.transactions.length,data.transactions.filter(t=>t.status==='CONFIRMED').length);ok(imported.transactions.every(t=>t.status==='CONFIRMED'));
});
