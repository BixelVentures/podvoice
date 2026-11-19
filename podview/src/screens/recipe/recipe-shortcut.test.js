// Ported from tests/podview/recipe-shortcut.test.mjs (node:test, source text run in a vm) to Vitest with a real DOM,
// when the recipe screen moved to React. Same assertions. Adaptations: the vm-loaded class became the real
// RecipeView; the inert base URL is a <base> element; the source-text test (the shortcut entry's anatomy) became a
// test of the rendered entry with the same facts (its disclosure and title, both copy rows, the hidden upload code,
// the update notice and the download name); the upload history rows are the rendered rows, their text joined as the
// fake DOM's was, and the fake date formatter's »i dag« is the real formatter's text.
import {afterEach,test} from 'vitest';
import assert from 'node:assert/strict';
import {historyDate} from './model';
import {RecipeView} from './RecipeView';

const settle=async()=>{for(let n=0;n<8;n++)await new Promise(resolve=>setTimeout(resolve,0));};
const textOf=node=>[...node.children].map(child=>child.textContent).join(' ');
afterEach(()=>{document.head.querySelector('base')?.remove();document.body.replaceChildren();localStorage.clear();});

function recipeView(fetch) {
 const base=document.createElement('base');base.href='http://inert/view/';document.head.append(base);
 globalThis.fetch=fetch;
 return Object.assign(Object.create(RecipeView.prototype),{shortcut:null});
}

function mounted(answers) {
 globalThis.fetch=async url=>{
  const answer=answers[new URL(String(url)).pathname.split('/').pop()];
  return {ok:Boolean(answer),json:async()=>structuredClone(answer)};
 };
 const form=document.createElement('form'),root=document.createElement('section');
 form.append(root);document.body.append(form);
 return {root,view:new RecipeView(root,()=>{},()=>{})};
}

test('the iPhone shortcut entry follows the admin-only server answer', async () => {
 const reads = [];
 let answer = {status:403};
 const view = recipeView(async url => {
  reads.push(String(url));
  return {ok:answer.status === 200,json:async()=>answer.body};
 });
 assert.equal(await view.refreshShortcut(), false, 'a non-admin never sees the entry');
 assert.equal(view.shortcut, null);
 assert.deepEqual(reads, ['http://inert/view/api/recipe-shortcut']);

 answer = {status:200,body:{version:1,download:'assets/opskrifter-til-podview.shortcut',
  address:'https://ha.example/api/podvoice/recipe-submissions',uploadCode:'u'.repeat(40),outdated:null}};
 assert.equal(await view.refreshShortcut(), true);
 assert.equal(view.shortcut.uploadCode, 'u'.repeat(40));
 assert.equal(await view.refreshShortcut(), false, 'an unchanged answer does not re-render');

 answer.body = {...answer.body,outdated:{seenAt:1,version:null}};
 assert.equal(await view.refreshShortcut(), true, 'an old shortcut seen on the phone shows the update');
 assert.deepEqual(view.shortcut.outdated, {seenAt:1,version:null});

 answer = {status:403};
 assert.equal(await view.refreshShortcut(), true);
 assert.equal(view.shortcut, null, 'losing admin access hides the upload code again');
});

test('the catalogue renders the entry with both import answers and a download', async () => {
 const address='https://ha.example/api/podvoice/recipe-submissions',code='u'.repeat(40);
 const {root}=mounted({recipes:{recipes:[]},'recipe-upload-history':{uploads:[]},
  'recipe-shortcut':{version:1,download:'assets/opskrifter-til-podview.shortcut',address,uploadCode:code,
   outdated:{seenAt:1,version:null}}});
 await settle();
 const entry=root.querySelector('#recipe-shortcut-trigger').closest('section');
 assert.equal(entry.hidden,false);
 assert.equal(entry.querySelector('[data-kit-slot=title]').textContent,'Tilføj opskrift-genvej til iPhone');
 const rows=[...entry.querySelectorAll('#recipe-shortcut-panel>.pv-kit-listrow')];
 assert.deepEqual(rows.map(row=>[row.querySelector('h3').textContent,row.querySelector('p').textContent]),
  [['1. PodView-adresse',address],['2. Uploadkode','Skjult']]);
 [...rows[1].querySelectorAll('button')].find(button=>button.textContent==='Vis').click();
 assert.equal(rows[1].querySelector('p').textContent,code,'the upload code is shown on Vis');
 assert.ok(root.textContent.includes('Ny version af genvejen'));
 const links=[...root.querySelectorAll('a[download]')];
 assert.deepEqual(links.map(link=>link.textContent),['Hent ny version','Hent genvejen']);
 for(const link of links)assert.equal(link.download,'Opskrifter til PodView.shortcut');
});

test('upload history names every phone outcome, including duplicates', async () => {
 const {root}=mounted({recipes:{recipes:[]},'recipe-upload-history':{uploads:[
  {id:'a',status:'duplicate',message:'Findes allerede',title:'Boller',updatedAt:1},
  {id:'b',status:'importing',message:'Henter opskriften fra siden',url:'https://example.com/x',updatedAt:1},
  {id:'c',status:'rejected',message:'Ingen opskrift fundet på siden',url:'https://example.com/y',updatedAt:1},
 ]}});
 await settle();
 const panel=root.querySelector('#recipe-upload-history-panel'),day=historyDate.format(new Date(1));
 assert.deepEqual([...panel.children].map(textOf),[
  `Boller ${day} Findes allerede`,
  `https://example.com/x ${day} Henter · Henter opskriften fra siden`,
  `https://example.com/y ${day} Afvist · Ingen opskrift fundet på siden`,
 ]);
});
