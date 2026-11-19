import {deliveredStylesheet} from '../../podview/build/legacy-styles.mjs';
// Every animation PodView ships can run on the compositor in WebKit (the wall iPad's engine; docs/MOTION.md §0).
// WebKit's Core Animation path accelerates only transform (and translate/scale/rotate), opacity and filter, and only
// with a keyword or cubic-bezier easing: an easing with linear() points is never accelerated
// (KeyframeEffect::canBeAccelerated), and an animated width, top, box-shadow, clip-path or stroke-dasharray is
// laid out or painted on the main thread every frame. This scans the shipped stylesheets and the JS sources:
// - no linear( easing anywhere, except the two modules that compute or parse spring curves;
// - podview.css (the delivered stylesheet) @keyframes and transitions animate only composited properties, discrete
//   ones (visibility, display), or colour fades (repaint of one element, no layout); anything else is in
//   GEOMETRY_ALLOWED below, with the reason;
// - element.animate() keyframes written as literals name only composited properties.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('../../podview/',import.meta.url));
const walk=dir=>readdirSync(dir).flatMap(name=>{const file=path.join(dir,name);
 return statSync(file).isDirectory()?walk(file):[file];});
const files=walk(ROOT).map(file=>path.relative(ROOT,file).split(path.sep).join('/'));
// Generated bundles carry the Motion library, which builds linear() strings it is never asked for; their sources
// are scanned instead.
const BUNDLES=new Set(['podview.bundle.js','library.bundle.js']);
const cssFiles=files.filter(file=>file.endsWith('.css'));
const jsFiles=files.filter(file=>file.endsWith('.js')&&!BUNDLES.has(file)
 &&!file.startsWith('public/')&&!file.startsWith('build/'));
