from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
root=Path('/private/tmp/pv118-radio-combined-20261103/dist')
script=r'''
<script type="module">
import {LiveRadioView} from './live-radio-view.js';
import {SpeakerOutputView} from './speaker-output-view.js';
await customElements.whenDefined('pv-widget-host');
const h=document.querySelector('pv-widget-host'),mode=new URLSearchParams(location.search).get('case')||'radio-to-music';
const now=()=>Date.now()/1000;let radio=mode.startsWith('radio'),changed=false;
h.playerView.seekControl?.remove();h.playerView.seekControl=null;
const musicVM={...h.playerView.progressVM,examplePosition:false,canSeek:false,active:true,sourceKind:'music',playing:true,fresh:true,volume:37,title:'Spotify på Svend',artist:'Inert test',target:'Svend',canOutput:true};
const owner={schema:'podview.radio.v1',ok:true,bootId:'radio-browser-inert',roomId:'kitchen',revision:1,enabled:true,physicalResultVerified:false,ownerProcessId:'manager-inert',stations:[{id:'p3'},{id:'p1'},{id:'p4-ostjylland'},{id:'p6-beat'},{id:'p8-jazz'}],targets:[{id:'r0',name:'Stuen',availability:'available',selectable:true,default:true},{id:'r1',name:'Svend',availability:'available',selectable:true,default:false}],actions:['start','stop','move','volume'],state:{status:radio?'playing':'idle',stationId:radio?'p3':null,targetId:radio?'r0':null,generation:1,sourceKind:radio?'radio':'none',ownerGeneration:1,volumePercent:41,observedAt:now()}};
const dto=()=>({...owner,retrievedAt:now(),validUntil:now()+30});document.body.dataset.qaRadioEffects='0';document.body.dataset.qaMusicEffects='0';
h.live=true;h.dataset.mode='inert-radio-review';h.state={...h.state,focus:'radio',connected:true};h.liveStatus='connected';h.liveSnapshot={bootId:owner.bootId,roomId:owner.roomId,sessionId:'session',taskId:'task',inputRevision:1,providerGeneration:1,voice:{phase:'IDLE',active:false},timers:{status:'observed',items:[],epoch:'timer'},capabilities:{musicRead:['playback'],homeRead:[],controlSetup:[],timerActions:[]}};
h.liveTransport={connected:true,generation:1,radio:async()=>dto(),radioOffer:async()=>{document.body.dataset.qaRadioEffects=String(Number(document.body.dataset.qaRadioEffects)+1);return new Promise(()=>{});},radioAction:async()=>({status:'accepted'})};
h.liveOutputs=new SpeakerOutputView(h);h.liveRadio=new LiveRadioView(h);h.liveControls={allowed:()=>false,musicContext:()=>({key:'fresh-inert-owner'}),musicIntent(action,args){document.body.dataset.qaMusicEffects=String(Number(document.body.dataset.qaMusicEffects)+1);document.body.dataset.qaMusicValue=String(args.percent);},render(){if(h.liveRadio.ownsPlayer())h.liveRadio.renderControls();else h.playerView.renderControls({sourceKind:'music',playing:true,toggle:true,volume:37,canVolume:true,blocked:false});}};
h.liveMedia={account:'account',playback:{state:'playing',config_entry_id:'account',owner_epoch:'spotify-inert',target:{id:'spotify-B'},roomBinding:'native-B'},observedPlayerModel:()=>musicVM,render(){if(!h.liveRadio.renderPlayer())h.playerView.renderPlayer(musicVM);h.liveControls.render();},refresh:async()=>{}};
await h.liveRadio.refresh({immediate:true});h.render();
for(const id of ['volume','detail-volume'])document.getElementById(id).addEventListener('input',()=>{if(changed)return;changed=true;radio=!radio;owner.revision++;owner.state={...owner.state,status:radio?'playing':'idle',sourceKind:radio?'radio':'none',stationId:radio?'p3':null,targetId:radio?'r0':null,generation:2,ownerGeneration:2,observedAt:now()};h.liveRadio.value=dto();h.liveRadio.lastConfirmed=radio?{...owner.state,targetName:'Stuen'}:null;h.playerView.focusSource(radio?'radio':'music');h.render();document.body.dataset.qaSource=radio?'radio':'music';});
</script>'''
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(root),**kwargs)
 def do_GET(self):
  if self.path.startswith('/__radio-gesture.html'):
   data=(root/'index.html').read_text().replace('</body>',script+'</body>').encode();self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  super().do_GET()
ThreadingHTTPServer(('127.0.0.1',53918),Handler).serve_forever()
