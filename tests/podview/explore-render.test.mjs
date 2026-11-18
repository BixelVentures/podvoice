// Udforsk (docs/MOTION.md): the cover flow is a pure function of the fractional index p. At whole p it
// is the canvas (Opskrifter-Bog); between whole values it is continuous, the title fades through 0 at .5 and the
// dots weigh 1−|k−p|. Reduced stands flat.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {exploreFrame,exploreKeyframes} from '../../podview/recipe-view.js';

const parse=transform=>{
 const m=/translate3d\((-?[\d.e-]+)px,0,(-?[\d.e-]+)px\) rotateY\((-?[\d.e-]+)deg\)/.exec(transform);
 return {x:Number(m[1])+0,z:Number(m[2])+0,ry:Number(m[3])+0};
};

test('whole p is exactly the canvas: flat centre, neighbours 430+110·(a−1), −260−60·(a−1), 55° away, shade .18',()=>{
 const frame=exploreFrame(4,12);
 assert.deepEqual(parse(frame.covers[4].transform),{x:0,z:0,ry:0});assert.equal(frame.covers[4].shade,0);
 for(const [k,x,z,ry]of [[5,430,-260,-55],[3,-430,-260,55],[6,540,-320,-55],[1,-650,-380,55]]){
  const c=parse(frame.covers[k].transform);
  assert.deepEqual([c.x,c.z,c.ry],[x,z,ry],`cover ${k}`);assert.equal(frame.covers[k].shade,.18);
 }
 assert.equal(frame.covers[0].visibility,'hidden','past 3.5 covers is hidden, not transparent');
 assert.equal(frame.covers[8].visibility,'hidden');assert.equal(frame.covers[7].visibility,'visible');
 assert.equal(frame.textOpacity,1);assert.equal(frame.index,4);
});

test('between whole values everything is continuous, and the turn eases in without a kink',()=>{
 for(const k of [5,6]){
  const a=parse(exploreFrame(4.999,12).covers[k].transform),b=parse(exploreFrame(5.001,12).covers[k].transform);
  assert(Math.abs(a.x-b.x)<2&&Math.abs(a.z-b.z)<1&&Math.abs(a.ry-b.ry)<1,`continuous at cover ${k}`);
 }
 const near=parse(exploreFrame(4.98,12).covers[5].transform);
 assert(Math.abs(near.x-430*.02)<1e-6,'1:1 near the centre');
 const centre=parse(exploreFrame(4.98,12).covers[5].transform);assert(centre.ry<0);
 const flat=parse(exploreFrame(4.02,12).covers[4].transform);assert(Math.abs(flat.ry)<.1,'smoothstep: flat at d=0');
 assert.equal(exploreFrame(4.5,12).textOpacity,0,'the title is invisible at the crossing');
 assert.equal(exploreFrame(4.25,12).textOpacity,.5);
});

test('photos shift ±24px per cover for parallax; reduced stands flat and keeps the photos still',()=>{
 assert.equal(exploreFrame(4,12).covers[5].parallax,'translateX(-24px)');
 const flat=exploreFrame(4.3,12,{reduced:true});
 for(const cover of flat.covers.filter(c=>c.visibility==='visible')){
  const c=parse(cover.transform);assert.equal(c.ry,0);assert.equal(c.z,0);assert.equal(cover.parallax,'none');
 }
});

test('seven dots weigh 1−|k−p| and push each other, the window starts at round(p)−3, edge dots are small',()=>{
 const whole=exploreFrame(5,20).dots;assert.equal(whole.start,2);assert.equal(whole.items.length,7);
 assert.equal(whole.items[3].opacity,1);assert.match(whole.items[3].transform,/translateX\(48px\) scale\(3,1\)/);
 assert.match(whole.items[4].transform,/translateX\(80px\)/,'the wide dot pushes the next one');
 assert.match(whole.items[0].transform,/scale\(0\.6,0\.6\)/,'cut edge');assert.equal(whole.items[0].opacity,.35);
 const half=exploreFrame(5.5,20).dots;
 assert.equal(half.items.find(d=>d.k===5).opacity,half.items.find(d=>d.k===6).opacity,'shared at the crossing');
 assert.equal(exploreFrame(0,3).dots.items.length,3);
});

test('the stylesheet carries exactly the sampled keyframes, and covers move only with the scroll',()=>{
 const css=readFileSync(new URL('../../podview/ui-kit.css',import.meta.url),'utf8');
 const rule=(name,frames,body)=>`@keyframes ${name}{\n`+frames.map(f=>` ${f.offset}%{${body(f)}}`).join('\n')+'}';
 const cover=f=>`transform:${f.transform};z-index:${f.z}`+(Math.abs(f.d)===3.5?';visibility:visible':'');
 const full=exploreKeyframes(),flat=exploreKeyframes({reduced:true});
 assert.ok(css.includes(rule('pv-explore-cover',full,cover)),'pv-explore-cover');
 assert.ok(css.includes(rule('pv-explore-cover-flat',flat,cover)),'pv-explore-cover-flat');
 assert.ok(css.includes(rule('pv-explore-shade',full,f=>`opacity:${f.shade}`)),'pv-explore-shade');
 assert.ok(css.includes(rule('pv-explore-photo',full,f=>`transform:${f.photo}`)),'pv-explore-photo');
 // A native snap scroller; each slot is a view-timeline subject, the range ±3.5 covers around the centre.
 assert.match(css,/scroll-snap-type:x mandatory/);assert.match(css,/view-timeline:--pv-cover inline/);
 assert.match(css,/animation-range:cover calc\(50% - 1505px\) cover calc\(50% \+ 1505px\)/);
 assert.match(css,/@supports not \(animation-timeline:view\(\)\)/,'a flat snap carousel without scroll timelines');
 const cover0=css.slice(css.indexOf('#recipe-view#recipe-view#recipe-view [data-recipe-cover]{'));
 assert.doesNotMatch(cover0.slice(0,cover0.indexOf('}')),/transition|filter|will-change/);
 const source=readFileSync(new URL('../../podview/recipe-view.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/attachSwipeTrack|requestAnimationFrame\(draw|pvMoving|brightness\(/);
 assert.match(source,/flow\.addEventListener\('scroll',scrolled,\{passive:true\}\)/);
 assert.match(source,/flow\.dataset\.pvGestureOwner = ''/);
});

test('at whole d the keyframes are the canvas, measured from the flow centre',()=>{
 const at=d=>exploreKeyframes().find(f=>f.d===d);
 assert.equal(at(0).transform,'translateX(0px) perspective(1600px) translate3d(0px,0,0px) rotateY(0deg)');
 assert.equal(at(1).transform,'translateX(-430px) perspective(1600px) translate3d(430px,0,-260px) rotateY(-55deg)');
 assert.equal(at(-3.5).transform,'translateX(1505px) perspective(1600px) translate3d(-705px,0,-410px) rotateY(55deg)');
 assert.deepEqual([at(0).offset,at(1).offset,at(3.5).offset,at(-3.5).offset],[50,35.714,0,100]);
 assert.deepEqual([at(0).z,at(1).z,at(3.5).z],[20,19,16]);assert.deepEqual([at(0).shade,at(1).shade],[0,.18]);
 assert.equal(exploreKeyframes({reduced:true}).find(f=>f.d===1).transform,
  'translateX(-430px) perspective(1600px) translate3d(430px,0,0px) rotateY(0deg)');
});
