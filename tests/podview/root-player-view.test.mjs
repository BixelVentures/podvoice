import {connectionPresentation} from '../../podvoice/gatekeeper/static/podview/podvoice-view.js';
import {boundPlayback} from './room-fixture.mjs';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {PlayerView,localPlayerModel,localControlModel,localQueueModel,livePlayerModel,liveQueueModel} from '../../podvoice/gatekeeper/static/podview/player-view.js';
import {previewScene,playerPreviewStates} from '../../podvoice/gatekeeper/static/podview/preview-scenes.js';
import {initialScene,sceneTransition} from '../../podvoice/gatekeeper/static/podview/scene-model.js';
import {TRACKS} from '../../podvoice/gatekeeper/static/podview/widget-model.js';
import {PageLifecycle} from '../../podvoice/gatekeeper/static/podview/ui/page-lifecycle.js';
class Node extends EventTarget{
 constructor(tag='div'){super();this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.style={getPropertyValue(key){return this[key]||'';},setProperty(key,value){this[key]=value;}};this.attributes=new Map();this.hidden=false;this.disabled=false;this.textContent='';this.className='';this.classList={add:x=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),x])].join(' ');},remove:x=>{this.className=this.className.split(' ').filter(c=>c!==x).join(' ');},contains:x=>this.className.split(' ').includes(x)};}
 append(...nodes){for(const n of nodes){n.remove();n.parentNode=this;this.children.push(n);}}
 insertBefore(n,before){n.remove();n.parentNode=this;const index=this.children.indexOf(before);if(index<0)this.children.push(n);else this.children.splice(index,0,n);}
 remove(){if(this.parentNode){const a=this.parentNode.children;a.splice(a.indexOf(this),1);this.parentNode=null;}}
 replaceChildren(...nodes){for(const n of [...this.children])n.remove();this.append(...nodes);}
 replaceWith(node){const parent=this.parentNode,index=parent.children.indexOf(this);node.remove();parent.children.splice(index,1,node);node.parentNode=parent;this.parentNode=null;}
 setAttribute(k,v){this.attributes.set(k,String(v));}getAttribute(k){return k==='src'?(this.src??null):(this.attributes.get(k)??null);}removeAttribute(k){this.attributes.delete(k);}
 querySelector(tag){return this.children.find(n=>n.tagName===tag.toUpperCase())||null;}
 close(){this.open=false;}click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}
}
function surface({live=false,seek=()=>{},arrange=()=>{}}={}){const nodes=new Map(),groups=new Map();const doc={getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);},createElement:tag=>new Node(tag),querySelector:selector=>groups.get(selector)};const host={live,ownerDocument:doc,dataset:{},querySelector:selector=>{if(!groups.has(selector))groups.set(selector,new Node());return groups.get(selector);}};doc.getElementById('detail-output').append(new Node('span'));const empty=doc.getElementById('player-empty');empty.append(new Node('h2'),new Node('p'));host.querySelector('.player').append(doc.getElementById('output'));const discovery=doc.getElementById('empty-find-music'),discoveryText={nodeType:3,nodeValue:'Find musik'},discoveryIcon=new Node('img');discovery.firstChild=discoveryText;discovery.append(discoveryIcon);arrange({host,doc});const selected=[],view=new PlayerView(host,{chooseQueue:item=>selected.push(item),seek});return {host,doc,nodes,groups,view,selected,discoveryText,discoveryIcon};}
const item={id:'snapshot:0',title:'Actual <img> song',artist:'Actual artist',uri:'spotify:track:0123456789ABCDEFGHIJKL',artwork:{kind:'album_cover',provider:'spotify',url:'https://i.scdn.co/image/abc'},order:1,selectable:false};
test('all ten player audit fixtures are deterministic and unsupported controls stay inert',()=>{assert.equal(playerPreviewStates.length,10);for(const stage of playerPreviewStates){const s=previewScene(stage),vm=localPlayerModel(s),f=surface();f.view.renderPlayer(vm);f.view.renderControls(localControlModel(s));assert.equal(s.focus,stage.includes('-rest-')?'photo':'music');assert.equal(f.nodes.get('play-pause').disabled,true);assert.equal(f.nodes.get('detail-toggle').disabled,true);assert.equal(f.nodes.get('volume').disabled,true);assert.equal(f.nodes.get('volume-value').textContent,'—');if(stage.endsWith('missing-art')){assert.equal(vm.active,true);assert.equal(f.nodes.get('cover').src,'assets/icons/music-note-beamed.svg');}else if(stage.endsWith('offline')){assert.equal(vm.active,true);assert.equal(f.nodes.get('player-state').textContent,'Sidst kendt');}else if(stage.endsWith('loading')){assert.equal(vm.active,false);assert.equal(vm.loading,true);assert.equal(f.host.querySelector('.player').hidden,true);assert.equal(f.nodes.get('player-empty').hidden,false);assert.equal(f.nodes.get('player-empty').getAttribute('aria-busy'),'true');assert.equal(f.view.emptyCopy.hidden,false);assert.equal(f.view.emptyCopy.textContent,'Henter afspilningsstatus');assert.equal(f.nodes.get('player-detail').disabled,true);}else{assert.equal(vm.active,false);assert.equal(f.host.querySelector('.player').hidden,true);assert.equal(f.nodes.get('player-empty').hidden,false);assert.match(f.nodes.get('player-empty').querySelector('p').textContent,stage.endsWith('error')?/kunne ikke/:/Vælg en stemning eller sang/);}}});
test('source empty/loading/error/offline never fabricates observed playback or an output',()=>{for(const status of ['loading','error',undefined]){const vm=livePlayerModel(null,true,status);assert.equal(vm.active,false);assert.equal(vm.canOutput,false);assert.equal(vm.volume,null);}const vm=livePlayerModel({state:'no_active_playback',expiresAt:Date.now()+10000},true);assert.equal(vm.active,false);assert.equal(vm.empty,'Vælg en stemning eller sang.');assert.equal(vm.emptyState,'unconfirmed');assert.match(livePlayerModel(null,false).empty,/Forbindelsen/);});
test('offline retains known playback and canonical artwork while changing freshness only',()=>{const observed={expiresAt:Date.now()+10000,state:'paused',item:{name:'Observed song',artists:['Observed artist'],uri:item.uri,artwork:item.artwork},target:{name:null}};const snapshot={bootId:'boot',roomId:'room'},scoped=boundPlayback(snapshot,observed);const vm=livePlayerModel(scoped,false,undefined,snapshot),f=surface();f.view.renderPlayer(vm);assert.equal(vm.active,true);assert.equal(vm.fresh,false);assert.equal(vm.target,'Højttaleren i rummet');assert.equal(f.nodes.get('detail-status').textContent,'Sidst kendte afspilning');assert.equal(f.nodes.get('cover').src,item.artwork.url);assert.equal(f.nodes.get('detail-cover').src,item.artwork.url);assert.equal(f.nodes.get('output').disabled,true);});
test('queue observations preserve repeated occurrences as the same approved four-child button anatomy without action authority',()=>{const q={items:[0,1].map(index=>({id:`snapshot:${index}`,name:'Repeated song',artists:['Artist'],uri:item.uri,artwork:item.artwork}))},rows=liveQueueModel(q),f=surface();f.view.renderQueue(rows);assert.equal(f.view.queue.children.length,2);assert.notEqual(rows[0].id,rows[1].id);for(const row of f.view.queue.children){assert.equal(row.tagName,'BUTTON');assert.equal(row.className,'queue-track pv-row pv-btn pv-kit pv-kit-listrow');assert.equal(row.children.length,4);assert.equal(row.children[0].className,'queue-order');assert.equal(row.children[3].className,'queue-play');assert.equal(row.disabled,true);row.click();}assert.equal(f.selected.length,0);assert.equal(rows.every(row=>row.selectable===false),true);});
test('retained queue rows survive stale/error renders without reordering or changing scroll position',()=>{const f=surface();f.view.renderQueue([item,{...item,id:'snapshot:1',order:2}]);const first=f.view.queue.children[0];f.view.queue.scrollTop=72;f.view.renderQueue([item,{...item,id:'snapshot:1',order:2}],{status:'stale'});assert.equal(f.view.queue.children[0],first);assert.equal(f.view.queue.scrollTop,72);assert.equal(f.nodes.get('queue-title').textContent,'Sidst kendte kø');f.view.renderQueue([item,{...item,id:'snapshot:1',order:2}],{status:'error'});assert.equal(f.view.queue.children[0],first);assert.match(f.view.queue.getAttribute('aria-label'),/kunne ikke/);});
test('queue action uses the current local row revision and source rows cannot reuse that handler',()=>{const f=surface();f.view.renderQueue([{...item,id:'fixture-track',selectable:true,revision:1}]);const row=f.view.queue.children[0];f.view.renderQueue([{...item,id:'fixture-track',selectable:true,revision:2}]);row.click();assert.equal(f.selected[0].revision,2);f.view.renderQueue([{...item,id:'fixture-track',selectable:false}]);row.click();assert.equal(f.selected.length,1);});
test('unknown volume keeps reserved controls visible but inactive and source markup stays literal text',()=>{const f=surface();f.view.renderPlayer({active:true,playing:true,fresh:true,title:item.title,artist:item.artist,target:'Observed speaker',uri:item.uri,artwork:item.artwork,canOutput:false});f.view.renderControls({playing:true,volume:null});assert.equal(f.nodes.get('track-name').textContent,item.title);assert.equal(f.nodes.get('track-name').children.length,0);for(const selector of ['.player .transport','#music-detail .transport','.player .volume','#music-detail .volume'])assert.equal(f.groups.get(selector).hidden,selector.startsWith('#music-detail'));assert.equal(f.nodes.get('next').disabled,true);assert.equal(f.nodes.get('volume').disabled,true);assert.equal(f.nodes.get('volume-value').textContent,'—');});
test('local queue includes the current track once with remaining queue order preserved',()=>{const s=previewScene('top'),rows=localQueueModel(s);assert.equal(rows.length,9);assert.equal(new Set(rows.map(row=>row.id)).size,rows.length);assert.deepEqual(rows.map(row=>row.order),[0,1,2,3,4,5,6,7,8]);assert.equal(rows[0].current,true);assert.equal(rows[0].selectable,false);assert.equal(rows.slice(1).every(row=>row.selectable),true);});
test('multiple real accounts provide an honest completed selection prompt rather than indefinite loading',()=>{const vm=livePlayerModel(null,true,'account-selection'),f=surface();f.view.renderPlayer(vm);assert.equal(f.nodes.get('player-empty').querySelector('p').textContent,'Vælg en musikkonto.');assert.equal(vm.active,false);});
test('initial queue loading reserves three inert native row anatomies and failure cannot leave an endless placeholder',()=>{const f=surface();f.view.renderQueue([],{status:'loading'});assert.equal(f.view.queue.getAttribute('aria-busy'),'true');assert.equal(f.view.queue.children.length,3);for(const row of f.view.queue.children){assert.equal(row.children.length,4);assert.equal(row.dataset.trackId,undefined);assert.equal(row.children[1].src,undefined);assert.equal(row.disabled,true);row.click();}assert.deepEqual(f.selected,[]);f.view.renderQueue([item]);assert.equal(f.view.queue.children.length,1);const actual=f.view.queue.children[0];f.view.renderQueue([item],{status:'pending'});assert.equal(f.view.queue.children[0],actual);assert.equal(f.view.queue.getAttribute('aria-busy'),'true');assert.equal(f.nodes.get('queue-title').textContent,'Næste i køen');f.view.renderQueue([],{status:'error',empty:'Køen kunne ikke hentes.'});assert.equal(f.view.queue.getAttribute('aria-busy'),'false');assert.equal(f.view.queue.children.length,1);assert.equal(f.view.queue.children[0].className,'queue-empty');assert.match(f.view.queue.children[0].textContent,/kunne ikke/);});
test('first playback read uses actual player geometry with inert controls; refresh preserves real content and success restores detail controls',()=>{const f=surface();f.view.renderPlayer(livePlayerModel(null,true,'loading'));f.view.renderControls({blocked:true});assert.equal(f.host.querySelector('.player').hidden,true);assert.equal(f.nodes.get('player-empty').getAttribute('aria-busy'),'true');assert.equal(f.nodes.get('player-empty').hidden,false);assert.equal(f.view.emptyCopy.hidden,false);assert.equal(f.nodes.get('track-name').textContent,'');assert.equal(f.nodes.get('cover').style.visibility,'hidden');assert.equal(f.nodes.get('track').disabled,true);const snapshot={bootId:'boot',roomId:'room'},observed=boundPlayback(snapshot,{expiresAt:Date.now()+10000,state:'playing',item:{name:'Actual song',artists:['Artist'],uri:item.uri,artwork:item.artwork},target:{name:'Actual room'}});f.view.renderPlayer(livePlayerModel(observed,true,'ready',snapshot));assert.equal(f.nodes.get('cover').style.visibility,'');assert.equal(f.nodes.get('track').disabled,false);const src=f.nodes.get('cover').src;f.view.renderPlayer(livePlayerModel(observed,true,'loading',snapshot));assert.equal(f.nodes.get('track-name').textContent,'Actual song');assert.equal(f.nodes.get('cover').src,src);assert.equal(f.host.querySelector('.player').getAttribute('aria-busy'),'true');f.view.renderPlayer(livePlayerModel(observed,false,'error',snapshot));assert.equal(f.host.querySelector('.player').getAttribute('aria-busy'),'false');assert.equal(f.nodes.get('player-state').textContent,'Sidst kendt');});

