import {SUN,normaliseDataset} from './model.js';
const fields=['row_type','period_id','period_label','period_type','period_status','coverage','network','holder_address','owner_address','initial_amount_sun','wallet_ordinal','wallet_label','wallet_role',
  'transfer_id','sequence','campaign_day','kind','status','planned_utc','scheduled_utc','confirmed_utc','recorded_confirmation_utc','from_address','to_address','native_amount_sun','native_amount_trx',
  'stake_owner_address','owner_amount_sun','owner_amount_trx','packet_ownership','attribution_basis','tx_id','bandwidth_whole_transaction','export_scope'];
const cell=v=>{let s=v==null?'':String(v);if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
/** Personal CSV follows the original stake through peer holders. Packet sums
 * remain whole native amounts; they are never multiplied by owner count. */
export function journeyCsv(raw,{owner=null,confirmedOnly=false}={}){
  const data=normaliseDataset(raw),rows=[],exportScope=owner?'PERSONAL_STAKE':'ALL_STAKES';
  if(owner&&!data.periods.some(p=>p.initial.some(a=>a.ownerAddress===owner)))throw Error('Choose a participant whose stake is included in this snapshot.');
  const row=values=>rows.push({...values,export_scope:exportScope});
  for(const w of data.wallets)row({row_type:'WALLET',holder_address:w.address,wallet_ordinal:w.ordinal,wallet_label:w.label,wallet_role:w.role,network:data.network});
  for(const p of data.periods){
    const initial=p.initial.filter(a=>!owner||a.ownerAddress===owner);if(!initial.length)continue;
    const base={period_id:p.id,period_label:p.label,period_type:p.type,period_status:p.status,coverage:p.coverage,network:data.network};
    for(const a of initial){const w=data.wallets.find(w=>w.address===a.ownerAddress);row({...base,row_type:'BASELINE',holder_address:a.holderAddress,owner_address:a.ownerAddress,
      initial_amount_sun:a.amountSun,wallet_ordinal:w.ordinal,wallet_label:w.label,wallet_role:w.role});}
    for(const t of data.transactions.filter(t=>t.periodId===p.id&&(!confirmedOnly||t.status==='CONFIRMED')&&(!owner||t.allocations.some(a=>a.ownerAddress===owner)||t.attribution==='UNKNOWN'))){
      const shares=t.allocations.filter(a=>!owner||a.ownerAddress===owner),packet=t.allocations.map(a=>`${a.ownerAddress}: ${(a.amountSun/SUN).toFixed(6)} TRX`).join('; ');
      for(const a of shares.length?shares:[null])row({...base,row_type:'TRANSFER',transfer_id:t.id,sequence:t.sequence,campaign_day:t.campaignDay,kind:t.kind,status:t.status,
        planned_utc:t.plannedAt,scheduled_utc:t.scheduledAt,confirmed_utc:t.confirmedAt,recorded_confirmation_utc:t.recordedAt,
        from_address:t.from,to_address:t.to,native_amount_sun:t.amountSun,native_amount_trx:(t.amountSun/SUN).toFixed(6),stake_owner_address:a?.ownerAddress,
        owner_amount_sun:a?.amountSun,owner_amount_trx:a?(a.amountSun/SUN).toFixed(6):'',packet_ownership:packet,
        attribution_basis:t.attribution==='FIFO'?'RECONSTRUCTED':t.attribution,tx_id:t.txId,bandwidth_whole_transaction:t.bandwidthUsed});
    }
  }
  return '\uFEFF'+[fields,...rows.map(r=>fields.map(f=>r[f]??''))].map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';
}
