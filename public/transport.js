/** Public reads and password-authenticated publishing never depend on a
 * visitor's ChatGPT cookies. Retry reads only; a lost write reply is uncertain. */
export class ApiError extends Error{
  constructor(message,{status=0,retryable=false,uncertain=false}={}){super(message);this.name='ApiError';this.status=status;this.retryable=retryable;this.uncertain=uncertain;}
}
const later=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const isJson=type=>/^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(type??'');
export function parseSnapshotFile(text){
  const cleaned=text.replace(/^\uFEFF/,'').trim();
  if(!cleaned.startsWith('{'))throw new Error('This file is not a Flow Atlas JSON export. It may contain an error page from a failed download. Download “Скачать все потоки · JSON” again from the orchestrator.');
  try{return JSON.parse(cleaned);}catch{throw new Error('The selected JSON file is incomplete or invalid. Download a fresh flow export from the orchestrator.');}
}
async function decode(response,path,write=false){
  const status=response.status,label=`HTTP ${status} at ${path}`;
  if(write&&status===404)throw new ApiError(`This Flow deployment is missing its publishing endpoint (${label}). Deploy api/admin/publish.js from the Flow project root; a static-only deployment cannot publish.`,{status});
  if(!isJson(response.headers.get('content-type')))throw new ApiError(`The host returned a page instead of JSON (${label}). ${write?'The upload result is unconfirmed; refresh public data before retrying.':'Retry Refresh. The current view has been retained.'}`,{status,retryable:status===200||status===408||status===429||status>=500,uncertain:write});
  let body;try{body=await response.json();}catch{throw new ApiError(`The host returned incomplete JSON (${label}). ${write?'Refresh public data before retrying the upload.':'Retry Refresh.'}`,{status,retryable:true,uncertain:write});}
  if(!response.ok)throw new ApiError(typeof body?.error==='string'?`${body.error.slice(0,500)} (${label})`:`The request failed (${label}).`,{status,retryable:status===408||status===429||status>=500,uncertain:write&&status>=500});
  if(!body||typeof body!=='object'||Array.isArray(body))throw new ApiError(`The host returned an invalid API reply (${label}).`,{status,retryable:true,uncertain:write});
  return body;
}
export async function readPublicJson(path,{fetchImpl=fetch,sleep=later,attempts=3,timeout=15_000}={}){
  let last;
  for(let i=0;i<attempts;i++){
    try{return await decode(await fetchImpl(path,{method:'GET',cache:'no-store',credentials:'omit',redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(timeout)}),path);}
    catch(error){
      last=error instanceof ApiError?error:new ApiError(`Cannot reach ${path}. Retry Refresh; the current view has been retained.`,{retryable:true});
      if(!last.retryable||i===attempts-1)throw last;
      await sleep(i===0?350:1000);
    }
  }
  throw last;
}
export async function readSnapshot(options){
  const body=await readPublicJson('/api/snapshot',options);
  if(!body.dataset||!(body.revision==='demo'||/^[a-f0-9]{32}$/.test(body.revision??'')))throw new ApiError('The snapshot server returned an invalid data envelope. The current view has been retained.');
  return body;
}
export function acceptPublishedSnapshot(dataset,receipt,commit){
  if(receipt?.ok!==true||!/^[a-f0-9]{32}$/.test(receipt.revision??'')||!Number.isFinite(Date.parse(receipt.publishedAt)))throw new ApiError('The upload receipt is invalid. Refresh public data before retrying.',{uncertain:true});
  // The server confirmed persistence. Display this validated file immediately;
  // a separate GET must not prevent the successful upload from becoming visible.
  commit({dataset,revision:receipt.revision,publishedAt:receipt.publishedAt,source:'published'});
}
export async function publishSnapshot(dataset,{password,revision,fetchImpl=fetch,sleep=later}={}){
  const path='/api/admin/publish',started=Date.now();
  try{
    const response=await fetchImpl(path,{method:'POST',credentials:'omit',redirect:'error',headers:{'Content-Type':'application/json',Accept:'application/json','X-Flow-Password':password,'If-Match':revision},body:JSON.stringify(dataset),signal:AbortSignal.timeout(45_000)});
    const receipt=await decode(response,path,true);acceptPublishedSnapshot(dataset,receipt,()=>{});return receipt;
  }catch(error){
    const failure=error instanceof ApiError?error:new ApiError('Could not confirm the upload. Refresh public data before trying again.',{uncertain:true});
    if(failure.uncertain){
      try{
        const current=await readSnapshot({fetchImpl,sleep,attempts:2});
        if(current.revision!==revision&&Date.parse(current.publishedAt)>=started-5000&&JSON.stringify(current.dataset)===JSON.stringify(dataset))
          return {ok:true,revision:current.revision,publishedAt:current.publishedAt,recovered:true};
      }catch{/* Keep the original failure. A write is never repeated here. */}
    }
    throw failure;
  }
}
