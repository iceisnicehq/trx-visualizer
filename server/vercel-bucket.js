import {createHash} from 'node:crypto';
const keyAllowed=key=>key==='flow-atlas/current.json'||/^flow-atlas\/versions\/[a-f0-9]{32}\.json$/.test(key);
const logicalTag=body=>createHash('md5').update(body).digest('hex');
// SDK subclasses keep Error.name="Error"; use the exported constructors.
const conflict=(error,sdk,createOnly)=>(typeof sdk.BlobPreconditionFailedError==='function'&&error instanceof sdk.BlobPreconditionFailedError)
  ||(createOnly&&typeof sdk.BlobError==='function'&&error instanceof sdk.BlobError&&/already exists/i.test(error.message));
function revisionFailure(message){const error=new Error(message);error.code='FLOW_STORAGE_REVISION_MISMATCH';return error;}
/** Private storage belonging only to this Flow deployment. Provider ETags are
 * used for atomic writes; the public revision is a stable 32-character digest. */
export function vercelBucket(sdk,token){
  if(!token)throw Error('Flow storage token is missing.');
  async function metadata(key){
    if(typeof sdk.head!=='function')throw revisionFailure('Flow needs the Blob metadata API to verify replacements. Redeploy the complete Flow package with its pinned storage SDK.');
    try{
      const value=await sdk.head(key,{token,abortSignal:AbortSignal.timeout(15_000)});
      if(!value||typeof value.etag!=='string'||!/^"[^"\r\n]+"$/.test(value.etag))
        throw revisionFailure('Flow storage did not provide a strong write revision. The previous snapshot is retained; verify this Flow project’s private Blob store.');
      return value;
    }catch(error){if(typeof sdk.BlobNotFoundError==='function'&&error instanceof sdk.BlobNotFoundError)return null;throw error;}
  }
  async function get(key){
    if(!keyAllowed(key))throw Error('Invalid Flow storage key.');
    const value=await sdk.get(key,{access:'private',token,useCache:false,abortSignal:AbortSignal.timeout(15_000)});
    if(!value)return null;
    if(value.statusCode!==200||!value.stream)throw Error('Flow storage did not return a complete object.');
    const body=await new Response(value.stream).text(),etag=logicalTag(body);
    return {etag,httpEtag:'"'+etag+'"',text:async()=>body,json:async()=>JSON.parse(body)};
  }
  async function put(key,body,options={}){
    if(!keyAllowed(key))throw Error('Invalid Flow storage key.');
    const headers=options.onlyIf,expected=headers?.get('if-match')?.replaceAll('"','');
    const createOnly=headers?.get('if-none-match')==='*';
    let providerEtag;
    if(expected){
      // The GET response may describe a download representation (for example
      // a weak/compressed ETag). Conditional writes use Blob API metadata.
      // Bracket the uncached content read with metadata reads so an intervening
      // writer cannot bind an old content digest to a newer write revision.
      const before=await metadata(key);if(!before)return null;
      const current=await get(key);if(current?.etag!==expected)return null;
      const after=await metadata(key);if(!after||before.etag!==after.etag)return null;
      providerEtag=after.etag;
    }else if(createOnly){
      const existing=await metadata(key);
      if(existing){
        if(await get(key))return null;
        throw revisionFailure('The saved Flow object exists, but private reads cannot see it. Check that this Flow project uses a private Blob store and the matching BLOB_READ_WRITE_TOKEN; keep the existing data.');
      }
    }
    try{
      await sdk.put(key,body,{access:'private',token,addRandomSuffix:false,allowOverwrite:!createOnly,
        ...(providerEtag?{ifMatch:providerEtag}:{}),contentType:'application/json',cacheControlMaxAge:60,abortSignal:AbortSignal.timeout(20_000)});
      const etag=logicalTag(body);return {etag,httpEtag:'"'+etag+'"'};
    }catch(error){
      if(headers&&conflict(error,sdk,createOnly)){
        const latest=await get(key);
        if(expected&&latest?.etag===expected){
          const latestMetadata=await metadata(key);
          if(latestMetadata?.etag===providerEtag)throw revisionFailure('Flow storage rejected a replacement even though its write revision is unchanged. The previous snapshot is retained. Redeploy the Flow publishing fix; reloading alone cannot resolve this storage mismatch.');
        }
        if(createOnly&&!latest&&await metadata(key))throw revisionFailure('The saved Flow object is invisible to private reads. Verify this Flow project’s private Blob store and matching token; do not delete the existing snapshot.');
        return null;
      }
      throw error;
    }
  }
  return {get,put};
}
