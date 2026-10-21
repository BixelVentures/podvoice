#!/usr/bin/env node
// Measures token membership, not whether the correct semantic token was chosen.
// Source literals are never added to the allowed sets merely because a consumer uses them.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export const REQUIRED_LAYOUT=['paddingTop','paddingRight','paddingBottom','paddingLeft','rowGap','columnGap','borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius'];
const splitList=value=>String(value).split(/,(?![^()]*\))/).map(v=>v.trim());
const canonical=value=>String(value).trim().replace(/\s+/g,'').replace(/(^|[(,])\.(\d)/g,'$10.$2');

export function readTokenContract(css){
 const raw=new Map();
 // Only root declarations, in source order. Component-local overrides are not grants.
 for(const block of css.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/:root\s*\{([^{}]*)\}/g)){
  for(const token of block[1].matchAll(/(--pv-[\w-]+)\s*:\s*([^;]+)(?:;|$)/g))raw.set(token[1],token[2].trim());
 }
 function value(name,seen=new Set()){
  if(seen.has(name))throw new Error(`Cyclic canonical token: ${name}`);
  const found=raw.get(name);if(found===undefined)throw new Error(`Missing canonical token: ${name}`);
  return found.replace(/var\((--pv-[\w-]+)\)/g,(_,ref)=>value(ref,new Set([...seen,name])));
 }
 const categories={fontSize:/^--pv-type-/,fontWeight:/^--pv-(?:type-)?weight-/,spacing:/^--pv-(?:(?:screen-)?space-|s[1-5]$)/,radius:/^--pv-(?:.*radius(?:-|$)|r-(?:s|l|pill)$)/,easing:/^--pv-(?:.*-)?ease(?:-|$)/};
 const contract={};
 for(const [category,pattern]of Object.entries(categories)){
  contract[category]=[...raw.keys()].filter(name=>pattern.test(name)).map(name=>({name,value:canonical(value(name))}));
 }
 return contract;
}

export function checkInventory(inventory,css){
 const violations=[],coverageErrors=[],contract=readTokenContract(css),checked={};
 if(inventory?.schema!=='podview.computed-ui.v1'||!Array.isArray(inventory.elements))throw new Error('Expected podview.computed-ui.v1 with elements[]');
 const sets=Object.fromEntries(Object.entries(contract).map(([key,tokens])=>[key,new Set(tokens.map(t=>t.value))]));
 for(const [key,set]of Object.entries(sets))if(!set.size)coverageErrors.push({category:key,error:'No canonical root tokens declared'});
 const rows=inventory.elements.filter(row=>row.visible===true);
 if(!rows.length)coverageErrors.push({error:'No visible elements measured'});
 function check(row,property,category,structural=[]){
  const supplied=row.styles?.[property];
  if(typeof supplied!=='string'||!supplied.trim()){coverageErrors.push({view:row.view,selector:row.selector,property,error:'Missing computed property'});return;}
  checked[property]=(checked[property]||0)+1;
  const actual=canonical(supplied);
  if(!sets[category].has(actual)&&!structural.includes(actual))violations.push({view:row.view,selector:row.selector,property,actual:supplied,category,allowed:contract[category]});
 }
 for(const row of rows){
  if(typeof row.selector!=='string'||!row.selector||typeof row.view!=='string'||!row.view)coverageErrors.push({error:'Visible record requires selector and view'});
  if(typeof row.directText!=='string')coverageErrors.push({view:row.view,selector:row.selector,error:'directText required to establish typography coverage'});
  if(row.directText?.trim()){
   check(row,'fontSize','fontSize');check(row,'fontWeight','fontWeight');
   // Optional semantic role catches a wrong-but-in-scale body/meta assignment.
   if(['body','meta'].includes(row.textRole)){
    const expected=contract.fontSize.find(t=>t.name===`--pv-type-${row.textRole}`)?.value;
    if(expected&&canonical(row.styles?.fontSize)!==expected)violations.push({view:row.view,selector:row.selector,property:'fontSize',category:'semanticType',actual:row.styles?.fontSize,expected});
   }
  }
  for(const property of REQUIRED_LAYOUT)check(row,property,property.includes('Radius')?'radius':'spacing',property.endsWith('Gap')?['0px','normal']:['0px']);
  for(const prefix of ['transition','animation']){
   const duration=row.styles?.[`${prefix}Duration`],timing=row.styles?.[`${prefix}TimingFunction`];
   if(typeof duration!=='string'||typeof timing!=='string'){coverageErrors.push({view:row.view,selector:row.selector,property:prefix,error:'Duration and timing function required'});continue;}
   const durations=splitList(duration),functions=splitList(timing);
   for(let i=0;i<durations.length;i++){
    if(!/^\d*\.?\d+(ms|s)$/.test(durations[i])){coverageErrors.push({view:row.view,selector:row.selector,property:`${prefix}Duration`,error:'Invalid computed duration'});continue;}
    if(parseFloat(durations[i])===0)continue;
    check({...row,styles:{...row.styles,[`${prefix}TimingFunction`]:functions[i%functions.length]}},`${prefix}TimingFunction`,'easing');
   }
  }
 }
 return {schema:'podview.token-check.v1',ok:violations.length===0&&coverageErrors.length===0,violationCount:violations.length,coverageErrorCount:coverageErrors.length,visibleElementCount:rows.length,views:[...new Set(rows.map(row=>row.view))],checked,violations,coverageErrors,contract,coverage:{included:['text fontSize/fontWeight','optional body/meta semantic roles','four paddings','row/column gap','four corner radii','nonzero-duration transition/animation easing'],excluded:['color/background palette and composited transparency','image pixels','dimensions and borders','margins','line height and letter spacing','offscreen/hidden elements','native user-agent shadow DOM','CSS variable usage at consumer source','semantic role correctness except supplied body/meta'],structuralExceptions:['0px padding/gap/radius','normal gap','zero-duration motion timing is inactive']}};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const path=process.argv[2];if(!path)throw new Error('Usage: node scripts/check-ui-tokens.mjs INVENTORY.json [CANONICAL-components.css]');
  const css=readFileSync(process.argv[3]||new URL('../dist/ui-kit.css',import.meta.url),'utf8');
  const report=checkInventory(JSON.parse(readFileSync(path,'utf8')),css);
  process.stdout.write(`${JSON.stringify(report,null,2)}\n`);process.exitCode=report.ok?0:1;
 }catch(error){process.stderr.write(`Token check failed: ${error.message}\n`);process.exitCode=1;}
}
