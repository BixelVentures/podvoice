import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkInventory,readTokenContract,REQUIRED_LAYOUT} from '../../scripts/check-ui-tokens.mjs';
const css=':root{--pv-type-body:17px;--pv-type-meta:15px;--pv-type-caption:var(--pv-type-meta);--pv-weight-normal:400;--pv-weight-medium:500;--pv-screen-space-2:8px;--pv-radius-card:24px;--pv-screen-ease:cubic-bezier(.2,0,0,1)} .debt{padding:13px;font-size:19px;border-radius:7px}';
const row=()=>({selector:'#answer p',view:'answer',visible:true,directText:'Et svar',styles:{fontSize:'17px',fontWeight:'400',...Object.fromEntries(REQUIRED_LAYOUT.map(key=>[key,'0px'])),transitionDuration:'0.24s',transitionTimingFunction:'cubic-bezier(0.2, 0, 0, 1)',animationDuration:'0s',animationTimingFunction:'ease',color:'rgb(0, 0, 0)'}});
const inventory=elements=>({schema:'podview.computed-ui.v1',elements});
test('canonical aliases resolve but consumer literals cannot silently authorize debt',()=>{
 const target=row();Object.assign(target.styles,{fontSize:'19px',paddingLeft:'13px',borderTopLeftRadius:'7px'});
 const report=checkInventory(inventory([target]),css);assert.equal(report.violationCount,3);assert.equal(report.ok,false);assert.equal(readTokenContract(css).fontSize.find(t=>t.name==='--pv-type-caption').value,'15px');
});
test('measured valid text/layout/motion passes with explicit uncovered color scope',()=>{
 const report=checkInventory(inventory([row()]),css);assert.equal(report.ok,true);assert.equal(report.visibleElementCount,1);assert(report.coverage.excluded.includes('color/background palette and composited transparency'));
});
test('missing measurements or missing canonical scales cannot yield zero-pass',()=>{
 const target=row();delete target.styles.paddingTop;const report=checkInventory(inventory([target]),css.replace('--pv-weight-normal:400;--pv-weight-medium:500;',''));assert.equal(report.ok,false);assert.equal(report.coverageErrorCount,2);assert.equal(checkInventory(inventory([]),css).ok,false);
});
test('container typography is not counted, hidden rows excluded, text roles expose wrong token choice',()=>{
 const container=row();container.directText='';container.styles.fontSize='16px';container.styles.fontWeight='700';
 const hidden={...row(),visible:false,styles:{}};assert.equal(checkInventory(inventory([container,hidden]),css).ok,true);
 const text=row();text.textRole='meta';assert.equal(checkInventory(inventory([text]),css).violations[0].category,'semanticType');
});
test('each active timing entry is checked; inactive default ease is not a deviation',()=>{
 const target=row();target.styles.transitionDuration='0.24s, 0s, 120ms';target.styles.transitionTimingFunction='ease, ease, linear';const report=checkInventory(inventory([target]),css);assert.equal(report.violationCount,2);assert.equal(report.checked.transitionTimingFunction,2);
});
test('command-line exits nonzero for real bad inventory and emits machine-readable findings',()=>{
 const dir=mkdtempSync(join(tmpdir(),'pv-token-test-'));try{const target=row();target.styles.paddingRight='3px';writeFileSync(join(dir,'inventory.json'),JSON.stringify(inventory([target])));writeFileSync(join(dir,'tokens.css'),css);const run=spawnSync(process.execPath,['scripts/check-ui-tokens.mjs',join(dir,'inventory.json'),join(dir,'tokens.css')],{encoding:'utf8'});assert.equal(run.status,1);assert.equal(JSON.parse(run.stdout).violationCount,1);}finally{rmSync(dir,{recursive:true,force:true});}
});
