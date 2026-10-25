import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
/** Durable single-process local adapter. Production Sites uses actual R2. */
export function fileBucket(directory){
  let tail=Promise.resolve();
  const file=key=>join(directory,Buffer.from(key).toString('base64url')+'.json');
  async function get(key){
    try{const body=await readFile(file(key),'utf8'),etag=createHash('md5').update(body).digest('hex');
      return {etag,httpEtag:'"'+etag+'"',text:async()=>body,json:async()=>JSON.parse(body)};
    }catch(e){if(e.code==='ENOENT')return null;throw e;}
  }
  function put(key,body,options={}){
    const action=tail.then(async()=>{
      const previous=await get(key),headers=options.onlyIf;
      if(headers?.get('if-none-match')==='*'&&previous)return null;
      const match=headers?.get('if-match')?.replaceAll('"','');if(match&&previous?.etag!==match)return null;
      await mkdir(directory,{recursive:true});const target=file(key),temporary=target+'.'+randomUUID()+'.tmp';
      await writeFile(temporary,body,{mode:0o600});await rename(temporary,target);return get(key);
    });tail=action.then(()=>{},()=>{});return action;
  }
  return {get,put};
}
