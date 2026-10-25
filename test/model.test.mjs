import {test} from 'node:test';
import {strictEqual,deepStrictEqual,ok,throws} from 'node:assert';
import {readFile} from 'node:fs/promises';
import {normaliseDataset,parseCsv,datasetFromCsv,buildFrames,createReplay,ownerPositions,composition,visibleTransactions,SUN} from '../public/model.js';
const a='Wallet-AAA',b='Wallet-BBB',c='Wallet-CCC';
const sample=()=>({format:'trx-flow-atlas',version:1,network:'mock',wallets:[a,b,c].map((address,ordinal)=>({address,ordinal,label:'Node '+(ordinal+1)})),
  periods:[{id:'plan-one',type:'SMART',label:'Plan 1',initial:[a,b,c].map(ownerAddress=>({holderAddress:ownerAddress,ownerAddress,amountSun:SUN}))}],
  transactions:[
    {id:'transfer-one',periodId:'plan-one',sequence:1,kind:'MIX',status:'CONFIRMED',from:a,to:b,amountSun:500001,allocations:[{ownerAddress:a,amountSun:500001}],campaignDay:1,
      scheduledAt:'2026-10-01T20:59:00Z',confirmedAt:'2026-10-01T20:59:00Z'},
    {id:'transfer-two',periodId:'plan-one',sequence:2,kind:'MIX',status:'APPROVED',from:b,to:c,amountSun:750001,
      allocations:[{ownerAddress:b,amountSun:250000},{ownerAddress:a,amountSun:500001}],campaignDay:2,scheduledAt:'2026-10-01T21:01:00Z'}
  ]});
