// Native attribute reflection for test-only DOM ports. Keep each port's original
// write hooks so mutation-counting and authority assertions retain their meaning.
const installed=new WeakSet(),values=new WeakMap();
const dataKey=name=>name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
function install(target){
 if(installed.has(target))return;installed.add(target);
 const get=target.getAttribute,set=target.setAttribute,remove=target.removeAttribute;
 const attributes=node=>{let map=values.get(node);if(!map){map=new Map();values.set(node,map);}return map;};
 target.getAttribute=function(name){
  const existing=get?.call(this,name);if(existing!==undefined&&existing!==null)return String(existing);
  if(attributes(this).has(name))return attributes(this).get(name);
  const mapped=this.attributes?.get?.(name)??this.attrs?.get?.(name);
  if(mapped!==undefined&&mapped!==null)return String(mapped);
  return Object.hasOwn(this,name)&&this[name]!==undefined?String(this[name]):null;
 };
 target.setAttribute=function(name,value){
  const text=String(value);set?.call(this,name,text);attributes(this).set(name,text);
  if(name.startsWith('data-')){this.dataset??={};this.dataset[dataKey(name)]=text;}
  if(name==='class')this.className=text;
 };
 target.removeAttribute=function(name){
  remove?.call(this,name);attributes(this).delete(name);this.attributes?.delete?.(name);this.attrs?.delete?.(name);
  if(name.startsWith('data-')&&this.dataset)delete this.dataset[dataKey(name)];
  if(Object.hasOwn(this,name))delete this[name];
  if(name==='class')this.className='';
 };
 target.hasAttribute??=function(name){return this.getAttribute(name)!==null;};
}
export function installDOMAttributes(Ctor){install(Ctor.prototype);}
export function withDOMAttributes(node){install(node);return node;}
