// Whole shipped HTML and inert API fixtures. Persistence/credentials are separately backend-tested.
const assert=require('node:assert/strict');
module.exports=async function runSettingsRepairContracts(browser,{source,sourceSha,status,settings,bounded,FIXTURE_WAIT_MS}) {
  const results=[];
  const savedRow={voicepe_host:'saved-speaker.local',room:'Saved-room',voicepe_noise_psk:'fixture-per-device-key'};
  const cases=[
    {name:'null-row',rows:[savedRow,null],repair:true},
    {name:'nonobject-row',rows:[savedRow,17],remove:true},
    {name:'non-list-object',rows:{voicepe_host:'unrepresentable.local'},remove:true},
    {name:'non-list-null',rows:null,repair:true},
    {name:'partial-host',rows:[savedRow,{voicepe_host:'kept-host.local'}],host:'kept-host.local',repair:true},
    {name:'partial-room',rows:[savedRow,{room:'Kept-room'}],room:'Kept-room',repair:true},
    {name:'nonstring-host',rows:[savedRow,{voicepe_host:17,room:'Kept-room'}],room:'Kept-room',repair:true},
    {name:'nonstring-room',rows:[savedRow,{voicepe_host:'kept-host.local',room:{id:'not-text'}}],host:'kept-host.local',repair:true},
    {name:'nonstring-per-device-key',rows:[savedRow,{voicepe_host:'kept-host.local',room:'Kept-room',voicepe_noise_psk:17}],remove:true,add:true},
    {name:'blank-source',rows:[savedRow,{voicepe_host:'',room:''}],remove:true},
    {name:'duplicate-host',rows:[savedRow,{voicepe_host:'SAVED-SPEAKER.LOCAL',room:'Other-room'}],remove:true},
    {name:'duplicate-room',rows:[savedRow,{voicepe_host:'other-speaker.local',room:'Saved-room'}],remove:true},
    {name:'valid-case-sensitive-rooms-and-new-blank',rows:[savedRow,{voicepe_host:'other-speaker.local',room:'saved-room'}],normal:true},
    {name:'nonascii-host-preserved',rows:[savedRow,{voicepe_host:'türkçe.local',room:'Other-room'}],normal:true},
    {name:'untrusted-409',untrusted:true}
  ];
  for(const item of cases) {
    let page,context,primary;const cleanupErrors=[],errors=[],posts=[],requests=[];
    const prefs={...settings,engine:'thin',live_alpha:false,idle_timeout_s:4,duck_level:23,
      system_prompt:'Fixture saved prompt',system_prompt_default:'Fixture default prompt',
      extended_device_control:false,device_control_entities:['vacuum.fixture'],
      podconnect_token:'********',ha_mcp_token:'********',voicepe_noise_psk:'********'};
    let current={...prefs,rooms:structuredClone(item.rows),settings_error:item.normal?'':'Fixture rejected room source'};
    try {
      page=await bounded(browser.newPage({viewport:{width:390,height:664}}),'settings repair new page');context=page.context();
      page.on('pageerror',error=>errors.push(error.message));
      await bounded(page.addInitScript(()=>{
        window.EventSource=class {close(){}};
        window.WebSocket=class {static OPEN=1;constructor(){this.readyState=3;}close(){this.readyState=3;}send(){}};
      }),'settings repair inert transports');
      await bounded(page.route('**/*',route=>{
        const request=route.request(),url=new URL(request.url());
        if(url.origin!=='https://panel.test')return route.abort('blockedbyclient');
        requests.push({path:url.pathname,method:request.method()});
        if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:source});
        if(url.pathname==='/api/settings') {
          if(request.method()==='POST') {
            const body=request.postDataJSON();posts.push(body);current={...prefs,...body};
            return route.fulfill({json:{ok:true,settings:current}});
          }
          assert.equal(request.method(),'GET');
          return route.fulfill({status:item.untrusted?409:200,json:item.untrusted?
            {ok:false,settings_source_untrusted:true,error:'Gendan settings.json fra backup, og genstart add-onen.'}:current});
        }
        assert.equal(request.method(),'GET','no restart, media or household write');
        let json={ok:true};
        if(url.pathname==='/api/status')json=status();
        if(url.pathname==='/api/models')json={models:[],voices:[],default:null};
        if(url.pathname==='/api/podconnect/rooms')json={rooms:[{id:'Saved-room'},{id:'saved-room'},{id:'Kept-room'},{id:'Other-room'},{id:'Repair-room'}]};
        return route.fulfill({json});
      }),'settings repair isolated routes');
      await bounded(page.goto('https://panel.test/'),'settings repair whole HTML');
      await page.locator('#tab-settings').click({timeout:FIXTURE_WAIT_MS});
      if(item.untrusted) {
        await page.waitForFunction(()=>document.querySelector('#s_status').textContent.includes('Gendan settings.json'),null,{timeout:FIXTURE_WAIT_MS});
        assert.equal(await page.locator('#s_save').isDisabled(),true);
        assert.equal(await page.locator('#s_saverestart').isDisabled(),true);
        await bounded(page.evaluate(()=>{document.querySelector('#s_save').onclick();document.querySelector('#s_saverestart').onclick();}),'untrusted direct handler veto');
        assert.equal(posts.length,0,'unknown settings cannot POST even through the installed handler');
        assert.doesNotMatch(await page.locator('#s_status').innerText(),/Gemt/);
        assert.deepEqual(errors,[]);results.push({name:item.name,pass:true,posts:0,restoreAction:true});
      } else {
        await page.waitForFunction(()=>document.querySelector('#s_save').disabled===false,null,{timeout:FIXTURE_WAIT_MS});
        assert.equal(posts.length,0,'raw GET never writes');
        assert.equal(await page.locator('#s_idle_timeout_s').inputValue(),'4');
        assert.equal(await page.locator('#s_duck_level').inputValue(),'23');
        assert.equal(await page.locator('#s_live_alpha').isChecked(),false);
        assert.equal(await page.locator('#s_podconnect_token').inputValue(),'********');
        const rows=page.locator('#s_rooms .roomrow'),count=Array.isArray(item.rows)?item.rows.length:1;
        assert.equal(await rows.count(),count,'raw rows projected without silent removal');
        const invalid=rows.last();
        if(item.host)assert.equal(await invalid.locator('.rh').inputValue(),item.host,'representable host preserved');
        if(item.room)assert.equal(await invalid.locator('.rr').inputValue(),item.room,'representable room preserved');
        if(!item.normal) {
          assert.match(await page.locator('#s_status').innerText(),/Ret eller fjern.*gem/);
          assert.ok(await page.locator('#s_rooms [aria-invalid=true]').count()>0,'invalid source visibly marked');
          await page.locator('#s_idle_timeout_s').fill('7',{timeout:FIXTURE_WAIT_MS});
          await page.locator('#s_save').click({timeout:FIXTURE_WAIT_MS});
          await page.waitForFunction(()=>document.querySelector('#s_status').textContent.includes('Ikke gemt'),null,{timeout:FIXTURE_WAIT_MS});
          assert.equal(posts.length,0,'unrelated preference save cannot discard rejected room rows');
          assert.equal(await rows.count(),count);
          if(item.add) {
            await invalid.locator('.rh').fill('changed-host.local',{timeout:FIXTURE_WAIT_MS});
            await invalid.locator('.rr').selectOption('Repair-room',{timeout:FIXTURE_WAIT_MS});
            await page.locator('#s_save').click({timeout:FIXTURE_WAIT_MS});
            await page.waitForFunction(()=>document.querySelector('#s_status').textContent.includes('ugyldige nøgle'),null,{timeout:FIXTURE_WAIT_MS});
            assert.equal(posts.length,0,'changing host/room cannot silently discard an invalid credential');
          }
          if(item.remove)await invalid.getByRole('button',{name:'Fjern rum'}).click({timeout:FIXTURE_WAIT_MS});
          else {
            await invalid.locator('.rh').fill(item.host||'repair-speaker.local',{timeout:FIXTURE_WAIT_MS});
            await invalid.locator('.rr').selectOption(item.room||'Repair-room',{timeout:FIXTURE_WAIT_MS});
          }
          if(item.add) {
            await page.locator('#s_addroom').click({timeout:FIXTURE_WAIT_MS});
            await rows.last().locator('.rh').fill('replacement-speaker.local',{timeout:FIXTURE_WAIT_MS});
            await rows.last().locator('.rr').selectOption('Repair-room',{timeout:FIXTURE_WAIT_MS});
          }
        } else {
          await page.locator('#s_addroom').click({timeout:FIXTURE_WAIT_MS});
          assert.equal(await rows.count(),count+1);
        }
        await page.locator('#s_save').click({timeout:FIXTURE_WAIT_MS});
        await page.waitForFunction(()=>document.querySelector('#s_status').textContent.startsWith('Gemt'),null,{timeout:FIXTURE_WAIT_MS});
        assert.equal(posts.length,1,'one explicit complete repair/remove Save');
        const body=posts[0];assert.ok(Array.isArray(body.rooms));
        assert.equal(body.idle_timeout_s,item.normal?4:7);
        for(const key of ['live_alpha','duck_level','system_prompt','extended_device_control','device_control_entities','podconnect_token','ha_mcp_token','voicepe_noise_psk'])
          assert.deepEqual(body[key],prefs[key],'preserved preference/masked secret '+key);
        if(Array.isArray(item.rows))assert.deepEqual(body.rooms[0],savedRow,'existing per-device credential preserved privately');
        const expectedCount=item.normal||item.add?count:item.remove?count-1:count;
        assert.equal(body.rooms.length,expectedCount,'new blank differs from rejected-source blank');
        if(item.normal)assert.deepEqual(body.rooms,item.rows,'valid identities/credentials remain unchanged and room IDs stay case-sensitive');
        await bounded(page.reload(),'repaired settings readback reload');
        await page.waitForFunction(()=>document.querySelector('#s_save').disabled===false,null,{timeout:FIXTURE_WAIT_MS});
        await page.locator('#tab-settings').click({timeout:FIXTURE_WAIT_MS});
        assert.equal(await page.locator('#s_rooms .roomrow').count(),expectedCount);
        assert.equal(await page.locator('#s_rooms [aria-invalid=true]').count(),0,'accepted API readback has valid rows');
        assert.equal(posts.length,1,'reload performs no new Save');
        assert.equal(await page.locator('#s_idle_timeout_s').inputValue(),String(body.idle_timeout_s));
        assert.deepEqual(errors,[],'whole shipped HTML has no script errors');
        results.push({name:item.name,pass:true,rawGetPosts:0,unrelatedSavePosts:item.normal?null:0,explicitSavePosts:1,readbackRows:expectedCount});
      }
    } catch(error){primary=error;}
    finally {
      if(page)try{await bounded(page.close(),'settings repair page cleanup');}catch(error){cleanupErrors.push(error.message);if(!primary)primary=error;}
      if(context)try{await bounded(context.close(),'settings repair context cleanup');}catch(error){cleanupErrors.push(error.message);if(!primary)primary=error;}
    }
    if(primary){primary.settingsRepairCleanupErrors=cleanupErrors;throw primary;}
  }
  return {html_sha256:sourceSha,source_kind:'whole candidate HTML',cases:results,
    evidence:'Synthetic settings API responses and accepted readback; no actual store, HA, credential, restart, provider or physical proof.'};
};
