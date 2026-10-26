import {test} from 'node:test';
import {strictEqual,deepStrictEqual,ok,throws} from 'node:assert';
import {continuousDataset,recordedDataset,restorationPreview} from '../public/provenance.js';
import {normaliseDataset,buildFrames,createReplay,ownerPositions,composition,datasetFromCsv,SUN} from '../public/model.js';
import {journeyCsv} from '../public/exports.js';
import {validateSnapshot} from '../worker/index.js';
const [a,b,c]=['Wallet-AAA','Wallet-BBB','Wallet-CCC'];
const allocation=(ownerAddress,amountSun)=>({ownerAddress,amountSun});
const baseline=[a,b,c].map(ownerAddress=>({holderAddress:ownerAddress,ownerAddress,amountSun:SUN}));
const tx=(sequence,periodId,from,to,amountSun,allocations,extra={})=>({id:'movement-'+sequence,sequence,periodId,from,to,amountSun,allocations,kind:'MIX',status:'CONFIRMED',
  scheduledAt:`2026-10-01T00:${String(sequence).padStart(2,'0')}:00Z`,confirmedAt:`2026-10-01T00:${String(sequence).padStart(2,'0')}:00Z`,txId:'tx-'+sequence,bandwidthUsed:267,...extra});
function fixture(){return {format:'trx-flow-atlas',version:1,network:'mock',createdAt:'2026-10-02T00:00:00Z',wallets:[a,b,c].map((address,ordinal)=>({address,ordinal,label:'Node '+(ordinal+1)})),
  periods:[{id:'legacy',label:'Legacy',type:'LEGACY',initial:baseline},{id:'plan-one',label:'Plan 1',type:'SMART',status:'RESTORED',initial:baseline}],transactions:[
    tx(1,'legacy',a,b,1000000,[allocation(a,SUN)],{attribution:'FIFO'}),
    tx(2,'legacy',b,c,1000000,[allocation(b,SUN)],{attribution:'FIFO'}),
    tx(3,'legacy',c,a,1000000,[allocation(c,SUN)],{kind:'REBALANCE',attribution:'FIFO'}),
    tx(4,'plan-one',a,b,123457,[allocation(a,123457)]),
    tx(5,'plan-one',b,a,123457,[allocation(a,123457)],{kind:'RETURN'})]};}
