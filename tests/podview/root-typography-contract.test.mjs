import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sources=['ui/components.css','widget-view.css','ui/library/library.css','frame-layout.css','widget-redesign.css','timer-notice.css','live-music.css'];
const read=name=>readFileSync(new URL(`../../podvoice/gatekeeper/static/podview/${name}`,import.meta.url),'utf8');

test('all seven shipped CSS owners use named font-size roles, never literal sizes',()=>{
 for(const name of sources){
  const css=read(name).replace(/\/\*[\s\S]*?\*\//g,'');
  for(const match of css.matchAll(/font-size\s*:\s*([^;}]+)/g)){
   const value=match[1].replace(/!important\s*$/, '').trim();
   assert.ok(/^(?:var\(--[\w-]+\)|inherit|0(?:px)?)$/.test(value),`${name}: ungoverned font-size ${value}`);
  }
 }
});

test('the canonical font ramp has the explicit product sizes',()=>{
 const css=read('ui/components.css');
 const expected={caption:15,'card-value':17,'card-title':20,title:28,display:40,value:64,clock:128};
 for(const [role,size] of Object.entries(expected)){
  const declarations=[...css.matchAll(new RegExp(`--pv-type-${role}:([^;}]+)`,'g'))];
  assert.equal(declarations.length,1,`primitive ${role} has one owner`);
  assert.equal(declarations[0][1],`${size}px`,role);
 }
 const primitives=[...css.matchAll(/--pv-type-[\w-]+:([\d.]+)px/g)].map(m=>Number(m[1]));
 assert.deepEqual([...new Set(primitives)].sort((a,b)=>a-b),Object.values(expected));
});
