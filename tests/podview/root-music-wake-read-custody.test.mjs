import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ScreenLifecycle,screenBusy} from '../../podview/ui/screen-lifecycle.js';
import {PodVoiceTransport} from '../../podview/podvoice-transport.js';
const code=readFileSync(new URL('../../podview/widget-view.js',import.meta.url),'utf8');
const start=code.indexOf(' async loadLiveMusic('),end=code.indexOf('\n connectGestures()',start);
const load=new Function(`return ({${code.slice(start,end)}}).loadLiveMusic`)();
const callbackStart=code.indexOf('onConnection:status=>{')+'onConnection:status=>{'.length,callbackEnd=code.indexOf('},onSnapshot:',callbackStart);
const connection=new Function('status',code.slice(callbackStart,callbackEnd));
const invalidStart=code.indexOf(' invalidateLiveMusic('),invalidEnd=code.indexOf('\n liveMusicAccountChanged',invalidStart);
const invalidate=new Function(`return ({${code.slice(invalidStart,invalidEnd)}}).invalidateLiveMusic`)();
const themes=[['cooking','Musik til madlavningen','assets/kitchen.webp'],['italian','En italiensk aften','assets/italian.webp'],['calm','En rolig stund','assets/lake.webp']];
const body=()=>({ok:true,schema:'podview.mood-preview.v1',preview:{readOnly:true,bootId:'boot',roomId:'room',configEntryId:'account',ownerEpoch:'epoch',source:'spotify_web_api',expiresIn:60,voiceSessionId:null,voiceTurnId:null},data:{config_entry_id:'account',owner_epoch:'epoch',source:'spotify_web_api',tracks:themes.map(([themeId,themeTitle,themeArt],i)=>({uri:'spotify:playlist:'+String(i).padStart(22,'0'),name:'Actual '+i,artist:themeTitle,themeId,themeTitle,themeArt}))}});

test('old lifecycle cleanup cannot clear a replacement read custody',()=>{
 const old={},replacement={},host={liveMusicReadCustody:replacement,style:{setProperty(){}},ownerDocument:{removeEventListener(){}},motion:{releaseGeometry(){}}},clock={clearTimeout(){}},lifecycle=new ScreenLifecycle(host,{removeEventListener(){}},clock);lifecycle.wakeReadCustody=old;lifecycle.cleanup();assert.equal(host.liveMusicReadCustody,replacement);assert.equal(lifecycle.wakeReadCustody,null);assert.equal(lifecycle.wakeReadTimer,null);
});
