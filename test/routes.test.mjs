import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,access} from 'node:fs/promises';
import {pbkdf2Sync} from 'node:crypto';
import {createVercelEndpoint} from '../server/vercel-app.js';
import {publishSnapshot,readSnapshot} from '../public/transport.js';
const root=new URL('../',import.meta.url);
test('the deployed package has three explicit API entry points, including the nested publisher',async()=>{
  const manifest=JSON.parse(await readFile(new URL('vercel.json',root),'utf8'));
  const files=['api/status.js','api/snapshot.js','api/admin/publish.js'];
  assert.deepEqual(Object.keys(manifest.functions).sort(),files.slice().sort());
  for(const file of files)await access(new URL(file,root));
  await assert.rejects(access(new URL('api/[...route].js',root)));
});
test('the actual endpoint modules survive Vercel-style rewritten request URLs and the publisher is discoverable without credentials',()=>{
  const script=`
    const results=[];
    for(const [file,method] of [['status.js','GET'],['snapshot.js','GET'],['admin/publish.js','GET'],['admin/publish.js','POST']]){
      const handle=(await import('./api/'+file)).default;let body;const headers={};
      const response={statusCode:200,setHeader(k,v){headers[k.toLowerCase()]=v;},end(value){body=JSON.parse(Buffer.from(value).toString());}};
      await handle({url:'/internal/vercel-function?route=rewritten',method,body:{},headers:{host:'analytics.example',origin:'https://analytics.example','content-type':'application/json'}},response);
      results.push({file,method,status:response.statusCode,allow:headers.allow??null,hasJson:typeof body==='object'});
    }
    console.log(JSON.stringify(results));`;
  const output=execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'test',BLOB_READ_WRITE_TOKEN:'',FLOW_PUBLISH_AUTH:''},encoding:'utf8'});
  const results=JSON.parse(output);assert.deepEqual(results.map(r=>r.status),[200,200,405,503]);
  assert.equal(results[2].allow,'POST, PUT');assert(results.every(r=>r.hasJson));
});
test('a mounted publishing endpoint handles an authenticated upload despite a rewritten URL',async()=>{
  const dataset=JSON.parse(await readFile(new URL('public/dataset.json',root),'utf8'));
  const password='TEST-ONLY-ROUTE-PASSWORD',salt='0123456789abcdef0123456789abcdef';
  const verifier='pbkdf2-sha256:100000:'+salt+':'+pbkdf2Sync(password,Buffer.from(salt,'hex'),100000,32,'sha256').toString('hex');
  const files=new Map(),sdk={
    async get(key){const value=files.get(key);return value?{statusCode:200,stream:new Response(value).body,blob:{etag:'"provider-version"'}}:null;},
    async put(key,body){files.set(key,body);return {etag:'"provider-version"'};}
  };
  const options={environment:{BLOB_READ_WRITE_TOKEN:'TEST-ONLY-ROUTE-STORAGE',FLOW_PUBLISH_AUTH:verifier},loadSdk:async()=>sdk,readBundled:async()=>JSON.stringify(dataset)};
  const publish=createVercelEndpoint('/api/admin/publish',options),snapshot=createVercelEndpoint('/api/snapshot',options);
  async function call(handle,method,body,headers={}){let result;const res={statusCode:200,setHeader(){},end(bytes){result=JSON.parse(Buffer.from(bytes).toString());}};
    await handle({url:'/not-the-public-path',method,body,headers:{host:'analytics.example',origin:'https://analytics.example','content-type':'application/json',...headers}},res);return {status:res.statusCode,body:result};}
  const saved=await call(publish,'POST',dataset,{'x-flow-password':password,'if-match':'demo'});assert.equal(saved.status,200);
  const visible=await call(snapshot,'GET');assert.equal(visible.status,200);assert.equal(visible.body.revision,saved.body.revision);assert.equal(visible.body.dataset.transactions.length,dataset.transactions.length);
});
test('browser API calls resolve at the Flow origin root even from a nested page URL',async()=>{
  const base='https://analytics.example/reports/day/',paths=[];
  const fetchImpl=async(path,options)=>{paths.push(new URL(path,base).pathname);return new Response(JSON.stringify(options.method==='POST'
    ?{ok:true,revision:'1234567890abcdef1234567890abcdef',publishedAt:new Date().toISOString()}
    :{dataset:{},revision:'demo'}),{headers:{'content-type':'application/json'}});};
  await readSnapshot({fetchImpl});await publishSnapshot({},{password:'TEST-ONLY',revision:'demo',fetchImpl});
  assert.deepEqual(paths,['/api/snapshot','/api/admin/publish']);
});
