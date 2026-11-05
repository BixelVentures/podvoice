// The committed renderer remains gatekeeper/static/podview. Local kit/build
// tools use dist as a disposable staging directory; never overwrite active work.
import {access,cp,readFile,readdir,mkdir,writeFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const generated=name=>name==='asset-manifest.json'||name==='podview.css'||name.endsWith('.bundle.js');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const safePath=name=>typeof name==='string'&&name.length>0&&!name.includes('\\')&&!name.startsWith('/')&&name.split('/').every(part=>part!==''&&part!=='.'&&part!=='..');
async function files(root,relative=''){
 const result=[];
 for(const entry of await readdir(path.join(root,relative),{withFileTypes:true})){
  const name=relative?`${relative}/${entry.name}`:entry.name;
  if(entry.isDirectory())result.push(...await files(root,name));
  else if(entry.isFile())result.push(name);
  else if(!generated(name))throw Error(`PodView staging contains unsupported entry: ${name}`);
 }
 return result;
}

export async function prepareCheckout({source=path.join(projectRoot,'podvoice/gatekeeper/static/podview'),staging=path.join(projectRoot,'dist')}={}){
 let exists=true;
 try{await access(staging);}catch(error){if(error.code!=='ENOENT')throw error;exists=false;}
 if(!exists){
  await access(path.join(source,'widget-view.js'));
  await cp(source,staging,{recursive:true,errorOnExist:true,force:false});
  return;
 }
 const manifest=JSON.parse(await readFile(path.join(source,'asset-manifest.json'),'utf8'));
 if(!manifest||manifest.schema!=='podview.assets.v1'||!Array.isArray(manifest.files))throw Error('Invalid PodView asset manifest');
 const baseline=new Map();
 for(const entry of manifest.files){
  if(!entry||!safePath(entry.path)||!/^[a-f0-9]{64}$/.test(entry.sha256)||baseline.has(entry.path))throw Error('Invalid PodView asset manifest entry');
  baseline.set(entry.path,entry.sha256);
 }
 const sourceFiles=(await files(source)).filter(name=>!generated(name));
 const stagedFiles=(await files(staging)).filter(name=>!generated(name));
 const sourceSet=new Set(sourceFiles),stagedSet=new Set(stagedFiles),copies=[];
 for(const name of baseline.keys())if(!generated(name)&&!sourceSet.has(name))throw Error(`PodView canonical file missing: ${name}`);
 for(const name of stagedFiles)if(!sourceSet.has(name))throw Error(`PodView staging-only file: ${name}`);
 for(const name of sourceFiles){
  const current=await readFile(path.join(source,name));
  if(!stagedSet.has(name)){if(baseline.has(name))throw Error(`PodView staging conflict: ${name} is missing`);try{await lstat(path.join(staging,name));throw Error(`PodView staging conflict: ${name} is not a file`);}catch(error){if(error.code!=='ENOENT')throw error;}copies.push({name,current});continue;}
  const existing=await readFile(path.join(staging,name));
  if(current.equals(existing))continue;
  if(baseline.get(name)!==digest(existing))throw Error(`PodView staging conflict: ${name}`);
  copies.push({name,current});
 }
 // All conflicts are checked before any staged file is written.
 for(const {name,current} of copies){const target=path.join(staging,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,current);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await prepareCheckout();
