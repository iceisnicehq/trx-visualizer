import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createHandler} from '../worker/index.js';
import {fileBucket} from './file-bucket.mjs';
const names=['index.html','style.css','model.js','canvas.js','app.js','exports.js','tree-layout.js','transport.js','dataset.json','demo.json'],assets=new Map();
for(const name of names)assets.set('/'+name,{body:await readFile(new URL('../public/'+name,import.meta.url),'utf8'),type:name.endsWith('.json')?'application/json':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'});
const port=Number(process.env.PORT??8090),env={BUCKET:fileBucket(process.env.FLOW_DATA_DIR??'.data'),FLOW_PUBLISH_AUTH:process.env.FLOW_PUBLISH_AUTH};
const handler=createHandler(assets);
createServer(async(req,res)=>{
  try{
    const base=process.env.FLOW_PUBLIC_ORIGIN||'http://localhost:'+port,url=new URL(req.url,base),headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(v)headers.set(k,Array.isArray(v)?v.join(','):v);
    const request=new Request(url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})});
    const reply=await handler.fetch(request,env);res.writeHead(reply.status,Object.fromEntries(reply.headers));res.end(Buffer.from(await reply.arrayBuffer()));
  }catch{res.writeHead(500,{'content-type':'text/plain'});res.end('Request failed.');}
}).listen(port,process.env.FLOW_LISTEN_HOST??'127.0.0.1',()=>console.log('Flow Atlas: http://localhost:'+port+' — persistent data in '+(process.env.FLOW_DATA_DIR??'.data')));
