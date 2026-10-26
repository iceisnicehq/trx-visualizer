import {SUN,normaliseDataset,initialState,applyMovement,timeOf} from './model.js';

export const CONTINUITY_NOTE='Continuous attribution: legacy lots use FIFO; saved plan packets carry those original lots forward using FIFO within each recorded plan share. Boundaries never reset original ownership. This is a declared accounting convention, not identifiable coins on TRON.';
const copy=lots=>lots.map(a=>({...a}));
const sum=lots=>lots.reduce((n,a)=>n+a.amountSun,0);
function append(target,lots){
  for(const a of lots){const last=target.at(-1);
    if(last?.ownerAddress===a.ownerAddress&&last.nominalOwner===a.nominalOwner)last.amountSun+=a.amountSun;
    else target.push({...a});
  }
}
function shares(lots){
  const totals=new Map();for(const a of lots)totals.set(a.ownerAddress,(totals.get(a.ownerAddress)??0)+a.amountSun);
  return [...totals].filter(([,n])=>n>0).map(([ownerAddress,amountSun])=>({ownerAddress,amountSun}));
}
const positions=stock=>[...stock].flatMap(([holderAddress,lots])=>shares(lots).map(a=>({holderAddress,...a})));
function take(source,amount,nominalOwner){
  let left=amount;const taken=[];
  for(const a of source){
    if(!left)break;if(nominalOwner!==undefined&&a.nominalOwner!==nominalOwner)continue;
    const n=Math.min(left,a.amountSun);if(n){append(taken,[{...a,amountSun:n}]);a.amountSun-=n;left-=n;}
  }
  if(left)throw Error('The supplied history cannot fund the recorded packet.');
  return taken;
}

/** Restore the original app ledger for comparison, without changing native facts. */
export function recordedDataset(raw){
  const data=normaliseDataset(raw);if(data.accounting?.mode!=='CONTINUOUS')return data;
  if(data.periods.some(p=>!p.recordedInitial)||data.transactions.some(t=>!t.recordedAllocations))
    throw Error('This continuous CSV contains only the corrected ownership view. Use the original JSON to compare the recorded plan ledger.');
  delete data.accounting;data.warnings=data.warnings.filter(w=>w!==CONTINUITY_NOTE);
  for(const p of data.periods){p.initial=p.recordedInitial;p.coverage=p.recordedCoverage??p.coverage;delete p.recordedInitial;delete p.recordedCoverage;delete p.continuity;delete p.provenanceIssue;}
  for(const t of data.transactions){t.allocations=t.recordedAllocations;t.attribution=t.recordedAttribution;delete t.recordedAllocations;delete t.recordedAttribution;}
  return data;
}

/** Bridge actual original-owner lots into the plan's nominal packet labels.
 * Never substitute a wallet's address for the owners it is really holding.
 * Saved SMART allocation routing remains intact. All arithmetic is integer Sun.
 * Incomplete history blocks later attribution instead of minting a new baseline. */
