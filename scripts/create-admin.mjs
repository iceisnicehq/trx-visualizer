import {randomBytes,pbkdf2Sync} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const password=randomBytes(24).toString('base64url'),salt=randomBytes(16).toString('hex');
const verifier='pbkdf2-sha256:100000:'+salt+':'+pbkdf2Sync(password,Buffer.from(salt,'hex'),100000,32,'sha256').toString('hex');
const target=process.argv[2]??'flow-atlas-admin.txt';
await writeFile(target,'TRX Flow Atlas — publishing access\n\nWebsite: your own Flow deployment\n\nPublishing password:\n'+password+'\n\nUse Admin upload on the website. This password can publish the shared public dataset. It cannot send TRX or access wallet keys. Keep this file private.\n\nServer-only FLOW_PUBLISH_AUTH (for your own host):\n'+verifier+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify({file:target,verifier}));
