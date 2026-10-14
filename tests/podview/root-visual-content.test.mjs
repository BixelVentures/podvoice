import test from 'node:test';
import assert from 'node:assert/strict';
import {validateVisualContent as validate,visualFamilies} from '../../podvoice/gatekeeper/static/podview/visual-content.js';
import {visualExamples} from '../../podvoice/gatekeeper/static/podview/visual-examples.js';
import {adjustTimerDuration,readTimerDuration} from '../../podvoice/gatekeeper/static/podview/timer-model.js';
test('four visual families accept bounded sourced content and discard executable extensions',()=>{
 for(const family of visualFamilies){const raw=structuredClone(visualExamples[family].content);raw.html='<script>evil()</script>';raw.actions=['turn_on'];const result=validate(family,raw);assert.equal(result.html,undefined);assert.equal(result.actions,undefined);assert.deepEqual(result,visualExamples[family].content);}
});
test('visual sources reject executable, credential-bearing and unrecognized local URLs',()=>{
 for(const url of ['javascript:alert(1)','data:text/html,test','http://example.com','https://user:pass@example.com','//example.com','../secret']){const raw=structuredClone(visualExamples['fact-card'].content);raw.sources[0].url=url;assert.throws(()=>validate('fact-card',raw));}
});
test('visual content requires valid provenance and bounded unique rows',()=>{
 for(const mutate of [r=>r.facts[0].sourceId='invented',r=>r.facts.push({...r.facts[0]}),r=>r.facts[0].value='x'.repeat(81),r=>r.sources=[],r=>r.facts=[]]){const raw=structuredClone(visualExamples['fact-card'].content);mutate(raw);assert.throws(()=>validate('fact-card',raw));}
});
test('images cannot load SVG, data or traversal sources',()=>{
 for(const url of ['data:image/svg+xml,test','assets/../secret.png','assets/image.svg','javascript:x']){const raw=structuredClone(visualExamples['sourced-image'].content);raw.image.url=url;assert.throws(()=>validate('sourced-image',raw));}
});
test('timer drafts have exact boundaries and reject ambiguous or out-of-range input',()=>{
 assert.equal(adjustTimerDuration(1,-60),1);assert.equal(adjustTimerDuration(86400,60),86400);assert.equal(adjustTimerDuration(300,60),360);
 assert.equal(readTimerDuration('0','5','30'),330);assert.equal(readTimerDuration(24,0,0),86400);
 for(const fields of [[0,0,0],[24,0,1],[0,60,0],['',5,0],[0,1.5,0],[-1,0,0],[0,0,'NaN']])assert.equal(readTimerDuration(...fields),null);
});
