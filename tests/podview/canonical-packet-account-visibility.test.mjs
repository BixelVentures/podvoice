import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8');
const method=source.slice(source.indexOf(' renderLive(){'),source.indexOf('\n suspendLiveTimer('));
const node=()=>({hidden:false,textContent:'',classList:{remove(){},contains(){return false;}},querySelector:()=>node(),setAttribute(){}});
const elements=new Map();
const render=new Function('$','LiveMusicCatalogueView','LiveMusicSelectionView','renderLiveWeather','renderRobotHistory',`return ({${method}}).renderLive`)(id=>{if(!elements.has(id))elements.set(id,node());return elements.get(id);},null,null,()=>{},()=>{});
for(const [name,hidden,count] of [['empty',true,0],['single',true,1],['multiple',false,2],['pending',true,0]])test(`host render preserves owner-controlled ${name} account visibility`,()=>{
 const accounts={hidden,children:[{},{}],data:{items:Array.from({length:count},(_,i)=>({id:`a${i}`}))}};
 const host={liveStatus:'connected',liveSnapshot:{capabilities:{musicRead:[],timerActions:[]},timers:{status:'unavailable'}},renderVoice(){},querySelectorAll(){return []},timerView:{renderAccess(){}},liveCatalogue:{updateCapabilities(){},open(){},render(){}},liveSelection:{setAccount(){},onSnapshot(){}},liveMedia:{accounts,render(){}}};
 render.call(host);render.call(host);assert.equal(accounts.hidden,hidden);
});
