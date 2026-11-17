// P9 track A (docs/MOTION.md §3.10.2): scrolling stays native. The recipe category track snaps softly on chip
// edges (proximity, never forced) and keeps the chosen chip in view; vertical lists never snap; music shelf cards
// scale only on a scroll-driven timeline behind a feature query; no -webkit-overflow-scrolling anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=file=>readFileSync(new URL(`../../podvoice/gatekeeper/static/podview/${file}`,import.meta.url),'utf8');
const css=read('ui-kit.css'),flat=css.replace(/\s+/g,' ');

test('the category track snaps by proximity with a chip-edge padding, and chips snap at their start',()=>{
 const track=flat.slice(flat.indexOf('[data-recipe-layout=toolbar]>fieldset .pv-kit-choice-options{'));
 assert(track.slice(0,track.indexOf('}')).endsWith('scroll-snap-type:x proximity;scroll-padding-inline:var(--pv-s3)'));
 assert.match(flat,/\[data-recipe-layout=toolbar\]>fieldset label\{[^}]*scroll-snap-align:start\}/);
});

test('the chosen chip is scrolled into view, smoothly unless reduced',()=>{
 const source=read('recipe-view.js');
 assert(source.replace(/\s+/g,' ').includes("scrollIntoView?.( {inline:'nearest',block:'nearest',"+
  "behavior:smooth && !isReduced(this.root) ? 'smooth' : 'auto'})"));
});

test('shelf cards scale on a scroll-driven timeline only where the engine has one, in entry and exit only',()=>{
 const block=flat.slice(flat.indexOf('@supports (animation-timeline:view(inline))'));
 assert(block.includes('#music-response .music-shelf>*{ animation:pv-shelf linear both,pv-shelf linear reverse '+
  'forwards;animation-timeline:view(inline),view(inline); animation-range:entry,exit}'));
 assert.match(flat,/@keyframes pv-shelf\{from\{transform:scale\(\.94\)\}\}/);
});

test('no vertical list snaps and nothing uses -webkit-overflow-scrolling',()=>{
 const bundled=read('podview.css');
 assert.doesNotMatch(bundled,/-webkit-overflow-scrolling/);
 assert.doesNotMatch(bundled,/\[data-recipe-layout=catalog\][^{]*\{[^}]*scroll-snap-type/);
});
