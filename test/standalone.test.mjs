import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {pbkdf2Sync} from 'node:crypto';
import {createVercelApp,VERCEL_UPLOAD_BYTES} from '../server/vercel-app.js';
import {vercelBucket} from '../server/vercel-bucket.js';
import {fileBucket} from '../scripts/file-bucket.mjs';
import {createHandler} from '../worker/index.js';
import {BlobError,BlobPreconditionFailedError} from '@vercel/blob';
const text=await readFile(new URL('../public/dataset.json',import.meta.url),'utf8'),data=JSON.parse(text);
const password='TEST-ONLY-FLOW-PASSWORD',salt='0123456789abcdef0123456789abcdef';
const verifier='pbkdf2-sha256:100000:'+salt+':'+pbkdf2Sync(password,Buffer.from(salt,'hex'),100000,32,'sha256').toString('hex');
function fakeSdk(){
  const files=new Map(),calls=[];let next=0;
  return {files,calls,BlobError,BlobPreconditionFailedError,async get(key,options){calls.push({kind:'get',key,options});const found=files.get(options.token+':'+key);return found?{statusCode:200,stream:new Response(found.body).body,blob:{etag:found.etag}}:null;},
    async put(key,body,options){
      calls.push({kind:'put',key,options});const name=options.token+':'+key,current=files.get(name);
      if(current&&!options.allowOverwrite)throw new BlobError('This blob already exists.');
      if(options.ifMatch&&options.ifMatch!==current?.etag)throw new BlobPreconditionFailedError();
      const etag='"provider-etag-'+(++next)+'"';files.set(name,{body,etag});return {etag};
    }};
}
function app(sdk,token='TEST-ONLY-STORAGE'){
  const environment={BLOB_READ_WRITE_TOKEN:token,FLOW_PUBLISH_AUTH:verifier};
  Object.defineProperty(environment,'FLOW_API_ORIGIN',{get(){throw Error('A standalone Flow must not use another API origin.');}});
  return createVercelApp({environment,loadSdk:async()=>sdk,readBundled:async()=>text});
}
async function call(handle,path='/api/snapshot',{method='GET',body,headers={}}={}){
  const req={url:path,method,body,headers:{host:'analytics.example',origin:'https://analytics.example','content-type':'application/json',...headers}};
  let raw;const response={headers:{},statusCode:200,setHeader(key,value){this.headers[key.toLowerCase()]=value;},end(value){raw=Buffer.from(value??'').toString();}};
  await handle(req,response);return {status:response.statusCode,headers:response.headers,body:JSON.parse(raw)};
}
const publish=(handle,revision='demo',snapshot=data)=>call(handle,'/api/admin/publish',{method:'POST',body:snapshot,headers:{'x-flow-password':password,'if-match':revision}});
test('an unconfigured Vercel copy shows its bundled demo and an actionable local setup message without contacting any server',async t=>{
  t.mock.method(globalThis,'fetch',()=>{throw Error('No other application may be contacted.');});
  const handle=createVercelApp({environment:{},readBundled:async()=>text,loadSdk:async()=>{throw Error('Storage SDK must not load without its own token.');}});
  const page=await call(handle);assert.equal(page.status,200);assert.equal(page.body.source,'unconfigured');assert.equal(page.body.dataset.demo,true);assert.match(page.body.setupMessage,/this Flow Vercel project/);
  const status=await call(handle,'/api/status');assert.equal(status.body.publishingEnabled,false);assert.equal(status.body.maxUploadBytes,VERCEL_UPLOAD_BYTES);
  assert.equal((await publish(handle)).status,503);
});
test('the Vercel API publishes and reads its own private storage across server instances, without a proxy',async t=>{
  t.mock.method(globalThis,'fetch',()=>{throw Error('No mixer or other Flow may be contacted.');});
  const sdk=fakeSdk(),handle=app(sdk);
  assert.equal((await call(handle,'/api/status')).body.publishingEnabled,true);
  const bad=await call(handle,'/api/admin/publish',{method:'POST',body:data,headers:{'x-flow-password':'wrong','if-match':'demo'}});assert.equal(bad.status,401);assert.equal(sdk.files.size,0);
  const saved=await publish(handle);assert.equal(saved.status,200);assert.match(saved.body.revision,/^[a-f0-9]{32}$/);
  const fresh=await call(app(sdk));assert.equal(fresh.body.source,'published');assert.equal(fresh.body.revision,saved.body.revision);assert.equal(fresh.body.dataset.transactions.length,data.transactions.length);
  assert(sdk.calls.filter(c=>c.kind==='get').every(c=>c.options.access==='private'&&c.options.useCache===false));
  assert(sdk.calls.filter(c=>c.kind==='put').every(c=>c.options.access==='private'));
});
test('separate Flow storage tokens produce independent instances',async()=>{
  const sdk=fakeSdk();assert.equal((await publish(app(sdk,'TEST-ONLY-STORE-A'))).status,200);
  const other=await call(app(sdk,'TEST-ONLY-STORE-B'));assert.equal(other.body.revision,'demo');assert.equal(other.body.source,'bundled');
});
test('a password pasted instead of its server verifier gives a setup error without accepting an upload',async()=>{
  const sdk=fakeSdk(),handle=createVercelApp({environment:{BLOB_READ_WRITE_TOKEN:'TEST-ONLY-STORAGE',FLOW_PUBLISH_AUTH:password},loadSdk:async()=>sdk,readBundled:async()=>text});
  const info=await call(handle,'/api/status');assert.equal(info.body.publishingEnabled,false);assert.match(info.body.setupMessage,/server verifier/);
  assert.equal((await publish(handle)).status,503);assert.equal(sdk.files.size,0);
});
test('concurrent first uploads and later replacements preserve atomic revision checks',async()=>{
  const sdk=fakeSdk();const first=await Promise.all([publish(app(sdk)),publish(app(sdk))]);assert.deepEqual(first.map(r=>r.status).sort(),[200,409]);
  const revision=first.find(r=>r.status===200).body.revision;
  const next=await Promise.all([publish(app(sdk),revision,{...data,title:'Variant A'}),publish(app(sdk),revision,{...data,title:'Variant B'})]);assert.deepEqual(next.map(r=>r.status).sort(),[200,409]);
  assert(sdk.calls.some(c=>c.kind==='put'&&c.options.ifMatch?.startsWith('"provider-etag-')));
});
test('same-origin auth, payload limits and unavailable storage fail without replacing data',async()=>{
  const sdk=fakeSdk(),handle=app(sdk),saved=await publish(handle);assert.equal(saved.status,200);
  assert.equal((await call(handle,'/api/admin/publish',{method:'POST',body:data,headers:{origin:'https://elsewhere.example','x-flow-password':password,'if-match':saved.body.revision}})).status,403);
  assert.equal((await call(handle,'/api/admin/publish',{method:'POST',body:data,headers:{'content-length':String(VERCEL_UPLOAD_BYTES+1)}})).status,413);
  assert.equal((await publish(handle)).status,409);
  assert.equal((await call(handle)).body.revision,saved.body.revision);
  sdk.get=async()=>{throw Error('storage offline');};assert.equal((await call(app(sdk))).status,503);
});
test('storage adapters reject arbitrary keys and do not treat provider failures as empty data',async()=>{
  const sdk=fakeSdk(),store=vercelBucket(sdk,'TEST-ONLY-STORAGE');await assert.rejects(store.get('https://other.example/file'));
  await assert.rejects(store.put('../file','data'));sdk.get=async()=>{throw Error('offline');};await assert.rejects(store.get('flow-atlas/current.json'),/offline/);
});
test('the Node deployment keeps its uploaded history on its own disk after restart',async()=>{
  const directory=await mkdtemp(new URL('../.test-flow-',import.meta.url).pathname),origin='http://localhost:8090';
  try{
    const assets=new Map([['/dataset.json',{body:text,type:'application/json'}]]),env={BUCKET:fileBucket(directory),FLOW_PUBLISH_AUTH:verifier};
    const saved=await createHandler(assets).fetch(new Request(origin+'/api/admin/publish',{method:'POST',headers:{origin,'content-type':'application/json','x-flow-password':password,'if-match':'demo'},body:text}),env);
    assert.equal(saved.status,200);const receipt=await saved.json();
    const fresh=await createHandler(assets).fetch(new Request(origin+'/api/snapshot'),{BUCKET:fileBucket(directory)});
    assert.equal((await fresh.json()).revision,receipt.revision);
  }finally{await rm(directory,{recursive:true,force:true});}
});
