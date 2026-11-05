'use strict';
// Shared test-only environment; never imported by the shipped application.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const root=path.resolve(__dirname,'../..');
const runtimeRoot=path.resolve(process.env.PODVIEW_TEST_RUNTIME_ROOT||root);
const python=process.env.PODVIEW_TEST_PYTHON||'python3';
let artifacts;
function pythonEnv(extra={}){
 const search=[path.join(runtimeRoot,'podvoice'),runtimeRoot,path.join(runtimeRoot,'tests')];
 if(process.env.PODVIEW_TEST_EXTRA_PYTHONPATH)search.push(process.env.PODVIEW_TEST_EXTRA_PYTHONPATH);
 return {...process.env,...extra,PYTHONPATH:search.join(path.delimiter)};
}
function browserOptions(){
 const options={headless:true};
 const requested=process.env.PODVIEW_TEST_CHROMIUM;
 if(requested){if(!fs.existsSync(requested))throw new Error('PODVIEW_TEST_CHROMIUM does not exist');options.executablePath=requested;}
 else if(process.platform==='darwin'){
  const mac='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if(fs.existsSync(mac))options.executablePath=mac;
 }
 return options;
}
function artifactDir(){
 if(!artifacts){
  if(process.env.PODVIEW_TEST_ARTIFACT_DIR){artifacts=path.resolve(process.env.PODVIEW_TEST_ARTIFACT_DIR);fs.mkdirSync(artifacts,{recursive:true});}
  else artifacts=fs.mkdtempSync(path.join(os.tmpdir(),'podview-actual-proof-'));
 }
 return artifacts;
}
// Enter the existing overview using the real screen wake gesture at night.
async function openOverview(surface){
 const photo=surface.locator('#photo-view'),host=surface.locator('pv-widget-host');
 await photo.waitFor({state:'visible',timeout:15000});
 const read=()=>host.evaluate(h=>{const visible=node=>!!node&&!node.hidden&&node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden'&&getComputedStyle(node).display!=='none';return {night:h.dataset.night,view:h.dataset.view,photoVisible:visible(h.querySelector('#photo-view')),overviewVisible:visible(h.querySelector('#now-view'))};});
 const wait=async(predicate,label)=>{let state;for(let n=0;n<100;n++){state=await read();if(predicate(state))return state;await new Promise(resolve=>setTimeout(resolve,50));}throw Error(`${label}: ${JSON.stringify(state)}`);};
 const initial=await wait(s=>['true','false'].includes(s.night)&&s.view==='rest'&&s.photoVisible&&!s.overviewVisible,'screen did not reach Ro');
 await photo.tap();
 if(initial.night==='true'){
  await wait(s=>s.night==='false'&&s.view==='rest'&&s.photoVisible&&!s.overviewVisible,'first night touch did not wake in Ro');
  await photo.waitFor({state:'visible'});await new Promise(resolve=>setTimeout(resolve,1100));await photo.tap();
 }
 await wait(s=>s.view==='active'&&!s.photoVisible&&s.overviewVisible,'touch did not open overview');
 console.log('overviewTouch',JSON.stringify({initialNight:initial.night,taps:initial.night==='true'?2:1}));
}
// Actual touch events, including the native range/scroll gesture. These helpers
// never set product input values or dispatch synthetic DOM input/change events.
async function touchDrag(page,from,to,{via,beforeRelease}={}){
 const session=await page.context().newCDPSession(page);let released=false;
 const point=({x,y})=>[{x,y,id:1,radiusX:6,radiusY:6,force:1}];
 try{
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:point(from)});
  let start=from;
  for(const end of [...(via?[via]:[]),to]){
   for(let step=1;step<=5;step++){
    await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:point({x:start.x+(end.x-start.x)*step/5,y:start.y+(end.y-start.y)*step/5})});
    await new Promise(resolve=>setTimeout(resolve,8));
   }
   start=end;
  }
  if(beforeRelease)await beforeRelease();
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});released=true;
 }finally{if(!released)try{await session.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});}catch{}await session.detach();}
}
async function touchRange(page,locator,value,{thumbSize,beforeRelease}={}){
 await locator.scrollIntoViewIfNeeded();
 const box=await locator.boundingBox();
 const range=await locator.evaluate(input=>({min:Number(input.min||0),max:Number(input.max||100),value:Number(input.value),thumb:parseFloat(getComputedStyle(input).getPropertyValue('--pv-volume-thumb-size'))||16,disabled:input.disabled,type:input.type}));
 if(!box||range.type!=='range'||range.disabled||!Number.isFinite(value)||value<range.min||value>range.max||range.max<=range.min)throw Error('touch range unavailable');
 const inset=Math.min((thumbSize??range.thumb)/2,box.width/4),x=v=>box.x+inset+(v-range.min)/(range.max-range.min)*(box.width-2*inset),y=box.y+box.height/2;
 const from={x:x(range.value),y},to={x:x(value),y};
 // A small adjustment still has to cross the browser's touch-drag threshold.
 // Move out and back within the same held gesture, as a finger would.
 const via=Math.abs(to.x-from.x)<18?{x:Math.max(box.x+inset,Math.min(box.x+box.width-inset,from.x+(to.x<from.x?-24:24))),y}:undefined;
 await touchDrag(page,from,to,{via,beforeRelease});
}
async function touchScroll(page,locator,{dy=400}={}){
 await locator.scrollIntoViewIfNeeded();const box=await locator.boundingBox();if(!box)throw Error('touch scroll unavailable');
 const distance=Math.min(Math.abs(dy),box.height*0.6),x=box.x+box.width/2,y=box.y+box.height/2;
 await touchDrag(page,{x,y:y+Math.sign(dy)*distance/2},{x,y:y-Math.sign(dy)*distance/2});
 let previous=await locator.evaluate(element=>element.scrollTop),stable=0;
 for(let attempt=0;attempt<30&&stable<3;attempt++){
  await new Promise(resolve=>setTimeout(resolve,50));const current=await locator.evaluate(element=>element.scrollTop);
  stable=Math.abs(current-previous)<0.5?stable+1:0;previous=current;
 }
}
module.exports={root,runtimeRoot,python,pythonEnv,browserOptions,artifactDir,openOverview,touchRange,touchScroll};
