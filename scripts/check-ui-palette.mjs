#!/usr/bin/env node
// Checks computed CSS colors against the supplied kit, never image pixels or
// perceived contrast. Alpha retains palette identity; composited colors do not.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const NAMES=['bg','surface','surface-2','line','ink','ink-2','ink-3','on-dark','dark','danger','danger-tint','weather','weather-strong','weather-ink','robot','robot-strong','robot-ink','light','light-strong','light-ink','tesla','tesla-strong','tesla-ink','clock-night'];
export function parseColor(value){
 const v=String(value).trim().toLowerCase();
 if(v==='transparent')return [0,0,0,0];
 if(/^#[0-9a-f]{3,8}$/.test(v)){let h=v.slice(1);if([3,4].includes(h.length))h=[...h].map(c=>c+c).join('');if(![6,8].includes(h.length))return null;return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)).concat(h.length===8?parseInt(h.slice(6),16)/255:1);}
 const m=v.match(/^(rgba?|color)\((.*)\)$/);if(!m)return null;
 let body=m[2],srgb=false;if(m[1]==='color'){if(!body.startsWith('srgb '))return null;body=body.slice(5);srgb=true;}
 const p=body.split(/[\s,/]+/).filter(Boolean);if(p.length<3||p.length>4)return null;
 const result=p.map((part,i)=>Number.parseFloat(part)*(part.endsWith('%')?(i===3?0.01:2.55):(srgb&&i<3?255:1)));
 if(result.some(x=>!Number.isFinite(x)))return null;return [...result.slice(0,3),result[3]??1];
}
export function paletteContract(css){return NAMES.map(name=>{const value=css.match(new RegExp(`--pv-${name}\\s*:\\s*(#[a-fA-F0-9]+)`))?.[1];if(!value)throw Error(`Missing canonical kit color --pv-${name}`);return {name:`--pv-${name}`,value,channels:parseColor(value)};});}
export function checkPaletteInventory(inventory,css){
 if(inventory?.schema!=='podview.computed-ui.v1'||!Array.isArray(inventory.elements))throw Error('Expected podview.computed-ui.v1 elements[]');
 const contract=paletteContract(css),violations=[],coverageErrors=[],checked={};let visibleElementCount=0,transparentCount=0;
 for(const row of inventory.elements){if(row.visible!==true)continue;visibleElementCount++;
  for(const property of ['color','backgroundColor']){
   const raw=row.styles?.[property];if(typeof raw!=='string'||!raw.trim()){coverageErrors.push({view:row.view,selector:row.selector,property,error:'Missing computed color'});continue;}
   const color=parseColor(raw);if(!color){coverageErrors.push({view:row.view,selector:row.selector,property,error:'Unsupported computed color syntax',actual:raw});continue;}
   checked[property]=(checked[property]||0)+1;if(color[3]===0){transparentCount++;continue;}
   if(!contract.some(token=>token.channels.slice(0,3).every((channel,i)=>Math.abs(channel-color[i])<=1)))violations.push({view:row.view,selector:row.selector,property,actual:raw});
  }
 }
 if(!visibleElementCount)coverageErrors.push({error:'No visible elements measured'});
 return {schema:'podview.palette-check.v1',ok:!violations.length&&!coverageErrors.length,visibleElementCount,checked,transparentCount,violationCount:violations.length,coverageErrorCount:coverageErrors.length,violations,coverageErrors,contract,coverage:{included:['visible computed foreground and backgroundColor','palette base channels with original alpha'],excluded:['image pixels and cover-derived tones','background-image gradients','shadows and borders','perceived composited color','opacity inherited from parents','contrast ratio','hidden and offscreen elements','native user-agent shadow DOM'],structuralExceptions:['fully transparent computed colors']}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(!process.argv[2])throw Error('Usage: node scripts/check-ui-palette.mjs INVENTORY.json [ui-kit.css]');const result=checkPaletteInventory(JSON.parse(readFileSync(process.argv[2],'utf8')),readFileSync(process.argv[3]||new URL('../dist/ui-kit.css',import.meta.url),'utf8'));console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:1;}catch(error){console.error(`Palette check failed: ${error.message}`);process.exitCode=1;}
}
