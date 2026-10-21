import test from 'node:test';
import assert from 'node:assert/strict';
import {validateVisualContent as validate} from '../../podvoice/gatekeeper/static/podview/visual-content.js';
import {presentationAnswer} from '../../podvoice/gatekeeper/static/podview/owner-answers.js';
import {renderAlbumCover} from './helpers/render-owned-album-cover.mjs';
const receipt='a'.repeat(32),url='https://i.scdn.co/image/ab67616d0000b2730123456789abcdef';
const content=()=>({summary:'Omslaget til nummeret',sources:[{id:'source',kind:'owner_receipt',receiptId:receipt,label:'Spotify via PodConnect',scope:'tool_result'}],image:{url,alt:'Albumomslag til Source song',caption:'Source song',credit:'Spotify',kind:'album_cover',sourceId:'source'}});
test('same sourced-image anatomy shows album cover with honest Spotify attribution and keeps source on image failure',()=>{
 const c=content(),before=structuredClone(c),clean=validate('sourced-image',c,{ownerReceiptIds:[receipt]});assert.deepEqual(clean,c);
 const visual=renderAlbumCover(c,receipt);assert.equal(visual.body.hidden,false);assert.equal(visual.credit.textContent,'Omslag · Spotify');assert.equal(visual.image.src,url);
 visual.image.dispatchEvent(new Event('error'));assert.equal(visual.image.hidden,true);assert.equal(visual.imageError.hidden,false);assert.equal(visual.captionText.textContent,'Source song');assert.equal(visual.credit.textContent,'Omslag · Spotify');assert.equal(visual.sourceList.children.length,1);assert.deepEqual(c,before);
});
test('album-cover images reuse strict existing Spotify host/path identity',()=>{
 for(const bad of ['https://foreign.invalid/image/id','https://127.0.0.1/image/id','http://i.scdn.co/image/id','https://user@i.scdn.co/image/id','https://i.scdn.co:443/image/id','https://i.scdn.co/image/id?x=1','https://i.scdn.co/image/../id','https://i.scdn.co/image/id#x','https://I.SCDN.CO/image/id','assets/bicycle-drivetrain-illustration.webp']){
  const raw=content();raw.image.url=bad;assert.throws(()=>validate('sourced-image',raw,{ownerReceiptIds:[receipt]}),bad);
 }
 const raw=content();raw.image.sourceId='foreign';assert.throws(()=>validate('sourced-image',raw,{ownerReceiptIds:[receipt]}));
 for(const credit of ['Public domain','© Spotify','Spotify\nLicens: fri']){const raw=content();raw.image.credit=credit;assert.throws(()=>validate('sourced-image',raw,{ownerReceiptIds:[receipt]}));}
});
test('new cover kind cannot acquire AI illustration provenance or another receipt',()=>{
 const binding={roomId:'kitchen',sessionId:'session',turnId:'turn',taskId:'answer:d1',sessionEpoch:1,inputRevision:1,answerRevision:1,providerGeneration:1};
 const row={...binding,schema:'podview.presentation.v1',receiptId:receipt,observedAt:100,validUntil:200,displaySuggested:true,allowedActions:[],family:'sourced-image',title:'Omslag',content:content(),provenance:{kind:'owner_sources',receiptIds:['b'.repeat(32)]}};
 assert.equal(presentationAnswer(row,binding,101000).content.image.kind,'album_cover');
 const ai=structuredClone(row);ai.provenance={kind:'ai_explanation'};ai.content.sources[0].scope='conversation_answer';assert.throws(()=>presentationAnswer(ai,binding,101000));
 const other=structuredClone(row);other.content.sources[0].receiptId='c'.repeat(32);assert.throws(()=>presentationAnswer(other,binding,101000));
});