test('first-read empty anatomy clears unknown copy, gates discovery and restores settled states',()=>{const f=surface();for(const canDiscover of [undefined,false,true]){f.view.renderPlayer({active:false,loading:true,canDiscover});assert.equal(f.nodes.get('player-empty').hidden,false);assert.equal(f.nodes.get('player-empty').getAttribute('aria-busy'),'true');assert.equal(f.view.emptyCopy.hidden,false);assert.equal(f.view.emptyCopy.textContent,'Henter afspilningsstatus');assert.equal(f.nodes.get('empty-find-music').disabled,canDiscover!==true);assert.equal(f.nodes.get('output').disabled,true);}for(const empty of ['Der spiller ikke noget lige nu.','Afspilningen kunne ikke hentes.','Forbindelsen mangler.']){f.view.renderPlayer({active:false,loading:false,empty,canDiscover:false});assert.equal(f.nodes.get('player-empty').getAttribute('aria-busy'),'false');assert.equal(f.view.emptyCopy.hidden,false);assert.equal(f.view.emptyCopy.textContent,empty);}f.view.renderPlayer({active:true,loading:true,title:'Retained song',artist:'Artist'});assert.equal(f.nodes.get('player-empty').hidden,true);assert.equal(f.host.querySelector('.player').hidden,false);assert.equal(f.nodes.get('track-name').textContent,'Retained song');});

test('selection feedback stays in existing player status without replacing observed content or playback truth',()=>{
 const f=surface(),vm={active:true,playing:false,fresh:true,title:'Observed song',artist:'Observed artist',target:'Actual room',uri:item.uri,artwork:item.artwork,canOutput:false};
 f.view.renderPlayer(vm);const cover=f.nodes.get('cover'),src=cover.src,state=f.nodes.get('player-state');
 for(const feedback of [{message:'Afventer afspilning i rummet.',pending:true},{message:'Anmodningen er modtaget · afventer observeret afspilning.',pending:false},{message:'Udfaldet er ukendt · handlingen gentages ikke.',pending:false}]){
  f.view.renderPlayer({...vm,feedback});assert.equal(f.nodes.get('player-state'),state);assert.equal(state.textContent,feedback.message);assert.equal(state.getAttribute('role'),'status');assert.equal(f.nodes.get('cover'),cover);assert.equal(cover.src,src);assert.equal(f.nodes.get('track-name').textContent,'Observed song');assert.equal(f.nodes.get('detail-status').textContent,feedback.message);assert.equal(f.nodes.get('play-icon').src,'assets/icons/play-fill.svg');assert.equal(f.host.querySelector('.player').getAttribute('aria-busy'),String(feedback.pending));assert.equal(f.host.dataset.selectionFeedback,'true');
 }
 f.view.renderPlayer(vm);assert.equal(state.textContent,'');assert.equal(f.host.dataset.selectionFeedback,'false');assert.equal(f.host.querySelector('.player').getAttribute('aria-busy'),'false');
});
test('empty selection feedback uses existing copy even during a read and cannot fabricate playing',()=>{
 const f=surface(),copy=f.view.emptyCopy;
 f.view.renderPlayer({active:false,loading:true,feedback:{message:'Afventer afspilning i rummet.',pending:true}});
 assert.equal(f.view.emptyCopy,copy);assert.equal(copy.hidden,false);assert.equal(copy.textContent,'Afventer afspilning i rummet.');assert.equal(f.nodes.get('player-empty').getAttribute('aria-busy'),'true');assert.equal(f.host.querySelector('.player').hidden,true);assert.equal(f.nodes.get('track-name').textContent,'');assert.equal(f.nodes.get('play-pause').disabled,true);
 f.view.renderPlayer({active:false,loading:false,empty:'Afspilningen i rummet kunne ikke bekræftes.',feedback:{message:'Udfaldet er ukendt · handlingen gentages ikke.',pending:false}});assert.equal(copy.textContent,'Udfaldet er ukendt · handlingen gentages ikke.');assert.equal(f.nodes.get('player-empty').getAttribute('aria-busy'),'false');
 f.view.renderPlayer({active:false,empty:'Afspilningen i rummet kunne ikke bekræftes.'});assert.equal(copy.textContent,'Afspilningen i rummet kunne ikke bekræftes.');
});

