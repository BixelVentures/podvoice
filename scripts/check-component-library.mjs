import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const CANONICAL_RENDERERS=['MusicResults','PlayerView','TimerView','VoiceSurface','AnswerWidget','LibraryComponent','VisualComponent','renderWeather','createResourceTile','updateResourceTile'];
const CONTAINERS=new Set(['div','article','section','aside','dialog','header','footer','nav','main','form','ol','ul','dl','table','figure','details','button']);
const sorted=value=>[...new Set(value)].sort();
const relative=(root,file)=>path.relative(root,file).split(path.sep).join('/');
const count=values=>Object.fromEntries(sorted(values).map(value=>[value,values.filter(x=>x===value).length]));
// A deliberately small source-surface scanner, not a JavaScript security parser.
// It masks comments/quoted text before finding declarations. HTML/factory roots
// are inspected separately. Native leaf elements are intentionally unrestricted.
function mask(source){
 let result='',i=0;while(i<source.length){const c=source[i],next=source[i+1];if(c==='/'&&next==='/'){let end=source.indexOf('\n',i);if(end<0)end=source.length;result+=' '.repeat(end-i);i=end;}else if(c==='/'&&next==='*'){let end=source.indexOf('*/',i+2);if(end<0)throw Error('Unclosed source comment');end+=2;result+=source.slice(i,end).replace(/[^\n]/g,' ');i=end;}else if("'\"`".includes(c)){const quote=c,start=i++;while(i<source.length){if(source[i]==='\\'){i+=2;continue;}if(source[i++]===quote)break;}result+=source.slice(start,i).replace(/[^\n]/g,' ');}else{result+=c;i++;}}return result;
}
export function inspectSurface(source,{factoryClassArgument=1}={}){
 const code=mask(source),definitions=[];
 for(const m of code.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g))definitions.push(`class:${m[1]}`);
 for(const m of code.matchAll(/\bfunction\s*\*?\s+([A-Za-z_$][\w$]*)\s*\(/g))definitions.push(`function:${m[1]}`);
 for(const m of code.matchAll(/(?:^|[;{}\n])\s*(?:(?:async|get|set)\s+)?([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*\{/g))if(!['if','for','while','switch','catch','with'].includes(m[1]))definitions.push(`method:${m[1]}`);
 for(const m of code.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^;{}]*?\)|[A-Za-z_$][\w$]*)\s*=>/g))definitions.push(`arrow:${m[1]}`);
 const roots=[];
 // HTML template/string roots. Interpolated class names need explicit review;
 // the original expression is retained, so a new family expression is detected.
 for(const m of source.matchAll(/<(div|article|section|aside|dialog|header|footer|nav|main|form|ol|ul|dl|table|figure|details|button)\b[^>]*\bclass\s*=\s*["']([^"']*)["']/g))roots.push(`html:${m[1]}:${m[2]}`);
 // Existing files use make(tag, class) or make(tag, text, class). Capturing the
 // argument expression also fences dynamically assembled container classes.
 for(const m of source.matchAll(/\bmake\(\s*(['"])([a-z-]+)\1\s*((?:,[^;\n]*?)?)\)/g)){
  if(!CONTAINERS.has(m[2]))continue;const args=m[3].replace(/^\s*,/,'').split(',');const cls=args[factoryClassArgument-1]?.trim();if(cls&&cls!=='undefined'&&cls!=='null')roots.push(`factory:${m[2]}:${cls}`);
 }
 // Native createElement + className assignments (MusicResults/PlayerView etc).
 const variables=new Map();for(const m of source.matchAll(/\b([\w$]+)\s*=\s*(?:[\w$.]+\.)?createElement\(\s*['"]([a-z-]+)['"]\s*\)/g))if(CONTAINERS.has(m[2]))variables.set(m[1],m[2]);
 for(const m of source.matchAll(/\b([\w$]+)\.className\s*=\s*(['"])([^'"\n]*)\2/g))if(variables.has(m[1]))roots.push(`native:${variables.get(m[1])}:${m[3]}`);
 const customTags=sorted([...source.matchAll(/<([a-z][a-z0-9]*-[a-z0-9-]+)\b|(?:createElement|make)\(\s*['"]([a-z][a-z0-9]*-[a-z0-9-]+)['"]/g)].map(m=>m[1]||m[2]));
 const registrations=[...source.matchAll(/customElements\.define\(\s*([^,\n]+)/g)].map(m=>m[1].trim());
 const rendererCalls=count([...code.matchAll(new RegExp('\\b('+CANONICAL_RENDERERS.join('|')+')\\s*\\(','g'))].map(m=>m[1]));
 return {customElementAccesses:(code.match(/\bcustomElements\b/g)||[]).length,rendererCalls,definitions:count(definitions),roots:sorted(roots),registrations:count(registrations),customTags,dom:/\bcreateElement\s*\(|\.(?:innerHTML|outerHTML)\s*[+]?=|\.(?:replaceChildren|replaceWith|append|prepend|appendChild|insertBefore|insertAdjacentHTML|attachShadow|cloneNode)\s*\(/.test(code)};
}
function differences(actual,allowed){return actual.filter(x=>!allowed.includes(x));}
function staticImports(source){
 const code=mask(source),imports=[],unsupported=[];
 for(const found of code.matchAll(/\b(import|export)\b/g)){
  const tail=source.slice(found.index),match=tail.match(/^(?:import\s*(?:[\w$*{},\s]+?\s*from\s*)?|export\s*[\w$*{},\s]+?\s*from\s*)['"]([^'"]+)['"]/);
  if(match)imports.push(match[1]);else if(found[1]==='import'&&!/^import\s*\./.test(code.slice(found.index)))unsupported.push(found.index);
 }
 return {imports,unsupported};
}
function htmlSurface(source){return {scripts:[...source.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map(m=>m[1]),styles:[...source.matchAll(/<link\b[^>]*\bhref=["']([^"']+\.css)["']/g)].map(m=>m[1]),roots:inspectSurface(source).roots};}
function validateComponentLibrary({root=process.cwd(),registryPath='docs/component-library-registry.json'}={}){
 const errors=[],notes=[];let registry;try{registry=JSON.parse(fs.readFileSync(path.join(root,registryPath),'utf8'));}catch(error){return {ok:false,errors:[`Registry unavailable: ${error.message}`],notes};}
 if(!registry.modules||!Array.isArray(registry.entrypoints)||!Array.isArray(registry.referenceOnlyFiles)||!registry.catalog||!Array.isArray(registry.sharedContracts))return {ok:false,errors:['Malformed component-library registry'],notes};
 if(registry.schema!==1||registry.approval?.authority!=='human-user'||!registry.approval?.request||!registry.approval?.date)errors.push('Missing explicit component-library approval authority');
 const visited=new Set();
 const known=new Set([...Object.keys(registry.modules),...registry.referenceOnlyFiles,...registry.entrypoints.flatMap(entry=>[entry.path,...entry.styles.map(style=>path.posix.join(path.posix.dirname(entry.path),style))])]);
 function inventory(dir){for(const item of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const file=path.posix.join(dir,item.name);if(item.isDirectory())inventory(file);else if(/\.(?:m?js|html|css)$/.test(item.name)&&!known.has(file))errors.push(`Unregistered product source file: ${file}`);}}
 inventory('dist');
 function walk(file){
  if(visited.has(file))return;visited.add(file);const rule=registry.modules[file];if(!rule){errors.push(`Unregistered active module: ${file}`);return;}
  let source;try{source=fs.readFileSync(path.join(root,file),'utf8');}catch{errors.push(`Missing active module: ${file}`);return;}
  if(/\bimport\s*\(/.test(mask(source)))errors.push(`${file}: dynamic imports require an explicit reviewed graph contract`);
  const actual=inspectSurface(source,rule),expected=rule.surface;
  for(const[key,value]of Object.entries(actual.rendererCalls))if(value>(expected.rendererCalls?.[key]||0))errors.push(`${file}: shared renderer construction/call moved outside its registered route: ${key}`);
  if(actual.dom&&!rule.domOwner)errors.push(`${file}: DOM construction outside a registered renderer/debt owner`);
  if(actual.dom||rule.domOwner){
   for(const[key,value]of Object.entries(actual.definitions))if(value>(expected.definitions[key]||0))errors.push(`${file}: unregistered renderer declaration ${key}`);
   for(const root of differences(actual.roots,expected.roots))errors.push(`${file}: unregistered container anatomy ${root}`);
  }
  for(const tag of differences(actual.customTags,expected.customTags))errors.push(`${file}: unregistered component use ${tag}`);
  if(actual.customElementAccesses>expected.customElementAccesses)errors.push(`${file}: custom element registration/access outside registered ownership`);
  if(JSON.stringify(actual.registrations)!==JSON.stringify(expected.registrations))errors.push(`${file}: custom element ownership changed`);
  const dependencies=staticImports(source);if(dependencies.unsupported.length)errors.push(`${file}: unsupported import syntax requires explicit graph review`);
  for(const specifier of dependencies.imports){
   if(!specifier.startsWith('.')){errors.push(`${file}: external module ${specifier} needs review`);continue;}
   const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),specifier));
   if(!target.startsWith('dist/')){errors.push(`${file}: import escapes product dist`);continue;}
   if(!rule.imports.includes(target))errors.push(`${file}: unregistered renderer/import edge to ${target}`);walk(target);
  }
  for(const contract of rule.requiredCalls||[])if(!new RegExp(contract,'s').test(mask(source)))errors.push(`${file}: shared renderer route missing: ${contract}`);
  if(rule.status==='unapproved-debt')notes.push(`Unapproved debt retained: ${file} (${rule.debt})`);
 }
 for(const entry of registry.entrypoints){let html;try{html=fs.readFileSync(path.join(root,entry.path),'utf8');}catch{errors.push(`Missing entrypoint ${entry.path}`);continue;}const actual=htmlSurface(html);for(const tag of differences(inspectSurface(html).customTags,entry.customTags))errors.push(`${entry.path}: unregistered component use ${tag}`);if(JSON.stringify(actual.scripts)!==JSON.stringify(entry.scripts))errors.push(`${entry.path}: entry scripts changed`);if(JSON.stringify(actual.styles)!==JSON.stringify(entry.styles))errors.push(`${entry.path}: stylesheet ownership changed`);for(const x of differences(actual.roots,entry.roots))errors.push(`${entry.path}: unregistered container anatomy ${x}`);for(const script of actual.scripts)walk(path.posix.join(path.posix.dirname(entry.path),script));}
 for(const[file,rule]of Object.entries(registry.modules))if(!visited.has(file))errors.push(`Registry module no longer active; review/remove stale ownership: ${file}`);
 const catalog=fs.readFileSync(path.join(root,'dist/ui/library/catalog.js'),'utf8');const ids=[...catalog.matchAll(/^\s*\['([^']+)'/gm)].map(m=>m[1]);if(JSON.stringify(ids)!==JSON.stringify(Object.keys(registry.catalog)))errors.push('Catalogue families changed: new roles require specification and human approval');
 for(const required of registry.sharedContracts){const source=fs.readFileSync(path.join(root,required.path),'utf8');for(const phrase of required.patterns)if(!new RegExp(phrase,'s').test(source))errors.push(`${required.path}: missing shared anatomy contract: ${phrase}`);}
 return {ok:errors.length===0,errors,notes,modules:visited.size};
}
export function checkComponentLibrary(options={}){try{return validateComponentLibrary(options);}catch(error){return {ok:false,errors:[`Component gate could not complete: ${error.message}`],notes:[]};}}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){const index=process.argv.indexOf('--root');const result=checkComponentLibrary({root:index>=0?path.resolve(process.argv[index+1]):process.cwd()});for(const error of result.errors)console.error(`FAIL ${error}`);for(const note of result.notes)console.log(`DEBT ${note.slice('Unapproved debt retained: '.length)}`);console.log(`${result.ok?'PASS':'FAIL'} component library (${result.modules||0} active modules)`);if(!result.ok)process.exitCode=1;}