// The delivered stylesheet is composed from the stage sources at build time.
const read=file=>file==='podview.css'?deliveredStylesheet():readFileSync(path.join(ROOT,file),'utf8');
const stripComments=(text,js=false)=>text.replace(/\/\*[\s\S]*?\*\//g,'')
 .replace(js?/(^|[^:\\'"`])\/\/.*$/gm:/$^/,'$1');

const COMPOSITED=new Set(['opacity','transform','translate','scale','rotate','filter','-webkit-filter']);
const DISCRETE=new Set(['visibility','display','overlay','content-visibility','pointer-events','z-index']);
const COLOUR=new Set(['color','background-color','background','border-color','fill','stroke','outline-color',
 'caret-color','text-decoration-color','-webkit-text-fill-color']);
// Not composited, kept on purpose: [property, selector pattern, why]. Each must still exist (no stale entries).
const GEOMETRY_ALLOWED=[
 // The timer ring's progress is the stroke's dash length: a tick is one linear step per second, a user change one
 // smooth spring. Repaint of a 64 px SVG arc, no layout. A transform alternative is a rotated half-disc mask pair
 // per ring (two more layers per ring), which costs more than it saves.
 ['stroke-dasharray',/\.(timer|pv-dial)-progress$/,'timer ring and dial progress'],
 // The radio needle sits at a percentage of the scale, which translate (a percentage of the needle) cannot say
 // without new markup. One 4 px element, laid out on a station change. Transform alternative: make the needle a
 // full-width box drawn by its ::after at its right edge and slide it with translate:calc(<pos> - 100%) 0.
 ['left',/\.radio-scale-needle$/,'radio needle position'],
 // An answer widget folding open or shut reflows the content under it; a transform would have to FLIP every
 // following sibling. Only on an explicit tap, not during navigation.
 ['grid-template-rows',/\.pv-disclosure$/,'answer widget disclosure'],
];
// The rules of a stylesheet as [selector or @keyframes name, body] pairs, through nested at-rules.
function blocks(css){
 const out=[],stack=[];let start=0,depth=0;
 for(let i=0;i<css.length;i++){
  if(css[i]==='{'){stack.push(css.slice(start,i).trim());start=i+1;depth++;}
  else if(css[i]==='}'){const head=stack.pop();out.push({head,body:css.slice(start,i),parents:[...stack]});
   start=i+1;depth--;}
 }
 return out;
}
const declarations=body=>body.split(';').map(part=>part.replace(/[^{}]*\{[^{}]*$/,'')).map(part=>{
 const colon=part.indexOf(':');
 return colon<0?null:[part.slice(0,colon).trim().toLowerCase(),part.slice(colon+1).trim()];
}).filter(Boolean);
const splitTop=value=>{const parts=[];let depth=0,last=0;
 for(let i=0;i<value.length;i++){if(value[i]==='(')depth++;else if(value[i]===')')depth--;
  else if(value[i]===','&&!depth){parts.push(value.slice(last,i));last=i+1;}}
 parts.push(value.slice(last));return parts.map(part=>part.trim()).filter(Boolean);};
// Properties a transition shorthand or transition-property animates.
function transitioned(name,value){
 const clean=value.replace(/!important/g,'').trim();
 if(name==='transition-property')return splitTop(clean).filter(p=>p!=='none');
 return splitTop(clean).map(item=>item.split(/\s+/)[0]).filter(first=>first&&first!=='none'&&
  !/^(-?[\d.]+m?s|var\(|calc\(|ease|linear|cubic-bezier|steps|step-|initial|inherit|unset|revert)/.test(first));
}
function animated(file){
 const css=stripComments(read(file)),found=[];
 for(const {head,body,parents}of blocks(css)){
  const keyframes=parents.find(parent=>/^@(-webkit-)?keyframes\b/.test(parent));
  for(const [name,value]of declarations(body)){
   if(keyframes&&!name.startsWith('--')&&name!=='offset'&&!name.startsWith('animation-timing')&&name!=='easing')
    found.push({kind:'keyframes',property:name,where:`${keyframes} ${head}`});
   if(!keyframes&&(name==='transition'||name==='transition-property'))
    for(const property of transitioned(name,value))found.push({kind:'transition',property,where:head});
  }
 }
 return found;
}
const allowed=({property})=>COMPOSITED.has(property)||DISCRETE.has(property)||COLOUR.has(property)||
 property.startsWith('--');

test('no linear() easing in any shipped stylesheet',()=>{
 for(const file of cssFiles)assert.ok(!/\blinear\(/.test(stripComments(read(file))),`${file} has a linear() easing`);
});

test('no linear() easing in the JS, except where spring curves are computed or parsed',()=>{
 // motion.js computes springCurve() (CSS tokens are fitted from it); native-motion.js parses Motion's curve into
 // sampled keyframes (springFrames). Neither hands a linear() easing to an animation.
 const producers=new Set(['ui/motion.js','ui/native-motion.js']);
 for(const file of jsFiles){
  if(producers.has(file))continue;
  assert.ok(!/linear\(/.test(stripComments(read(file),true)),`${file} has a linear() easing`);
 }
 const motion=stripComments(read('ui/motion.js'),true);
 // SceneMotion's springs (digits, toast, hero, sheet) take the fitted cubic-bezier, not springCurve()'s linear().
 for(const name of ['snappy','smooth','quick'])
  assert.match(motion,new RegExp(`=springBezier\\(SPRING\\.${name}\\)`),`${name} uses the fitted cubic-bezier`);
 assert.equal((motion.match(/linear\(/g)||[]).length,1,'ui/motion.js writes linear() only in springCurve()');
});

test('podview.css animates only composited, discrete or colour properties, plus the listed exceptions',()=>{
 const seen=new Set(),offenders=[];
 for(const item of animated('podview.css')){
  if(allowed(item))continue;
  const entry=GEOMETRY_ALLOWED.find(([property,selector])=>property===item.property&&selector.test(item.where));
  if(entry){seen.add(entry);continue;}
  offenders.push(`${item.kind} ${item.property} (${item.where.slice(0,100)})`);
 }
 assert.deepEqual(offenders,[],'non-composited animation; make it transform/opacity or list it with a reason');
 for(const entry of GEOMETRY_ALLOWED)assert.ok(seen.has(entry),`${entry[2]} is allowed but no longer animates`);
});

// The first argument of every element.animate( call, when it is written as a literal.
function animateFrames(source){
 const out=[];let at=0;
 while((at=source.indexOf('.animate(',at))>=0){
  let i=at+9,depth=1,start=i;
  for(;i<source.length&&depth;i++){const c=source[i];
   if('([{'.includes(c))depth++;else if(')]}'.includes(c))depth--;
   else if(c===','&&depth===1)break;}
  out.push(source.slice(start,i).trim());at=i;
 }
 return out;
}
test('element.animate() keyframe literals name only composited properties',()=>{
 const keys=new Set([...COMPOSITED,'visibility','offset','easing','composite','transformOrigin']),offenders=[];
 for(const file of jsFiles){
  for(const frames of animateFrames(stripComments(read(file),true))){
   if(!/^[[{]/.test(frames))continue;// a variable; its builder is covered where it is written
   for(const [,key]of frames.matchAll(/[{,]\s*([A-Za-z]+)\s*:/g))
    if(!keys.has(key))offenders.push(`${file}: ${key} in ${frames.slice(0,80)}`);
  }
 }
 assert.deepEqual(offenders,[]);
});
