import {normaliseDataset,initialState,applyMovement} from '../public/model.js';
const encoder=new TextEncoder();
export const MAX_UPLOAD_BYTES=12*1024*1024;
const currentKey='flow-atlas/current.json';
const hex=bytes=>[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
const unhex=value=>new Uint8Array(value.match(/.{2}/g).map(v=>parseInt(v,16)));
const equal=(a,b)=>{let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a[i]??0)^(b[i]??0);return diff===0;};
const response=(body,status=200,extra={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
export async function verifyPassword(password,verifier){
  if(typeof password!=='string'||password.length<1||password.length>256||typeof verifier!=='string')return false;
  const parts=verifier.split(':');
  if(parts.length!==4||parts[0]!=='pbkdf2-sha256'||!/^\d+$/.test(parts[1])||! /^[a-f0-9]{32}$/.test(parts[2])||! /^[a-f0-9]{64}$/.test(parts[3]))return false;
  const iterations=Number(parts[1]);if(iterations<100_000||iterations>100_000)return false;
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  const result=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:unhex(parts[2]),iterations},key,256);
  return equal(new Uint8Array(result),unhex(parts[3]));
}
async function readLimited(request,limit=MAX_UPLOAD_BYTES){
  const advertised=Number(request.headers.get('content-length'));if(advertised>limit)throw new Error('UPLOAD_TOO_LARGE');
  if(!request.body)throw new Error('EMPTY_BODY');
  const reader=request.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let bytes=0,text='';
  while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;
    if(bytes>limit){await reader.cancel();throw new Error('UPLOAD_TOO_LARGE');}text+=decoder.decode(chunk.value,{stream:true});}
  return text+decoder.decode();
}
/** Validate the complete saved SMART ledger in immutable sequence, rather than
 * trusting editable forecast dates. Unknown legacy ownership stays explicit. */
