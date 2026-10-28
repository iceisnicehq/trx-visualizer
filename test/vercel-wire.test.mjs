import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import * as sdk from '@vercel/blob';
import {vercelBucket} from '../server/vercel-bucket.js';
// Use the SDK's own declared HTTP dependency. No additional dependency,
// real token, store, external connection or mixer endpoint is used.
const require=createRequire(import.meta.url),sdkRequire=createRequire(require.resolve('@vercel/blob'));
const {MockAgent,setGlobalDispatcher,getGlobalDispatcher}=sdkRequire('undici');
const headersOf=value=>{
  if(Array.isArray(value)&&typeof value[0]==='string'){const pairs=[];for(let i=0;i<value.length;i+=2)pairs.push([value[i],value[i+1]]);return new Headers(pairs);}
  return new Headers(value);
};
test('the actual pinned Blob SDK replaces data using API metadata when download and write ETags differ',async()=>{
  const agent=new MockAgent(),previousDispatcher=getGlobalDispatcher(),previousApi=process.env.VERCEL_BLOB_API_URL;
  agent.disableNetConnect();setGlobalDispatcher(agent);process.env.VERCEL_BLOB_API_URL='http://flow-blob-api.test/api/blob';
  const files=new Map(),writes=[];let sequence=0;
  const metadata=(key,f)=>({url:'https://teststore.private.blob.vercel-storage.com/'+key,downloadUrl:'https://teststore.private.blob.vercel-storage.com/'+key+'?download=1',pathname:key,
    contentType:'application/json',contentDisposition:'attachment',cacheControl:'private, max-age=60',size:Buffer.byteLength(f.body),uploadedAt:'2026-10-28T00:00:00.000Z',etag:f.etag});
  const reply=(statusCode,data,headers={'content-type':'application/json'})=>({statusCode,data:typeof data==='string'?data:JSON.stringify(data),responseOptions:{headers}});
  const api=agent.get('http://flow-blob-api.test');
  api.intercept({method:'GET',path:path=>path.startsWith('/api/blob?url=')}).reply(options=>{
    const key=new URL(options.path,'http://flow-blob-api.test').searchParams.get('url'),f=files.get(key);
    return f?reply(200,metadata(key,f)):reply(404,{error:{code:'not_found',message:'Missing test object'}});
  }).persist();
  api.intercept({method:'PUT',path:path=>path.startsWith('/api/blob/?pathname=')}).reply(options=>{
    const key=new URL(options.path,'http://flow-blob-api.test').searchParams.get('pathname'),h=headersOf(options.headers),current=files.get(key),condition=h.get('x-if-match');
    writes.push({key,condition});
    if(condition&&condition!==current?.etag)return reply(412,{error:{code:'precondition_failed',message:'Write revision mismatch'}});
    if(current&&h.get('x-allow-overwrite')!=='1')return reply(400,{error:{code:'bad_request',message:'This blob already exists.'}});
    assert.equal(typeof options.body,'string');const f={body:options.body,etag:'"metadata-'+(++sequence)+'"'};files.set(key,f);return reply(200,metadata(key,f));
  }).persist();
  agent.get('https://teststore.private.blob.vercel-storage.com').intercept({method:'GET',path:path=>path.endsWith('?cache=0')}).reply(options=>{
    const key=new URL(options.path,'https://teststore.private.blob.vercel-storage.com').pathname.slice(1),f=files.get(key);
    return f?reply(200,f.body,{'content-type':'application/json',etag:'W/"download-'+sequence+'"'}):reply(404,'Not found');
  }).persist();
  const token='vercel_blob_rw_teststore_TEST_ONLY_NO_REAL_CREDENTIAL',key='flow-atlas/current.json';
  try{
    const store=vercelBucket(sdk,token),initial=await store.put(key,'{"value":1}',{onlyIf:new Headers({'if-none-match':'*'})});assert(initial);
    const download=await sdk.get(key,{access:'private',token,useCache:false});assert.match(download.blob.etag,/^W\//);await new Response(download.stream).text();
    await assert.rejects(sdk.put(key,'{"value":"would fail"}',{access:'private',token,addRandomSuffix:false,allowOverwrite:true,ifMatch:download.blob.etag}),sdk.BlobPreconditionFailedError);
    for(let i=2;i<=4;i++){
      const prior=await store.get(key),next=await store.put(key,JSON.stringify({value:i}),{onlyIf:new Headers({'if-match':'"'+prior.etag+'"'})});
      assert(next);assert.deepEqual(await (await store.get(key)).json(),{value:i});
    }
    assert(writes.filter(w=>w.condition?.startsWith('"metadata-')).length===3);
    assert.equal(files.get(key).body,'{"value":4}');
  }finally{
    if(previousApi===undefined)delete process.env.VERCEL_BLOB_API_URL;else process.env.VERCEL_BLOB_API_URL=previousApi;
    setGlobalDispatcher(previousDispatcher);await agent.close();
  }
});
