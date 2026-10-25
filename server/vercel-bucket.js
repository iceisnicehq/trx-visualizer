import {createHash} from 'node:crypto';
const keyAllowed=key=>key==='flow-atlas/current.json'||/^flow-atlas\/versions\/[a-f0-9]{32}\.json$/.test(key);
const logicalTag=body=>createHash('md5').update(body).digest('hex');
// SDK subclasses keep Error.name="Error"; use the exported constructors.
const conflict=(error,sdk,createOnly)=>(typeof sdk.BlobPreconditionFailedError==='function'&&error instanceof sdk.BlobPreconditionFailedError)
  ||(createOnly&&typeof sdk.BlobError==='function'&&error instanceof sdk.BlobError&&/already exists/i.test(error.message));
/** Private storage belonging only to this Flow deployment. Provider ETags are
 * used for atomic writes; the public revision is a stable 32-character digest. */
export function vercelBucket(sdk,token){
  if(!token)throw Error('Flow storage token is missing.');
  async function get(key){
    if(!keyAllowed(key))throw Error('Invalid Flow storage key.');
    const value=await sdk.get(key,{access:'private',token,useCache:false,abortSignal:AbortSignal.timeout(15_000)});
    if(!value)return null;
    if(value.statusCode!==200||!value.stream)throw Error('Flow storage did not return a complete object.');
    const body=await new Response(value.stream).text(),etag=logicalTag(body);
    return {etag,httpEtag:'"'+etag+'"',providerEtag:value.blob.etag,text:async()=>body,json:async()=>JSON.parse(body)};
  }
  async function put(key,body,options={}){
    if(!keyAllowed(key))throw Error('Invalid Flow storage key.');
    const headers=options.onlyIf,expected=headers?.get('if-match')?.replaceAll('"','');
    let providerEtag;
    if(expected){const current=await get(key);if(current?.etag!==expected)return null;providerEtag=current.providerEtag;}
    const createOnly=headers?.get('if-none-match')==='*';
    try{
      await sdk.put(key,body,{access:'private',token,addRandomSuffix:false,allowOverwrite:!createOnly,
        ...(providerEtag?{ifMatch:providerEtag}:{}),contentType:'application/json',cacheControlMaxAge:60,abortSignal:AbortSignal.timeout(20_000)});
      const etag=logicalTag(body);return {etag,httpEtag:'"'+etag+'"'};
    }catch(error){if(headers&&conflict(error,sdk,createOnly))return null;throw error;}
  }
  return {get,put};
}