export function continuousDataset(raw){
  const data=normaliseDataset(raw);if(data.accounting?.mode==='CONTINUOUS')return data;
  const output=structuredClone(data),issues=[];let stock=null,issue=null,previousHadOpen=false,previousSequence=0;
  if(data.sourceCoverage&&(data.sourceCoverage.recordedConfirmed!==data.sourceCoverage.exportedConfirmed||data.sourceCoverage.legacyConfirmed!==data.sourceCoverage.exportedLegacy))
    issue='The export omits recorded confirmed history. Re-export all plans with earlier history included before tracing original stakes.';
  const firstSequence=p=>Math.min(...data.transactions.filter(t=>t.periodId===p.id).map(t=>t.sequence),Infinity);
  const periods=[...data.periods].sort((a,b)=>firstSequence(a)-firstSequence(b));
  output.periods=[];output.transactions=[];
  for(const [i,p] of periods.entries()){
    const period={...structuredClone(p),recordedInitial:structuredClone(p.initial),recordedCoverage:p.coverage,continuity:i?'CARRIED':'ORIGIN'};
    const events=data.transactions.filter(t=>t.periodId===p.id).sort((a,b)=>a.sequence-b.sequence);
    if(events.length&&events[0].sequence<=previousSequence&&!issue)issue='Accounting periods overlap in execution sequence. A complete chronological journal is required before joining ownership.';
    previousSequence=Math.max(previousSequence,...events.map(t=>t.sequence));
    if(!stock){stock=new Map();for(const a of p.initial){if(!stock.has(a.holderAddress))stock.set(a.holderAddress,[]);append(stock.get(a.holderAddress),[{...a,nominalOwner:a.ownerAddress}]);}}
    else if(!issue){
      if(previousHadOpen&&p.status!=='DRAFT')issue='An earlier period has unfinished transfers. A confirmed new period cannot be bridged across that gap.';
      const declared=new Map();for(const a of p.initial){if(!declared.has(a.holderAddress))declared.set(a.holderAddress,[]);declared.get(a.holderAddress).push(a);}
      if(!issue)for(const [holder,initial] of declared)if(sum(initial)!==sum(stock.get(holder)??[])){
        issue=`Balance mismatch at ${p.label}: its recorded starting balance at ${holder} differs from the preceding history. Original ownership is not reset.`;break;
      }
      if(!issue&&p.ownershipMode==='ORIGINAL_STAKES')for(const [holder,initial] of declared){
        const signature=lots=>JSON.stringify(shares(lots).sort((a,b)=>a.ownerAddress.localeCompare(b.ownerAddress)));
        if(signature(initial)!==signature(stock.get(holder)??[])){issue=`Original-stake restoration baseline differs from the preceding original-owner ledger at ${holder}.`;break;}
      }
      if(!issue){
        const next=new Map([...stock].map(([holder,lots])=>[holder,copy(lots)]));
        for(const [holder,initial] of declared){const remaining=copy(stock.get(holder)??[]),mapped=[];
          if(p.ownershipMode==='ORIGINAL_STAKES'){next.set(holder,remaining.map(lot=>({...lot,nominalOwner:lot.ownerAddress})));continue;}
          for(const a of initial)append(mapped,take(remaining,a.amountSun).map(lot=>({...lot,nominalOwner:a.ownerAddress})));
          next.set(holder,mapped);
        }
        stock=next;
      }
    }
    period.initial=positions(stock);
    if(p.coverage==='PARTIAL'&&!issue)issue=`${p.label} has partial source coverage. Continuous ownership cannot be certified beyond this period.`;
    if(issue){period.continuity='UNAVAILABLE';period.provenanceIssue=issue;period.coverage='PARTIAL';if(!issues.includes(issue))issues.push(issue);}
    for(const t of events){
      const movement={...structuredClone(t),recordedAllocations:structuredClone(t.allocations),recordedAttribution:t.attribution};
      if(!issue)try{
        if(t.attribution==='UNKNOWN'||!t.allocations.length)throw Error('Original ownership is unavailable in the source export.');
        const source=copy(stock.get(t.from)??[]),target=copy(stock.get(t.to)??[]);
        if(sum(source)<t.amountSun)throw Error('The source wallet has insufficient tracked funds.');
        const moved=[];
        if(p.type==='LEGACY')append(moved,take(source,t.amountSun));
        else{
          if(sum(t.allocations)!==t.amountSun)throw Error('The saved plan packet does not cover the entire native amount.');
          for(const a of t.allocations)append(moved,take(source,a.amountSun,a.ownerAddress));
        }
        movement.allocations=shares(moved);movement.attribution=p.type==='LEGACY'?'FIFO':p.ownershipMode==='ORIGINAL_STAKES'?'RECORDED':'BRIDGED_FIFO';
        append(target,moved);stock.set(t.from,source.filter(a=>a.amountSun));stock.set(t.to,target);
      }catch(error){issue=`Continuous attribution stopped at #${t.sequence}: ${error.message}`;issues.push(issue);period.coverage='PARTIAL';}
      if(issue){movement.allocations=[];movement.attribution='UNKNOWN';}
      output.transactions.push(movement);
    }
    previousHadOpen=events.some(t=>t.status!=='CONFIRMED');
    output.periods.push(period);
  }
  output.warnings=[...output.warnings,CONTINUITY_NOTE];
  output.accounting={mode:'CONTINUOUS',method:'PACKET_FIFO_V1',complete:issues.length===0,issues};
  return normaliseDataset(output);
}

/** Read-only proposal. Routes require explicitly recorded ownership allocations;
 * ordinary native balance rebalancing or unannotated FIFO sends are different.
 * No RPC, transaction construction, signing or broadcast is present here. */