export function validateSnapshot(raw){
  const data=normaliseDataset(raw);
  for(const period of data.periods){
    if(period.type==='LEGACY'||period.coverage==='PARTIAL')continue;
    const state=initialState(period),tracked=new Set(period.initial.map(p=>p.ownerAddress));
    for(const t of data.transactions.filter(t=>t.periodId===period.id).sort((a,b)=>a.sequence-b.sequence)){
      const issue=applyMovement(state,t,tracked);if(issue)throw Error(issue);
    }
  }
  return data;
}
export function createHandler(assets){
  const attempts=new Map();
  const asset=path=>assets.get(path);
  return {
    async fetch(request,env={},ctx={}){
      try{
      const url=new URL(request.url),path=url.pathname;
      const uploadLimit=Number.isSafeInteger(env.MAX_UPLOAD_BYTES)&&env.MAX_UPLOAD_BYTES>0?Math.min(env.MAX_UPLOAD_BYTES,MAX_UPLOAD_BYTES):MAX_UPLOAD_BYTES;
      const passwordConfigured=/^pbkdf2-sha256:100000:[a-f0-9]{32}:[a-f0-9]{64}$/.test(env.FLOW_PUBLISH_AUTH??'');
      const setupMessage=env.SETUP_MESSAGE??(!env.BUCKET?'This Flow instance needs its own persistent storage before publishing.':!passwordConfigured?'Set FLOW_PUBLISH_AUTH to the server verifier from flow-atlas-admin.txt. Enter the actual password only in Admin upload.':null);
      if(path==='/api/status'&&request.method==='GET')return response({publishingEnabled:Boolean(env.BUCKET&&passwordConfigured),maxUploadBytes:uploadLimit,setupMessage});
      if(path==='/api/admin/publish'&&!['POST','PUT'].includes(request.method))return response({error:'This is the Flow publishing endpoint. Use POST or PUT with the publishing password and current snapshot revision.'},405,{Allow:'POST, PUT'});
      if(path==='/api/snapshot'&&['GET','HEAD'].includes(request.method)){
        if(!env.BUCKET)return response({dataset:JSON.parse(asset('/dataset.json').body),revision:'demo',publishedAt:null,source:'unconfigured',setupMessage});
        try{
          const object=await env.BUCKET.get(currentKey);
          if(!object){const data=JSON.parse(asset('/dataset.json').body);return response({dataset:data,revision:'demo',publishedAt:null,source:'bundled'});}
          const saved=await object.json();
          return response({dataset:saved.dataset,revision:object.etag,publishedAt:saved.publishedAt,source:'published'},200,{'ETag':object.httpEtag});
        }catch{return response({error:'Cannot read the shared snapshot. Retry shortly.'},503);}
      }
      if(path==='/api/admin/publish'&&['POST','PUT'].includes(request.method)){
        if(!env.BUCKET||!passwordConfigured)return response({error:setupMessage??'Publishing is not configured on this Flow instance.'},503);
        if(request.headers.get('origin')!==url.origin)return response({error:'Publish from the same website.'},403);
        if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return response({error:'Upload a public JSON snapshot.'},415);
        const ip=request.headers.get('cf-connecting-ip')??'shared-client',now=Date.now();
        const attempt=attempts.get(ip);if(attempt&&now<attempt.until&&attempt.count>=8)return response({error:'Too many attempts. Wait one minute.'},429,{'Retry-After':'60'});
        attempts.set(ip,{count:attempt&&now<attempt.until?attempt.count+1:1,until:attempt&&now<attempt.until?attempt.until:now+60_000});
        if(attempts.size>1000)attempts.delete(attempts.keys().next().value);
        if(!await verifyPassword(request.headers.get('x-flow-password'),env.FLOW_PUBLISH_AUTH))return response({error:'Invalid publishing password.'},401);
        attempts.delete(ip);
        const expected=request.headers.get('if-match');
        if(expected!=='demo'&&!/^[a-f0-9]{32}$/.test(expected??''))return response({error:'Reload the shared snapshot before publishing.'},428);
        let data;
        try{data=validateSnapshot(JSON.parse(await readLimited(request,uploadLimit)));}
        catch(e){return response({error:e.message==='UPLOAD_TOO_LARGE'?`JSON exceeds this Flow host’s ${Math.floor(uploadLimit/1_000_000)} MB upload limit.`:'Snapshot rejected: '+e.message},e.message==='UPLOAD_TOO_LARGE'?413:422);}
        try{
          const current=await env.BUCKET.get(currentKey);
          if((current?.etag??'demo')!==expected)return response({error:'The public snapshot changed. Reload before replacing it.'},409);
          if(current)await env.BUCKET.put('flow-atlas/versions/'+current.etag+'.json',await current.text(),{httpMetadata:{contentType:'application/json'}});
          const publishedAt=new Date().toISOString(),saved={publishedAt,dataset:data};
          const condition=new Headers(expected==='demo'?{'If-None-Match':'*'}:{'If-Match':'"'+expected+'"'});
          const stored=await env.BUCKET.put(currentKey,JSON.stringify(saved),{onlyIf:condition,httpMetadata:{contentType:'application/json',cacheControl:'no-store'}});
          if(!stored)return response({error:'Another upload completed first. Reload before publishing.'},409);
          return response({ok:true,revision:stored.etag,publishedAt,transactions:data.transactions.length,periods:data.periods.length});
        }catch{return response({error:'The upload could not be saved. The previous public snapshot is retained; reload to verify.'},503);}
      }
      if(path.startsWith('/api/'))return response({error:'Not found.'},404);
      if(!['GET','HEAD'].includes(request.method))return response({error:'Method not allowed.'},405,{'Allow':'GET, HEAD'});
      const value=asset(path==='/'?'/index.html':path);
      if(!value)return new Response('Not found',{status:404});
      return new Response(request.method==='HEAD'?null:value.body,{headers:{'Content-Type':value.type,'Cache-Control':path.endsWith('.json')?'no-store':'public, max-age=0, must-revalidate','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'}});
      }catch(error){console.error('Flow Atlas API failure: '+(error?.name??'Error'));return response({error:'The snapshot service encountered an error. Retry Refresh before another upload.'},500);}
    }
  };
}
export default {fetch(){return new Response('Build the Worker before deploying.',{status:503});}};
