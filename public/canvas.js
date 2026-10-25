import {composition,formatSun,visibleTransactions,applyMovement} from './model.js';
import {treeLayout} from './tree-layout.js';
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const bezier=(a,b,c,d,t)=>({x:(1-t)**3*a.x+3*(1-t)**2*t*b.x+3*(1-t)*t*t*c.x+t**3*d.x,y:(1-t)**3*a.y+3*(1-t)**2*t*b.y+3*(1-t)*t*t*c.y+t**3*d.y});
const distance=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy,t=len?clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/len,0,1):0;return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};

export class FlowCanvas{
  constructor(canvas,{selectWallet,selectTransfer}){
    this.canvas=canvas;this.ctx=canvas.getContext('2d');this.selectWallet=selectWallet;this.selectTransfer=selectTransfer;
    this.positions=new Map();this.camera={x:0,y:0,scale:1};this.nodes=[];this.edges=[];this.width=0;this.height=0;this.view='timeline';
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(canvas.parentElement);
    this.abort=new AbortController();const signal=this.abort.signal;
    canvas.addEventListener('wheel',e=>{e.preventDefault();if(this.view==='timeline'&&!e.ctrlKey&&!e.metaKey){this.camera.y-=e.shiftKey?0:e.deltaY;this.camera.x-=e.shiftKey?e.deltaY:e.deltaX;this.cameraTouched=true;this.dirty=true;}else this.zoom(Math.exp(-e.deltaY*.001),e.offsetX,e.offsetY);},{passive:false,signal});
    canvas.addEventListener('pointerdown',e=>this.down(e),{signal});
    canvas.addEventListener('pointermove',e=>this.move(e),{signal});
    canvas.addEventListener('pointerup',e=>this.up(e),{signal});
    canvas.addEventListener('pointercancel',()=>{this.drag=null;canvas.classList.remove('dragging');},{signal});
  }
  setState(state){
    const reset=!this.state||this.state.data!==state.data;
    if(!this.state||this.state.frames!==state.frames||reset)this.tree=treeLayout(state.data,state.frames);
    this.state=state;this.dirty=true;
    if(reset){this.positions.clear();this.layout();this.fit();}
  }
  setView(view){if(this.view===view)return;this.view=view;this.fit();}
  layout(){
    if(!this.state)return;
    const participants=this.state.data.wallets.filter(w=>w.role!=='teacher');
    for(const [i,w] of participants.entries())if(!this.positions.has(w.address)){
      const angle=-Math.PI/2+2*Math.PI*i/participants.length;
      this.positions.set(w.address,{x:500+310*Math.cos(angle),y:390+280*Math.sin(angle)});
    }
    for(const [i,w] of this.state.data.wallets.filter(w=>w.role==='teacher').entries())if(!this.positions.has(w.address))this.positions.set(w.address,{x:500+i*95,y:390});
  }
  reset(){this.positions.clear();this.layout();this.fit();}
  resize(){
    const rect=this.canvas.parentElement.getBoundingClientRect(),first=this.width===0;this.width=rect.width;this.height=rect.height;
    const dpr=Math.min(devicePixelRatio||1,2);this.dpr=dpr;this.canvas.width=Math.round(this.width*dpr);this.canvas.height=Math.round(this.height*dpr);
    this.dirty=true;if(first||!this.cameraTouched)this.fit();
  }
  fit(){
    this.dirty=true;this.cameraTouched=false;
    if(!this.width||!this.height)return;
    if(this.view==='timeline'){
      const scale=0.82;this.camera={scale,x:25,y:25};
      this.focusFrame(this.state?.index??0,true);
    }else{const scale=Math.min((this.width-45)/930,(this.height-25)/775);this.camera={scale,x:(this.width-1000*scale)/2,y:(this.height-780*scale)/2};}
  }
  focusFrame(index,force=false){
    if(this.view!=='timeline'||!this.tree?.rows[index])return;
    const row=this.tree.rows[index],at=row.y*this.camera.scale+this.camera.y;
    if(force||at<90||at>this.height-100)this.camera.y=105-row.y*this.camera.scale;
    if(this.state.owner){
      const addresses=new Set([this.state.owner]);
      for(const w of this.tree.wallets)if(composition(this.state.replay.after,w.address).some(a=>a.ownerAddress===this.state.owner))addresses.add(w.address);
      for(const t of visibleTransactions(this.state.frames[index],this.state.owner)){addresses.add(t.from);addresses.add(t.to);}
      this.focusAddresses([...addresses]);
    }
    this.dirty=true;
  }
  focusAddresses(addresses){
    if(this.view!=='timeline'||!this.tree)return;
    const xs=addresses.map(a=>this.tree.columns.get(a)).filter(Number.isFinite);if(!xs.length)return;
    this.cameraTouched=true;this.resize();
    const left=Math.min(...xs),right=Math.max(...xs),room=Math.max(120,this.width-180);
    const scale=Math.min(this.camera.scale,room/Math.max(100,right-left+110));
    if(scale<this.camera.scale){const row=this.tree.rows[this.state.index];this.camera.y=105-row.y*scale;this.camera.scale=scale;}
    this.camera.x=(this.width-(left+right)*this.camera.scale)/2;this.dirty=true;
  }
  zoom(factor,x=this.width/2,y=this.height/2){
    const old=this.camera.scale,next=clamp(old*factor,.08,5);this.camera.x=x-(x-this.camera.x)*next/old;this.camera.y=y-(y-this.camera.y)*next/old;this.camera.scale=next;this.dirty=true;this.cameraTouched=true;
  }
  world(e){return {x:(e.offsetX-this.camera.x)/this.camera.scale,y:(e.offsetY-this.camera.y)/this.camera.scale};}
  down(e){
    if(!this.state)return;const point=this.world(e),node=this.nodes.find(n=>Math.hypot(n.x-point.x,n.y-point.y)<=n.radius+6/this.camera.scale);
    this.drag={id:e.pointerId,node:this.view==='network'?node:null,hit:node,startX:e.offsetX,startY:e.offsetY,point,camera:{...this.camera},moved:false};
    this.canvas.setPointerCapture(e.pointerId);this.canvas.classList.add('dragging');
  }
  move(e){
    if(!this.drag){const point=this.world(e);this.canvas.style.cursor=this.nodes.some(n=>Math.hypot(n.x-point.x,n.y-point.y)<n.radius+5)?'pointer':'grab';return;}
    const d=this.drag;if(d.id!==e.pointerId)return;
    if(Math.hypot(e.offsetX-d.startX,e.offsetY-d.startY)>4)d.moved=true;
    if(d.node){const point=this.world(e);this.positions.set(d.node.address,{x:point.x,y:point.y});}
    else{this.camera.x=d.camera.x+e.offsetX-d.startX;this.camera.y=d.camera.y+e.offsetY-d.startY;}
    this.dirty=true;this.cameraTouched=true;
  }
  up(e){
    const d=this.drag;if(!d||d.id!==e.pointerId)return;
    if(!d.moved){
      if(d.hit)this.selectWallet(d.hit.address,d.hit.frameIndex);
      else{
        const p=this.world(e),hit=this.edges.find(edge=>{
          let a=edge.points[0];for(let i=1;i<=20;i++){const b=bezier(...edge.points,i/20);if(distance(p,a,b)<8/this.camera.scale)return true;a=b;}return false;
        });if(hit)this.selectTransfer(hit.transaction.id,hit.frameIndex);
      }
    }
    this.drag=null;this.canvas.classList.remove('dragging');if(this.canvas.hasPointerCapture(e.pointerId))this.canvas.releasePointerCapture(e.pointerId);
  }
  draw(now,progress=1){
    if(!this.state||!this.width)return;const c=this.ctx,s=this.state;
    c.setTransform(this.dpr,0,0,this.dpr,0,0);c.clearRect(0,0,this.width,this.height);
    const glow=c.createRadialGradient(this.width*.5,this.height*.5,20,this.width*.5,this.height*.5,this.width*.65);glow.addColorStop(0,'#1e293b60');glow.addColorStop(1,'#12172200');c.fillStyle=glow;c.fillRect(0,0,this.width,this.height);
    c.save();c.translate(this.camera.x,this.camera.y);c.scale(this.camera.scale,this.camera.scale);
    this.nodes=[];this.edges=[];
    if(this.view==='network')this.drawNetwork(now,progress);else this.drawTimeline(now,progress);
    c.restore();
    if(this.view==='timeline')this.treeLabels();this.dirty=false;
  }
  label(text,x,y,size=12,colour='#8b98b2',align='center',screen=false){
    const c=this.ctx;c.font=`${screen?size:Math.max(size,7/this.camera.scale)}px Inter, system-ui, sans-serif`;c.textAlign=align;c.textBaseline='middle';c.fillStyle=colour;c.fillText(text,x,y);
  }
  path(points){const c=this.ctx;c.beginPath();c.moveTo(points[0].x,points[0].y);c.bezierCurveTo(points[1].x,points[1].y,points[2].x,points[2].y,points[3].x,points[3].y);}
  curve(from,to,bend=30){
    const dx=to.x-from.x,dy=to.y-from.y,d=Math.hypot(dx,dy)||1,offset=Math.min(bend,d*.15),a={x:from.x+dx/d*38,y:from.y+dy/d*38},b={x:to.x-dx/d*38,y:to.y-dy/d*38};
    return [a,{x:a.x+dx*.34-dy/d*offset,y:a.y+dy*.34+dx/d*offset},{x:b.x-dx*.34-dy/d*offset,y:b.y-dy*.34+dx/d*offset},b];
  }
  transfer(t,points,now,{active=true,alpha=1,frameIndex=this.state.index,progress=1}={}){
    const c=this.ctx,s=this.state,selected=s.selectedTransfer===t.id,forecast=t.status!=='CONFIRMED';
    const shares=s.owner?t.allocations.filter(a=>a.ownerAddress===s.owner):t.allocations;
    const colours=shares.length?shares.map(a=>s.colour(a.ownerAddress)):['#a98b66'];
    const warm=!s.owner&&(s.frames[frameIndex]?.period.type==='LEGACY'||['REBALANCE','RETURN','PAYOUT'].includes(t.kind));
    if(warm)colours.splice(0,colours.length,'#e0ae70');
    c.save();c.globalAlpha=alpha;c.lineCap='round';c.lineJoin='round';c.setLineDash(forecast?[7,6]:[]);
    for(const [i,colour] of colours.slice(0,6).entries()){
      c.strokeStyle=colour;c.lineWidth=selected?5:active?2.5:1.1;
      if(active){c.shadowColor=colour;c.shadowBlur=selected?17:9;}
      const shift=(i-(Math.min(6,colours.length)-1)/2)*2.8;
      const shifted=points.map(p=>({x:p.x,y:p.y+shift}));this.path(shifted);c.stroke();
      if(active&&s.playing&&!s.reducedMotion){
        const phase=(progress*.85+i*.13)%1,point=bezier(...shifted,phase);
        c.setLineDash([]);c.beginPath();c.arc(point.x,point.y,3.3,0,Math.PI*2);c.fillStyle=colour;c.fill();c.setLineDash(forecast?[7,6]:[]);
      }
    }
    c.shadowBlur=0;c.setLineDash([]);const end=bezier(...points,.97),prev=bezier(...points,.91),angle=Math.atan2(end.y-prev.y,end.x-prev.x);
    if(active){c.fillStyle=colours[0];c.beginPath();c.moveTo(end.x,end.y);c.lineTo(end.x-8*Math.cos(angle-.45),end.y-8*Math.sin(angle-.45));c.lineTo(end.x-8*Math.cos(angle+.45),end.y-8*Math.sin(angle+.45));c.closePath();c.fill();}
    if(selected||active&&s.owner){
      const point=bezier(...points,.5),amount=s.owner?shares.reduce((n,a)=>n+a.amountSun,0):t.amountSun;
      c.fillStyle='#141a27e8';c.beginPath();c.roundRect(point.x-38,point.y-12,76,24,6);c.fill();this.label(t.attribution==='UNKNOWN'?'Unknown share':formatSun(amount,6),point.x,point.y,10,colours[0]);
    }
    c.restore();if(active)this.edges.push({transaction:t,points,frameIndex});
  }
  ring(state,address,x,y,radius,{label=true,frameIndex=this.state.index,alpha=1}={}){
    const s=this.state,c=this.ctx,shares=composition(state,address),total=shares.reduce((n,a)=>n+a.amountSun,0),wallet=s.wallets.get(address);
    const selected=s.selectedWallet===address,focused=s.owner&&shares.some(a=>a.ownerAddress===s.owner);
    c.save();c.globalAlpha=alpha;c.beginPath();c.arc(x,y,radius,0,Math.PI*2);c.fillStyle=selected?'#283d43':'#1b2334';c.fill();
      c.strokeStyle=selected?'#d0ffe9':'#3b4861';c.lineWidth=1.2;c.stroke();
    let angle=-Math.PI/2;
    for(const a of shares){const part=a.amountSun/total*Math.PI*2,gap=Math.min(.015,part*.2);c.beginPath();c.arc(x,y,radius+4,angle+gap,angle+part-gap);c.strokeStyle=s.colour(a.ownerAddress);c.lineWidth=focused&&a.ownerAddress===s.owner?7:4;c.globalAlpha=alpha*(s.owner&&a.ownerAddress!==s.owner ? 0.22 : 1);c.stroke();angle+=part;}
    c.globalAlpha=alpha;
    if(focused){c.beginPath();c.arc(x,y,radius+13,0,Math.PI*2);c.strokeStyle=s.colour(s.owner)+'44';c.lineWidth=1;c.stroke();}
    if(label){this.label(wallet?.role==='teacher'?'T':String((wallet?.ordinal??0)+1),x,y-3,19,selected?'#eafff8':'#dae2f2');
      this.label(s.replay.issue?'? TRX':formatSun(total,3)+' TRX',x,y+15,8,total?'#91a5c3':'#566784');
      this.label(wallet?.label??address,x,y+radius+24,10,'#8999b6');
    }
    c.restore();this.nodes.push({address,x,y,radius:radius+6,frameIndex});
  }
  drawNetwork(now,progress){
    const c=this.ctx,s=this.state;c.fillStyle='#50627b25';
    for(let x=40;x<=960;x+=40)for(let y=30;y<=750;y+=40){c.beginPath();c.arc(x,y,.8,0,Math.PI*2);c.fill();}
    const current=s.frames[s.index];if(!current)return;
    if(s.trails){
      const previous=s.frames.slice(current.periodStart,s.index).flatMap(f=>visibleTransactions(f,s.owner)).slice(s.owner?-90:-30);
      for(const t of previous){const from=this.positions.get(t.from),to=this.positions.get(t.to);if(from&&to)this.transfer(t,this.curve(from,to),now,{active:false,alpha:s.owner ? 0.2 : 0.055});}
    }
    for(const t of visibleTransactions(current,s.owner)){
      const from=this.positions.get(t.from),to=this.positions.get(t.to);if(from&&to)this.transfer(t,this.curve(from,to),now,{alpha:t.status==='CONFIRMED'?.8:.65,progress});
    }
    const shown=new Map(s.replay.after);
    if(s.playing&&!s.replay.issue&&progress<1){for(const [key,after] of shown){const before=s.replay.before.get(key)??0;shown.set(key,Math.round(before+(after-before)*progress));}
      for(const [key,before] of s.replay.before)if(!shown.has(key))shown.set(key,Math.round(before*(1-progress)));}
    for(const w of s.data.wallets){const pos=this.positions.get(w.address);if(!pos)continue;
      const active=current.period.initial.some(p=>p.ownerAddress===w.address)||composition(shown,w.address).length>0||w.role==='teacher'&&s.data.transactions.some(t=>t.periodId===current.period.id&&t.to===w.address&&t.kind==='PAYOUT');
      if(w.role==='teacher'&&!active)continue;
      const focus=s.owner&&(w.address===s.owner||composition(shown,w.address).some(a=>a.ownerAddress===s.owner)||visibleTransactions(current,s.owner).some(t=>t.from===w.address||t.to===w.address));
      this.ring(shown,w.address,pos.x,pos.y,31,{alpha:!active ? 0.25 : s.owner&&!focus ? 0.38 : 1});
    }
    if(s.owner){this.label('FOLLOWING THE ORIGINAL STAKE',500,353,9,'#7586a6');this.label(s.wallets.get(s.owner)?.label??'',500,380,24,s.colour(s.owner));this.label('1 TRX · across the network',500,407,10,'#788ca9');}
    else{this.label('SHARED FUNDS',500,371,9,'#657a98');this.label(current.period.initial.length+' stakes',500,395,22,'#adbcd3');}
  }
  holding(stock,address,from,to,{alpha=.35,forecast=false}={}){
    const c=this.ctx,s=this.state,shares=composition(stock,address).filter(a=>!s.owner||a.ownerAddress===s.owner);
    for(const [i,a] of shares.entries()){
      c.save();c.globalAlpha=alpha;c.strokeStyle=s.colour(a.ownerAddress);c.lineWidth=s.owner?Math.max(1.5,a.amountSun/1_000_000*4):1.2;
      c.setLineDash(forecast?[5,5]:[]);c.beginPath();c.moveTo(from.x+i*2,from.y);c.lineTo(to.x+i*2,to.y);c.stroke();c.restore();
    }
  }
  treeNode(f,stock,address,x,y,index,issue){
    const c=this.ctx,s=this.state,w=s.wallets.get(address),shares=composition(stock,address),total=shares.reduce((n,a)=>n+a.amountSun,0);
    const own=shares.find(a=>a.ownerAddress===s.owner),selected=s.selectedWallet===address;
    const alpha=s.owner&&!own&&address!==s.owner?.3:1;
    c.save();c.globalAlpha=alpha;c.beginPath();c.arc(x,y,32,0,Math.PI*2);c.fillStyle=selected?'#2d4245':'#1a2334';c.fill();c.strokeStyle=selected?'#ddfff2':'#3a4963';c.lineWidth=selected?2:1;c.stroke();
    let angle=-Math.PI/2;
    for(const a of shares){const part=a.amountSun/Math.max(1,total)*Math.PI*2,gap=Math.min(.01,part*.2);c.beginPath();c.arc(x,y,36,angle+gap,angle+part-gap);c.strokeStyle=s.colour(a.ownerAddress);c.globalAlpha=alpha*(s.owner&&a.ownerAddress!==s.owner ? .2 : 1);c.lineWidth=4;c.stroke();angle+=part;}
    c.globalAlpha=alpha;this.label(w.role==='teacher'?'T':String(w.ordinal+1),x,y-7,19,'#e8eef9');this.label(w.address.slice(-3),x,y+14,11,'#a8b8d4');
    this.label(issue?'Unknown balance':formatSun(total,6)+' TRX',x,y+54,11,'#c5d5e9');
    const visible=(s.owner?shares.filter(a=>a.ownerAddress===s.owner):shares).slice().sort((a,b)=>b.amountSun-a.amountSun);
    for(const [i,a] of visible.slice(0,3).entries())this.label(`${s.wallets.get(a.ownerAddress)?.ordinal+1}: ${formatSun(a.amountSun,6)}`,x,y+73+i*15,9,s.colour(a.ownerAddress));
    if(visible.length>3)this.label('+'+(visible.length-3)+' more stakes',x,y+120,8,'#8799b5');
    c.restore();this.nodes.push({address,x,y,radius:40,frameIndex:index});
  }
  drawTransition(index,now,progress){
    const s=this.state,f=s.frames[index],row=this.tree.rows[index];if(index===0)return;
    if(f.boundary){
      if(f.period.continuity==='CARRIED'&&!s.replayAt(index).issue)for(const w of this.tree.wallets)this.holding(s.replayAt(index).after,w.address,{x:this.tree.columns.get(w.address),y:row.previousY+43},{x:this.tree.columns.get(w.address),y:row.y-42},{alpha:s.owner?.65:.18});
      return;
    }
    const before=s.replayAt(index),stock=new Map(before.before),tracked=new Set(f.period.initial.map(a=>a.ownerAddress));
    const positions=new Map(this.tree.wallets.map(w=>[w.address,{x:this.tree.columns.get(w.address),y:row.previousY+43}]));
    const bandStart=row.previousY+132,bandEnd=row.y-52,slot=(bandEnd-bandStart)/Math.max(1,f.events.length);
    let known=!s.replayAt(index-1).issue;
    for(const [j,t] of f.events.entries()){
      const oldFrom=positions.get(t.from),oldTo=positions.get(t.to);if(!oldFrom||!oldTo)continue;
      const y=bandStart+slot*(j+.25),from={x:oldFrom.x,y},to={x:oldTo.x,y:y+Math.min(3,slot*.3)};
      const toBefore=new Map(stock),issue=known?applyMovement(stock,t,tracked):'unknown';if(issue)known=false;
      if(known){this.holding(stock,t.from,oldFrom,from,{alpha:s.owner?.65:.2,forecast:f.forecast});this.holding(toBefore,t.to,oldTo,to,{alpha:s.owner?.65:.2,forecast:f.forecast});}
      const relevant=!s.owner||t.allocations.some(a=>a.ownerAddress===s.owner)||t.attribution==='UNKNOWN';
      if(relevant){
        const points=[oldFrom,{x:oldFrom.x,y:oldFrom.y+(to.y-oldFrom.y)*.43},{x:to.x,y:to.y-Math.max(10,(to.y-oldFrom.y)*.3)},to];
        this.transfer(t,points,now,{active:index===s.index,alpha:index===s.index?.95:t.status==='CONFIRMED'?.58:.24,frameIndex:index,progress});
        if(index!==s.index)this.edges.push({transaction:t,points,frameIndex:index});
        this.ctx.beginPath();this.ctx.arc(to.x,to.y,2.5,0,Math.PI*2);this.ctx.fillStyle=t.attribution==='UNKNOWN'?'#ad8c68':s.colour(s.owner??t.allocations[0]?.ownerAddress);this.ctx.fill();
      }
      positions.set(t.from,from);positions.set(t.to,to);
    }
    if(known)for(const w of this.tree.wallets)this.holding(stock,w.address,positions.get(w.address),{x:this.tree.columns.get(w.address),y:row.y-42},{alpha:s.owner?.65:.18,forecast:f.forecast});
  }
  drawTimeline(now,progress){
    const c=this.ctx,s=this.state;if(!this.tree?.rows.length)return;
    const top=-this.camera.y/this.camera.scale,bottom=(this.height-this.camera.y)/this.camera.scale;
    let first=this.tree.rows.findIndex(r=>r.y>=top-150);if(first<0)first=this.tree.rows.length-1;first=Math.max(0,first-1);
    const last=this.tree.rows.findIndex(r=>r.previousY!==null&&r.previousY>bottom+150),end=last<0?this.tree.rows.length:last;
    for(let index=first;index<end;index++)this.drawTransition(index,now,progress);
    for(let index=first;index<end;index++){
      const row=this.tree.rows[index],f=s.frames[index],at=s.replayAt(index),active=index===s.index;
      c.beginPath();c.moveTo(0,row.y);c.lineTo(this.tree.width,row.y);c.strokeStyle=f.boundary?'#8d739644':active?'#9ae8cb40':'#52648218';c.setLineDash(f.boundary?[7,7]:[]);c.lineWidth=1;c.stroke();c.setLineDash([]);
      for(const w of this.tree.wallets){const x=this.tree.columns.get(w.address),screenX=x*this.camera.scale+this.camera.x;
        if(screenX<-80||screenX>this.width+80)continue;this.treeNode(f,at.after,w.address,x,row.y,index,at.issue);}
    }
  }
  treeLabels(){
    const c=this.ctx,s=this.state;c.save();c.fillStyle='#141a27f2';c.fillRect(0,0,98,this.height);c.fillRect(0,0,this.width,43);
    for(const w of this.tree.wallets){const x=this.tree.columns.get(w.address)*this.camera.scale+this.camera.x;if(x<95||x>this.width+50)continue;
      this.label(w.label+' · '+w.address.slice(-3),x,20,10,'#9eafcc','center',true);}
    for(const row of this.tree.rows){const y=row.y*this.camera.scale+this.camera.y;if(y<45||y>this.height+70)continue;
      const f=s.frames[row.index];this.label(f.boundary?(f.period.continuity==='CARRIED'?'CARRIED':'START'):f.label.length>14?f.label.slice(0,14):f.label,12,y-7,10,row.index===s.index?'#a4ebd1':'#9eabc3','left',true);
      this.label(f.period.label.slice(0,14),12,y+11,8,'#7285a4','left',true);if(f.forecast)this.label('FORECAST',12,y+29,7,'#b49bd6','left',true);
    }
    c.restore();
  }
  destroy(){this.observer.disconnect();this.abort.abort();}
}
