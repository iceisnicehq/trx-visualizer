import {COLOURS,SUN,normaliseDataset,datasetFromCsv,buildFrames,createReplay,composition,ownerPositions,visibleTransactions,formatSun,shortAddress,timeOf} from './model.js';
import {FlowCanvas} from './canvas.js';
import {journeyCsv} from './exports.js';
const $=id=>document.getElementById(id),element=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=String(text);return el;};
const params=new URLSearchParams(location.hash.slice(1));
const state={data:null,frames:[],index:0,owner:null,selectedWallet:null,selectedTransfer:null,playing:false,trails:true,scope:'all',legacy:true,axis:'calendar',granularity:'day',status:'all',view:'timeline',historyStatus:'CONFIRMED',sharedRevision:'demo',
  reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,duration:1500,started:0,elapsed:0};
let replay=()=>({before:new Map(),after:new Map(),issue:null}),toastTimer,importGeneration=0;
const colour=address=>{const wallet=state.wallets?.get(address);return wallet?COLOURS[wallet.ordinal%COLOURS.length]:'#8e9ab3';};
const name=address=>state.wallets?.get(address)?.label??shortAddress(address);
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
function download(name,blob){const url=URL.createObjectURL(blob),a=element('a');a.download=name;a.href=url;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
function pause(){state.playing=false;$('play-button').textContent='▶';$('play-button').setAttribute('aria-label','Play timeline');}
function chooseFrame(index){pause();state.index=Math.max(0,Math.min(state.frames.length-1,index));state.selectedTransfer=null;state.elapsed=1;updateFrame();if(state.view==='timeline')canvas.focusFrame(state.index);}
function nextIndex(direction){
  const end=state.frames.length-1;let at=state.index+direction;
  if(state.owner&&state.granularity==='transaction')while(at>0&&at<end&&!state.frames[at].boundary&&!visibleTransactions(state.frames[at],state.owner).length)at+=direction;
  return Math.max(0,Math.min(end,at));
}
const canvas=new FlowCanvas($('flow-canvas'),{
  selectWallet(address,index){if(index!==undefined&&state.view==='timeline')chooseFrame(index);state.selectedWallet=address;state.selectedTransfer=null;renderDetail();syncCanvas();},
  selectTransfer(id,index){if(index!==undefined)chooseFrame(index);state.selectedTransfer=id;state.selectedWallet=null;renderActivity();renderDetail();syncCanvas();}
});
function syncCanvas(){if(!state.data)return;state.replay=replay(state.index);canvas.setState({...state,colour,replayAt:replay});}
function setOwner(owner){if(!state.data)return;pause();state.owner=owner;state.selectedWallet=null;state.selectedTransfer=null;renderOwners();updateFrame();if(state.view==='timeline'){if(owner)canvas.focusFrame(state.index,true);else canvas.fit();}}
function renderOwners(){
  const list=$('owners-list');list.replaceChildren();
  const owners=new Set(state.frames.flatMap(f=>f.boundary?f.period.initial.map(p=>p.ownerAddress):[]));
  const people=state.data.wallets.filter(w=>w.role!=='teacher'&&owners.has(w.address));
  $('owner-total').textContent=people.length+' stakes';$('all-owners').classList.toggle('active',!state.owner);
  for(const w of people){
    const button=element('button','owner-button'+(state.owner===w.address?' active':''));button.style.setProperty('--owner',colour(w.address));
    button.setAttribute('aria-pressed',String(state.owner===w.address));button.title=w.address;
    button.append(element('span','owner-swatch'),element('span','owner-name',w.label),element('span','owner-address',w.address.slice(-3)));
    button.addEventListener('click',()=>setOwner(w.address));list.append(button);
  }
}
function build(keep=false){
  if(!state.data)return;
  pause();state.frames=buildFrames(state.data,state);replay=createReplay(state.frames);
  if(!keep)state.index=0;
  state.index=Math.max(0,Math.min(state.index,state.frames.length-1));state.selectedTransfer=null;
  const owners=new Set(state.frames.flatMap(f=>f.period.initial.map(a=>a.ownerAddress)));if(state.owner&&!owners.has(state.owner))state.owner=null;
  $('timeline-slider').max=String(Math.max(0,state.frames.length-1));renderOwners();updateFrame();
}
function load(raw,source){
  const data=normaliseDataset(raw);pause();state.data=data;state.wallets=new Map(data.wallets.map(w=>[w.address,w]));
  state.owner=params.get('owner')&&state.wallets.has(params.get('owner'))?params.get('owner'):null;
  state.scope=data.periods.some(p=>p.id===params.get('scope'))?params.get('scope'):'all';
  state.legacy=params.get('legacy')!=='0';$('legacy-toggle').checked=state.legacy;
  for(const [key,options,id] of [['axis',['calendar','round'],'axis-select'],['granularity',['day','transaction'],'granularity'],['status',['all','confirmed'],'status-select']]){
    if(options.includes(params.get(key)))state[key]=params.get(key);$(id).value=state[key];
  }
  $('period-select').replaceChildren(element('option','', 'All plans'));
  $('period-select').firstChild.value='all';
  for(const p of data.periods){const option=element('option','',p.label+(p.status==='DRAFT'?' · preview':''));option.value=p.id;$('period-select').append(option);}
  $('period-select').value=state.scope;
  $('source-badge').textContent=data.demo?'DEMO DATA':(data.network.toUpperCase()+' · SNAPSHOT');$('source-badge').classList.toggle('imported',!data.demo);
  $('wallet-count').textContent=String(data.wallets.filter(w=>w.role!=='teacher').length);
  $('transfer-count').textContent=data.transactions.length.toLocaleString('en-GB');$('plan-count').textContent=String(data.periods.filter(p=>p.type==='SMART').length);
  $('subtitle').textContent=data.demo?'Demonstration snapshot. An admin can publish the real game for everyone.':`${data.title} · ${source}. All visitors read this shared snapshot.`;
  const legacyCount=data.transactions.filter(t=>data.periods.some(p=>p.id===t.periodId&&p.type==='LEGACY')).length;
  $('history-coverage').textContent=`${data.transactions.filter(t=>t.status==='CONFIRMED').length} confirmed transfers · ${legacyCount} before the plans · all recorded types included`;
  if(data.sourceCoverage&&!data.sourceCoverage.includesLegacy)$('history-coverage').textContent+=' · this export excluded earlier history; re-export with includeLegacy=1';
  $('snapshot-date').textContent='Exported '+new Date(data.createdAt).toLocaleString('en-GB',{timeZone:'Europe/Moscow'})+' MSK';
  build();
  if(params.has('frame'))chooseFrame(Number(params.get('frame'))||0);
  setView(params.get('view')==='network'?'network':'timeline');
}
function updateFrame(){
  if(!state.data)return;
  const f=state.frames[state.index];syncCanvas();
  $('canvas-empty').hidden=Boolean(f);$('play-button').disabled=!state.frames.length;
  $('timeline-slider').value=String(state.index);$('previous-frame').disabled=state.index<=0;$('next-frame').disabled=state.index>=state.frames.length-1;
  $('canvas-kicker').textContent=state.owner?'FOLLOWING THE ORIGINAL 1 TRX':'EVERYONE TOGETHER';
  $('canvas-title').textContent=state.owner?name(state.owner)+' · across every wallet':state.view==='network'?'The shared network':'Day by day · time flows downward';
  $('workspace').classList.toggle('tree-mode',state.view==='timeline');
  $('workspace').classList.toggle('inspect-open',Boolean(state.owner||state.selectedWallet||state.selectedTransfer));
  $('canvas-hint').textContent=state.view==='network'?'Drag wallets to arrange · Scroll to zoom · Click to inspect':'Scroll down through days · Ctrl/⌘ + scroll to zoom · Drag to pan';
  $('frame-label').textContent=f?.label??'No frames';$('period-label').textContent=f?.period.label??'NO DATA';
  $('frame-badge').textContent=f?.boundary?'STARTING ALLOCATION':f?.forecast?'FORECAST':'CONFIRMED';$('frame-badge').classList.toggle('forecast',Boolean(f?.forecast));
  $('timeline-start').textContent=state.frames[0]?.period.label??'Start';$('timeline-end').textContent=state.frames.at(-1)?.label??'End';
  $('timeline-progress').textContent=state.frames.length?`${state.index+1} / ${state.frames.length} ${state.granularity==='day'?'day frames':'steps'}`:'';
  const events=f?visibleTransactions(f,state.owner):[],native=events.reduce((n,t)=>n+t.amountSun,0),own=events.reduce((n,t)=>n+t.allocations.filter(a=>a.ownerAddress===state.owner).reduce((v,a)=>v+a.amountSun,0),0);
  $('frame-summary').textContent=f?.boundary?'A new accounting period · the same stake is reused, no transfer is implied':`${events.length} native transfers · ${formatSun(native,6)} TRX moved${state.owner?' · '+formatSun(own,6)+' TRX of this stake moved':''}`;
  const warnings=[...(state.data.warnings??[]).filter(w=>!w.startsWith('Ownership colours')&&!w.startsWith('Forecast dates')),...(f?.period.warnings??[]),...(state.replay.issue?[state.replay.issue]:[])];
  if(f?.period.coverage==='PARTIAL')warnings.unshift('Partial ownership history. Balances cover only the supplied stakes and valid recorded steps.');
  $('notice').hidden=!warnings.length;$('notice').textContent=[...new Set(warnings)].join(' ');$('notice').classList.toggle('error',Boolean(state.replay.issue));
  renderActivity();renderDetail();syncCanvas();
}
function renderActivity(){
  const f=state.frames[state.index],events=f?visibleTransactions(f,state.owner):[],list=$('activity-list');list.replaceChildren();
  $('activity-title').textContent=f?.boundary?'The same 1 TRX. A new chapter.':state.owner?name(state.owner)+'’s share, on the move':'One day. Many paths.';
  $('activity-count').textContent=events.length+' transfers';
  if(!events.length){list.append(element('div','empty-activity',f?.boundary?'Each participant starts this accounting period with their own 1 TRX. A plan boundary is not a transfer.':'No movement of the selected stake in this frame. Choose another day or Everyone together.'));return;}
  for(const t of events){
    const card=element('button','transfer-card'+(state.selectedTransfer===t.id?' active':''));
    const top=element('span','card-top');top.append(element('span','',`#${t.sequence} · ${t.kind}`),element('span','',t.status));
    const bottom=element('span','card-bottom'),dots=element('span','packet-dots');
    for(const a of t.allocations){const dot=element('i');dot.style.background=colour(a.ownerAddress);dots.append(dot);}
    const share=state.owner?t.allocations.find(a=>a.ownerAddress===state.owner)?.amountSun:t.amountSun;
    bottom.append(element('span','card-amount',state.owner&&t.attribution==='UNKNOWN'?'Unknown share · '+formatSun(t.amountSun,6)+' TRX native':formatSun(share??0,6)+' TRX'+(state.owner?' of stake':'')),dots);
    card.append(top,element('span','card-route',name(t.from)+' → '+name(t.to)),bottom);
    card.addEventListener('click',()=>{pause();state.selectedTransfer=t.id;state.selectedWallet=null;renderActivity();renderDetail();syncCanvas();});list.append(card);
  }
}
function balanceRow(address,amount,owner,total){
  const row=element('div'),line=element('div','balance-item'),swatch=element('span','owner-swatch');swatch.style.setProperty('--owner',colour(owner));
  const label=element('span','name',name(address));label.append(element('small','',shortAddress(address)));line.append(swatch,label,element('span','',formatSun(amount,6)+' TRX'));
  const bar=element('div','balance-bar'),inner=element('span');inner.style.width=Math.min(100,amount/Math.max(1,total)*100)+'%';inner.style.background=colour(owner);bar.append(inner);row.append(line,bar);return row;
}
function totalCard(amount,label){const box=element('div','detail-total'),value=element('strong','',formatSun(amount,6)+' ');value.append(element('small','','TRX'));box.append(value,element('small','',label));return box;}
function renderDetail(){
  $('workspace').classList.toggle('inspect-open',Boolean(state.owner||state.selectedWallet||state.selectedTransfer));
  const container=$('detail-content');container.replaceChildren();const f=state.frames[state.index];if(!f)return;
  const selected=state.data.transactions.find(t=>t.id===state.selectedTransfer),wallet=state.selectedWallet;
  if(selected){
    $('detail-title').textContent='Transfer #'+selected.sequence;$('detail-intro').textContent='One native transfer can carry shares belonging to several original owners.';
    container.append(element('span','detail-tag'+(selected.status==='CONFIRMED'?'':' forecast'),selected.status),element('div','detail-route',name(selected.from)+' → '+name(selected.to)),totalCard(selected.amountSun,'Whole native transfer'));
    container.append(element('div','detail-label','Inside this packet'));
    for(const a of selected.allocations)container.append(balanceRow(a.ownerAddress,a.amountSun,a.ownerAddress,selected.amountSun));
    if(!selected.allocations.length)container.append(element('p','detail-note','The ownership of this native transfer is unavailable.'));
    container.append(element('div','detail-address',selected.from+' → '+selected.to));
    const at=new Date(timeOf(selected)).toLocaleString('en-GB',{timeZone:'Europe/Moscow',hour12:false});
    container.append(element('p','detail-meta',`${selected.status==='CONFIRMED'?'Recorded':'Forecast'}: ${at} MSK${selected.bandwidthUsed!==null?' · '+selected.bandwidthUsed+' Bandwidth for the whole transaction':''}. Attribution: ${selected.attribution}.`));
    if(selected.txId){
      const text=element('p','detail-meta','TX '+selected.txId);container.append(text);
      if(/^[a-fA-F0-9]{64}$/.test(selected.txId)&&state.data.network==='mainnet'){const a=element('a','detail-note','View on TRONSCAN ↗');a.href='https://tronscan.org/#/transaction/'+selected.txId;a.target='_blank';a.rel='noopener noreferrer';container.append(a);}
    }
  }else if(wallet){
    $('detail-title').textContent=name(wallet);$('detail-intro').textContent='The wallet is the holder. The colours identify whose original shares it is holding.';
    const shares=composition(state.replay.after,wallet),total=shares.reduce((n,a)=>n+a.amountSun,0);
    container.append(totalCard(total,state.replay.issue?'Last valid reconstructed balance':'Tracked balance after this frame · extra Sun excluded'),element('div','detail-label','Whose funds are here?'));
    for(const a of shares)container.append(balanceRow(a.ownerAddress,a.amountSun,a.ownerAddress,total));
    if(!shares.length)container.append(element('p','detail-note','No tracked stake is held here at this point.'));
    container.append(element('div','detail-address',wallet));
    if(f.period.initial.some(a=>a.ownerAddress===wallet)){const follow=element('button','detail-action','Follow '+name(wallet)+'’s original 1 TRX →');follow.addEventListener('click',()=>setOwner(wallet));container.append(follow);}
    renderHistory(container,state.data.transactions.filter(t=>t.from===wallet||t.to===wallet),'Full wallet history');
  }else if(state.owner){
    $('detail-title').textContent=name(state.owner)+'’s 1 TRX';$('detail-intro').textContent='Follow the original stake through every holder, even when the owner is not the sender or recipient.';
    const positions=ownerPositions(state.replay.after,state.owner),total=positions.reduce((n,p)=>n+p.amountSun,0);
    container.append(totalCard(total,state.replay.issue?'Last valid accounting position':'Tracked stake · conserved across holders'),element('div','detail-label','Where are the pieces?'));
    for(const p of positions)container.append(balanceRow(p.holderAddress,p.amountSun,state.owner,total));
    const moved=state.frames.slice(f.periodStart,state.index+1).flatMap(f=>visibleTransactions(f,state.owner));
    container.append(element('p','detail-note',`${positions.length} current holders · ${moved.length} movements of this stake in this period. A transfer can combine several owners’ shares.`));
    container.append(element('div','detail-address',state.owner));
    renderHistory(container,state.data.transactions.filter(t=>t.allocations.some(a=>a.ownerAddress===state.owner)||t.attribution==='UNKNOWN'),'Complete journey of this stake',state.owner);
  }else{
    $('detail-title').textContent='The whole picture';$('detail-intro').textContent='Every colour belongs to an original stake. Wallet balances change as the shares split, travel and reunite.';
    const total=[...state.replay.after.values()].reduce((a,b)=>a+b,0);
    container.append(totalCard(total,f.period.coverage==='PARTIAL'?'Tracked shares in this partial import':'Total tracked stake · extra Sun excluded'));
    const transactions=f.events,combined=transactions.filter(t=>t.allocations.length>1).length;
    container.append(element('div','detail-label','This frame'),element('p','detail-note',`${transactions.length} unique native transfers. ${combined} carry shares from more than one owner. ${f.forecast?'This frame includes forecast transfers.':'These are recorded steps.'}`),element('div','detail-label','Make it personal'),element('p','detail-note','Choose an owner on the left to keep only routes carrying that person’s share. Click a wallet to inspect the exact balance breakdown.'));
    container.append(element('p','detail-note','A starting allocation is an accounting boundary. Earlier plans are not added to the current stake.'));
  }
  const csvOwner=state.owner??state.selectedWallet;
  $('download-personal-csv').disabled=!csvOwner||!state.data.periods.some(p=>p.initial.some(a=>a.ownerAddress===csvOwner));
  $('download-personal-csv').textContent=csvOwner?'↓ '+name(csvOwner)+' · 1 TRX CSV':'↓ My 1 TRX · CSV';
}
function renderHistory(container,rows,title,stakeOwner=null){
  container.append(element('div','detail-label',title+' · '+rows.length));
  const controls=element('div','history-choice');
  for(const [value,label] of [['CONFIRMED','Confirmed'],['ALL','All steps']]){
    const button=element('button',state.historyStatus===value?'active':'',label);button.addEventListener('click',()=>{state.historyStatus=value;renderDetail();});controls.append(button);
  }
  container.append(controls);const list=element('div','wallet-history');
  const shown=rows.filter(t=>state.historyStatus==='ALL'||t.status==='CONFIRMED').sort((a,b)=>a.sequence-b.sequence);
  for(const t of shown){
    const button=element('button','history-transfer'),own=stakeOwner?t.allocations.find(a=>a.ownerAddress===stakeOwner)?.amountSun:null;
    const amount=stakeOwner&&t.attribution==='UNKNOWN'?'Unknown share · '+formatSun(t.amountSun,6)+' TRX native':formatSun(own??t.amountSun,6)+' TRX';
    button.append(element('strong','',`#${t.sequence} · ${t.kind} · ${amount}`),element('span','',name(t.from)+' → '+name(t.to)),
      element('small','',new Date(timeOf(t)).toLocaleString('en-GB',{timeZone:'Europe/Moscow'})+' MSK · '+t.status));
    button.addEventListener('click',()=>{
      let index=state.frames.findIndex(f=>f.events.some(e=>e.id===t.id));
      if(index<0){state.scope='all';state.legacy=true;state.status='all';$('period-select').value='all';$('legacy-toggle').checked=true;$('status-select').value='all';build();index=state.frames.findIndex(f=>f.events.some(e=>e.id===t.id));}
      if(index>=0)chooseFrame(index);state.selectedTransfer=t.id;state.selectedWallet=null;renderActivity();renderDetail();syncCanvas();canvas.focusFrame(state.index);canvas.focusAddresses([t.from,t.to]);
    });list.append(button);
  }
  if(!shown.length)list.append(element('p','detail-note','No confirmed transfers for this selection yet.'));
  container.append(list);
}
function setView(view){state.view=view;canvas.setView(view);for(const v of ['network','timeline']){$(v+'-view').classList.toggle('active',v===view);$(v+'-view').setAttribute('aria-pressed',String(v===view));}if(state.data)updateFrame();}
$('all-owners').addEventListener('click',()=>setOwner(null));
for(const [id,key] of [['period-select','scope'],['axis-select','axis'],['granularity','granularity'],['status-select','status']])$(id).addEventListener('change',e=>{
  state[key]=e.target.value;if(key==='scope'&&state.data?.periods.find(p=>p.id===state.scope)?.type==='LEGACY'){state.legacy=true;$('legacy-toggle').checked=true;}
  build();if(state.view==='timeline')canvas.fit();
});
$('legacy-toggle').addEventListener('change',e=>{state.legacy=e.target.checked;build();if(state.view==='timeline')canvas.fit();});
$('trails-toggle').addEventListener('change',e=>{state.trails=e.target.checked;syncCanvas();});
$('network-view').addEventListener('click',()=>setView('network'));$('timeline-view').addEventListener('click',()=>setView('timeline'));
$('timeline-slider').addEventListener('input',e=>chooseFrame(Number(e.target.value)));
$('previous-frame').addEventListener('click',()=>chooseFrame(nextIndex(-1)));$('next-frame').addEventListener('click',()=>chooseFrame(nextIndex(1)));
$('play-button').addEventListener('click',()=>{
  if(state.playing){pause();syncCanvas();return;}
  if(state.index>=state.frames.length-1)chooseFrame(0);
  state.playing=true;state.started=performance.now();state.elapsed=0;$('play-button').textContent='Ⅱ';$('play-button').setAttribute('aria-label','Pause timeline');syncCanvas();
});
$('speed-select').addEventListener('change',e=>{state.duration=Number(e.target.value);state.started=performance.now();});
$('zoom-in').addEventListener('click',()=>canvas.zoom(1.25));$('zoom-out').addEventListener('click',()=>canvas.zoom(.8));
$('fit-view').addEventListener('click',()=>canvas.fit());$('reset-layout').addEventListener('click',()=>canvas.reset());
$('fullscreen').addEventListener('click',async()=>{
  const stage=$('atlas-stage');
  if(stage.classList.contains('expanded')){stage.classList.remove('expanded');document.body.classList.remove('atlas-expanded');return;}
  try{if(document.fullscreenElement)await document.exitFullscreen();else await stage.requestFullscreen();}
  catch{stage.classList.add('expanded');document.body.classList.add('atlas-expanded');toast('Expanded canvas. Press Esc or ⛶ to return.');}
});
$('save-image').addEventListener('click',()=>{$('flow-canvas').toBlob(blob=>{if(blob)download('trx-flow-'+state.index+'.png',blob);});});
$('download-data').addEventListener('click',()=>{if(state.data)download('dataset.json',new Blob([JSON.stringify(state.data,null,2)],{type:'application/json'}));});
$('help-button').addEventListener('click',()=>$('help-dialog').showModal());$('close-help').addEventListener('click',()=>$('help-dialog').close());
$('copy-link').addEventListener('click',async()=>{
  const q=new URLSearchParams({view:state.view,frame:String(state.index),scope:state.scope,legacy:state.legacy?'1':'0',axis:state.axis,granularity:state.granularity,status:state.status});if(state.owner)q.set('owner',state.owner);
  const url=new URL(location.href);url.hash=q.toString();
  try{await navigator.clipboard.writeText(url.href);toast('Shared view link copied. Visitors open the saved public snapshot.');}catch{toast('Copy is unavailable. Your current view is saved in the address bar.');}
  history.replaceState(null,'',url);
});
let stagedSnapshot=null,stagedGeneration=0;
async function loadShared(){
  const generation=++importGeneration;pause();
  const [snapshot,status]=await Promise.all([
    fetch('./api/snapshot',{cache:'no-store',signal:AbortSignal.timeout(20_000)}),
    fetch('./api/status',{cache:'no-store',signal:AbortSignal.timeout(10_000)}).then(r=>r.ok?r.json():{publishingEnabled:false}).catch(()=>({publishingEnabled:false}))
  ]);
  if(!snapshot.ok){
    if(snapshot.status===404){
      const fallback=await fetch('./dataset.json',{cache:'no-store'});if(!fallback.ok)throw Error('No shared snapshot is configured on this static host.');
      if(generation!==importGeneration)return;load(await fallback.json(),'static read-only snapshot');$('admin-upload').disabled=true;return;
    }
    throw Error('The shared snapshot could not be read. Retry Refresh; the current view is retained.');
  }
  const body=await snapshot.json();if(generation!==importGeneration)return;
  state.sharedRevision=body.revision;state.publishingEnabled=status.publishingEnabled===true;
  load(body.dataset,body.publishedAt?'published '+new Date(body.publishedAt).toLocaleString('en-GB',{timeZone:'Europe/Moscow'})+' MSK':'shared demonstration');
  $('admin-upload').disabled=!state.publishingEnabled;
}
$('refresh-data').addEventListener('click',()=>loadShared().then(()=>toast('The current public snapshot is loaded.')).catch(e=>toast(e.message)));
$('admin-upload').addEventListener('click',()=>{
  pause();$('publish-error').textContent='';$('publish-password').value='';$('publish-dialog').showModal();
});
function clearPublish(){
  stagedGeneration++;stagedSnapshot=null;$('file-input').value='';$('publish-password').value='';$('publish-submit').disabled=true;
  $('publish-preview').textContent='Choose a JSON export to review its coverage.';$('publish-error').textContent='';
}
$('close-publish').addEventListener('click',()=>{$('publish-dialog').close();clearPublish();});
$('publish-dialog').addEventListener('close',clearPublish);
$('file-input').addEventListener('change',async e=>{
  const generation=++stagedGeneration;stagedSnapshot=null;$('publish-submit').disabled=true;$('publish-error').textContent='';
  try{
    const file=e.target.files?.[0];if(!file)return;if(file.size>12*1024*1024)throw Error('The JSON publishing limit is 12 MB.');
    const data=normaliseDataset(JSON.parse(await file.text()));if(generation!==stagedGeneration)return;stagedSnapshot=data;
    const earlier=data.transactions.filter(t=>data.periods.some(p=>p.id===t.periodId&&p.type==='LEGACY')).length;
    $('publish-preview').textContent=`${data.wallets.filter(w=>w.role!=='teacher').length} wallets · ${data.transactions.length} native transfers · ${earlier} pre-plan transfers · ${data.periods.length} accounting periods. Publishing replaces the snapshot for every visitor.`;
    $('publish-submit').disabled=false;
  }catch(error){$('publish-error').textContent=error.message;}
});
$('publish-form').addEventListener('submit',async e=>{
  e.preventDefault();if(!stagedSnapshot)return;
  $('publish-submit').disabled=true;$('close-publish').disabled=true;$('publish-error').textContent='';
  try{
    const reply=await fetch('./api/admin/publish',{method:'PUT',headers:{'Content-Type':'application/json','X-Flow-Password':$('publish-password').value,'If-Match':state.sharedRevision},
      body:JSON.stringify(stagedSnapshot),signal:AbortSignal.timeout(30_000)});
    const body=await reply.json();if(!reply.ok)throw Error(body.error??'Publishing failed.');
    $('publish-dialog').close();clearPublish();await loadShared();toast('Published. Everyone now reads this saved snapshot on Refresh.');
  }catch(error){$('publish-error').textContent=error.name==='TimeoutError'||error.name==='TypeError'?'Could not confirm the upload. Refresh public data before trying again.':error.message;
    $('publish-submit').disabled=!stagedSnapshot;
  }finally{$('publish-password').value='';$('close-publish').disabled=false;}
});
function saveCsv(owner){
  if(!state.data)return;
  try{download(owner?`trx-node-${state.wallets.get(owner).ordinal+1}-stake.csv`:'trx-everyone.csv',new Blob([journeyCsv(state.data,{owner,confirmedOnly:state.status==='confirmed'})],{type:'text/csv;charset=utf-8'}));}
  catch(error){toast(error.message);}
}
$('download-personal-csv').addEventListener('click',()=>saveCsv(state.owner??state.selectedWallet));
$('download-all-csv').addEventListener('click',()=>saveCsv(null));
$('latest-confirmed').addEventListener('click',()=>{const i=state.frames.findLastIndex(f=>f.events.some(t=>t.status==='CONFIRMED'));chooseFrame(Math.max(0,i));});
for(const event of ['dragover','drop'])document.addEventListener(event,e=>{e.preventDefault();if(event==='drop')toast('Use Admin upload to publish a JSON snapshot.');});
document.addEventListener('keydown',e=>{
  if(e.code==='Escape'&&$('atlas-stage').classList.contains('expanded')){$('atlas-stage').classList.remove('expanded');document.body.classList.remove('atlas-expanded');return;}
  if(e.target.closest('input,select,textarea,button,dialog')||$('help-dialog').open)return;
  if(e.code==='Space'){e.preventDefault();$('play-button').click();}else if(e.code==='ArrowRight'){e.preventDefault();chooseFrame(nextIndex(1));}else if(e.code==='ArrowLeft'){e.preventDefault();chooseFrame(nextIndex(-1));}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden){pause();syncCanvas();}});
let lastDraw=0;
function animate(now){
  if(state.data){
    if(state.playing){
      state.elapsed=Math.min(1,(now-state.started)/state.duration);
      if(state.elapsed>=1){
        if(state.index>=state.frames.length-1){pause();syncCanvas();}
        else{state.index=nextIndex(1);state.started=now;state.elapsed=0;state.selectedTransfer=null;updateFrame();if(state.view==='timeline')canvas.focusFrame(state.index);}
      }
    }
    if(now-lastDraw>1000/40&&(state.playing||canvas.dirty)){canvas.state.playing=state.playing;canvas.draw(now,state.playing?state.elapsed:1);lastDraw=now;}
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
loadShared().catch(e=>{$('notice').hidden=false;$('notice').classList.add('error');$('notice').textContent=e.message;});
