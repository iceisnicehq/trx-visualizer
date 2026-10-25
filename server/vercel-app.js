import {readFile} from 'node:fs/promises';
import {createHandler} from '../worker/index.js';
import {vercelBucket} from './vercel-bucket.js';
export const VERCEL_UPLOAD_BYTES=4_000_000;
const paths=new Set(['/api/status','/api/snapshot','/api/admin/publish']);
const errorReply=(res,status,error)=>{res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.statusCode=status;res.end(JSON.stringify({error}));};
export function createVercelApp({environment=process.env,loadSdk=()=>import('@vercel/blob'),
  readBundled=()=>readFile(new URL('../public/dataset.json',import.meta.url),'utf8')}={}){
  let services;
  async function runtime(){
    if(!services)services=(async()=>{
      const assets=new Map([['/dataset.json',{body:await readBundled(),type:'application/json'}]]);
      const token=environment.BLOB_READ_WRITE_TOKEN,verifier=environment.FLOW_PUBLISH_AUTH;
      const BUCKET=token?vercelBucket(await loadSdk(),token):undefined;
      const setupMessage=!token?'Flow storage is not configured. Create a private Blob store in this Flow Vercel project and connect BLOB_READ_WRITE_TOKEN, then redeploy.'
        :!verifier?'Set FLOW_PUBLISH_AUTH in this Flow project to enable password-protected publishing, then redeploy.':null;
      return {handler:createHandler(assets),env:{BUCKET,FLOW_PUBLISH_AUTH:verifier,MAX_UPLOAD_BYTES:VERCEL_UPLOAD_BYTES,SETUP_MESSAGE:setupMessage}};
    })().catch(error=>{services=null;throw error;});
    return services;
  }
  return async(req,res)=>{
    try{
      const path=new URL(req.url,'https://flow.invalid').pathname;
      if(!paths.has(path)){errorReply(res,404,'Not found.');return;}
      const host=String(req.headers['x-forwarded-host']??req.headers.host??'');
      if(!/^[a-z0-9.-]+(?::\d+)?$/i.test(host)){errorReply(res,400,'Invalid Flow host.');return;}
      const headers=new Headers();for(const [name,value] of Object.entries(req.headers))if(value)headers.set(name,Array.isArray(value)?value.join(','):String(value));
      let body;
      if(!['GET','HEAD'].includes(req.method)){
        if(Number(headers.get('content-length'))>VERCEL_UPLOAD_BYTES){errorReply(res,413,'This Flow host accepts up to 4 MB of normalized JSON per upload.');return;}
        if(req.body!==undefined)body=typeof req.body==='string'||Buffer.isBuffer(req.body)?req.body:JSON.stringify(req.body);
        else{const chunks=[];let total=0;for await(const chunk of req){const bytes=Buffer.from(chunk);total+=bytes.length;if(total>VERCEL_UPLOAD_BYTES){errorReply(res,413,'This Flow host accepts up to 4 MB per upload.');return;}chunks.push(bytes);}body=Buffer.concat(chunks);}
        if(Buffer.byteLength(body)>VERCEL_UPLOAD_BYTES){errorReply(res,413,'This Flow host accepts up to 4 MB per upload.');return;}
      }
      const {handler,env}=await runtime();
      const reply=await handler.fetch(new Request('https://'+host+path,{method:req.method,headers,...(body!==undefined?{body,duplex:'half'}:{})}),env);
      res.statusCode=reply.status;for(const [name,value] of reply.headers)res.setHeader(name,value);res.end(Buffer.from(await reply.arrayBuffer()));
    }catch{errorReply(res,503,'Flow could not access its own storage. Check this Flow deployment’s storage configuration.');}
  };
}
export default createVercelApp();