export function restorationPreview(raw){
  const data=continuousDataset(raw),blocked=[];let state=null,last=null;
  const key=(h,o)=>h+'\0'+o,sorted=rows=>rows.map(a=>[key(a.holderAddress,a.ownerAddress),a.amountSun]).sort(([a],[b])=>a.localeCompare(b));
  if(!data.accounting?.complete)blocked.push('Continuous attribution is incomplete; resolve the reported history gaps first.');
  if(data.transactions.some(t=>t.status!=='CONFIRMED'))blocked.push('Unfinished or forecast transfers exist. Pause execution and obtain a fresh fully confirmed export before using a restoration proposal.');
  for(const p of data.periods){
    if(p.status==='DRAFT')continue;
    if(!state)state=initialState(p);
    else if(JSON.stringify([...state].filter(([,n])=>n).sort(([a],[b])=>a.localeCompare(b)))!==JSON.stringify(sorted(p.initial)))
      blocked.push(`The confirmed history does not join continuously at ${p.label}.`);
    const tracked=new Set(p.initial.map(a=>a.ownerAddress));
    for(const t of data.transactions.filter(t=>t.periodId===p.id&&t.status==='CONFIRMED').sort((a,b)=>a.sequence-b.sequence)){
      const issue=applyMovement(state,t,tracked);if(issue){blocked.push(issue);break;}last=t;
    }
  }
  const current=[...(state??new Map())].filter(([,n])=>n>0).map(([k,amountSun])=>{const [holderAddress,ownerAddress]=k.split('\0');return {holderAddress,ownerAddress,amountSun};});
  if(data.wallets.some(w=>w.role==='participant'&&!current.some(p=>p.ownerAddress===w.address)))blocked.push('Supply all participant stakes before preparing a whole-pool restoration proposal. Personal CSV reports are insufficient.');
  if(current.some(p=>data.wallets.find(w=>w.address===p.holderAddress)?.role==='teacher'))blocked.push('A tracked stake is already held by the teacher. This preview cannot arrange a return from that account.');
  const wallets=data.wallets.filter(w=>w.role!=='teacher').map(w=>({...w,balanceSun:current.filter(p=>p.holderAddress===w.address).reduce((n,p)=>n+p.amountSun,0),
    ownAtHomeSun:current.find(p=>p.holderAddress===w.address&&p.ownerAddress===w.address)?.amountSun??0,positions:current.filter(p=>p.ownerAddress===w.address)}));
  const routes=current.filter(p=>p.holderAddress!==p.ownerAddress).map((p,index)=>({step:index+1,from:p.holderAddress,to:p.ownerAddress,amountSun:p.amountSun,
    allocations:[{ownerAddress:p.ownerAddress,amountSun:p.amountSun}]}));
  const end=new Map(state),tracked=new Set(current.map(p=>p.ownerAddress));
  for(const route of routes){const issue=applyMovement(end,{...route,sequence:route.step,attribution:'RECORDED'},tracked);if(issue)blocked.push(issue);}
  for(const owner of tracked)if(end.get(key(owner,owner))!==SUN)blocked.push('The proposal does not restore an exact one-TRX stake for every owner.');
  return {format:'trx-ownership-restoration-preview',version:1,status:'PREVIEW_ONLY',method:'PACKET_FIFO_V1',network:data.network,createdAt:data.createdAt,
    basedOn:{confirmedTransfers:data.transactions.filter(t=>t.status==='CONFIRMED').length,lastTransferId:last?.id??null,lastSequence:last?.sequence??null,lastTxId:last?.txId??null,confirmedAt:last?timeOf(last):null},
    ready:blocked.length===0,blocked:[...new Set(blocked)],totalStakeSun:current.reduce((n,p)=>n+p.amountSun,0),foreignSun:routes.reduce((n,p)=>n+p.amountSun,0),
    transactionCount:routes.length,positions:current,wallets,routes,
    instructions:'Preview only. These direct routes assume explicitly recorded owner-specific packet allocations. They are not ordinary balance rebalancing and not instructions for unannotated FIFO transfers. Reconcile a fresh confirmed chain export, reserve personal extra Sun, and perform the existing live zero-fee preflight before each separately approved transfer. Nothing here broadcasts transactions or pays the teacher.'};
}
