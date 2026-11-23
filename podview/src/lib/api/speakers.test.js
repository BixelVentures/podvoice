// The speaker row table and the catalogue's block reasons (lib/api/speakers.ts); moved from
// tests/podview/root-speaker-row-state.test.mjs to Vitest with the module. Same assertions.
import {test} from 'vitest';
import assert from 'node:assert/strict';
import {musicBusy,speakerCatalogue,speakerRowState} from './speakers';

const row=(extra={})=>({availability:'available',homepodId:'42',selectable:true,startSelectable:true,...extra});
const idle={busy:false,music:false,selection:true,moveAvailable:false,fenced:null,actualOutput:false};
const playing={...idle,music:true,moveAvailable:true};

test('one table names every reason a speaker row is locked or free',()=>{
 const cases=[
  [row(),idle,'ok',false,''],
  [row(),playing,'ok',false,'Kan vælges til den aktuelle afspilning'],
  [row(),{...playing,fenced:'accepted'},'ok',false,'Afventer bekræftelse af afspilningen'],
  [row(),{...idle,busy:true},'busy-music',true,'Musikhandlingen behandles'],
  [row({availability:'unavailable'}),idle,'unavailable',true,'Ikke tilgængelig'],
  [row({availability:'unknown'}),idle,'unknown',true,'Status ukendt'],
  [row({homepodId:null}),idle,'no-homepod',true,'Afspilningsmål er ikke bekræftet'],
  [row({startSelectable:false}),idle,'no-start-rule',true,'Kan ikke vælges til afspilning'],
  [row(),{...idle,selection:false},'no-start-rule',true,'Kan ikke vælges til afspilning'],
  [row({selectable:false}),playing,'no-move',true,'Kan ikke vælges til afspilning'],
  [row(),{...playing,moveAvailable:false},'no-move',true,'Kan ikke vælges til afspilning'],
  [row({selectable:false}),{...playing,actualOutput:true},'current',false,'Bruges til den aktuelle afspilning'],
 ];
 for(const [r,ctx,reason,disabled,label] of cases)
  assert.deepEqual(speakerRowState(r,ctx),{reason,disabled,label},JSON.stringify([r,ctx]));
});

test('availability outranks busy, and busy outranks the current output',()=>{
 assert.equal(speakerRowState(row({availability:'unknown'}),{...playing,busy:true,actualOutput:true}).reason,'unknown');
 assert.equal(speakerRowState(row(),{...playing,busy:true,actualOutput:true}).reason,'busy-music');
});

test('server block reasons become truthful Danish labels',()=>{
 const start=reason=>speakerRowState(row({startSelectable:false,startBlockedReason:reason}),idle).label;
 assert.equal(start('no_rule'),'Ingen PodConnect-regel tillader denne højttaler i rummet');
 assert.equal(start('duplicate_rule'),'Flere PodConnect-regler matcher · ret opsætningen');
 assert.equal(start(null),'Kan ikke vælges til afspilning');
 const move=speakerRowState(row({selectable:false,moveBlockedReason:'duplicate_rule'}),playing);
 assert.equal(move.reason,'no-move');assert.equal(move.label,'Flere PodConnect-regler matcher · ret opsætningen');
});

test('only a music command in flight counts as busy',()=>{
 assert.equal(musicBusy(null),false);
 assert.equal(musicBusy({pending:true,activeOperation:{domain:'music'}}),true);
 assert.equal(musicBusy({pending:true,activeOperation:{domain:'vacuum'}}),false);
 assert.equal(musicBusy({pending:true,activeOperation:{domain:'light'}}),false);
 assert.equal(musicBusy({pending:false,setupPending:true,activeOperation:null}),false);
 assert.equal(musicBusy({pending:false,activeOperation:{domain:'music'}}),false);
});

test('catalogue accepts block reasons and rejects unknown ones',()=>{
 const context={bootId:'boot',roomId:'r0',accountId:'account'};
 const value=reason=>({ok:true,schema:'podview.speaker-catalogue.v1',...context,status:'observed',catalogueId:'c'.repeat(64),
  retrievedAt:Date.now()/1000,source:'podconnect.get_targets',moveAvailable:false,physicalResultVerified:false,
  speakers:[{speakerId:'a'.repeat(64),accountId:'account',kind:'configured_alias',nativeRoomId:'r0',homepodId:'42',
   name:'Frida',availability:'available',default:true,nativeSelected:true,outputSelected:null,selectable:false,
   startSelectable:false,startBlockedReason:reason,moveBlockedReason:null}]});
 assert.equal(speakerCatalogue(value('no_rule'),context)[0].startBlockedReason,'no_rule');
 assert.equal(speakerCatalogue(value(null),context).length,1);
 assert.equal(speakerCatalogue(value('made_up'),context),null);
});