test('returning to Ro keeps pending feedback in the same populated or empty status slot',()=>{
 for(const active of [false,true]){const f=surface();f.host.dataset.view='rest';const vm={active,playing:true,fresh:true,title:'Observed song',artist:'Artist',target:'Actual room',uri:item.uri,artwork:item.artwork,feedback:{message:'Afventer afspilning i rummet.',pending:true}};
 f.view.renderPlayer(vm);assert.equal(f.host.dataset.view,'rest');assert.equal(f.host.dataset.selectionFeedback,'true');assert.equal(active?f.nodes.get('player-state').textContent:f.view.emptyCopy.textContent,vm.feedback.message);assert.equal((active?f.host.querySelector('.player'):f.nodes.get('player-empty')).getAttribute('aria-busy'),'true');if(active){assert.equal(f.nodes.get('play-icon').src,'assets/icons/pause-fill.svg');assert.equal(f.nodes.get('track-name').textContent,'Observed song');}
 f.view.renderPlayer({...vm,feedback:null});assert.equal(f.host.dataset.selectionFeedback,'false');
 }
});

test('unconfirmed playback offers a useful music entry without claiming paused, history or an actionable transport',()=>{const vm=livePlayerModel(null,true,'ready',undefined,'Køkkenalrum HomePod'),f=surface();f.view.renderPlayer(vm);assert.equal(vm.active,false);assert.equal(vm.playing,false);assert.equal(vm.empty,'Vælg en stemning eller sang.');assert.equal(vm.title,'');assert.equal(vm.artist,'');assert.equal(vm.uri,undefined);assert.equal(vm.artwork,undefined);assert.equal(vm.volume,null);assert.equal(f.nodes.get('player-empty').dataset.state,'unconfirmed');assert.equal(f.view.emptyCopy.textContent,'Vælg en stemning eller sang.');assert.equal(f.nodes.get('play-pause').disabled,true);for(const [status,connected,state,message]of [['loading',true,'loading',''],['error',true,'error','Afspilningen kunne ikke hentes.'],['ready',false,'offline','Forbindelsen mangler.'],['account-selection',true,'account-selection','Vælg en musikkonto.']]){const next=livePlayerModel(null,connected,status);f.view.renderPlayer(next);assert.equal(next.emptyState,state);assert.equal(next.empty,message);assert.equal(f.nodes.get('player-empty').dataset.state,state);}});

test('fixture and live configured-room headers use the same retained output anatomy through empty and loading states',()=>{const state=previewScene('player-active-empty'),local=localPlayerModel(state),configured=state.music.playback.room;assert.equal(local.configuredTarget,configured);const fixtures=[surface(),surface({live:true})];const models=[local,livePlayerModel(null,true,'unavailable',undefined,configured)];for(let i=0;i<fixtures.length;i++){const f=fixtures[i],vm=models[i],output=f.nodes.get('output'),copy=f.nodes.get('player-empty');f.view.renderPlayer(vm);assert.equal(f.nodes.get('player-room').textContent,configured);assert.equal(output.parentNode,copy);assert.equal(output.disabled,vm.canOutput!==true);assert.equal(f.nodes.get('player-state').textContent,'');f.view.renderPlayer({...vm,loading:true,canOutput:false});assert.equal(output.parentNode,copy);assert.equal(f.nodes.get('player-room').textContent,configured);assert.equal(output.disabled,true);assert.equal(f.view.emptyCopy.hidden,false);assert.equal(f.nodes.get('play-pause').disabled,true);assert.equal(f.nodes.get('volume-value').textContent,'—');}assert.equal(fixtures[0].view.outputPlacement.output,fixtures[0].nodes.get('output'));assert.equal(fixtures[1].view.outputPlacement.output,fixtures[1].nodes.get('output'));});

test('empty music entry is absent only while its destination is already visible, equally for fixture and live',()=>{for(const live of [false,true]){const f=surface({live}),vm=live?livePlayerModel(null,true,'ready',undefined,'Stuen'):localPlayerModel(previewScene('player-active-empty')),button=f.nodes.get('empty-find-music')||f.doc.getElementById('empty-find-music');for(const focus of ['now','music','photo','music','now']){f.host.state={focus};f.view.renderPlayer(vm);assert.equal(button.hidden,focus==='music');assert.equal(f.nodes.get('empty-find-music'),button);assert.equal(button.disabled,vm.canDiscover!==true);assert.equal(f.nodes.get('player-empty').hidden,false);assert.equal(f.nodes.get('player-room').textContent,'Stuen');}}});

// Discovery is a read/navigation affordance, independent of playback proof.
test('admitted catalogue discovery remains actionable through playback loading, error and stale observations',()=>{
 for(const kind of ['mood','feeling','top','recent','search','account_playlists'])for(const status of ['loading','error','unavailable','ready']){
  const snapshot={bootId:'boot',roomId:'room',capabilities:{musicRead:[kind]}},f=surface({live:true});f.host.state={focus:'now'};
  const vm=livePlayerModel(null,true,status,snapshot,'Køkkenalrum');f.doc.getElementById('empty-find-music').disabled=false;f.view.renderPlayer(vm);
  assert.equal(vm.canDiscover,true,kind+' '+status);assert.equal(f.nodes.get('empty-find-music').disabled,false);assert.equal(f.nodes.get('empty-find-music').hidden,false);assert.equal(vm.active,false);assert.equal(vm.playing,false);assert.equal(vm.canOutput,false);assert.equal(f.nodes.get('play-pause').disabled,true);assert.equal(f.nodes.get('volume').disabled,true);
 }
 const snapshot={bootId:'boot',roomId:'room',capabilities:{musicRead:['mood','targets','playback']}},stale=boundPlayback(snapshot,{expiresAt:Date.now()-1,stale:true,state:'playing',item:{name:'Old song',artists:['Artist'],uri:item.uri,artwork:item.artwork},target:{name:'Room'}}),vm=livePlayerModel(stale,true,'error',snapshot);
 assert.equal(vm.canDiscover,true);assert.equal(vm.active,false);assert.equal(vm.canOutput,true);assert.equal(vm.fresh,false);
});
test('discovery denies absent, malformed, metadata-only or revoked catalogue permission even after another renderer enabled the button',()=>{
 for(const musicRead of [undefined,null,'mood',[],['targets'],['playback'],['queue'],['invented']]){
  const f=surface({live:true}),snapshot={capabilities:{musicRead}};f.host.state={focus:'now'};const vm=livePlayerModel(null,true,'ready',snapshot);f.doc.getElementById('empty-find-music').disabled=false;f.view.renderPlayer(vm);assert.equal(vm.canDiscover,false,JSON.stringify(musicRead));assert.equal(f.nodes.get('empty-find-music').disabled,true);
 }
 const f=surface({live:true}),snapshot={capabilities:{musicRead:['mood']}};f.host.state={focus:'now'};f.view.renderPlayer(livePlayerModel(null,true,'error',snapshot));assert.equal(f.nodes.get('empty-find-music').disabled,false);snapshot.capabilities.musicRead=[];f.view.renderPlayer(livePlayerModel(null,true,'error',snapshot));assert.equal(f.nodes.get('empty-find-music').disabled,true);
 snapshot.capabilities.musicRead=['mood'];f.view.renderPlayer(livePlayerModel(null,false,'offline',snapshot));assert.equal(f.nodes.get('empty-find-music').disabled,true);
});

