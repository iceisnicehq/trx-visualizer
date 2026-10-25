export const SUN=1_000_000;
export const COLOURS=['#73e8c0','#b5a0ff','#ffbf78','#78b9ff','#ff8fab','#d3e879','#7bd9ef','#e9a1ef','#f3d6a0','#8fc8b0','#a4b8ff','#f29d7e','#b3d591','#89d6d2','#d7b2de','#b6c5d5','#e8ce73'];
const statuses=new Set(['CONFIRMED','APPROVED','PLANNED','PAUSED','DRAFT','SUBMITTED','SUBMITTING','UNKNOWN']);
const kinds=new Set(['MIX','RETURN','REBALANCE','PAYOUT','TRANSFER']);
const fail=message=>{throw Error(message);};
const integer=(v,name,min=0)=>Number.isSafeInteger(v)&&v>=min?v:fail(`${name} must be a whole number of Sun.`);
const address=v=>typeof v==='string'&&/^[A-Za-z0-9:_-]{3,120}$/.test(v)?v:fail('An address is missing or invalid.');
const string=(v,fallback,max=200)=>typeof v==='string'?v.slice(0,max):fallback;
const date=(v,optional=true)=>v==null||v===''?(optional?null:fail('A transaction date is missing.')):
  typeof v==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():fail('Dates must include UTC or an explicit timezone.');
export const formatSun=(sun,digits=3)=>new Intl.NumberFormat('en-GB',{maximumFractionDigits:digits}).format(sun/SUN);
export const shortAddress=address=>address.length>18?address.slice(0,6)+'…'+address.slice(-4):address;
export const moscowDay=at=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
export const timeOf=t=>t.status==='CONFIRMED'?(t.confirmedAt??t.recordedAt??t.scheduledAt):t.scheduledAt;
const shareKey=(holder,owner)=>holder+'\0'+owner;

/** Allow-listed public data only. Reject wallet-config files before displaying
 * anything; all amounts stay integer Sun. No RPC or wallet signing occurs. */
