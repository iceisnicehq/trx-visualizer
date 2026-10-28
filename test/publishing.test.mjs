import {test} from 'node:test';
import {strictEqual,ok,deepStrictEqual} from 'node:assert';
import {readFile} from 'node:fs/promises';
import {createHash,pbkdf2Sync} from 'node:crypto';
import {createHandler,verifyPassword,MAX_UPLOAD_BYTES} from '../worker/index.js';
const salt='0123456789abcdef0123456789abcdef',password='TEST-ONLY-publishing-secret';
const verifier='pbkdf2-sha256:100000:'+salt+':'+pbkdf2Sync(password,Buffer.from(salt,'hex'),100000,32,'sha256').toString('hex');
const demo=JSON.parse(await readFile(new URL('../public/dataset.json',import.meta.url),'utf8'));
const assets=new Map([['/dataset.json',{body:JSON.stringify(demo),type:'application/json'}],['/index.html',{body:'TRX Flow Atlas',type:'text/html'}]]);
function bucket(){
  const objects=new Map();
  return {objects,async get(key){return objects.get(key)??null;},async put(key,body,options={}){
    const old=objects.get(key),h=options.onlyIf;
    if(h?.get('if-none-match')==='*'&&old)return null;
    if(h?.get('if-match')?.replaceAll('"','')&&h.get('if-match').replaceAll('"','')!==old?.etag)return null;
    const etag=createHash('md5').update(body).digest('hex'),result={etag,httpEtag:'"'+etag+'"',json:async()=>JSON.parse(body),text:async()=>body};
    objects.set(key,result);return result;
  }};
}
const origin='https://atlas.test';
function publish(data=demo,options={}){return new Request(origin+'/api/admin/publish',{method:'PUT',headers:{origin,'content-type':'application/json','x-flow-password':password,'if-match':'demo',...options.headers},body:JSON.stringify(data)});}
test('public reads work anonymously while publisher authentication never appears in public HTML or metadata',async()=>{
  const handler=createHandler(assets),env={BUCKET:bucket(),FLOW_PUBLISH_AUTH:verifier};
  const read=await handler.fetch(new Request(origin+'/api/snapshot'),env),body=await read.json();strictEqual(read.status,200);strictEqual(body.revision,'demo');strictEqual(body.dataset.transactions.length,demo.transactions.length);
  const info=JSON.stringify(await (await handler.fetch(new Request(origin+'/api/status'),env)).json());ok(!info.includes(verifier)&&!info.includes(password));
  strictEqual((await handler.fetch(new Request(origin+'/worker/index.js'),env)).status,404);
  strictEqual((await handler.fetch(publish(demo,{headers:{'x-flow-password':''}}),env)).status,401);strictEqual(env.BUCKET.objects.size,0);
});
test('a valid password persists one shared snapshot across independent handlers and redeploys',async()=>{
  const env={BUCKET:bucket(),FLOW_PUBLISH_AUTH:verifier},handler=createHandler(assets);
  const saved=await handler.fetch(publish(),env),receipt=await saved.json();strictEqual(saved.status,200);ok(/^[a-f0-9]{32}$/.test(receipt.revision));
  const fresh=createHandler(assets),visible=await (await fresh.fetch(new Request(origin+'/api/snapshot'),env)).json();
  strictEqual(visible.source,'published');strictEqual(visible.revision,receipt.revision);strictEqual(visible.dataset.transactions.length,demo.transactions.length);
  strictEqual((await fresh.fetch(publish(demo,{headers:{'x-flow-password':'wrong'}}),env)).status,401);
  strictEqual((await (await fresh.fetch(new Request(origin+'/api/snapshot'),env)).json()).revision,receipt.revision);
});
test('same-origin, expected revision, JSON type and a configured verifier are required on every publish',async()=>{
  const env={BUCKET:bucket(),FLOW_PUBLISH_AUTH:verifier},handler=createHandler(assets);
  strictEqual((await handler.fetch(publish(demo,{headers:{origin:'https://other.test'}}),env)).status,403);
  strictEqual((await handler.fetch(publish(demo,{headers:{'if-match':''}}),env)).status,428);
  strictEqual((await handler.fetch(publish(demo,{headers:{'content-type':'text/plain'}}),env)).status,415);
  strictEqual((await handler.fetch(publish(),{BUCKET:env.BUCKET})).status,503);strictEqual(env.BUCKET.objects.size,0);
});
test('concurrent publishes cannot silently overwrite one another and stale revisions are rejected',async()=>{
  const env={BUCKET:bucket(),FLOW_PUBLISH_AUTH:verifier};
  const [a,b]=await Promise.all([createHandler(assets).fetch(publish(),env),createHandler(assets).fetch(publish({...demo,title:'Another upload'}),env)]);
  deepStrictEqual([a.status,b.status].sort(),[200,409]);
  strictEqual((await createHandler(assets).fetch(publish(),env)).status,409);
});
test('invalid ledgers, unknown schema and oversized uploads retain the previously published snapshot',async()=>{
  const handler=createHandler(assets),env={BUCKET:bucket(),FLOW_PUBLISH_AUTH:verifier};
  const first=await (await handler.fetch(publish(),env)).json(),headers={'if-match':first.revision};
  const bad=structuredClone(demo),row=bad.transactions.find(t=>bad.periods.find(p=>p.id===t.periodId).type==='SMART');
  row.allocations=[{ownerAddress:demo.wallets.at(-2).address,amountSun:row.amountSun}];
  strictEqual((await handler.fetch(publish(bad,{headers}),env)).status,422);
  strictEqual((await handler.fetch(publish({privateKey:'DO-NOT-PUBLISH'},{headers}),env)).status,422);
  strictEqual((await handler.fetch(publish(demo,{headers:{...headers,'content-length':String(MAX_UPLOAD_BYTES+1)}}),env)).status,413);
  strictEqual((await (await handler.fetch(new Request(origin+'/api/snapshot'),env)).json()).revision,first.revision);
});
test('replacement keeps the previous revision, storage failures fail closed, and there is no public write fallback',async()=>{
  const handler=createHandler(assets),env={BUCKET:bucket(),FLOW_PUBLISH_AUTH:verifier};
  const first=await (await handler.fetch(publish(),env)).json();
  const next=await handler.fetch(publish({...demo,title:'Updated game'},{headers:{'if-match':first.revision}}),env);strictEqual(next.status,200);
  ok(env.BUCKET.objects.has('flow-atlas/versions/'+first.revision+'.json'));
  strictEqual((await handler.fetch(new Request(origin+'/api/snapshot'),{BUCKET:{get:async()=>{throw Error('offline');}}})).status,503);
  strictEqual((await handler.fetch(new Request(origin+'/dataset.json',{method:'PUT',body:'unauthorized'}),env)).status,405);
});
test('PBKDF2 validation and the attempt limit reject weak configuration or repeated wrong passwords',async()=>{
  strictEqual(await verifyPassword(password,verifier),true);strictEqual(await verifyPassword('wrong',verifier),false);strictEqual(await verifyPassword(password,'plain-password'),false);
  const handler=createHandler(assets),env={BUCKET:bucket(),FLOW_PUBLISH_AUTH:verifier};
  for(let i=0;i<8;i++)strictEqual((await handler.fetch(publish(demo,{headers:{'x-flow-password':''}}),env)).status,401);
  strictEqual((await handler.fetch(publish(),env)).status,429);strictEqual(env.BUCKET.objects.size,0);
});
test('POST publishing has exactly the same password, origin and revision checks as the compatible PUT route',async()=>{
  const env={BUCKET:bucket(),FLOW_PUBLISH_AUTH:verifier},handler=createHandler(assets);
  const post=options=>new Request(publish(demo,options),{method:'POST'});
  strictEqual((await handler.fetch(post({headers:{'x-flow-password':'wrong'}}),env)).status,401);
  strictEqual((await handler.fetch(post({headers:{origin:'https://other.test'}}),env)).status,403);
  strictEqual((await handler.fetch(post({headers:{'if-match':''}}),env)).status,428);
  const saved=await handler.fetch(post(),env);strictEqual(saved.status,200);
  const receipt=await saved.json();strictEqual((await handler.fetch(post(),env)).status,409);
  strictEqual((await (await handler.fetch(new Request(origin+'/api/snapshot'),env)).json()).revision,receipt.revision);
});
test('a rejected conditional write without a visible revision change reports storage failure instead of repeated false 409s',async()=>{
  const env={BUCKET:bucket(),FLOW_PUBLISH_AUTH:verifier},handler=createHandler(assets);
  const first=await (await handler.fetch(publish(),env)).json(),put=env.BUCKET.put.bind(env.BUCKET);
  env.BUCKET.put=async(key,...args)=>key==='flow-atlas/current.json'?null:put(key,...args);
  const failed=await handler.fetch(publish({...demo,title:'Cannot persist'},{headers:{'if-match':first.revision}}),env),body=await failed.json();
  strictEqual(failed.status,503);strictEqual(body.code,'FLOW_STORAGE_REVISION_MISMATCH');
  strictEqual((await (await handler.fetch(new Request(origin+'/api/snapshot'),env)).json()).revision,first.revision);
});