test('actual live host and final player agree on home and empty discovery through playback error, revoke and disconnect',()=>{
 const f=surface({live:true});f.host.state={focus:'now'};f.doc.getElementById('home-music').append(new Node('small'));
 const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8'),code=source.slice(source.indexOf(' renderLive(){'),source.indexOf('\n suspendLiveTimer(')).trim();
 const render=new Function('$','renderLiveWeather','renderRobotHistory','connectionPresentation',`return function ${code}`)(id=>f.doc.getElementById(id),()=>{},()=>{},connectionPresentation);
 Object.assign(f.host,{renderConnectionNotice(){},liveStatus:'connected',liveSnapshot:{capabilities:{musicRead:['targets'],timerActions:[]},timers:{status:'unavailable'}},renderVoice(){},timerView:{renderAccess(){}},liveCatalogue:{updateCapabilities(){},open(){},render(){}},liveSelection:{setAccount(){},onSnapshot(){}},liveMedia:{render(){f.view.renderPlayer(livePlayerModel(null,f.host.liveStatus==='connected','error',f.host.liveSnapshot));}}});
 for(const [read,connected,allowed]of [[['targets'],true,false],[['playback','queue'],true,false],[['mood'],true,true],[['search'],true,true],[['account_playlists'],true,true],[[],true,false],[['mood'],false,false]]){
  f.host.liveSnapshot.capabilities.musicRead=read;f.host.liveStatus=connected?'connected':'disconnected';render.call(f.host);assert.equal(f.doc.getElementById('home-music').disabled,!allowed);assert.equal(f.doc.getElementById('empty-find-music').disabled,!allowed);assert.equal(f.doc.getElementById('play-pause').disabled,true);assert.equal(f.host.querySelector('.player').hidden,true);
 }
});

test('empty discovery changes only its existing label and keeps button, icon, status and room nodes across states',()=>{
 const f=surface({live:true}),button=f.doc.getElementById('empty-find-music'),copy=f.view.emptyCopy,output=f.doc.getElementById('output'),room=f.doc.getElementById('player-room'),snapshot={capabilities:{musicRead:['mood','targets','playback']}};f.host.state={focus:'now'};f.doc.activeElement=button;assert.equal(f.discoveryText.nodeValue,'Vælg musik');assert.equal(button.children[0],f.discoveryIcon);
 for(const status of ['ready','loading','error','account-selection','ready']){f.view.renderPlayer(livePlayerModel(null,true,status,snapshot,'Køkkenalrum HomePod'));assert.equal(f.doc.getElementById('empty-find-music'),button);assert.equal(button.firstChild,f.discoveryText);assert.equal(button.children[0],f.discoveryIcon);assert.equal(f.view.emptyCopy,copy);assert.equal(f.doc.getElementById('output'),output);assert.equal(f.doc.getElementById('player-room'),room);assert.equal(room.textContent,'Køkkenalrum HomePod');assert.equal(f.doc.activeElement,button);assert.equal(button.disabled,status==='account-selection');if(status==='error')assert.equal(copy.textContent,'Afspilningen kunne ikke hentes.');}
});
test('unknown playback uses actionable copy and a domain heading without asserting stopped or inventing a room',()=>{
 const f=surface({live:true});f.host.state={focus:'now'};f.view.renderPlayer({active:false,canDiscover:true});assert.equal(f.view.emptyCopy.textContent,'Vælg en stemning eller sang.');assert.equal(f.doc.getElementById('player-room').textContent,'Musik');assert.equal(f.doc.getElementById('player-state').textContent,'');assert.equal(f.doc.getElementById('output').getAttribute('aria-label'),'Musik');assert.equal(f.doc.getElementById('play-pause').disabled,true);assert.equal(f.doc.getElementById('track-name').textContent,'');assert.equal(f.doc.getElementById('volume-value').textContent,'—');
 f.view.renderPlayer(livePlayerModel(null,true,'error',{capabilities:{musicRead:['mood']}}));assert.equal(f.view.emptyCopy.textContent,'Afspilningen kunne ikke hentes.');assert.equal(f.doc.getElementById('player-room').textContent,'Musik');assert.equal(f.doc.getElementById('empty-find-music').disabled,false);
});
test('genuinely admitted paused and retained last-known context stay populated rather than becoming invented history',()=>{
 const f=surface({live:true}),snapshot={bootId:'boot',roomId:'room',capabilities:{musicRead:['mood','targets','playback']}},playback=boundPlayback(snapshot,{state:'paused',expiresAt:Date.now()+10000,item:{name:'Observed paused song',artists:['Observed artist'],uri:item.uri,artwork:item.artwork},target:{name:'Observed HomePod'}});f.host.state={focus:'now'};f.view.renderPlayer(livePlayerModel(playback,true,'ready',snapshot,'Configured HomePod'));const cover=f.doc.getElementById('cover');assert.equal(f.host.querySelector('.player').hidden,false);assert.equal(f.doc.getElementById('player-empty').hidden,true);assert.equal(f.doc.getElementById('track-name').textContent,'Observed paused song');assert.equal(f.doc.getElementById('player-state').textContent,'');assert.equal(f.doc.getElementById('player-room').textContent,'Observed HomePod');
 const retained={...playback,stale:true,displayRetained:true,expiresAt:Date.now()-1};f.view.renderPlayer(livePlayerModel(retained,false,'error',snapshot,'Configured HomePod'));assert.equal(f.host.querySelector('.player').hidden,false);assert.equal(f.doc.getElementById('cover'),cover);assert.equal(cover.src,item.artwork.url);assert.equal(f.doc.getElementById('track-name').textContent,'Observed paused song');assert.equal(f.doc.getElementById('player-state').textContent,'Sidst kendt');assert.equal(f.doc.getElementById('output').disabled,true);
 f.view.renderPlayer(livePlayerModel(null,true,'unavailable',snapshot,'Configured HomePod'));assert.equal(f.host.querySelector('.player').hidden,true);assert.equal(f.doc.getElementById('track-name').textContent,'');assert.equal(f.doc.getElementById('player-room').textContent,'Configured HomePod');assert.equal(f.view.emptyCopy.textContent,'Vælg en stemning eller sang.');assert.equal(f.doc.getElementById('player-state').textContent,'');
});

test('source progress reaches the canonical compact and detail player with no seek affordance',()=>{
 const f=surface(),snapshot={bootId:'boot',roomId:'room'},p=boundPlayback(snapshot,{state:'playing',expiresAt:Date.now()+10000,progressMs:84000,item:{name:'Song',artists:['Artist'],uri:item.uri,duration_ms:187000}});
 const vm=livePlayerModel(p,true,'ready',snapshot);f.view.renderPlayer(vm);
 for(const prefix of ['player','detail']){assert.equal(f.doc.getElementById(`${prefix}-progress`).hidden,false);assert.equal(f.doc.getElementById(`${prefix}-elapsed`).textContent,'1:24');assert.equal(f.doc.getElementById(`${prefix}-duration`).textContent,'3:07');assert.equal(f.doc.getElementById(`${prefix}-progress-meter`).getAttribute('value'),'84000');assert.match(f.doc.getElementById(`${prefix}-progress-meter`).getAttribute('aria-label'),/^Observeret position.*Kun visning/);}
 const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/index.html',import.meta.url),'utf8');for(const prefix of ['player','detail'])assert.match(source,new RegExp(`<progress id="${prefix}-progress-meter"`));assert.doesNotMatch(source,/<input[^>]+id="(?:player|detail)-progress/);
});
test('paused and retained positions never advance, stale is labelled, and missing/new/invalid position clears both surfaces',()=>{
 const f=surface(),snapshot={bootId:'boot',roomId:'room'},p=boundPlayback(snapshot,{state:'paused',expiresAt:Date.now()+10000,progressMs:84000,item:{name:'Song',artists:['Artist'],uri:item.uri,duration_ms:187000}});
 f.view.renderPlayer(livePlayerModel(p,true,'ready',snapshot));f.view.renderPlayer(livePlayerModel({...p,expiresAt:Date.now()-1,displayRetained:true},false,'offline',snapshot));
 for(const prefix of ['player','detail']){assert.equal(f.doc.getElementById(`${prefix}-elapsed`).textContent,'1:24');assert.equal(f.doc.getElementById(`${prefix}-progress`).dataset.stale,'true');assert.match(f.doc.getElementById(`${prefix}-progress-meter`).getAttribute('aria-label'),/^Sidst kendte position/);}
 for(const patch of [{progressMs:null},{progressMs:188000},{progressMs:-1},{durationMs:0},{active:false},{progressMs:undefined,uri:'spotify:track:new'}]){f.view.renderPlayer({...livePlayerModel(p,true,'ready',snapshot),...patch});for(const prefix of ['player','detail']){assert.equal(f.doc.getElementById(`${prefix}-progress`).hidden,true);assert.equal(f.doc.getElementById(`${prefix}-elapsed`).textContent,'');assert.equal(f.doc.getElementById(`${prefix}-progress-meter`).getAttribute('value'),'0');}}
});

test('account selection keeps its existing CTA actionable in music focus without discovery access',()=>{const f=surface({live:true});f.host.state={focus:'music'};const vm=livePlayerModel(null,true,'account-selection',{capabilities:{musicRead:['targets','playback']}});f.view.renderPlayer({...vm,canChooseAccount:true});const button=f.nodes.get('empty-find-music');assert.equal(button.disabled,false);assert.equal(button.hidden,false);assert.equal(button.dataset.action,'account');assert.equal(f.discoveryText.nodeValue,'Vælg musikkonto');f.view.renderPlayer({...vm,canChooseAccount:false});assert.equal(button.disabled,true);f.view.renderPlayer({...vm,emptyState:'unconfirmed',canDiscover:true});assert.equal(button.hidden,true);assert.equal(button.dataset.action,'music');assert.equal(f.discoveryText.nodeValue,'Vælg musik');});

test('player journey retains one operation status in overview and detail and does not call stale output current',()=>{const f=surface({live:true});const vm={active:true,playing:true,fresh:true,title:'A song',artist:'An artist',target:'Kitchen',canOutput:true,feedback:{pending:true,message:'Afventer svar fra højttaleren'}};f.view.renderPlayer(vm);assert.equal(f.nodes.get('player-state').textContent,vm.feedback.message);assert.equal(f.nodes.get('detail-status').textContent,vm.feedback.message);assert.equal(f.nodes.get('music-detail').getAttribute('aria-busy'),'true');f.view.renderPlayer({...vm,feedback:null,fresh:false});assert.equal(f.nodes.get('music-detail').getAttribute('aria-busy'),'false');assert.equal(f.nodes.get('detail-status').textContent,'Sidst kendte afspilning');for(const id of ['output','detail-output'])assert.match(f.nodes.get(id).getAttribute('aria-label'),/sidst kendte output/i);});

test('empty local journey selects output then reveals actual receipt playback and its controls',async()=>{
 const {sceneTransition}=await import('../../podvoice/gatekeeper/static/podview/scene-model.js');let state=previewScene('player-active-empty');const send=event=>{state=sceneTransition(state,{type:'music',event});};
 assert.equal(state.music.playback.active,false);assert.equal(localPlayerModel(state).canOutput,true);assert.equal(localControlModel(state).blocked,true);
 send({type:'target',accountId:'household',kind:'configured_alias',targetId:'kitchen',revision:state.music.revision});assert.equal(state.music.pending,null);assert.equal(localPlayerModel(state).target,'Køkkenet');assert.equal(localPlayerModel(state).active,false);
 send({type:'select',id:'smooth-jazz',revision:0});assert.equal(localPlayerModel(state).active,false);
 send({type:'select',id:'smooth-jazz',revision:state.music.revision});assert.equal(localPlayerModel(state).active,false);assert.equal(state.music.pending.targetId,'kitchen');
 send({type:'receipt',operation:state.music.operation});assert.equal(localPlayerModel(state).active,true);assert.equal(localPlayerModel(state).target,'Køkkenet');assert.equal(localControlModel(state).blocked,false);assert.ok(localQueueModel(state).length>0);
 for(const status of ['loading','error','offline'])assert.equal(localPlayerModel(previewScene('player-active-'+status)).canOutput,false);
});

test('radio transport and queue use source capabilities and music restores the same controls',()=>{
 const f=surface();f.view.renderControls({sourceKind:'radio',playing:true,toggle:true,canVolume:true,volume:35});
 for(const id of ['previous','next','detail-previous','detail-next'])assert.equal(f.nodes.get(id).hidden,true);
 assert.equal(f.nodes.get('play-pause').hidden,false);assert.equal(f.nodes.get('play-pause').getAttribute('aria-label'),'Sæt radio på pause');assert.equal(f.nodes.get('volume').disabled,false);
 f.view.renderQueue([],{sourceKind:'radio'});assert.equal(f.nodes.get('queue-title').hidden,true);assert.equal(f.view.queue.hidden,true);
 f.view.renderControls({playing:false,previous:true,next:true,toggle:true,canVolume:true,volume:35});f.view.renderQueue([]);
 assert.equal(f.nodes.get('previous').hidden,false);assert.equal(f.nodes.get('next').hidden,false);assert.equal(f.nodes.get('play-pause').getAttribute('aria-label'),'Fortsæt musikken');assert.equal(f.nodes.get('queue-title').hidden,false);assert.equal(f.view.queue.hidden,false);
});


test('local timeline previews and commits exact position without changing pause, and retains draft through background renders',()=>{
 const intents=[],f=surface({seek:event=>intents.push(event)}),state=previewScene('now');state.music.playback.playing=false;
 const vm=localPlayerModel(state);f.view.renderPlayer(vm);const range=f.view.seekControl;
 assert.equal(range.hidden,false);assert.equal(range.disabled,false);assert.equal(f.doc.getElementById('player-progress-meter').hidden,true);assert.equal(range.parentNode,f.doc.getElementById('player-progress'));assert.equal(f.doc.getElementById('detail-progress').exampleLabel,undefined);
 range.dispatchEvent(new Event('pointerdown'));range.value='121000';range.dispatchEvent(new Event('input'));
 assert.equal(f.doc.getElementById('detail-elapsed').textContent,'2:01');assert.equal(f.doc.getElementById('player-elapsed').textContent,'2:01');assert.equal(range.getAttribute('aria-valuetext'),'2:01 af 3:00');assert.equal(range.getAttribute('aria-label'),'Vælg afspilningsposition');assert.equal(intents.length,0);
 f.view.renderPlayer({...vm});assert.equal(range.value,'121000');assert.equal(state.music.playback.playing,false);
 range.dispatchEvent(new Event('change'));assert.deepEqual(intents,[{positionMs:121000,trackId:vm.trackId,operation:vm.seekOperation}]);assert.equal(state.music.playback.playing,false);
});
test('local timeline fences a track change during drag, pointer cancellation and offline controls; live never gets a range',()=>{
 const intents=[],f=surface({seek:event=>intents.push(event)}),vm=localPlayerModel(previewScene('now'));f.view.renderPlayer(vm);const range=f.view.seekControl;
 range.dispatchEvent(new Event('pointerdown'));range.value='120000';range.dispatchEvent(new Event('input'));
 f.view.renderPlayer({...vm,trackId:'new-track',seekOperation:2,progressMs:0});range.value='130000';range.dispatchEvent(new Event('input'));range.dispatchEvent(new Event('change'));assert.deepEqual(intents,[]);
 f.view.renderPlayer(vm);range.value='120000';range.dispatchEvent(new Event('input'));range.dispatchEvent(new Event('pointercancel'));range.dispatchEvent(new Event('change'));assert.deepEqual(intents,[]);assert.equal(range.value,String(vm.progressMs));
 f.view.renderPlayer({...vm,canSeek:false,positionFresh:false});assert.equal(range.disabled,true);range.value='120000';range.dispatchEvent(new Event('input'));range.dispatchEvent(new Event('change'));assert.deepEqual(intents,[]);
 f.view.renderPlayer({active:true,exampleOnly:true,sourceKind:'radio'});assert.equal(range.hidden,true);assert.equal(range.disabled,true);
 const live=surface({live:true});live.view.renderPlayer({...vm,examplePosition:false});assert.equal(live.view.seekControl,undefined);assert.equal(live.doc.getElementById('detail-progress-meter').hidden,false);
});


test('local seek fill follows drag preview, cancellation, endpoints and hidden-state reset',()=>{
 const f=surface(),vm=localPlayerModel(previewScene('now'));f.view.renderPlayer({...vm,progressMs:0});const range=f.view.seekControl,fill=()=>range.style.getPropertyValue('--seek-progress');assert.equal(fill(),'0%');
 range.value='90000';range.dispatchEvent(new Event('input'));assert.equal(fill(),'50%');assert.equal(f.doc.getElementById('detail-elapsed').textContent,'1:30');
 f.view.renderPlayer({...vm,progressMs:0});assert.equal(fill(),'50%');range.dispatchEvent(new Event('pointercancel'));assert.equal(fill(),'0%');
 f.view.renderPlayer({...vm,progressMs:180000});assert.equal(fill(),'100%');
 f.view.renderPlayer({...vm,progressMs:180001});assert.equal(fill(),'0%');assert.equal(range.hidden,true);
 f.view.renderPlayer({...vm,progressMs:90000,canSeek:false});assert.equal(fill(),'50%');assert.equal(range.disabled,true);
 f.view.renderPlayer({active:true,sourceKind:'radio'});assert.equal(fill(),'0%');assert.equal(range.hidden,true);
});


test('seek keyboard changes remain available after a no-change pointer press and subsequent track change',()=>{
 const intents=[],f=surface({seek:event=>intents.push(event)}),vm=localPlayerModel(previewScene('now'));f.view.renderPlayer(vm);const range=f.view.seekControl;
 range.dispatchEvent(new Event('pointerdown'));range.dispatchEvent(new Event('pointerup'));
 const next={...vm,trackId:'next-track',seekOperation:vm.seekOperation+1,progressMs:0};f.view.renderPlayer(next);
 // Native keyboard arrows send input/change without another pointerdown.
 range.value='1000';range.dispatchEvent(new Event('input'));range.dispatchEvent(new Event('change'));
 assert.deepEqual(intents,[{positionMs:1000,trackId:next.trackId,operation:next.seekOperation}]);
});
test('seek blur cancels an uncommitted preview without changing playback or later committing it',()=>{
 const intents=[],f=surface({seek:event=>intents.push(event)}),vm=localPlayerModel(previewScene('now'));f.view.renderPlayer(vm);const range=f.view.seekControl;
 range.dispatchEvent(new Event('pointerdown'));range.value='90000';range.dispatchEvent(new Event('input'));assert.equal(f.doc.getElementById('detail-elapsed').textContent,'1:30');
 range.dispatchEvent(new Event('blur'));assert.equal(range.value,String(vm.progressMs));assert.equal(f.doc.getElementById('detail-elapsed').textContent,'1:24');assert.equal(f.view.seekDraft,null);assert.equal(f.view.seekGesture,null);
 range.dispatchEvent(new Event('change'));assert.deepEqual(intents,[]);
});
test('queue accessible name identifies full title and artist and updates the same row on artist change',()=>{
 const f=surface();f.view.renderQueue([item]);const row=f.view.queue.children[0];let label=row.getAttribute('aria-label');assert.ok(label.includes(item.title));assert.ok(label.includes(item.artist));assert.equal(row.disabled,true);
 f.view.renderQueue([{...item,artist:'A different artist',selectable:true}]);assert.equal(f.view.queue.children[0],row);label=row.getAttribute('aria-label');assert.ok(label.includes(item.title));assert.ok(label.includes('A different artist'));assert.equal(row.disabled,false);
});

test('player controls expose visible track, status and room text in their accessible names',()=>{
 const f=surface({live:true}),vm={active:true,playing:true,fresh:true,title:'Morgensang',artist:'En kunstner',target:'Køkken',canOutput:true};
 for(const value of [vm,{...vm,fresh:false,feedback:{message:'Afventer svar'}}]){
  f.view.renderPlayer(value);
  assert.equal(f.nodes.get('track').getAttribute('aria-label'),null);assert.equal(f.nodes.get('track-name').textContent,value.title);assert.equal(f.nodes.get('track-artist').textContent,value.artist);
  const name=f.nodes.get('output').getAttribute('aria-label');assert.ok(name.includes(f.nodes.get('player-state').textContent));assert.ok(name.includes(value.target));
 }
 f.view.renderQueue([{...item,order:3}]);assert.equal(f.view.queue.getAttribute('role'),'group');assert.ok(f.view.queue.children[0].getAttribute('aria-label').includes('3'));
});

test('queue detail never shows the duplicate mini player in active or empty rendering',()=>{
 const f=surface(),duplicate=new Node(),query=f.host.querySelector.bind(f.host);f.host.querySelector=selector=>selector==='.now-playing-detail'?duplicate:query(selector);
 f.view.renderPlayer({active:true,playing:true,fresh:true,title:'Song',artist:'Artist',target:'Room'});assert.equal(duplicate.hidden,true);duplicate.hidden=false;f.view.renderPlayer({active:false});assert.equal(duplicate.hidden,true);
});

test('current queue row uses the existing transport and cannot replay or bypass revoked authority',()=>{
 const f=surface(),vm=localPlayerModel(previewScene('now'));f.view.renderPlayer(vm);f.view.renderControls({toggle:true,playing:true});f.view.renderQueue([{...item,current:true,playing:true}]);const row=f.view.queue.children[0];let toggles=0;f.doc.getElementById('play-pause').addEventListener('click',()=>toggles++);row.click();assert.equal(toggles,1);assert.deepEqual(f.selected,[]);
 f.view.renderControls({toggle:false,blocked:true});row.click();assert.equal(toggles,1);assert.equal(row.disabled,true);
});
test('volume exposes name and truthful percent or unknown value',()=>{const f=surface();for(const volume of [0,40,100,null]){f.view.renderControls({canVolume:true,volume});const input=f.doc.getElementById('volume');assert.equal(input.getAttribute('aria-label'),'Lydstyrke');assert.equal(input.getAttribute('aria-valuetext'),volume===null?'Ukendt lydstyrke':volume+' %');}});
test('local and live queue rows expose no drag/reorder UI and leave native vertical scrolling and row playback available',()=>{
 for(const live of [false,true]){
  const f=surface({live}),events=[];f.host.music=event=>events.push(event);
  f.view.renderQueue([1,2,3].map(i=>({...item,id:'track'+i,order:i,selectable:true,reorderable:true,revision:8})));
  const original=[...f.view.queue.children],row=original[2],indicator=row.children[0];f.view.queue.scrollTop=72;
  assert.equal(indicator.tagName,'SPAN');assert.equal(indicator.textContent,'3');assert.equal(indicator.dataset.queueDragHandle,undefined);assert.equal(row.dataset.reorderable,undefined);assert.equal(indicator.getAttribute('tabindex'),null);assert.equal(indicator.getAttribute('aria-grabbed'),null);assert.doesNotMatch(row.getAttribute('aria-label'),/Flyt|Alt/);
  for(const pointerType of ['mouse','touch','pen'])for(const [type,clientY]of [['pointerdown',200],['pointermove',10],['pointerup',10],['pointercancel',10]]){const e=new Event(type,{cancelable:true});Object.assign(e,{pointerId:1,button:0,clientY,pointerType});indicator.dispatchEvent(e);assert.equal(e.defaultPrevented,false,'indicator must not capture or prevent a native scroll');}
  const keyboard=new Event('keydown',{cancelable:true});Object.assign(keyboard,{altKey:true,key:'ArrowUp'});row.dispatchEvent(keyboard);assert.equal(keyboard.defaultPrevented,false);assert.deepEqual(events,[]);assert.deepEqual(f.view.queue.children,original);assert.equal(row.style.transform||'','');assert.equal(row.dataset.dragging,undefined);assert.equal(f.view.queue.scrollTop,72);
  row.click();assert.equal(f.selected.length,1);assert.equal(f.selected[0].id,'track3');assert.equal(f.selected[0].revision,8);
  f.view.renderQueue(original.map(node=>({...node.queueItem,revision:9})));assert.deepEqual(f.view.queue.children,original);assert.equal(f.view.queue.scrollTop,72);row.click();assert.equal(f.selected[1].revision,9);assert.deepEqual(events,[]);
 }
 const css=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/ui-kit.css',import.meta.url),'utf8'),components=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/ui/components.css',import.meta.url),'utf8');assert.doesNotMatch(css+components,/grip-vertical|queue-track\[data-reorderable|queue-track\[data-dragging/);assert.match(css,/#music-detail #queue \.queue-track>\.queue-order\{[^}]*touch-action:pan-y/);
});
test('cover tone uses decoded dominant pixels once, stays neutral for unreadable artwork and cleans listeners',()=>{
 const f=surface(),cover=f.doc.getElementById('cover'),style=f.host.querySelector('.player').style;f.view.progressVM={active:true};cover.src='https://source/cover';cover.complete=true;cover.naturalWidth=300;let reads=0;const create=f.doc.createElement;f.doc.createElement=tag=>tag==='canvas'?{getContext:()=>({drawImage(){},getImageData(){reads++;return {data:new Uint8ClampedArray([20,40,60,255,21,41,61,255,240,240,240,255])};}})}:create(tag);
 f.view.updateCoverTone();assert.equal(style.getPropertyValue('--player-cover-tone'),'rgb(21 41 61 / .12)');f.view.updateCoverTone();assert.equal(reads,1);
 cover.src='https://blocked/cover';f.doc.createElement=()=>({getContext:()=>({drawImage(){throw new Error('Tainted canvas');}})});f.view.updateCoverTone();assert.equal(style.getPropertyValue('--player-cover-tone'),'transparent');assert.equal(f.view.coverTones.get(cover.src),'transparent');f.view.cleanup();cover.src='https://after/cleanup';cover.dispatchEvent(new Event('load'));assert.equal(f.view.coverTones.size,0);
});

test('current queue row presents its actual pause/resume action under an inclusive heading',()=>{
 const f=surface(),current={...item,id:'current',current:true,playing:true,order:0};f.view.renderControls({playing:true,toggle:true});f.view.renderQueue([current,item]);const row=f.view.rows.get('current');assert.equal(row.children[3].src,'assets/icons/pause-fill.svg');assert.match(row.getAttribute('aria-label'),/Sæt på pause/);assert.equal(f.nodes.get('queue-title').textContent,'Afspilning og kø');let toggles=0;f.nodes.get('play-pause').addEventListener('click',()=>toggles++);row.click();assert.equal(toggles,1);
 f.view.renderQueue([{...current,playing:false},item]);assert.equal(f.view.rows.get('current'),row);assert.equal(row.children[3].src,'assets/icons/play-fill.svg');assert.match(row.getAttribute('aria-label'),/Fortsæt/);f.view.renderQueue([item]);assert.equal(f.nodes.get('queue-title').textContent,'Næste i køen');
});

test('speaker output follows transport before volume in DOM and survives idle restoration',()=>{
 let volume,transport;const f=surface({arrange({host,doc}){const player=host.querySelector('.player');transport=new Node();volume=new Node();player.append(transport,volume);player.querySelector=selector=>selector==='.volume'?volume:null;}});const player=f.host.querySelector('.player'),output=f.doc.getElementById('output');assert.deepEqual(player.children,[transport,output,volume]);f.view.renderPlayer({active:false,canOutput:true});assert.equal(player.children.includes(output),false);f.view.renderPlayer({active:true,title:'Song',artist:'Artist',target:'Room',canOutput:true});assert.deepEqual(player.children,[transport,output,volume]);
});

test('Spotify palette uses anonymous CORS before request without mutating visible artwork',()=>{
 const f=surface(),cover=f.doc.getElementById('cover'),style=f.host.querySelector('.player').style,probes=[];class PaletteImage{constructor(){probes.push(this);this.complete=true;this.naturalWidth=640;}set src(value){this.request={url:value,crossOrigin:this.crossOrigin};}removeAttribute(){this.removed=true;}}
 f.doc.defaultView={Image:PaletteImage};const create=f.doc.createElement;f.doc.createElement=tag=>tag==='canvas'?{getContext:()=>({drawImage(image){assert.ok(image instanceof PaletteImage);},getImageData(){return {data:new Uint8ClampedArray([20,40,60,255])};}})}:create(tag);f.view.progressVM={active:true};cover.src='https://i.scdn.co/image/abc';f.view.updateCoverTone();assert.deepEqual(probes[0].request,{url:cover.src,crossOrigin:'anonymous'});assert.equal(cover.crossOrigin,undefined);f.view.updateCoverTone();assert.equal(probes.length,1);probes[0].onload();assert.equal(style.getPropertyValue('--player-cover-tone'),'rgb(20 40 60 / .12)');f.view.updateCoverTone();assert.equal(probes.length,1);
 cover.src='https://image-cdn-ak.spotifycdn.com/image/def';f.view.updateCoverTone();probes[1].onerror();assert.equal(cover.src,'https://image-cdn-ak.spotifycdn.com/image/def');assert.equal(style.getPropertyValue('--player-cover-tone'),'transparent');f.view.updateCoverTone();assert.equal(probes.length,2);
 cover.src='https://i.scdn.co/image/new';f.view.updateCoverTone();const pending=probes[2];f.view.cleanup();assert.equal(pending.onload,null);assert.equal(pending.onerror,null);assert.equal(pending.removed,true);
});

test('first empty, loading, error and offline player keeps a precise state in the existing shell without fake controls',()=>{
 const f=surface({live:true}),snapshot={capabilities:{musicRead:['mood']}},states=[['loading',true,'Henter afspilningsstatus'],['error',true,'Afspilningen kunne ikke hentes.'],['unavailable',false,'Afspilningen kan ikke hentes offline.']];for(const [state,connected,message]of states){const vm=livePlayerModel(null,connected,state,snapshot,'Køkkenalrum');f.view.renderPlayer(vm);assert.equal(f.nodes.get('player-empty').hidden,false);assert.equal(f.view.emptyCopy.hidden,false);assert.equal(f.view.emptyCopy.textContent,message);assert.equal(f.nodes.get('player-room').textContent,'Køkkenalrum');assert.equal(f.nodes.get('play-pause').disabled,true);assert.equal(f.nodes.get('volume').disabled,true);assert.equal(f.nodes.get('player-progress').hidden,true);assert.equal(f.nodes.get('track-name').textContent,'');assert.equal(f.nodes.get('empty-find-music').disabled,!vm.canDiscover);}
 const html=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/index.html',import.meta.url),'utf8');assert.match(html,/<div class="player-empty-art" aria-hidden="true"><img id="empty-cover" class="live-art-fallback" src="assets\/icons\/music-note-beamed.svg" alt=""><\/div>/);
});

test('a bound read error preserves known song and artwork while naming failed status and retaining source position honestly',()=>{
 const f=surface({live:true}),snapshot={bootId:'boot',roomId:'room',capabilities:{musicRead:['playback','mood']}},observed=boundPlayback(snapshot,{expiresAt:Date.now()+10000,state:'playing',progressMs:84000,item:{name:'Known song',artists:['Known artist'],duration_ms:187000,uri:item.uri,artwork:item.artwork},target:{name:'Known room'}});f.view.renderPlayer(livePlayerModel(observed,true,'ready',snapshot));const cover=f.nodes.get('cover'),title=f.nodes.get('track-name'),src=cover.src,stale={...observed,stale:true,displayRetained:true};f.view.renderPlayer(livePlayerModel(stale,true,'error',snapshot));assert.equal(f.nodes.get('cover'),cover);assert.equal(cover.src,src);assert.equal(f.nodes.get('track-name'),title);assert.equal(title.textContent,'Known song');assert.equal(f.nodes.get('player-room').textContent,'Known room');assert.equal(f.nodes.get('player-state').textContent,'Status kunne ikke hentes');assert.equal(f.nodes.get('player-progress').dataset.stale,'true');assert.equal(f.nodes.get('player-progress-meter').getAttribute('value'),'84000');
});

test('current and upcoming queue rows retain identical ListRow slots with long real copy and playback authority',()=>{
 const f=surface(),longTitle='En meget lang sangtitel '.repeat(12),longArtist='Et meget langt kunstnernavn '.repeat(8);
 f.view.renderControls({toggle:true,playing:true});
 const current={...item,id:'current-aligned',current:true,playing:true,title:longTitle,artist:longArtist,order:0},upcoming={...item,id:'next-aligned',current:false,title:longTitle,artist:longArtist,order:12,reorderable:true,selectable:true,revision:42};
 f.view.renderQueue([current,upcoming]);
 const first=f.view.rows.get(current.id),next=f.view.rows.get(upcoming.id);
 for(const row of [first,next]){
  assert.equal(row.children.length,4);for(const [index,slot]of ['queue-order','queue-cover','queue-copy','queue-play'].entries())assert.ok(row.children[index].classList.contains(slot));
  assert.equal(row.children[0].dataset.queueDragHandle,undefined);
  assert.equal(row.children[2].children[0].textContent,longTitle);
  assert.equal(row.children[2].children[1].textContent,longArtist);
  assert.ok(row.getAttribute('aria-label').includes(longTitle));
 }
 assert.equal(first.children[0].children[0].src,'assets/icons/soundwave.svg');
 assert.equal(next.children[0].textContent,'12');
 assert.equal(first.dataset.reorderable,undefined);assert.equal(next.dataset.reorderable,undefined);
 f.view.renderQueue([{...current,playing:false},upcoming]);
 assert.equal(f.view.rows.get(current.id),first);assert.equal(f.view.rows.get(upcoming.id),next);
 assert.equal(first.children[0].children[0].src,'assets/icons/pause-fill.svg');
 const css=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/ui-kit.css',import.meta.url),'utf8');
 assert.match(css,/#music-detail #queue \.queue-track\{[^}]*grid-template-columns:var\(--pv-hit\) var\(--pv-hit\) minmax\(0,1fr\) var\(--pv-hit\)/);
 assert.match(css,/#music-detail #queue \.queue-track>\.queue-order\{[^}]*place-items:center;justify-content:center;padding:0/);
 assert.match(css,/#music-detail #queue \.queue-track>span :is\(strong,small\)\{[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis/);
});

test('volume icon mutes and restores only observed same-owner volume with no optimistic icon or repeated pending intent',()=>{
 const f=surface({arrange:({host,doc})=>{host.state=previewScene('now');doc.getElementById('volume-mute').append(new Node('img'));}}),events=[];f.host.playerView=f.view;f.host.music=e=>events.push(e);
 const render=volume=>f.view.renderControls({volume,canVolume:true});
 render(46);const button=f.nodes.get('volume-mute');assert.equal(button.disabled,false);button.click();button.click();assert.deepEqual(events,[{type:'volume',value:0}]);assert.equal(button.getAttribute('aria-pressed'),'false');assert.equal(button.querySelector('img').src,'assets/icons/volume-up-fill.svg');
 render(46);assert.equal(button.disabled,true);render(0);assert.equal(button.getAttribute('aria-pressed'),'true');assert.equal(button.querySelector('img').src,'assets/icons/volume-mute.svg');button.click();assert.deepEqual(events[1],{type:'volume',value:46});assert.equal(button.getAttribute('aria-pressed'),'true');render(46);assert.equal(button.getAttribute('aria-pressed'),'false');
 f.host.state.music.playback.targetId='another-room';render(0);assert.equal(button.disabled,true);button.click();assert.equal(events.length,2);
 render(22);f.view.renderControls({volume:22,canVolume:true,blocked:true});button.click();assert.equal(events.length,2);
 f.view.renderControls({volume:null,canVolume:true});assert.equal(button.disabled,true);f.view.renderControls({volume:22,canVolume:true,min:10,max:100});assert.equal(button.disabled,true);
});

test('live mute uses the admitted volume action and forgets restore on account/owner changes, including unknown outcomes',()=>{
 const f=surface({live:true,arrange:({host,doc})=>{host.liveSnapshot={bootId:'boot',roomId:'room'};host.liveMedia={playback:{config_entry_id:'account',owner_epoch:'epoch',target:{id:'target'}}};doc.getElementById('volume-mute').append(new Node('img'));}}),events=[];f.host.playerView=f.view;f.host.music=e=>events.push(e);
 f.view.renderControls({volume:30,canVolume:true});f.nodes.get('volume-mute').click();assert.deepEqual(events,[{type:'volume',value:0}]);f.view.renderControls({volume:30,canVolume:true,blocked:true});f.view.renderControls({volume:30,canVolume:true});f.nodes.get('volume-mute').click();assert.equal(events.length,1);
 f.view.renderControls({volume:0,canVolume:true});f.host.liveMedia.playback.owner_epoch='new-owner';f.view.renderControls({volume:0,canVolume:true});assert.equal(f.nodes.get('volume-mute').disabled,true);
});

test('play and pause retain destination and player structure with one fixed destination CSS slot',()=>{
 const f=surface(),vm=localPlayerModel(previewScene('now'));f.view.renderPlayer(vm);const player=f.host.querySelector('.player'),children=[...player.children],output=f.nodes.get('output');
 for(const playing of [false,true,false]){f.view.renderPlayer({...vm,playing});assert.equal(f.nodes.get('player-room').textContent,vm.target);assert.equal(f.nodes.get('output'),output);assert.deepEqual(player.children,children);assert.notEqual(f.nodes.get('player-state').textContent,'På pause');}
 const css=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/ui-kit.css',import.meta.url),'utf8');assert.match(css,/\.player\.pv-card>\.output h2\{[^}]*height:48px;display:grid;grid-template-columns:minmax\(0,1fr\);grid-template-rows:20px 28px/);assert.match(css,/\.player\.pv-card>\.output \.output-room\{grid-column:1;grid-row:2;align-self:center;justify-self:center/);
});


test('actual Player volume inputs use shared Slider and paint observed volume without overwriting an active gesture',()=>{
 const f=surface();for(const id of ['volume','detail-volume'])assert.equal(f.doc.getElementById(id).getAttribute('data-kit'),'slider');
 f.view.renderControls({canVolume:true,volume:35});const input=f.doc.getElementById('volume');assert.equal(input.style.getPropertyValue('--pv-slider-progress'),'35%');
 input.value='65';f.view.renderControls({canVolume:true,volume:35,gesture:input});assert.equal(input.value,'65');assert.equal(input.style.getPropertyValue('--pv-slider-progress'),'65%');
 f.view.renderControls({canVolume:true,volume:0});assert.equal(input.style.getPropertyValue('--pv-slider-progress'),'0%');assert.equal(input.getAttribute('aria-valuetext'),'0 %');
});

test('same-instance bfcache restore reconnects mute and retained seek exactly once without changing current resources',()=>{
 const intents=[],seeks=[],target=new EventTarget(),f=surface({seek:event=>seeks.push(event),arrange:({host,doc})=>{host.state=previewScene('light-detail-on');host.isConnected=true;doc.getElementById('volume-mute').append(new Node('img'));}});const documentEvents=new EventTarget();f.doc.addEventListener=documentEvents.addEventListener.bind(documentEvents);f.doc.removeEventListener=documentEvents.removeEventListener.bind(documentEvents);f.host.playerView=f.view;f.host.cleanup=()=>f.view.cleanup();f.host.schedule=()=>{};f.host.render=()=>{f.view.renderPlayer(localPlayerModel(f.host.state));f.view.renderControls(localControlModel(f.host.state));};f.host.music=event=>{intents.push(event);f.host.state=sceneTransition(f.host.state,{type:'music',event});f.host.render();};const life=new PageLifecycle(f.host,target),button=f.nodes.get('volume-mute'),seek=f.view.seekControl,root=f.nodes.get('player-progress');life.attach();f.host.render();
 for(let cycle=0;cycle<2;cycle++){const state=f.host.state,focus=state.focus,devices=state.devices,timer=state.timer,volume=state.music.playback.volume,count=intents.length;target.dispatchEvent(new Event('pagehide'));assert.equal(seek.parentNode,null);assert.equal(f.host.state,state);button.click();assert.equal(intents.length,count);assert.equal(f.view.progressVM,null);
  const shown=new Event('pageshow');Object.defineProperty(shown,'persisted',{value:true});target.dispatchEvent(shown);target.dispatchEvent(shown);f.view.resume();assert.equal(f.view.seekControl,seek);assert.equal(root.children.filter(child=>child===seek).length,1);assert.equal(f.host.state.focus,focus);assert.equal(f.host.state.devices,devices);assert.equal(f.host.state.timer,timer);
  button.click();assert.equal(f.host.state.music.playback.volume,0);button.click();assert.equal(f.host.state.music.playback.volume,volume);assert.deepEqual(intents.slice(count),[{type:'volume',value:0},{type:'volume',value:volume}]);
  seek.value='60000';seek.dispatchEvent(new Event('pointerdown'));seek.dispatchEvent(new Event('input'));seek.dispatchEvent(new Event('change'));assert.equal(seeks.length,cycle+1);assert.equal(seeks.at(-1).positionMs,60000);assert.equal(f.host.state.focus,focus);
 }
 target.dispatchEvent(new Event('pagehide'));f.host.isConnected=false;target.dispatchEvent(new Event('pageshow'));f.view.resume();assert.equal(seek.parentNode,null);const count=intents.length;button.click();assert.equal(intents.length,count);life.detach();
});


test('semantic current queue row follows playing/paused identity while disabled authority stays independent',()=>{
 const f=surface(),current={...item,id:'observed-current',current:true,playing:true,order:0},next={...item,id:'next',selectable:false,order:1};
 f.view.renderControls({toggle:true,playing:true});f.view.renderQueue([current,next]);const row=f.view.rows.get(current.id),upcoming=f.view.rows.get(next.id),slots=[...row.children];
 assert.equal(row.getAttribute('aria-current'),'true');assert.equal(row.getAttribute('aria-pressed'),null);assert.equal(row.dataset.playback,'playing');assert.equal(row.children[0].querySelector('img').src,'assets/icons/soundwave.svg');assert.equal(upcoming.getAttribute('aria-current'),null);assert.equal(upcoming.dataset.playback,'upcoming');assert.equal(upcoming.disabled,true);
 f.view.renderControls({toggle:false,blocked:true});f.view.renderQueue([{...current,playing:false},next]);assert.equal(f.view.rows.get(current.id),row);assert.deepEqual(row.children,slots);assert.equal(row.disabled,true);assert.equal(row.getAttribute('aria-current'),'true');assert.equal(row.dataset.playback,'paused');assert.equal(row.children[0].querySelector('img').src,'assets/icons/pause-fill.svg');assert.equal(row.children[3].src,'assets/icons/play-fill.svg');assert.match(row.getAttribute('aria-label'),/På pause/);
 f.view.renderQueue([{...current,playing:undefined},next]);assert.equal(row.dataset.playback,'unknown');assert.match(row.getAttribute('aria-label'),/Aktuelt nummer/);assert.doesNotMatch(row.getAttribute('aria-label'),/Spiller|På pause|Fortsæt/);assert.equal(row.children[0].querySelector('img').src,'assets/icons/music-note-beamed.svg');
 f.view.renderQueue([{...current,current:false,playing:false,order:2,selectable:false},next]);assert.equal(row.getAttribute('aria-current'),null);assert.equal(row.dataset.current,'false');assert.equal(row.dataset.playback,'upcoming');assert.equal(row.children[0].textContent,'2');
});

test('radio station branding uses decoded cover pixels at the same quiet12percent tint as album art',()=>{
 const f=surface(),cover=f.doc.getElementById('cover'),style=f.host.querySelector('.player').style,create=f.doc.createElement;let samples=0;f.doc.createElement=tag=>tag==='canvas'?{getContext:()=>({drawImage(image){assert.strictEqual(image,cover);},getImageData(){samples++;return {data:new Uint8ClampedArray([0,255,0,255,0,255,0,255,255,255,255,255])};}})}:create(tag);cover.complete=true;cover.naturalWidth=500;
 for(const [sourceKind,source]of [['radio','assets/radio-p3.svg'],['music','assets/top-heartless.svg']]){f.view.progressVM={active:true,sourceKind};cover.src=source;f.view.updateCoverTone();assert.equal(style.getPropertyValue('--player-cover-tone'),'rgb(0 255 0 / .12)');assert.equal(style.getPropertyValue('--pv-cover'),'rgb(0 255 0 / .12)');assert.equal(cover.src,source);f.view.updateCoverTone();}
 assert.equal(samples,2,'the actual source palette is cached rather than re-read or branded by phase');f.view.cleanup();
});

test('open player detail and fixed empty player share honest source states through active-to-empty crossings',()=>{
 const f=surface({live:true}),active={active:true,playing:true,fresh:true,title:'Observed song',artist:'Observed artist',target:'Kitchen',canOutput:true};
 for(const [status,connected,message]of [
  ['loading',true,'Henter afspilningsstatus'],
  ['error',true,'Afspilningen kunne ikke hentes.'],
  ['ready',false,'Afspilningen kan ikke hentes offline.'],
  ['account-selection',true,'Vælg en musikkonto.'],
  ['ready',true,'Vælg en stemning eller sang.'],
 ]){
  f.view.renderPlayer(active);const title=f.nodes.get('detail-title'),detail=f.nodes.get('detail-status');
  const vm=livePlayerModel(null,connected,status);f.view.renderPlayer(vm);
  assert.equal(detail.textContent,message);assert.equal(f.view.emptyCopy.textContent,message);
  assert.equal(f.nodes.get('detail-title'),title);assert.equal(f.nodes.get('detail-status'),detail);
  assert.equal(f.nodes.get('track-name').textContent,'');assert.equal(f.nodes.get('play-pause').disabled,true);
  assert.equal(f.nodes.get('player-empty').getAttribute('aria-busy'),String(status==='loading'));
  f.view.renderPlayer({...vm,feedback:{message:'Afspilningen kunne ikke bekræftes',pending:false}});
  assert.equal(detail.textContent,'Afspilningen kunne ikke bekræftes');assert.equal(f.view.emptyCopy.textContent,detail.textContent);
 }
 f.view.renderPlayer(active);assert.equal(f.nodes.get('track').getAttribute('aria-label'),null);
 assert.equal(f.nodes.get('track').getAttribute('aria-description'),'Åbn afspiller');
 assert.equal(f.nodes.get('track-name').textContent,active.title);assert.equal(f.nodes.get('track-artist').textContent,active.artist);
});

test('a chosen local song is shown while starting without borrowing prior track position or playing status',()=>{
 const state=initialScene();state.music.pending={id:'chosen',track:1,room:'Stuen',operation:2};const vm=localPlayerModel(state),controls=localControlModel(state);
 assert.equal(vm.title,TRACKS[1].title);assert.equal(vm.active,true);assert.equal(vm.loading,true);assert.equal(vm.playing,false);assert.equal(vm.fresh,false);assert.equal(vm.progressMs,null);assert.equal(vm.canSeek,false);assert.equal(vm.feedback.message,'Starter afspilning…');assert.equal(controls.blocked,true);assert.equal(controls.canVolume,false);assert.equal(state.music.playback.track,0,'presentation does not fabricate observed playback');
});
