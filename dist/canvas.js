import {composition,formatSun,visibleTransactions} from './model.js';
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const bezier=(a,b,c,d,t)=>({x:(1-t)**3*a.x+3*(1-t)**2*t*b.x+3*(1-t)*t*t*c.x+t**3*d.x,y:(1-t)**3*a.y+3*(1-t)**2*t*b.y+3*(1-t)*t*t*c.y+t**3*d.y});
const distance=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy,t=len?clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/len,0,1):0;return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};

export class FlowCanvas{
  constructor(canvas,{selectWallet,selectTransfer}){
    this.canvas=canvas;this.ctx=canvas.getContext('2d');this.selectWallet=selectWallet;this.selectTransfer=selectTransfer;
    this.positions=new Map();this.camera={x:0,y:0,scale:1};this.nodes=[];this.edges=[];this.width=0;this.height=0;this.view='network';
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(canvas.parentElement);
    this.abort=new AbortController();const signal=this.abort.signal;
    canvas.addEventListener('wheel',e=>{e.preventDefault();this.zoom(Math.exp(-e.deltaY*.001),e.offsetX,e.offsetY);},{passive:false,signal});
    canvas.addEventListener('pointerdown',e=>this.down(e),{signal});
    canvas.addEventListener('pointermove',e=>this.move(e),{signal});
    canvas.addEventListener('pointerup',e=>this.up(e),{signal});
    canvas.addEventListener('pointercancel',()=>{this.drag=null;canvas.classList.remove('dragging');},{signal});
  }
  setState(state){
    const reset=!this.state||this.state.data!==state.data;
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
      const scale=Math.min(1,(this.height-30)/((this.state?.data.wallets.length??17)*57+170));
      this.camera={scale,x:120,y:25};
      if(this.state){const target=Math.max(0,this.state.index-3)*145;this.camera.x=125-target*scale;}
    }else{const scale=Math.min((this.width-45)/930,(this.height-25)/775);this.camera={scale,x:(this.width-1000*scale)/2,y:(this.height-780*scale)/2};}
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
    if(this.view==='timeline')this.laneLabels();this.dirty=false;
  }
  label(text,x,y,size=12,colour='#8b98b2',align='center'){
    const c=this.ctx;c.font=`${Math.max(size,7/this.camera.scale)}px Inter, system-ui, sans-serif`;c.textAlign=align;c.textBaseline='middle';c.fillStyle=colour;c.fillText(text,x,y);
  }
  path(points){const c=this.ctx;c.beginPath();c.moveTo(points[0].x,points[0].y);c.bezierCurveTo(points[1].x,points[1].y,points[2].x,points[2].y,points[3].x,points[3].y);}
  curve(from,to,bend=30){
    const dx=to.x-from.x,dy=to.y-from.y,d=Math.hypot(dx,dy)||1,offset=Math.min(bend,d*.15),a={x:from.x+dx/d*38,y:from.y+dy/d*38},b={x:to.x-dx/d*38,y:to.y-dy/d*38};
    return [a,{x:a.x+dx*.34-dy/d*offset,y:a.y+dy*.34+dx/d*offset},{x:b.x-dx*.34-dy/d*offset,y:b.y-dy*.34+dx/d*offset},b];
  }
  transfer(t,points,now,{active=true,alpha=1,frameIndex=this.state.index,progress=1}={}){
    const c=this.ctx,s=this.state,selected=s.selectedTransfer===t.id,forecast=t.status!=='CONFIRMED';
    const shares=s.owner?t.allocations.filter(a=>a.ownerAddress===s.owner):t.allocations;
    const colours=shares.length?shares.map(a=>s.colour(a.ownerAddress)):['#7f8ca7'];
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
      c.fillStyle='#141a27e8';c.beginPath();c.roundRect(point.x-38,point.y-12,76,24,6);c.fill();this.label(formatSun(amount,6),point.x,point.y,10,colours[0]);
    }
    c.restore();if(active)this.edges.push({transaction:t,points,frameIndex});
  }
  ring(state,address,x,y,radius,{label=true,frameIndex=this.state.index,alpha=1}={}){
    const s=this.state,c=this.ctx,shares=composition(state,address),total=shares.reduce((n,a)=>n+a.amountSun,0),wallet=s.wallets.get(address);
    const selected=s.selectedWallet===address,focused=s.owner&&shares.some(a=>a.ownerAddress===s.owner);
    c.save();c.globalAlpha=alpha;c.beginPath();c.arc(x,y,radius,0,Math.PI*2);c.fillStyle=selected?'#283d43':'#1b2334';c.fill();
      c.strokeStyle=selected?'#d0ffe9':'#3b4861';c.lineWidth=1.2;c.stroke();
    let angle=-Math.PI/2;
    for(const a of shares){const part=a.amountSun/total*Math.PI*2;c.beginPath();c.arc(x,y,radius+4,angle+.015,angle+part-.015);c.strokeStyle=s.colour(a.ownerAddress);c.lineWidth=focused&&a.ownerAddress===s.owner?7:4;c.globalAlpha=alpha*(s.owner&&a.ownerAddress!==s.owner ? 0.22 : 1);c.stroke();angle+=part;}
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
  drawTimeline(now,progress){
    const c=this.ctx,s=this.state,rows=s.data.wallets,byAddress=new Map(rows.map((w,i)=>[w.address,115+i*57]));
    const left=(-this.camera.x)/this.camera.scale,right=(this.width-this.camera.x)/this.camera.scale;
    for(const [i,w] of rows.entries()){
      const y=115+i*57;c.beginPath();c.moveTo(Math.max(0,left),y);c.lineTo(right,y);c.strokeStyle='#50617e30';c.lineWidth=1;c.stroke();
    }
    const from=Math.max(0,Math.floor((left-200)/145)),to=Math.min(s.frames.length,Math.ceil(right/145)+1);
    for(let index=from;index<to;index++){
      const f=s.frames[index],x=80+index*145,active=index===s.index,past=index<=s.index;
      const balances=s.replayAt(index);
      if(!f.boundary&&!balances.issue){
        // Horizontal coloured holdings connect the native arrows across days.
        // These segments are labelled by the wallet lanes, never counted as TX.
        for(const [i,w] of rows.entries()){
          const y=115+i*57;
          for(const [stock,x1,x2] of [[balances.before,x-72,x],[balances.after,x,x+73]]){
            const shares=composition(stock,w.address).filter(a=>!s.owner||a.ownerAddress===s.owner);
            for(const [j,a] of shares.entries()){
              c.save();c.strokeStyle=s.colour(a.ownerAddress);c.globalAlpha=past?(s.owner?0.48:0.1):0.06;
              c.lineWidth=s.owner?Math.max(1,a.amountSun/1_000_000*4):1;c.beginPath();c.moveTo(x1,y+j*1.5);c.lineTo(x2,y+j*1.5);c.stroke();c.restore();
            }
          }
        }
      }
      c.beginPath();c.moveTo(x,70);c.lineTo(x,115+rows.length*57);c.strokeStyle=active?'#8cf1c550':'#50617e1f';c.lineWidth=active?2:1;c.stroke();
      this.label(f.boundary?'START':f.label.length>22?f.label.slice(0,22):f.label,x,35,10,active?'#b9ead7':'#8c9bb6');
      this.label(f.period.label+(f.forecast?' · forecast':''),x,55,8,f.forecast?'#ae9cd2':'#647590');
      if(f.boundary){
        for(const p of f.period.initial){const y=byAddress.get(p.holderAddress);if(y!==undefined){c.beginPath();c.arc(x,y,7,0,Math.PI*2);c.fillStyle=s.colour(p.ownerAddress);c.fill();this.nodes.push({address:p.holderAddress,x,y,radius:9,frameIndex:index});}}
        continue;
      }
      const events=visibleTransactions(f,s.owner);
      for(const [i,t] of events.entries()){
        const y1=byAddress.get(t.from),y2=byAddress.get(t.to);if(y1===undefined||y2===undefined)continue;
        const dx=events.length>1?i/(events.length-1)*70:20,start=x-42+dx,end=start+55;
        const points=[{x:start,y:y1},{x:start+40,y:y1},{x:end-40,y:y2},{x:end,y:y2}];
        this.transfer(t,points,now,{active,alpha:active ? 0.9 : past ? (s.owner ? 0.65 : 0.24) : 0.12,frameIndex:index,progress});
        if(!active)this.edges.push({transaction:t,points,frameIndex:index});
        const colour=s.colour(s.owner??t.allocations[0]?.ownerAddress);c.fillStyle=colour;c.globalAlpha=active?1:past ? 0.6 : 0.18;
        for(const p of [points[0],points[3]]){c.beginPath();c.arc(p.x,p.y,active?4:2.5,0,Math.PI*2);c.fill();}c.globalAlpha=1;
        this.nodes.push({address:t.from,...points[0],radius:6,frameIndex:index},{address:t.to,...points[3],radius:6,frameIndex:index});
      }
    }
    const at=80+s.index*145;this.label('CURRENT FRAME',at,92,7,'#a2d5c2');
  }
  laneLabels(){
    const c=this.ctx,s=this.state;c.save();c.fillStyle='#141a27f5';c.fillRect(0,0,102,this.height);
    for(const [i,w] of s.data.wallets.entries()){
      const y=(115+i*57)*this.camera.scale+this.camera.y;if(y<0||y>this.height)continue;
      c.beginPath();c.arc(17,y,3,0,Math.PI*2);c.fillStyle=s.colour(w.address);c.fill();this.label(w.label,28,y,9,'#9aabc5','left');
    }
    c.restore();
  }
  destroy(){this.observer.disconnect();this.abort.abort();}
}
