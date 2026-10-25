import {writeFile} from 'node:fs/promises';
import {normaliseDataset,SUN} from '../public/model.js';
const wallets=Array.from({length:17},(_,i)=>({address:`DEMO-WALLET-${String(i+1).padStart(2,'0')}`,label:`Node ${i+1}`,ordinal:i,role:'participant'}));
wallets.push({address:'DEMO-TEACHER',label:'Teacher',ordinal:17,role:'teacher'});
const members=wallets.filter(w=>w.role==='participant'),periods=[],transactions=[];let sequence=1;
function period(id,label,start,days,confirmedDays,legacy=false){
  const initial=members.map(w=>({holderAddress:w.address,ownerAddress:w.address,amountSun:SUN}));
  periods.push({id,label,type:legacy?'LEGACY':'SMART',status:confirmedDays>=days?'RESTORED':'ACTIVE',startedAt:start,
    deadlineAt:'2026-11-15T20:59:00Z',coverage:'COMPLETE',initial,warnings:legacy?['Demo FIFO accounting.']:[]});
  const stock=new Map(members.map(w=>[w.address,new Map([[w.address,SUN]])])),dailyCount=new Map();
  function send(from,to,amountSun,day,kind='MIX',explicit){
    const fromStock=stock.get(from),toStock=stock.get(to),allocations=[];let left=amountSun;
    for(const [ownerAddress,balance] of fromStock){
      if(explicit&&ownerAddress!==explicit)continue;
      const value=Math.min(left,balance);if(value){allocations.push({ownerAddress,amountSun:value});fromStock.set(ownerAddress,balance-value);toStock.set(ownerAddress,(toStock.get(ownerAddress)??0)+value);left-=value;}
      if(!left)break;
    }
    if(left)throw Error('Unfunded demo transfer');
    const slot=dailyCount.get(day)??0;dailyCount.set(day,slot+1);
    const at=new Date(Date.parse(start)+(day-1)*86_400_000+slot*150_000).toISOString();
    transactions.push({id:`demo-transfer-${sequence}`,periodId:id,sequence:sequence++,campaignDay:day,kind,status:day<=confirmedDays?'CONFIRMED':'APPROVED',
      from,to,amountSun,allocations,attribution:legacy?'FIFO':'RECORDED',plannedAt:at,scheduledAt:at,confirmedAt:day<=confirmedDays?at:null,
      recordedAt:day<=confirmedDays?at:null,txId:day<=confirmedDays?'demo-tx-'+sequence:null,bandwidthUsed:day<=confirmedDays?267:null});
  }
  for(let day=1;day<=days-2;day++){
    const offset=[3,7,4,11,6,9,2][(day-1)%7];
    for(let i=0;i<members.length;i++){
      const from=members[(i*7+day)%17].address,to=members[((i*7+day)+offset)%17].address;
      const balance=[...stock.get(from).values()].reduce((a,b)=>a+b,0);
      const choice=legacy?[121535,74301,42147][i%3]:[500000,250000,750000,375000,125000][(i+day)%5];
      if(balance>0)send(from,to,Math.min(balance,choice),day);
    }
  }
  const returns=[...stock].flatMap(([from,s])=>[...s].filter(([owner,a])=>a>0&&owner!==from).map(([to,amountSun])=>({from,to,amountSun})));
  for(const [i,r] of returns.entries())send(r.from,r.to,r.amountSun,days-1+(i%2),'RETURN',r.to);
  for(const w of members)if(stock.get(w.address).get(w.address)!==SUN)throw Error('Demo return failed');
}
period('demo-legacy','Before the plans','2026-09-29T09:00:00Z',4,4,true);
period('demo-plan-one','Plan 1','2026-10-04T09:00:00Z',10,10);
period('demo-plan-two','Plan 2','2026-10-15T09:00:00Z',16,7);
const data=normaliseDataset({format:'trx-flow-atlas',version:1,title:'A shared journey · demonstration',network:'DEMO',demo:true,
  createdAt:'2026-10-25T09:00:00Z',wallets,periods,transactions,warnings:[]});
await writeFile(new URL('../public/dataset.json',import.meta.url),JSON.stringify(data));
await writeFile(new URL('../public/demo.json',import.meta.url),JSON.stringify(data));
console.log(`Demo: ${data.wallets.length-1} participants, ${data.periods.length} periods, ${data.transactions.length} native transfers.`);
