// Exercise the shipped SetupFlow module with Chromium's native timers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

const root = process.env.PODVOICE_UI_ROOT || path.resolve(__dirname, '../..');
const staticRoot = path.join(root, 'podvoice/gatekeeper/static/podview');
const modules = new Set(['setup.js', 'podvoice-transport.js', 'request-deadline.js']);

(async () => {
 const browser = await chromium.launch({headless:true, executablePath:process.env.PODVOICE_TEST_CHROMIUM});
 try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://panel.test/**', route => {
   const name = new URL(route.request().url()).pathname.split('/').pop();
   if (modules.has(name)) return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(staticRoot,name),'utf8')});
   return route.fulfill({contentType:'text/html',body:'<!doctype html><title>SetupFlow timer regression</title>'});
  });
  await page.goto('http://panel.test/view/setup.html');
  await page.evaluate(async () => {
   const {SetupFlow} = await import('./setup.js');
   window.makeFlow = ({claims=[],expiresIn=10,renew=true,load=()=>null}={}) => {
    const trace = {claims:0,starts:0,closes:0,views:[],navigation:[],saved:[]};
    const transport = {
     connected:true,controllerRenewed:false,
     snapshot:{bootId:'boot',roomId:'kitchen',controllerContinuity:{available:true}},
     async accessRequest() {return {requestId:'a'.repeat(32),matchSignal:'ABC123',expiresIn};},
     async accessClaim() {trace.claims++;const result=claims.shift();if(result instanceof Error)throw result;return result;},
     async start() {trace.starts++;this.controllerRenewed=renew;},
     close() {trace.closes++;},
    };
    const flow = new SetupFlow({transport,render:view=>trace.views.push(view),navigate:url=>trace.navigation.push(url),load,save:value=>trace.saved.push({...value}),forget:()=>{}});
    flow.connection('connected');
    return {flow,trace,transport};
   };
  });

  // The first native timer must fire after a pending response and schedule the
  // second poll. A connected claim only opens after renewed controller state.
  await page.evaluate(async () => {
   window.success = makeFlow({claims:[{status:'pending',expiresIn:10},{status:'connected'}]});
   await success.flow.submit('Kitchen screen');
  });
  assert.equal(await page.evaluate(()=>success.flow.phase),'pending');
  await page.waitForFunction(()=>success.trace.claims===1,undefined,{timeout:7000});
  assert.equal(await page.evaluate(()=>success.flow.phase),'pending');
  assert.equal(await page.evaluate(()=>success.trace.views.at(-1).pending),true);
  await page.waitForFunction(()=>success.trace.navigation.length===1,undefined,{timeout:7000});
  assert.deepEqual(await page.evaluate(()=>({claims:success.trace.claims,starts:success.trace.starts,closes:success.trace.closes,navigation:success.trace.navigation})),
   {claims:2,starts:1,closes:1,navigation:['./?room=kitchen']});

  // Closing and known failure cancel an armed native timer without invoking
  // clearTimeout with SetupFlow as its receiver.
  await page.evaluate(async () => {
   window.stopCase = makeFlow();await stopCase.flow.submit('Closed screen');stopCase.flow.close();
   window.failed = makeFlow();await failed.flow.submit('Denied screen');failed.flow.fail({code:'request_denied'});
  });
  assert.deepEqual(await page.evaluate(()=>({closed:stopCase.flow.closed,closedClaims:stopCase.trace.claims,failed:failed.flow.phase,failedTimer:failed.flow.timer})),
   {closed:true,closedClaims:0,failed:'error',failedTimer:null});

  // A resumed request expires on an actual short browser timer.
  await page.evaluate(() => {
   const saved={bootId:'boot',roomId:'kitchen',requestId:'a'.repeat(32),matchSignal:'ABC123',name:'Expired screen',deadline:Date.now()+100};
   window.expired=makeFlow({load:()=>saved});
  });
  await page.waitForFunction(()=>expired.flow.phase==='error',undefined,{timeout:3000});
  assert.deepEqual(await page.evaluate(()=>({claims:expired.trace.claims,timer:expired.flow.timer,status:expired.trace.views.at(-1).status})),
   {claims:0,timer:null,status:'Anmodningen udløb. Bed om adgang igen.'});
  assert.deepEqual(errors,[],'no uncaught browser timer exception');
  await page.close();
  console.log('PASS: shipped SetupFlow with native Chromium timers; pending poll, renewal, navigation, close, failure, expiry');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