export function normaliseDataset(raw){
  if(!raw||raw.format!=='trx-flow-atlas'||raw.version!==1)fail('Choose a Flow Atlas JSON export or one or more report CSV files.');
  if(!Array.isArray(raw.wallets)||raw.wallets.length<1||raw.wallets.length>100)fail('Expected 1–100 public wallet records.');
  if(!Array.isArray(raw.periods)||raw.periods.length>200)fail('Too many accounting periods.');
  if(!Array.isArray(raw.transactions)||raw.transactions.length>50_000)fail('The export must contain at most 50,000 transactions.');
  if(raw.wallets.some(w=>w.privateKey||w.private_key||w.seed||w.mnemonic))fail('This is a wallet configuration. Import public reports only; private keys are never needed.');
  const wallets=raw.wallets.map((w,i)=>({address:address(w.address),label:string(w.label,`Node ${i+1}`,60),
    ordinal:integer(w.ordinal??i,'Wallet number'),role:w.role==='teacher'?'teacher':'participant'}));
  const known=new Set(wallets.map(w=>w.address));if(known.size!==wallets.length)fail('Duplicate wallet addresses.');
  const check=a=>known.has(address(a))?a:fail('A transaction references an address absent from the export.');
  const warnings=Array.isArray(raw.warnings)?raw.warnings.map(w=>string(w,'',500)).slice(0,100):[];
  const periods=raw.periods.map(p=>{
    const id=address(p.id),seen=new Set();
    if(!Array.isArray(p.initial)||p.initial.length>10_000)fail('An accounting period needs an explicit starting allocation.');
    const initial=p.initial.map(v=>{
      const holderAddress=check(v.holderAddress),ownerAddress=check(v.ownerAddress),key=shareKey(holderAddress,ownerAddress);
      if(seen.has(key))fail('Duplicate starting ownership position.');seen.add(key);
      return {holderAddress,ownerAddress,amountSun:integer(v.amountSun,'Starting allocation',1)};
    });
    const totals=new Map();for(const v of initial)totals.set(v.ownerAddress,(totals.get(v.ownerAddress)??0)+v.amountSun);
    if([...totals.values()].some(v=>v!==SUN))fail('Each tracked stake must start with exactly 1 TRX per accounting period.');
    return {id,label:string(p.label,'Plan',100),type:p.type==='LEGACY'?'LEGACY':'SMART',status:string(p.status,'EXPORTED',40),
      startedAt:date(p.startedAt),deadlineAt:date(p.deadlineAt),coverage:p.coverage==='PARTIAL'?'PARTIAL':'COMPLETE',
      initial,warnings:Array.isArray(p.warnings)?p.warnings.map(v=>string(v,'',500)).slice(0,30):[]};
  });
  const periodIds=new Set(periods.map(p=>p.id));if(periodIds.size!==periods.length)fail('Duplicate accounting periods.');
  const seenIds=new Set(),seenSequence=new Set();
  const transactions=raw.transactions.filter(t=>t.status!=='CANCELLED').map(t=>{
    const id=address(t.id),periodId=address(t.periodId);if(!periodIds.has(periodId))fail('Unknown accounting period.');
    const sequence=integer(t.sequence,'Sequence',1),seqKey=periodId+':'+sequence;
    if(seenIds.has(id)||seenSequence.has(seqKey))fail('Duplicate transactions must be merged before replay.');seenIds.add(id);seenSequence.add(seqKey);
    if(!statuses.has(t.status)||!kinds.has(t.kind))fail('Unknown transaction status or type.');
    const from=check(t.from),to=check(t.to);if(from===to)fail('A transfer cannot send to the same wallet.');
    const amountSun=integer(t.amountSun,'Transfer amount',1),owners=new Set();
    if(!Array.isArray(t.allocations)||t.allocations.length>100)fail('Invalid packet ownership.');
    const allocations=t.allocations.map(a=>{
      const ownerAddress=check(a.ownerAddress);if(owners.has(ownerAddress))fail('Duplicate owner in a packet.');owners.add(ownerAddress);
      return {ownerAddress,amountSun:integer(a.amountSun,'Owner share',1)};
    });
    const allocated=allocations.reduce((n,a)=>n+a.amountSun,0),period=periods.find(p=>p.id===periodId);
    if(allocated>amountSun||allocated!==amountSun&&period.coverage!=='PARTIAL'&&t.attribution!=='UNKNOWN')fail(`Shares do not add up to native transfer #${sequence}.`);
    const scheduledAt=date(t.scheduledAt,false),confirmedAt=date(t.confirmedAt),recordedAt=date(t.recordedAt),plannedAt=date(t.plannedAt);
    return {id,periodId,sequence,kind:t.kind,status:t.status,from,to,amountSun,allocations,scheduledAt,confirmedAt,recordedAt,plannedAt,
      campaignDay:t.campaignDay==null?null:integer(t.campaignDay,'Algorithm round'),
      attribution:t.attribution==='FIFO'?'FIFO':t.attribution==='UNKNOWN'?'UNKNOWN':'RECORDED',
      txId:typeof t.txId==='string'&&/^[A-Za-z0-9_-]{1,150}$/.test(t.txId)?t.txId:null,
      bandwidthUsed:t.bandwidthUsed==null?null:integer(t.bandwidthUsed,'Bandwidth')};
  });
  return {format:'trx-flow-atlas',version:1,title:string(raw.title,'TRX Flow Atlas',100),network:string(raw.network,'TRON',30),
    demo:raw.demo===true,createdAt:date(raw.createdAt)??new Date().toISOString(),wallets,periods,transactions,warnings};
}