test('personal tracing follows the stake through peer-to-peer packets with exact single-Sun conservation',()=>{
  const data=normaliseDataset(sample()),frames=buildFrames(data),replay=createReplay(frames),end=replay(frames.length-1);
  strictEqual(frames.length,3);strictEqual(frames[1].label,'2026-10-01');strictEqual(frames[2].label,'2026-10-02');strictEqual(end.issue,null);
  for(const owner of [a,b,c])strictEqual(ownerPositions(end.after,owner).reduce((n,p)=>n+p.amountSun,0),SUN);
  strictEqual(composition(end.after,c).find(s=>s.ownerAddress===a).amountSun,500001);
  strictEqual(visibleTransactions(frames[2],a)[0].from,b);strictEqual(visibleTransactions(frames[2],c).length,0);
  strictEqual([...end.after.values()].reduce((a,b)=>a+b,0),3*SUN);
});
test('scrubbing, backwards playback and repeated reads never mutate the exported data or the cached balances',()=>{
  const data=normaliseDataset(sample()),before=JSON.stringify(data),frames=buildFrames(data,{granularity:'transaction'}),replay=createReplay(frames);
  const final=[...replay(2).after];strictEqual(replay(0).after.size,3);replay(1);deepStrictEqual([...replay(2).after],final);strictEqual(JSON.stringify(data),before);
});
test('a second plan resets to its explicit accounting baseline and never doubles the reused 1 TRX',()=>{
  const raw=sample();raw.periods.push({...raw.periods[0],id:'plan-two',label:'Plan 2'});
  raw.transactions.push({...raw.transactions[0],id:'next-transfer',periodId:'plan-two',sequence:3,scheduledAt:'2026-10-03T09:00:00Z',confirmedAt:'2026-10-03T09:00:00Z'});
  const data=normaliseDataset(raw),frames=buildFrames(data),replay=createReplay(frames),boundary=frames.findIndex(f=>f.period.id==='plan-two');
  ok(frames[boundary].boundary);strictEqual([...replay(boundary).after.values()].reduce((a,b)=>a+b,0),3*SUN);
  strictEqual(ownerPositions(replay(boundary).after,a)[0].holderAddress,a);strictEqual(frames[boundary].events.length,0);
});
test('confirmed-only, plan, legacy and algorithm-round filters are independent',()=>{
  const raw=sample();raw.periods.push({...raw.periods[0],id:'legacy-one',type:'LEGACY'});
  const data=normaliseDataset(raw);
  strictEqual(buildFrames(data,{status:'confirmed'}).flatMap(f=>f.events).length,1);
  strictEqual(buildFrames(data,{axis:'round'})[1].label,'Round 1');
  strictEqual(buildFrames(data,{scope:'legacy-one',legacy:false}).length,0);strictEqual(buildFrames(data,{scope:'legacy-one',legacy:true}).length,1);
  raw.periods[0].status='DRAFT';strictEqual(buildFrames(normaliseDataset(raw),{status:'confirmed',legacy:false}).length,0);
});
test('a deficit or unknown attribution stops its period without creating or partially spending any stake',()=>{
  const raw=sample();raw.transactions[1].allocations=[{ownerAddress:a,amountSun:750001}];
  let data=normaliseDataset(raw),frames=buildFrames(data),end=createReplay(frames)(2);
  ok(end.issue.includes('cannot fund'));strictEqual(ownerPositions(end.after,a).reduce((n,p)=>n+p.amountSun,0),SUN);
  strictEqual(composition(end.after,c).length,1);
  raw.transactions[1].allocations=[];raw.transactions[1].attribution='UNKNOWN';raw.periods[0].coverage='PARTIAL';
  data=normaliseDataset(raw);end=createReplay(buildFrames(data))(2);ok(end.issue.includes('unavailable'));strictEqual(composition(end.after,c).length,1);
});
test('imports reject fractional Sun, unsafe integers, mismatched shares, duplicate transactions and missing timezone',()=>{
  for(const mutate of [r=>r.transactions[0].amountSun=.5,r=>r.transactions[0].amountSun=Number.MAX_SAFE_INTEGER+1,
    r=>r.transactions[0].allocations[0].amountSun=500000,r=>r.transactions.push(r.transactions[0]),r=>r.transactions[0].scheduledAt='2026-10-01 14:00:00']){
    const raw=sample();mutate(raw);throws(()=>normaliseDataset(raw));
  }
  throws(()=>normaliseDataset({wallets:[{privateKey:'never-render-this'}]}));
});
test('CSV parser handles BOM, CRLF, escaped quotes, embedded newlines and empty final cells',()=>{
  deepStrictEqual(parseCsv('\uFEFF"name","note","end"\r\n"Node 1","a, b\nwith ""quotes""",""\r\n'),[{name:'Node 1',note:'a, b\nwith "quotes"',end:''}]);
  throws(()=>parseCsv('a,b\n"broken,b'));throws(()=>parseCsv('a,b\n1,2,3'));
});
function csv(rows){return rows.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');}
const header=['campaign_id','sequence','kind','status','from_address','to_address','native_amount_sun','stake_owner_address','owner_amount_sun','packet_ownership','scheduled_utc','campaign_day'];
test('several personal CSVs deduplicate one shared native transaction instead of adding the amount twice',()=>{
  const base=['plan-one','1','MIX','CONFIRMED',a,b,'750000'];
  const packet=`${a}: 0.500000 TRX; ${b}: 0.250000 TRX`;
  const one=csv([header,[...base,a,'500000',packet,'2026-10-01T09:00:00Z','1']]);
  const two=csv([header,[...base,b,'250000',packet,'2026-10-01T09:00:00Z','1']]);
  const data=datasetFromCsv([{name:'node-1.csv',text:one},{name:'node-2.csv',text:two},{name:'node-1-again.csv',text:one}]);
  strictEqual(data.transactions.length,1);strictEqual(data.transactions[0].amountSun,750000);strictEqual(data.transactions[0].allocations.length,2);
  strictEqual(data.periods[0].coverage,'PARTIAL');strictEqual(data.wallets.find(w=>w.address===b).label,'Node 2');
});
test('inconsistent CSV snapshots are rejected rather than silently replacing recorded transfers',()=>{
  const row=['plan-one','1','MIX','CONFIRMED',a,b,'500000',a,'500000',`${a}: 0.500000 TRX`,'2026-10-01T09:00:00Z','1'];
  const other=[...row];other[6]='500001';
  throws(()=>datasetFromCsv([{text:csv([header,row])},{text:csv([header,other])}]),/Conflicting/);
});
test('complete demo replays every frame, conserves 17 stakes, and returns each original stake at the end of both plans',async()=>{
  const data=normaliseDataset(JSON.parse(await readFile(new URL('../public/dataset.json',import.meta.url),'utf8'))),frames=buildFrames(data,{legacy:true}),replay=createReplay(frames);
  for(let i=0;i<frames.length;i++){
    const result=replay(i);strictEqual(result.issue,null,frames[i].label);strictEqual([...result.after.values()].reduce((a,b)=>a+b,0),17*SUN);
    for(const a of frames[i].period.initial)strictEqual(ownerPositions(result.after,a.ownerAddress).reduce((n,p)=>n+p.amountSun,0),SUN);
  }
  for(const p of data.periods){const end=frames.findLastIndex(f=>f.period.id===p.id);for(const a of p.initial){const pos=ownerPositions(replay(end).after,a.ownerAddress);strictEqual(pos.length,1);strictEqual(pos[0].holderAddress,a.ownerAddress);}}
  ok(data.transactions.some(t=>t.allocations.length>=3));
});
