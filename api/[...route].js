/** Optional Vercel mirror: public UI + same-origin server proxy to the
 * existing shared Flow Atlas API. No wallet or publishing secrets are bundled. */
export default async function handler(req,res){
  const path=new URL(req.url,'https://local.invalid').pathname;
  if(!['/api/snapshot','/api/status','/api/admin/publish'].includes(path)){res.status(404).json({error:'Not found.'});return;}
  const origin=process.env.FLOW_API_ORIGIN;
  let upstream;try{upstream=new URL(origin);if(upstream.protocol!=='https:'||upstream.username||upstream.password)throw Error();}catch{res.status(503).json({error:'Set FLOW_API_ORIGIN to the protected Flow Atlas server.'});return;}
  const write=path==='/api/admin/publish'&&['POST','PUT'].includes(req.method);
  if(!write&&!(req.method==='GET'&&path!=='/api/admin/publish')){res.status(405).end();return;}
  const headers={'Content-Type':'application/json'};
  if(write){
    const publicHost=req.headers['x-forwarded-host']??req.headers.host;
    if(req.headers.origin!=='https://'+publicHost){res.status(403).json({error:'Publish from this website.'});return;}
    headers.Origin=upstream.origin;
    if(req.headers['x-flow-password'])headers['X-Flow-Password']=req.headers['x-flow-password'];
    if(req.headers['if-match'])headers['If-Match']=req.headers['if-match'];
  }
  try{
    const result=await fetch(new URL(path,origin),{method:req.method,headers,body:write?JSON.stringify(req.body):undefined,signal:AbortSignal.timeout(40_000)});
    if(!/^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(result.headers.get('content-type')??'')){res.setHeader('Cache-Control','no-store');res.status(502).json({error:'The snapshot host returned an error page. Refresh before retrying an upload.'});return;}
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.status(result.status).send(await result.text());
  }catch{res.status(503).json({error:'The shared snapshot server is unavailable.'});}
}