/** RFC 4180 quotes, escaped quotes, embedded newlines, CRLF and UTF-8 BOM. */
export function parseCsv(text){
  if(text.length>50_000_000)fail('CSV is too large.');
  const rows=[],row=[];let value='',quoted=false,closed=false;
  text=text.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=c;continue;}
    if(c==='"'){if(value||closed)fail('Malformed CSV quotes.');quoted=true;}
    else if(c===','||c==='\n'||c==='\r'){
      row.push(value);value='';closed=false;
      if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(v=>v!==''))rows.push([...row]);row.length=0;}
    }else{if(closed&&c!==' '&&c!=='\t')fail('Unexpected text after CSV quote.');if(!closed)value+=c;}
    if(rows.length>150_000)fail('Too many CSV rows.');
  }
  if(quoted)fail('CSV has an unclosed quote.');if(value||row.length){row.push(value);rows.push(row);}
  if(!rows.length)fail('CSV is empty.');
  const header=rows.shift().map(h=>h.trim().toLowerCase());
  return rows.map((values,i)=>{if(values.length!==header.length)fail(`CSV row ${i+2} has a different number of columns from its header.`);
    return Object.fromEntries(header.map((h,j)=>[h,values[j]]));});
}
const sunFromCsv=(v,name)=>/^\d+$/.test(v??'')?integer(Number(v),name):fail(`CSV ${name} is missing or not integer Sun.`);
function parsePacket(value){
  if(!value)return [];
  return value.split(';').filter(v=>v.trim()).map(v=>{
    const match=/^\s*([A-Za-z0-9:_-]+):\s*(\d+)(?:\.(\d{1,6}))?\s*TRX\s*$/.exec(v);
    if(!match)fail('Cannot parse packet_ownership; use the JSON export for an exact snapshot.');
    return {ownerAddress:address(match[1]),amountSun:integer(Number(match[2])*SUN+Number((match[3]??'').padEnd(6,'0')),'Packet share',1)};
  });
}
export function datasetFromCsv(files){
  const wallets=new Map(),periods=new Map(),movements=new Map();let network='CSV import';
  const addWallet=(a,ordinal,role)=>{
    if(!a)return;address(a);
    if(!wallets.has(a))wallets.set(a,{address:a,ordinal:ordinal??wallets.size,label:role==='teacher'?'Teacher':`Node ${(ordinal??wallets.size)+1}`,role:role??'participant'});
    else if(ordinal!==undefined){const w=wallets.get(a);w.ordinal=ordinal;w.label=role==='teacher'?'Teacher':`Node ${ordinal+1}`;}
    if(role==='teacher'){wallets.get(a).role='teacher';wallets.get(a).label='Teacher';}
  };
  for(const file of files){
    const rows=parseCsv(file.text);const number=/node[-_ ]?(\d+)/i.exec(file.name??'');
    for(const row of rows){
      if(row.status==='CANCELLED')continue;
      const legacy=row.report_section==='PREHISTORY'||row.period_type==='LEGACY';
      const periodId=row.period_id||(legacy?row.history_period_id||'legacy-import':row.campaign_id||'csv-plan');
      address(periodId);
      let p=periods.get(periodId);
      if(!p){p={id:periodId,label:row.period_label||(legacy?'Legacy history':`Plan ${row.plan_number||periods.size+1}`),type:legacy?'LEGACY':'SMART',
        status:row.period_status||row.plan_status||'IMPORTED',coverage:'PARTIAL',initial:[],warnings:[],owners:new Set(),explicit:false};periods.set(periodId,p);}
      if(row.network)network=row.network;
      if(row.row_type==='BASELINE'){
        const ownerAddress=row.owner_address||row.stake_owner_address,holderAddress=row.holder_address||ownerAddress;
        const ordinal=row.wallet_ordinal===''?undefined:Number(row.wallet_ordinal);
        addWallet(ownerAddress,ordinal);addWallet(holderAddress);
        const amountSun=sunFromCsv(row.initial_amount_sun,'initial_amount_sun'),previous=p.initial.find(v=>v.ownerAddress===ownerAddress&&v.holderAddress===holderAddress);
        if(previous&&previous.amountSun!==amountSun)fail('Conflicting CSV starting allocations.');
        if(!previous)p.initial.push({ownerAddress,holderAddress,amountSun});
        p.explicit=true;p.coverage=row.coverage==='PARTIAL'?'PARTIAL':'COMPLETE';continue;
      }
      if(row.row_type&&row.row_type!=='TRANSFER')continue;
      const owner=row.stake_owner_address;if(owner){addWallet(owner,number?Number(number[1])-1:undefined);p.owners.add(owner);}
      const from=row.from_address,to=row.to_address;addWallet(from);addWallet(to,undefined,row.kind==='PAYOUT'?'teacher':undefined);
      const sequence=sunFromCsv(row.sequence,'sequence'),key=periodId+':'+sequence;
      const amountSun=sunFromCsv(row.native_amount_sun??row.amount_sun,'native_amount_sun');
      let allocations=parsePacket(row.packet_ownership);for(const a of allocations)addWallet(a.ownerAddress);
      if(!allocations.length&&owner&&row.owner_amount_sun)allocations=[{ownerAddress:owner,amountSun:sunFromCsv(row.owner_amount_sun,'owner_amount_sun')}];
      const t={id:row.transfer_id||row.tx_id||`csv-${periods.size}-${sequence}`,periodId,sequence,kind:row.kind,status:row.status,from,to,amountSun,allocations,
        campaignDay:row.campaign_day?Number(row.campaign_day):null,scheduledAt:row.scheduled_utc||row.confirmed_utc||row.recorded_confirmation_utc,
        plannedAt:row.planned_utc||null,confirmedAt:row.confirmed_utc||null,recordedAt:row.recorded_confirmation_utc||null,
        attribution:row.attribution_basis==='RECONSTRUCTED'||row.attribution_method==='FIFO'?'FIFO':row.attribution_basis==='UNKNOWN'?'UNKNOWN':'RECORDED',
        txId:row.tx_id||null,bandwidthUsed:row.bandwidth_whole_transaction?Number(row.bandwidth_whole_transaction):null};
      const previous=movements.get(key);
      if(previous){
        if(['from','to','amountSun','kind','status'].some(k=>previous[k]!==t[k])||previous.txId&&t.txId&&previous.txId!==t.txId)
          fail(`Conflicting versions of #${sequence}. Export the reports together from one snapshot.`);
        const merged=new Map(previous.allocations.map(a=>[a.ownerAddress,a.amountSun]));
        for(const a of allocations){if(merged.has(a.ownerAddress)&&merged.get(a.ownerAddress)!==a.amountSun)fail(`Conflicting ownership for #${sequence}.`);merged.set(a.ownerAddress,a.amountSun);}
        previous.allocations=[...merged].map(([ownerAddress,amountSun])=>({ownerAddress,amountSun}));
      }else movements.set(key,t);
    }
  }
  for(const p of periods.values())if(!p.explicit){
    p.initial=[...p.owners].map(ownerAddress=>({holderAddress:ownerAddress,ownerAddress,amountSun:SUN}));
    p.warnings.push('Personal CSV reports provide partial coverage. A 1 TRX starting stake is assumed for each supplied report owner; omitted movements cannot be reconstructed. Use Download all flows for a complete snapshot.');
  }
  return normaliseDataset({format:'trx-flow-atlas',version:1,network,wallets:[...wallets.values()],periods:[...periods.values()],transactions:[...movements.values()],
    warnings:[...periods.values()].some(p=>!p.explicit)?['Partial CSV import: the all-wallet balance is not a complete on-chain snapshot.']:[]});
}