const atOwner=(state,owner)=>ownerPositions(state,owner).sort((a,b)=>a.holderAddress.localeCompare(b.holderAddress));
test('equal native balances do not reset original owners at a plan boundary',()=>{
  const d=continuousDataset(fixture()),frames=buildFrames(d,{granularity:'transaction'}),replay=createReplay(frames),boundary=frames.findIndex(f=>f.period.id==='plan-one');
  strictEqual(d.accounting.complete,true);deepStrictEqual([...replay(boundary-1).after].filter(([,n])=>n).sort(),[...replay(boundary).after].filter(([,n])=>n).sort());
  deepStrictEqual(atOwner(replay(boundary).after,a),[{holderAddress:b,amountSun:SUN}]);
  strictEqual(d.transactions.find(t=>t.sequence===4).allocations[0].ownerAddress,c);
  strictEqual(d.transactions.find(t=>t.sequence===4).recordedAllocations[0].ownerAddress,a);
});
test('original decimal lots and combined plan packets retain every Sun without negative balances',()=>{
  const raw=fixture();raw.transactions.splice(3,2,
    tx(4,'plan-one',a,b,123457,[allocation(a,123457)]),
    tx(5,'plan-one',b,c,623458,[allocation(a,123457),allocation(b,500001)]));
  const d=continuousDataset(raw),frames=buildFrames(d,{granularity:'transaction'}),replay=createReplay(frames);
  for(let i=0;i<frames.length;i++){const r=replay(i);strictEqual(r.issue,null);strictEqual([...r.after.values()].reduce((n,s)=>n+s,0),3*SUN);
    for(const owner of [a,b,c])strictEqual(atOwner(r.after,owner).reduce((n,p)=>n+p.amountSun,0),SUN);ok([...r.after.values()].every(n=>n>=0));}
  const last=d.transactions.at(-1);strictEqual(last.amountSun,623458);deepStrictEqual(last.allocations,[allocation(c,123457),allocation(a,500001)]);
});
test('multiple plans, a hidden legacy section and scope filtering retain the same original ownership',()=>{
  const raw=fixture();raw.periods.push({...raw.periods[1],id:'plan-two'});raw.transactions.push(tx(6,'plan-two',b,a,250001,[allocation(b,250001)]));
  const d=continuousDataset(raw),frames=buildFrames(d,{scope:'plan-two',legacy:false});
  deepStrictEqual(atOwner(createReplay(frames)(0).after,a),[{holderAddress:b,amountSun:SUN}]);
  strictEqual(frames[0].period.continuity,'CARRIED');strictEqual(d.transactions.at(-1).allocations[0].ownerAddress,a);
});
test('native transaction facts and the source object remain unchanged; correction and normalisation are idempotent',()=>{
  const raw=fixture(),original=JSON.stringify(raw),d=continuousDataset(raw);
  strictEqual(JSON.stringify(raw),original);deepStrictEqual(continuousDataset(d),d);deepStrictEqual(normaliseDataset(d),d);deepStrictEqual(recordedDataset(d),normaliseDataset(raw));
  for(let i=0;i<raw.transactions.length;i++)for(const k of ['from','to','sequence','amountSun','status','txId','bandwidthUsed'])strictEqual(raw.transactions[i][k],d.transactions[i][k]);
  deepStrictEqual(validateSnapshot(d),d);
});
test('incomplete history and mismatched starting balances stop continuity instead of minting a new 1 TRX baseline',()=>{
  for(const mutate of [r=>{r.periods[0].coverage='PARTIAL';},r=>{r.transactions.splice(1,2);},r=>{r.transactions[0].allocations=[];r.transactions[0].attribution='UNKNOWN';r.periods[0].coverage='PARTIAL';}]){
    const raw=fixture();mutate(raw);const d=continuousDataset(raw);strictEqual(d.accounting.complete,false);ok(d.periods[1].provenanceIssue);strictEqual(d.transactions.at(-1).attribution,'UNKNOWN');strictEqual(restorationPreview(d).ready,false);
  }
});
test('a faulty saved packet cannot partially consume a source lot or change later provenance',()=>{
  const raw=fixture();raw.transactions[3].allocations=[allocation(a,100000),allocation(c,23457)];
  const d=continuousDataset(raw);strictEqual(d.accounting.complete,false);strictEqual(d.transactions[3].attribution,'UNKNOWN');
  const f=buildFrames(d,{granularity:'transaction'}),r=createReplay(f)(f.length-1);ok(r.issue);deepStrictEqual(atOwner(r.after,c),[{holderAddress:a,amountSun:SUN}]);
});
test('restoration previews use explicitly selected owner packets, restore every stake and never pay the teacher',()=>{
  const d=continuousDataset(fixture()),r=restorationPreview(d);strictEqual(r.ready,true);strictEqual(r.status,'PREVIEW_ONLY');strictEqual(r.transactionCount,3);strictEqual(r.totalStakeSun,3*SUN);
  for(const t of r.routes){strictEqual(t.to,t.allocations[0].ownerAddress);strictEqual(t.amountSun,t.allocations[0].amountSun);ok(t.from!==t.to);}
  strictEqual(r.basedOn.lastSequence,5);strictEqual(d.transactions.length,5);
});
test('pending sends and incomplete personal-only data block restoration, never turn forecasts into confirmed positions',()=>{
  const raw=fixture();raw.transactions[4].status='APPROVED';const d=continuousDataset(raw),r=restorationPreview(d);strictEqual(r.ready,false);strictEqual(r.basedOn.confirmedTransfers,4);
  const personal=datasetFromCsv([{text:journeyCsv(continuousDataset(fixture()),{owner:a})}]);strictEqual(restorationPreview(personal).ready,false);
});
test('everyone and personal CSV preserve carried baselines, continuous attribution and exact decimal shares on reimport',()=>{
  const d=continuousDataset(fixture());
  for(const owner of [null,a,b,c]){
    const imported=datasetFromCsv([{text:journeyCsv(d,{owner})}]);strictEqual(imported.accounting.mode,'CONTINUOUS');
    const frames=buildFrames(imported,{granularity:'transaction'}),replay=createReplay(frames);
    for(let i=0;i<frames.length;i++){const state=replay(i);strictEqual(state.issue,null);for(const o of owner?[owner]:[a,b,c])strictEqual(atOwner(state.after,o).reduce((n,p)=>n+p.amountSun,0),SUN);}
    deepStrictEqual(continuousDataset(imported),imported);throws(()=>recordedDataset(imported),/original JSON/);
  }
});
test('a confirmed next plan cannot jump across an unfinished previous plan',()=>{
  const raw=fixture();raw.transactions[2].status='APPROVED';const d=continuousDataset(raw);strictEqual(d.accounting.complete,false);ok(d.accounting.issues.some(x=>x.includes('unfinished')));
});
test('forecast timestamps cannot reorder the saved ownership algorithm in calendar view',()=>{
  const raw=fixture();raw.transactions[3].status='APPROVED';raw.transactions[4].status='APPROVED';
  raw.transactions[3].scheduledAt='2026-10-03T09:00:00Z';raw.transactions[4].scheduledAt='2026-10-02T09:00:00Z';
  const d=continuousDataset(raw),frames=buildFrames(d),replay=createReplay(frames);
  deepStrictEqual(frames.flatMap(f=>f.events.map(t=>t.sequence)),[1,2,3,4,5]);strictEqual(frames.at(-1).label,'2026-10-03');
  strictEqual(replay(frames.length-1).issue,null);strictEqual(d.transactions.at(-1).scheduledAt,'2026-10-02T09:00:00.000Z');
});
test('omitted recorded history and overlapping periods block continuity even if each period is internally valid',()=>{
  let raw=fixture();raw.sourceCoverage={includesLegacy:false,recordedConfirmed:10,exportedConfirmed:5,legacyConfirmed:8,exportedLegacy:3};
  let d=continuousDataset(raw);strictEqual(d.accounting.complete,false);ok(d.accounting.issues[0].includes('omits'));
  raw=fixture();raw.transactions[2].sequence=6;d=continuousDataset(raw);strictEqual(d.accounting.complete,false);ok(d.accounting.issues.some(x=>x.includes('overlap')));
});
test('a frozen original-stake restoration selects the original owner directly, without relabelling lots a second time',()=>{
  const raw=fixture(),prior=continuousDataset(raw),positions=restorationPreview(prior).positions;
  raw.periods.push({id:'original-restore',label:'Original restoration',type:'SMART',ownershipMode:'ORIGINAL_STAKES',status:'RESTORED',initial:positions});
  const routes=restorationPreview(prior).routes;
  raw.transactions.push(...routes.map((r,i)=>tx(6+i,'original-restore',r.from,r.to,r.amountSun,r.allocations,{kind:'RETURN'})));
  const d=continuousDataset(raw);strictEqual(d.accounting.complete,true);strictEqual(d.periods.at(-1).ownershipMode,'ORIGINAL_STAKES');
  const frames=buildFrames(d,{granularity:'transaction'}),end=createReplay(frames)(frames.length-1);strictEqual(end.issue,null);
  for(const owner of [a,b,c])deepStrictEqual(atOwner(end.after,owner),[{holderAddress:owner,amountSun:SUN}]);
  strictEqual(restorationPreview(d).transactionCount,0);deepStrictEqual(continuousDataset(recordedDataset(d)),d);
});
test('an original-restoration boundary with a false ownership composition is rejected despite equal native balances',()=>{
  const raw=fixture();raw.periods.push({id:'false-restore',label:'False restoration',type:'SMART',ownershipMode:'ORIGINAL_STAKES',initial:baseline});
  raw.transactions.push(tx(6,'false-restore',a,b,1,[allocation(a,1)]));
  const d=continuousDataset(raw);strictEqual(d.accounting.complete,false);ok(d.accounting.issues.some(x=>x.includes('restoration baseline')));
});
