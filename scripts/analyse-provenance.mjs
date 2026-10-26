import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {continuousDataset,restorationPreview} from '../public/provenance.js';
import {normaliseDataset,buildFrames,createReplay,SUN} from '../public/model.js';
import {journeyCsv} from '../public/exports.js';

const [input,destination]=process.argv.slice(2);
if(!input||!destination){console.error('Usage: node scripts/analyse-provenance.mjs PUBLIC_EXPORT.json OUTPUT_DIRECTORY');process.exit(1);}
const bytes=await readFile(resolve(input)),source=normaliseDataset(JSON.parse(bytes.toString('utf8'))),data=continuousDataset(source);
const preview=restorationPreview(data),frames=buildFrames(data,{granularity:'transaction'}),replay=createReplay(frames);
for(let i=0;i<frames.length;i++){
  const state=replay(i);if(state.issue)throw Error(state.issue);
  const owners=new Map();for(const [key,amount] of state.after){const owner=key.split('\0')[1];owners.set(owner,(owners.get(owner)??0)+amount);}
  if([...owners.values()].some(n=>n!==SUN))throw Error('An original stake is not conserved at frame '+i);
}
const target=resolve(destination);await mkdir(target,{recursive:true});await mkdir(join(target,'personal-csv'),{recursive:true});
const write=(name,value)=>writeFile(join(target,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
await write('trx-all-flows-continuous.json',data);
await write('restoration-preview.json',{...preview,sourceSha256:createHash('sha256').update(bytes).digest('hex')});
await write('everyone-continuous.csv',journeyCsv(data,{confirmedOnly:true}));
for(const w of data.wallets.filter(w=>w.role!=='teacher'))await write('personal-csv/node-'+(w.ordinal+1)+'.csv',journeyCsv(data,{owner:w.address,confirmedOnly:true}));
if(preview.ready){
  const forecast=structuredClone(data),id='ownership-restoration-preview',base=Math.max(...data.transactions.map(t=>t.sequence),0);
  forecast.periods.push({id,label:'Ownership return · PREVIEW ONLY',type:'SMART',ownershipMode:'ORIGINAL_STAKES',status:'DRAFT',coverage:'COMPLETE',startedAt:data.createdAt,deadlineAt:null,
    initial:preview.positions,recordedInitial:preview.positions,continuity:'CARRIED',warnings:['Unexecuted ownership-return proposal. Dates are illustrative, not an execution schedule. This file cannot send transactions.']});
  forecast.transactions.push(...preview.routes.map((r,i)=>({id:'ownership-preview-'+(i+1),periodId:id,sequence:base+i+1,campaignDay:null,kind:'REBALANCE',status:'DRAFT',
    from:r.from,to:r.to,amountSun:r.amountSun,allocations:r.allocations,recordedAllocations:r.allocations,recordedAttribution:'RECORDED',attribution:'RECORDED',
    scheduledAt:new Date(Date.parse(data.createdAt)+(i+1)*60_000).toISOString(),confirmedAt:null,recordedAt:null,plannedAt:null,txId:null,bandwidthUsed:null})));
  await write('restoration-forecast.json',normaliseDataset(forecast));
}
const label=a=>data.wallets.find(w=>w.address===a)?.label??a,amount=n=>(n/SUN).toFixed(6),lines=[
  '# Original-stake audit','',`Snapshot: ${data.createdAt}. Network: ${data.network}.`,
  `${data.transactions.length} native transfers; ${data.transactions.filter(t=>t.status==='CONFIRMED').length} confirmed. ${frames.length} replay frames checked.`,
  '',`Continuous attribution complete: ${data.accounting.complete}. Original stake total: ${amount(preview.totalStakeSun)} TRX.`,
  '','The source used separate accounting periods. Legacy transfers consume FIFO lots. At each plan boundary, the exact preceding ownership is mapped into the new plan’s recorded packet labels. The recorded plan routing is preserved; original lots within each recorded share are consumed FIFO. All amounts are integer Sun. This is an accounting convention, not proof that particular Sun have on-chain owner identities.',
  '','Native addresses, transaction hashes, sequence numbers, amounts, statuses, confirmation times and recorded Bandwidth are unchanged. No chain query, wallet key, transaction signing or broadcast was performed. Transfers absent from the supplied export cannot be inferred.',
  '','## Confirmed positions','', '| Original owner | Held at | Exact Sun | TRX |','| --- | --- | ---: | ---: |',
  ...preview.positions.map(p=>`| ${label(p.ownerAddress)} | ${label(p.holderAddress)} | ${p.amountSun} | ${amount(p.amountSun)} |`),
  '','## Proposed owner-specific return','',`${preview.transactionCount} direct routes move ${amount(preview.foreignSun)} TRX. This minimizes the number of holder-to-original-owner hops per Sun; it is not a claim of globally minimum transaction count.`,
  '',...preview.blocked.map(x=>'BLOCKED: '+x),
  '',preview.instructions,
  '','Every native wallet may already hold 1 TRX while its attributed ownership is different. Ordinary Rebalance can therefore do nothing. Do not send this list as unannotated FIFO transfers: these packets deliberately select the named original owner’s share. The release-36 mixer Restore original stakes action recalculates from its own current confirmed DB journal, freezes those owner-specific allocations and uses its existing approval/receipt engine. This file is a preview of the supplied snapshot; never upload it as executable commands. External manual sends while the mixer tracks expected balances can cause reconciliation failures.',
  '','| Step | Sender | Recipient / owner | Exact Sun | TRX |','| ---: | --- | --- | ---: | ---: |',
  ...preview.routes.map(r=>`| ${r.step} | ${label(r.from)} · ${r.from} | ${label(r.to)} · ${r.to} | ${r.amountSun} | ${amount(r.amountSun)} |`),
  '','## Files','',
  '- `trx-all-flows-continuous.json`: corrected confirmed history, suitable for Flow Admin upload.',
  '- `restoration-preview.json`: exact routes, full addresses, explicit packet allocations and source anchor. Read-only proposal.',
  '- `restoration-forecast.json`: optional Flow preview with additional DRAFT routes. None of those additional routes has executed. Dates are illustrative.',
  '- `everyone-continuous.csv` and `personal-csv/node-N.csv`: original-stake journeys including decimal legacy transfers. They preserve current ownership across boundaries.',
  '','This analysis script does not modify the mixer or its database. No teacher payout is included. Use the protected mixer recovery queue to execute real returns, then download a fresh confirmed JSON/CSV. The included preview and DRAFT forecast do not claim that recovery has already executed.',''];
await write('READ-ME-FIRST.md',lines.join('\n'));
console.log(JSON.stringify({complete:data.accounting.complete,transfers:data.transactions.length,framesChecked:frames.length,restorationReady:preview.ready,routes:preview.transactionCount,foreignSun:preview.foreignSun,output:target}));
