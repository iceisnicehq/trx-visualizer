import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readPublicJson,readSnapshot,publishSnapshot,acceptPublishedSnapshot,parseSnapshotFile} from '../public/transport.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const html=(status=502)=>new Response('The page could not be loaded.',{status,headers:{'Content-Type':'text/html'}});
const revision='1234567890abcdef1234567890abcdef',next='abcdef1234567890abcdef1234567890',dataset={format:'trx-flow-atlas',version:1};
const publishedAt=new Date().toISOString();
const sleep=async()=>{};
test('a temporary host page is retried as a read and never passed to JSON.parse',async()=>{
  let calls=0;const result=await readPublicJson('/api/snapshot',{sleep,fetchImpl:async(path,options)=>{
    assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');return ++calls===1?html():json({dataset,revision});
  }});assert.equal(calls,2);assert.deepEqual(result,{dataset,revision});
});
test('persistent HTML errors produce a useful status message after bounded retries',async()=>{
  let calls=0;await assert.rejects(readPublicJson('/api/snapshot',{sleep,fetchImpl:async()=>{calls++;return html();}}),error=>error.status===502&&error.message.includes('HTTP 502')&&!error.message.includes('Unexpected token'));
  assert.equal(calls,3);
});
test('HTML with a successful HTTP status, malformed JSON and network outages do not become data',async()=>{
  for(const fetchImpl of [async()=>html(200),async()=>new Response('{',{headers:{'content-type':'application/json'}}),async()=>{throw TypeError('offline');}]){
    await assert.rejects(readSnapshot({sleep,attempts:1,fetchImpl}));
  }
  await assert.rejects(readSnapshot({sleep,fetchImpl:async()=>json({title:'Not a snapshot'})}),/invalid data envelope/);
});
test('ordinary validation and authentication failures are not retried',async()=>{
  let calls=0;await assert.rejects(readPublicJson('/api/snapshot',{sleep,fetchImpl:async()=>{calls++;return json({error:'Not found'},404);}}),e=>e.status===404);
  assert.equal(calls,1);
  calls=0;await assert.rejects(publishSnapshot(dataset,{revision,password:'TEST-ONLY',sleep,fetchImpl:async()=>{calls++;return json({error:'Invalid publishing password.'},401);}}),e=>e.status===401);
  assert.equal(calls,1);
});
test('confirmed publication displays the uploaded history without depending on another GET',async()=>{
  let calls=0,displayed;
  const receipt=await publishSnapshot(dataset,{revision,password:'TEST-ONLY',sleep,fetchImpl:async(path,options)=>{
    calls++;assert.equal(options.method,'POST');assert.equal(options.credentials,'omit');assert.equal(options.headers['If-Match'],revision);assert.equal(options.headers['X-Flow-Password'],'TEST-ONLY');
    return json({ok:true,revision:next,publishedAt});
  }});
  acceptPublishedSnapshot(dataset,receipt,current=>{displayed=current;});assert.equal(calls,1);assert.equal(displayed.dataset,dataset);assert.equal(displayed.revision,next);
});
test('a lost write reply is reconciled by reading the saved snapshot without repeating the write',async()=>{
  const calls=[];const receipt=await publishSnapshot(dataset,{revision,password:'TEST-ONLY',sleep,fetchImpl:async(path,options)=>{
    calls.push(options.method);return options.method==='POST'?html():json({dataset,revision:next,publishedAt});
  }});assert.deepEqual(calls,['POST','GET']);assert.equal(receipt.recovered,true);
});
test('an unconfirmed write never substitutes the intended upload for a different public snapshot',async()=>{
  let writes=0;await assert.rejects(publishSnapshot(dataset,{revision,password:'TEST-ONLY',sleep,fetchImpl:async(path,options)=>{
    if(options.method==='POST'){writes++;return html();}return json({dataset:{...dataset,title:'Other upload'},revision:next,publishedAt});
  }}),error=>error.uncertain&&error.message.includes('unconfirmed'));assert.equal(writes,1);
});
test('a fake upload receipt cannot replace the current view',()=>{
  let writes=0;assert.throws(()=>acceptPublishedSnapshot(dataset,{ok:true,revision:'demo',publishedAt},()=>writes++),/receipt is invalid/);assert.equal(writes,0);
});
test('a missing publishing route gives deployment instructions and never retries the upload',async()=>{
  let writes=0;await assert.rejects(publishSnapshot(dataset,{revision,password:'TEST-ONLY',sleep,fetchImpl:async()=>{writes++;return json({error:{code:'NOT_FOUND'}},404);}}),
    error=>error.status===404&&error.message.includes('api/admin/publish.js')&&!error.message.includes('The request failed'));
  assert.equal(writes,1);
});
test('files containing a hosting error page get a file-specific explanation and BOM JSON is accepted',()=>{
  assert.throws(()=>parseSnapshotFile('The page could not be loaded.'),/failed download/);
  assert.throws(()=>parseSnapshotFile('<!doctype html>'),/not a Flow Atlas JSON export/);
  assert.throws(()=>parseSnapshotFile('{"format":'),/incomplete or invalid/);
  assert.deepEqual(parseSnapshotFile('\uFEFF '+JSON.stringify(dataset)),dataset);
});