/** A frame is a day or a transaction. Accounting boundaries are explicit;
 * stakes are reused across plans, never added once for each plan. */
export function buildFrames(data,{scope='all',legacy=false,axis='calendar',granularity='day',status='all'}={}){
  const frames=[];
  for(const p of data.periods.filter(p=>(scope==='all'||p.id===scope)&&(legacy||p.type!=='LEGACY'))){
    if(status==='confirmed'&&p.status==='DRAFT')continue;
    const events=data.transactions.filter(t=>t.periodId===p.id&&(status!=='confirmed'||t.status==='CONFIRMED'));
    events.sort((a,b)=>{
      if(a.status==='CONFIRMED'&&b.status!=='CONFIRMED')return -1;if(b.status==='CONFIRMED'&&a.status!=='CONFIRMED')return 1;
      return axis==='calendar'?Date.parse(timeOf(a))-Date.parse(timeOf(b))||a.sequence-b.sequence:a.sequence-b.sequence;
    });
    const base=frames.length;
    frames.push({period:p,boundary:true,label:p.label+' · starting stake',events:[],forecast:false,periodStart:base});
    const grouped=new Map();
    for(const t of events){
      const day=axis==='round'&&p.type!=='LEGACY'?`Round ${t.campaignDay??0}`:moscowDay(timeOf(t));
      const key=granularity==='transaction'?t.id:day;
      if(!grouped.has(key))grouped.set(key,{period:p,boundary:false,label:granularity==='transaction'?`#${t.sequence} · ${day}`:day,events:[],forecast:false,periodStart:base});
      const f=grouped.get(key);f.events.push(t);if(t.status!=='CONFIRMED')f.forecast=true;
    }
    for(const f of grouped.values())frames.push(f);
  }
  return frames;
}
export function initialState(period){return new Map(period.initial.map(v=>[shareKey(v.holderAddress,v.ownerAddress),v.amountSun]));}
export function composition(state,holder){return [...state].flatMap(([key,amountSun])=>{
  const [holderAddress,ownerAddress]=key.split('\0');return holderAddress===holder&&amountSun>0?[{ownerAddress,amountSun}]:[];
});}
export function ownerPositions(state,owner){return [...state].flatMap(([key,amountSun])=>{
  const [holderAddress,ownerAddress]=key.split('\0');return ownerAddress===owner&&amountSun>0?[{holderAddress,amountSun}]:[];
});}
export function applyMovement(state,t,tracked){
  if(t.attribution==='UNKNOWN'||!t.allocations.length)return `Ownership is unavailable for #${t.sequence}; later balances in this period are not inferred.`;
  const shares=t.allocations.filter(a=>tracked.has(a.ownerAddress));
  for(const a of shares)if((state.get(shareKey(t.from,a.ownerAddress))??0)<a.amountSun)
    return `The supplied history cannot fund ${a.ownerAddress}'s share in #${t.sequence}. Replay stops here; no funds are invented.`;
  for(const a of shares){const source=shareKey(t.from,a.ownerAddress),target=shareKey(t.to,a.ownerAddress);
    state.set(source,state.get(source)-a.amountSun);state.set(target,(state.get(target)??0)+a.amountSun);}
  return null;
}
export function createReplay(frames){
  const cache=new Map();
  return index=>{
    if(!frames[index])return {before:new Map(),after:new Map(),issue:null};
    const first=frames[index].periodStart,tracked=new Set(frames[index].period.initial.map(p=>p.ownerAddress));
    let from=first,state=initialState(frames[index].period),issue=null;
    for(const [at,c] of cache)if(at>=first&&at<index&&at>=from){from=at+1;state=new Map(c.after);issue=c.issue;}
    let before=new Map(state);
    for(let i=from;i<=index;i++){
      before=new Map(state);
      if(!issue)for(const t of frames[i].events){issue=applyMovement(state,t,tracked);if(issue)break;}
    }
    const result={before,after:new Map(state),issue};cache.set(index,result);
    if(cache.size>128)cache.delete(cache.keys().next().value);
    return result;
  };
}
export function visibleTransactions(frame,owner){return owner?frame.events.filter(t=>t.allocations.some(a=>a.ownerAddress===owner)):frame.events;}
