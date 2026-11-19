import {deliveredStylesheet} from '../../podview/build/legacy-styles.mjs';
// P9 track A (docs/MOTION.md §3.10.2): scrolling stays native. The recipe category row does not scroll at all (the
// least used categories are under »Flere«); vertical lists never snap; music shelf cards
// scale only on a scroll-driven timeline behind a feature query; no -webkit-overflow-scrolling anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=file=>readFileSync(new URL(`../../podview/${file}`,import.meta.url),'utf8');
const css=read('ui-kit.css'),flat=css.replace(/\s+/g,' ');

test('the category row never scrolls: it is clipped, not a scroller, and nothing in it snaps',()=>{
 const track=flat.slice(flat.indexOf('[data-recipe-layout=toolbar] fieldset .pv-kit-choice-options{'));
 const rule=track.slice(0,track.indexOf('}'));
 assert.match(rule,/overflow:hidden!important$/);
 assert.doesNotMatch(rule,/scroll-snap|overflow-x:auto/);
 assert.doesNotMatch(read('recipe-view.js'),/scrollIntoView/);
});

test('shelf cards scale on a scroll-driven timeline only where the engine has one, in entry and exit only',()=>{
 const block=flat.slice(flat.indexOf('@supports (animation-timeline:view(inline))'));
 assert(block.includes('#music-response .music-shelf>*{ animation:pv-shelf linear both,pv-shelf linear reverse '+
  'forwards;animation-timeline:view(inline),view(inline); animation-range:entry,exit}'));
 assert.match(flat,/@keyframes pv-shelf\{from\{transform:scale\(\.94\)\}\}/);
});

test('no vertical list snaps and nothing uses -webkit-overflow-scrolling',()=>{
 const bundled=deliveredStylesheet();
 assert.doesNotMatch(bundled,/-webkit-overflow-scrolling/);
 assert.doesNotMatch(bundled,/\[data-recipe-layout=catalog\][^{]*\{[^}]*scroll-snap-type/);
});
