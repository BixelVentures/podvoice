import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const kit=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/ui-kit.css',import.meta.url),'utf8');
const legacy=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-redesign.css',import.meta.url),'utf8');
const base='pv-widget-host[data-view=active] #now-view:has(>#timer-card>.timer-shortcut:not([hidden]))';
const rules=css=>[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([,selector,body])=>({selector:selector.replace(/\/\*[\s\S]*?\*\//g,'').trim(),body:Object.fromEntries(body.split(';').filter(s=>s.includes(':')).map(s=>{const i=s.indexOf(':');return [s.slice(0,i).trim(),s.slice(i+1).trim()];}))}));
const find=(css,selector)=>{const rule=rules(css).find(r=>r.selector===selector);assert(rule,`Missing grid owner ${selector}`);return rule.body;};
const span=value=>{const parts=value.split('/').map(Number);return parts.length===1?[parts[0],parts[0]+1]:parts;};
const cells=({column,row})=>{const [x0,x1]=span(column),[y0,y1]=span(row),out=[];for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)out.push(`${x},${y}`);return out;};

test('inactive Radio and Timer occupy two equal small cells beside the retained larger Music slot',()=>{
 const music=find(kit,base+'>#home-music'),radio=find(kit,base+'>#home-radio'),timer=find(kit,base+'>#timer-card');
 assert.equal(music['grid-column'],'1/3');assert.equal(music['grid-row'],'3');
 assert.equal(radio['grid-row'],music['grid-row']);assert.equal(timer['grid-row'],music['grid-row']);
 assert.deepEqual(cells({column:radio['grid-column'],row:radio['grid-row']}),['3,3']);
 assert.deepEqual(cells({column:timer['grid-column'],row:timer['grid-row']}),['4,3']);
});

test('the complete inactive grid has no overlaps or orphan fourth timer row',()=>{
 const overall=find(kit,base);assert.equal(overall['grid-template-rows'],'repeat(3,177px)');
 const placement=[
  {name:'weather',column:'1/3',row:find(kit,base+'>#home-weather')['grid-row']},
  {name:'robot',column:'3/5',row:find(kit,base+'>.resource-card[data-kind=vacuum]')['grid-row']},
  {name:'light',column:'3',row:find(kit,base+'>:is(.resource-card[data-kind=light],#home-vehicle)')['grid-row']},
  {name:'Tesla',column:'4',row:find(kit,base+'>:is(.resource-card[data-kind=light],#home-vehicle)')['grid-row']},
  ...[['music','#home-music'],['radio','#home-radio'],['timer','#timer-card']].map(([name,id])=>{const rule=find(kit,base+'>'+id);return {name,column:rule['grid-column'],row:rule['grid-row']};})
 ];
 const occupied=new Map();for(const item of placement)for(const cell of cells(item)){assert(!occupied.has(cell),`${item.name} overlaps ${occupied.get(cell)} at ${cell}`);assert(Number(cell.split(',')[1])<=3,`${item.name} left an orphan row`);occupied.set(cell,item.name);}
 assert.equal(occupied.size,12);
});

test('the inactive recipe remains fenced by shortcut visibility while active timer stays full width',()=>{
 assert(base.includes('.timer-shortcut:not([hidden])'));
 const active=rules(legacy).filter(r=>r.selector.includes('#timer-card:has(>.timer-active-list:not([hidden])')&&r.selector.endsWith(')')&&r.body['grid-column']);
 assert(active.length>0);assert(active.every(r=>r.body['grid-column']==='1/-1'));
});

test('direct commands use canonical kit dimensions, reserve M/L content space and remain absent in S',()=>{
 const placement=find(legacy,'#now-view>.resource-card>.resource-direct-action');
 const action=find(kit,'pv-widget-host #now-view>.resource-card>.resource-direct-action');
 const owner='pv-widget-host[data-view=active] #now-view:not([hidden])>.resource-card:has(>.resource-direct-action:not([hidden]))>.resource-preview';
 const card=find(kit,owner),status=find(kit,owner+' .resource-label>small'),reserve=find(kit,owner+' .resource-label>:is(small,.resource-value)');
 const tokens=Object.fromEntries([...kit.matchAll(/(--pv-(?:s[1-5]|hit|icon-m)):(\d+)px/g)].map(([,key,value])=>[key,Number(value)]));
 assert.match(kit,/--pv-card-action-width:calc\(2 \* var\(--pv-hit\)\)/);assert.equal(action.width,'var(--pv-card-action-width)');assert.equal(action['min-width'],action.width);assert.equal(action.height,'var(--pv-hit)');assert.equal(action['min-height'],action.height);
 assert.equal(placement.top,'auto');assert.equal(placement.bottom,placement.right);assert.equal(placement.right,'var(--pv-s3)');assert.equal(card['grid-template-rows'],'var(--pv-icon-m) minmax(0,1fr) var(--pv-hit)');
 assert.equal(reserve['padding-inline-end'],'calc(var(--pv-card-action-width) + var(--pv-s2))');assert.equal(reserve['white-space'],'normal');assert.equal(status['line-height'],'24px');assert.equal(status['max-height'],'48px');
 const small=find(kit,'pv-widget-host[data-view=active] #now-view [data-kit-size=s]>.resource-direct-action');assert.equal(small.display,'none!important');assert.equal(small['pointer-events'],'none');
 const inset=tokens['--pv-s3'],hit=tokens['--pv-hit'],width=414,commandWidth=2*hit,gap=tokens['--pv-s2'],textWidth=width-2*inset-commandWidth-gap;assert(hit>=64);assert(textWidth>=128);assert(177-inset-hit>=inset+tokens['--pv-icon-m']+gap);const textRight=width-inset-commandWidth-gap,actionLeft=width-inset-commandWidth;assert(textRight+gap<=actionLeft);
 assert(!rules(kit).some(rule=>rule.selector.includes('resource-card:has(>.resource-direct-action')&&rule.selector.endsWith('.resource-label>strong')&&rule.body['padding-inline-end']),'command must not take the title role');
});

test('explicit S M L footprints share one grid and keep status density within their actual inner height',()=>{
 const tokens=Object.fromEntries([...kit.matchAll(/(--pv-card-(?:s-width|m-width|l-width|row-height|l-height)):(\d+)px/g)].map(([,key,value])=>[key,Number(value)]));
 assert.equal(tokens['--pv-card-s-width'],199);assert.equal(tokens['--pv-card-m-width'],414);assert.equal(tokens['--pv-card-l-width'],414);assert.equal(tokens['--pv-card-row-height'],177);assert.equal(tokens['--pv-card-l-height'],370);
 assert.equal(tokens['--pv-card-m-width'],2*tokens['--pv-card-s-width']+16);assert.equal(tokens['--pv-card-l-height'],2*tokens['--pv-card-row-height']+16);
 const common=rules(kit).find(rule=>rule.body.width==='var(--pv-card-size-width)!important');assert(common);assert.match(common.selector,/\[data-kit-size\]/);assert.match(common.selector,/#timer-card:not\(\[data-activity-kind=timer\]\)/);assert.equal(common.body.height,'var(--pv-card-size-height)!important');assert.equal(common.body['min-height'],common.body.height);assert.equal(common.body['max-height'],common.body.height);
 const normalInner=tokens['--pv-card-row-height']-2*24,statusTop=tokens['--pv-card-row-height']-24-48;assert(32+2*16+48<=normalInner);assert(24+52<statusTop,'a wrapped two-line title must end before the fixed status zone');assert(32+28+2*8+44<=normalInner,'M weather fits current conditions and its compact real forecast');
 const explicit=kit.slice(kit.indexOf('/* Explicit Card sizes'),kit.indexOf('/* End explicit Card sizes. */'));
 for(const rule of rules(explicit))if(rule.selector!==':root')assert.match(rule.selector,/\[data-kit-size/,'explicit size rules must never change an untagged product card');
 assert.match(explicit,/#home-weather\[data-kit-size=s\] \.home-forecast\{display:none!important/);assert.match(explicit,/#home-weather\[data-kit-size=m\] \.home-forecast-hour>img\{display:none/);
});

test('weather S and L cannot flex-wrap their condition beside the reading and Robot facts occupy a later real grid row',()=>{
 const explicit=kit.slice(kit.indexOf('/* Explicit Card sizes'),kit.indexOf('/* End explicit Card sizes. */')),sized=rules(explicit);
 for(const size of ['s','l']){const reading=sized.find(rule=>rule.selector.endsWith(`#home-weather[data-kit-size=${size}]>span>strong`));assert.equal(reading.body['flex-direction'],'column!important');assert.equal(reading.body['flex-wrap'],'nowrap!important');assert.equal(reading.body['align-items'],'flex-start!important');if(size==='l')assert.equal(reading.body['max-height'],'none!important');}
 for(const rule of sized.filter(rule=>rule.body['max-height']==='52px'))assert(!rule.selector.includes('#home-weather'),'numeric weather reading must not inherit the two-line heading cap');
 const status=sized.find(rule=>rule.selector.endsWith('>.resource-label>.resource-value')&&rule.body['grid-row']==='3!important'),metadata=sized.find(rule=>rule.selector.endsWith('>.resource-label>small:not([hidden])')&&rule.body['grid-row']==='5!important');assert(status);assert(metadata);assert.equal(status.body.margin,'0!important');assert.equal(metadata.body.margin,'0!important');
 const medium=sized.find(rule=>rule.selector.includes('resource-card[data-kit-size=m]')&&rule.body['grid-template-rows']?.endsWith('20px!important')),large=sized.find(rule=>rule.selector.includes('resource-card[data-kit-size=l]')&&rule.body['grid-template-rows']?.endsWith('34px!important'));assert(medium);assert(large);assert.equal(medium.body['row-gap'],'0!important');assert.equal(large.body['row-gap'],'0!important');assert.equal(24+4+20,48);assert.equal(34+8+20+34,96,'L retains its same footer footprint rather than pushing metadata over the status');
});
