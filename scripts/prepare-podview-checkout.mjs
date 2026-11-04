// The committed renderer remains gatekeeper/static/podview. Local kit/build
// tools use dist as a disposable staging directory; never overwrite active work.
import {access,cp} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const staging=new URL('../dist/',import.meta.url);
let exists=true;
try{await access(staging);}catch(error){if(error.code!=='ENOENT')throw error;exists=false;}
if(!exists){
 const source=new URL('../podvoice/gatekeeper/static/podview/',import.meta.url);
 await access(new URL('widget-view.js',source));
 await cp(fileURLToPath(source),fileURLToPath(staging),{recursive:true,errorOnExist:true,force:false});
}
