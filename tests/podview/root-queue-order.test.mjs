import test from 'node:test';
import assert from 'node:assert/strict';
import {initialWidgetState,widgetTransition,TRACKS} from '../../podvoice/gatekeeper/static/podview/widget-model.js';
import {localQueueModel} from '../../podvoice/gatekeeper/static/podview/player-view.js';
test('moving third upcoming track to first preserves current position and next follows the visible queue',()=>{
 let music=initialWidgetState(),before=music.playback;music=widgetTransition(music,{type:'queue-reorder',id:TRACKS[3].id,beforeId:TRACKS[1].id,revision:music.revision});assert.equal(music.playback,before);const rows=localQueueModel({music,connected:true});assert.deepEqual(rows.slice(0,4).map(r=>r.id),[TRACKS[0].id,TRACKS[3].id,TRACKS[1].id,TRACKS[2].id]);const next=widgetTransition(music,{type:'skip',delta:1});assert.equal(next.playback.track,3);
 for(const e of [{id:TRACKS[0].id,beforeId:TRACKS[1].id},{id:TRACKS[2].id,beforeId:TRACKS[0].id},{id:'forged',beforeId:null}])assert.equal(widgetTransition(music,{type:'queue-reorder',revision:music.revision,...e}),music);
 assert.equal(widgetTransition(music,{type:'queue-reorder',id:TRACKS[2].id,beforeId:null,revision:1}),music);
});
test('pause resume and current-track selection never reset the retained position',()=>{let s=initialWidgetState();for(const type of ['toggle','toggle']){s=widgetTransition(s,{type});assert.equal(s.playback.progressMs,84000);}assert.equal(widgetTransition(s,{type:'queue-select',id:TRACKS[0].id,revision:s.revision}),s);});
