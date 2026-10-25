/** Fixed columns and expanding day rows. Time never runs upward; no layout
 * solver moves wallet columns when a new frame or selection is rendered. */
export const TREE_COLUMN=148;
export const TREE_TOP=115;
export function treeLayout(data,frames){
  const wallets=data.wallets.filter(w=>w.role!=='teacher'||data.transactions.some(t=>t.to===w.address&&t.kind==='PAYOUT'));
  const columns=new Map(wallets.map((w,i)=>[w.address,135+i*TREE_COLUMN]));
  const rows=[];let y=TREE_TOP;
  for(const [index,f] of frames.entries()){
    if(index)y+=f.boundary?220:Math.max(250,Math.min(900,165+f.events.length*8));
    rows.push({index,y,previousY:index?rows[index-1].y:null,height:index?y-rows[index-1].y:0});
  }
  return {wallets,columns,rows,width:270+Math.max(0,wallets.length-1)*TREE_COLUMN,height:y+150};
}
