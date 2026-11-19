// Ported from tests/podview/root-recipe-approved-layout.test.mjs (node:test, the catalogue projection cut out of the
// source and run with inert nodes, the class run in a vm) to Vitest with a real DOM, when the recipe screen moved to
// React. There is no canonical copy. Same assertions. Adaptations: the source check for the step-number slot became
// a check of the rendered steps; the catalogue projection is the real catalogue (the view's own render, re-run with
// catalog(false) where the old test called render() again); the »I gang« row stands in the band, which CSS orders
// above the catalogue, so the rows are read band first; a fake node's `variant` is the data-kit-variant attribute and
// its text is its children's text joined by spaces, as the fake's was; the vm's createElement focus counter is a
// spy on focus(); the background test stubs catalog() as the old test did (recording the refresh flag and presenting
// a page heading), keeping the real constructor, page, refresh and restore code.
// Added with the move to React: an identical render writes nothing to the DOM.
import {afterEach,test,vi} from 'vitest';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createElement} from 'react';
import {PageHeader} from './parts';
import {RecipeView} from './RecipeView';

const podview=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const css=readFileSync(resolve(podview,'ui-kit.css'),'utf8');
const settle=async()=>{for(let n=0;n<8;n++)await new Promise(resolve=>setTimeout(resolve,0));};
afterEach(()=>{document.body.replaceChildren();localStorage.clear();});

function mount(){
 const form=document.createElement('form'),main=document.createElement('main'),root=document.createElement('section');
 main.append(root);form.append(main);document.body.append(form);return root;
}
// A view with a catalogue already read (no network): the state is set, then the catalogue drawn again.
function catalogue(state){
 globalThis.fetch=async()=>new Promise(()=>{});
 const root=mount(),view=new RecipeView(root,()=>{},()=>{},{background:true});
 Object.assign(view,state);
 const render=()=>{view.suppressPageFocus=true;view.catalog(false);view.suppressPageFocus=false;};
 render();
 return {root,view,render};
}
const textOf=node=>[...node.children].map(child=>child.textContent).join(' ');
const recipeRows=root=>[...root.querySelectorAll('[data-recipe-layout=band] [data-recipe]'),
 ...root.querySelectorAll('[data-recipe-layout=catalog]>div:first-child [data-recipe]')];

test('recipe reading and cooking share the approved numbered-list geometry', () => {
  const {root,view}=catalogue({saved:[{title:'Boller',steps:['Ælt','Bag'],ingredients:['Mel'],
    source:{url:'https://example.invalid/b',files:[]}}],catalogStatus:'ready'});
  view.recipe(view.saved[0]);
  const steps=[...root.querySelectorAll('[data-recipe-layout=reading] ol>li')];
  assert.equal(steps.length,2);
  for(const step of steps)
    assert.ok(step.firstElementChild.dataset.recipeStepNumber==='',"step numbers use canonical slot");
  assert.ok(/#recipe-view \[data-recipe-layout=reading\] ol\{[^}]*list-style:none/.test(css),
    "approved recipe CSS contract");
  assert.ok(new RegExp(String.raw`#recipe-view \[data-recipe-layout=reading\] li\{[^}]*`
    +String.raw`grid-template-columns:var\(--pv-icon-s\) minmax\(0,1fr\)`).test(css), "approved recipe CSS contract");
  assert.ok(/#recipe-view \[data-recipe-layout=reading\] li>\[data-recipe-step-number\]\{[^}]*grid-column:1;grid-row:1/
    .test(css), "approved recipe CSS contract");
  assert.ok(/#recipe-view \[data-recipe-layout=reading\] li>:is\(h3,p,button\)\{grid-column:2\}/.test(css),
    "approved recipe CSS contract");
  // The approved recipe is already full-width. Shared detail inset previously
  // narrowed it a second time and changed instruction wrapping.
  assert.doesNotMatch(css, /\.responses>:is\([^}]*#recipe-view[^}]*\)\[?[^}]*padding-inline:var\(--pv-s2\)/);
});

test('recipe catalog resume, ingredient disclosure, and overview use canonical kit styling', () => {
  assert.ok(new RegExp(String.raw`\.pv-kit-listrow\[data-kit-variant=resume\]\[aria-current=true\]`
    +String.raw`\{background:var\(--pv-dark\);color:var\(--pv-on-dark\)\}`).test(css), "approved recipe CSS contract");
  assert.ok(/\.pv-kit-disclosure\[data-kit-layout=card-header\][^{]*\{[^}]*border-radius/.test(css),
    "approved recipe CSS contract");
  assert.ok(css.includes("#recipe-view .pv-kit.pv-kit-button[data-kit-variant=quiet]{font:var(--pv-t-label)}"),
    "recipe quiet actions retain approved label typography");
  assert.ok(css.includes("#recipe-view [data-recipe-layout=ingredients]>div:not([hidden]){display:grid"),
    "ingredient disclosure uses canonical grid");
  assert.ok(/:is\(#home-recipes,#home-radio\)\[data-overview-size=s\]/.test(css), "approved recipe CSS contract");
});

test('active recipe stays once above the alphabetical catalogue across category changes',()=>{
  const burger={title:'Burgerboller',categories:['Brød'],steps:['Ælt','Bag'],
    source:{url:'https://example.invalid/burger'}};
  const curry={title:'Karry',categories:['Aftensmad'],steps:['Kog'],source:{url:'https://example.invalid/curry'}};
  const {root,view,render}=catalogue({saved:[burger,curry],active:burger,
    sessions:new Map([[burger,{steps:new Set(['0'])}]]),catalogCategory:'Aftensmad',history:[],catalogStatus:'ready'});
  view.recipe=function(r){this.opened=r;};
  let rows=recipeRows(root);
  assert.deepEqual(rows.map(r=>r.dataset.recipe),['Burgerboller','Karry']);
  assert.equal(rows[0].dataset.kitVariant,'resume');assert.equal(rows[0].getAttribute('aria-current'),'true');
  assert.match(textOf(rows[0]),/I gang.*Burgerboller · trin 2 af 2/,'A-Opskrifter: the band names the current step');
  rows[0].click();assert.equal(view.opened,burger,'resume opens the same session object');
  view.catalogCategory='';render();rows=recipeRows(root);
  assert.deepEqual(rows.map(r=>r.dataset.recipe),['Burgerboller','Karry'],'active recipe is not duplicated in B');
  view.active=null;render();rows=recipeRows(root);
  assert.ok(rows.every(r=>r.dataset.kitVariant!=='resume'),'completion removes the pinned row');
  view.active=burger;view.sessions.clear();view.catalogCategory='Aftensmad';render();
  assert.deepEqual(recipeRows(root).map(r=>r.dataset.recipe),['Karry'],
    'no fabricated session for a stale active object');
});

test('a recipe card shows its own publisher as a photo label; none, no label; the active band has none',()=>{
  const meyers={title:'Burgerboller',publisher:'Meyers',portions:'15 stk.',baking:'12–15 min. bagetid',
    steps:['Ælt'],source:{url:'https://meyers.dk/burgerboller'}};
  const plain={title:'Karry',publisher:'  ',steps:['Kog'],source:{url:'https://example.invalid/curry'}};
  const {root,view,render}=catalogue({saved:[meyers,plain],active:null,sessions:new Map(),catalogCategory:'',history:[],
    catalogStatus:'ready'});
  const label=row=>row.children[0].querySelector(':scope>[data-recipe-publisher]')??undefined;
  const [burger,curry]=recipeRows(root);
  assert.equal(label(burger).textContent,'Meyers');assert.equal(label(burger).tagName,'SMALL');
  assert.equal(label(curry),undefined,'a blank publisher shows no label');
  assert.match(textOf(burger.children[0]),/Burgerboller 15 stk\. · 12–15 min\. bagetid/,'title and meta unchanged');
  view.active=meyers;view.sessions.set(meyers,{steps:new Set()});render();
  assert.equal(label(recipeRows(root)[0]),undefined,'the I gang band keeps its own lines');
  assert.ok(/\[data-recipe\]:not\(\[data-kit-variant=resume\]\) small\[data-recipe-publisher\]\{[^}]*grid-row:1;/
    .test(css),'the label sits on the photo row, so the 252 card keeps its rows');
});

// Changed 13 Nov (native feel): the background owner now reads the catalogue once at startup, so the
// page opens complete; it still never takes focus and restores the validated session once.
test('background owner reads the catalogue once quietly, takes no focus and restores the validated session once',
  async()=>{
  const burger={title:'Burgerboller',steps:['Ælt','Bag'],ingredients:['Mel'],
    source:{url:'https://example.invalid/burger'}};
  const record={version:1,url:burger.source.url,
    signature:JSON.stringify([burger.steps,[{title:'Råvarer',lines:burger.ingredients}]]),
    savedAt:Date.now(),steps:['0'],ingredients:[],expanded:true,scroll:20};
  let reads=0,removed=0;
  const focus=vi.spyOn(HTMLElement.prototype,'focus');
  localStorage.setItem('podview.recipe-session.v1',JSON.stringify(record));
  const remove=vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{removed++;});
  globalThis.fetch=async()=>{reads++;return {ok:true,json:async()=>({recipes:[structuredClone(burger)]})};};
  // Keep actual constructor/page/refresh/restore code. The mounted catalogue
  // DOM and polling are separate: capture the exact refresh flag given to it.
  const catalog=vi.spyOn(RecipeView.prototype,'catalog').mockImplementation(function(refresh=true){
    this.initialRefresh=refresh;this.begin(()=>{},true);
    this.present(()=>createElement(PageHeader,{title:'Opskrifter',subtitle:''}));
  });
  try{
    const foreground=new RecipeView(mount(),()=>{},()=>{});
    assert.equal(foreground.initialRefresh,true,'normal constructor retains immediate catalogue refresh');
    assert.equal(focus.mock.calls.length,1,'normal constructor retains initial heading focus');
    const background=new RecipeView(mount(),()=>{},()=>{},{background:true});
    assert.equal(background.initialRefresh,false,'background constructor does not start the polling refresh');
    assert.equal(focus.mock.calls.length,1,'hidden heading never receives focus');
    assert.equal(background.active,undefined,'pending session is not trusted before catalogue validation');
    await background.refreshPublishedCatalog();
    assert.equal(reads,1,'the quiet startup read and WidgetHost hydration share one catalogue read');
    await background.backgroundCatalogRead;
    assert.equal(reads,1);
    assert.equal(background.active,background.saved[0]);
    assert.equal(background.sessions.get(background.active).steps.has('0'),true);
    assert.equal(background.pendingSession,null);assert.equal(removed,0);
  }finally{catalog.mockRestore();remove.mockRestore();}
});

// O1: one malformed catalogue row is skipped; the rest of the catalogue shows.
test('a recipe without a source is skipped and the rest of the catalogue is shown',async()=>{
  const good={title:'Karry',steps:['Kog'],ingredients:['Ris'],source:{url:'https://example.invalid/karry'}};
  globalThis.fetch=async()=>({ok:true,json:async()=>({recipes:[{title:'Uden kilde',steps:[]},null,
    {title:'Tom',source:{}},structuredClone(good)]})});
  const view=Object.assign(Object.create(RecipeView.prototype),{saved:[],deleted:new Set(),sessions:new Map(),
    catalogStatus:'loading',restoreSession(){}});
  await view.refreshPublishedCatalog();
  assert.equal(view.catalogStatus,'ready','the catalogue stays available');
  assert.deepEqual(view.saved.map(r=>r.title),['Karry'],'only the well-formed recipe is shown');
});

test('the catalogue tells how to add a recipe: Share → Home Assistant',()=>{
  const {root}=catalogue({saved:[],active:null,sessions:new Map(),catalogCategory:'',history:[],catalogStatus:'ready'});
  assert.match(root.querySelector('[data-recipe-layout=catalog]>div:first-child').textContent,
    /Tilføj opskrift: Del → Home Assistant fra Safari eller Chrome på iPhone\./);
});

// Added with the move to React: the old renderer rebuilt the catalogue on every refresh; now a quiet refresh and any
// other render with nothing changed must write nothing at all (no blink), on the catalogue (with a cooking band,
// categories, history, uploads and the shortcut), on a recipe being cooked and in Udforsk.
function recordMutations(root){
 const observer=new MutationObserver(()=>{});
 observer.observe(root,{subtree:true,childList:true,attributes:true,characterData:true});
 return ()=>{const records=observer.takeRecords();observer.disconnect();
  return records.map(record=>[record.type,record.attributeName,record.target.nodeName]);};
}
test('an identical recipe render writes nothing to the DOM',async()=>{
 const burger={title:'Burgerboller',categories:['Brød'],steps:['Ælt','Bag'],ingredients:['Mel','Vand'],
  image:'https://img.example/b.jpg',publisher:'Meyers',source:{url:'https://example.invalid/burger',files:[]}};
 const curry={title:'Karry',categories:['Aftensmad'],steps:['Kog'],groups:[{title:'Sauce',lines:['Fløde']},
  {title:'Ris',lines:['Ris']}],source:{url:'https://example.invalid/curry',files:[]}};
 const answers={recipes:{recipes:[burger,curry]},'recipe-upload-history':{uploads:[{id:'a',status:'saved',
  message:'Gemt',title:'Boller',updatedAt:'2026-11-18T10:00:00Z'}]},'recipe-shortcut':{download:'a.shortcut',
  uploadCode:'u'.repeat(40),outdated:{seenAt:1}}};
 globalThis.fetch=async url=>{const answer=answers[new URL(String(url)).pathname.split('/').pop()];
  return {ok:true,json:async()=>structuredClone(answer)};};
 localStorage.setItem('podview.recipe-history',JSON.stringify([{title:'Karry',completedAt:Date.now()-1000}]));
 const root=mount(),view=new RecipeView(root,()=>{},()=>{});
 await settle();
 root.querySelector('[data-recipe="Burgerboller"]').click();
 root.querySelector('[data-recipe-layout=controls] button').click();
 root.querySelector('[data-recipe-layout=reading] ol>li button').click();
 let done=recordMutations(root);view.redraw();view.redraw();
 assert.deepEqual(done(),[],'a recipe being cooked');
 view.catalog();await settle();
 for(const id of ['recipe-history','recipe-upload-history','recipe-shortcut'])
  root.querySelector(`#${id}-trigger`).click();
 assert.ok(root.querySelector('[data-recipe-layout=band] [data-recipe]'),'the cooking band is shown');
 done=recordMutations(root);
 view.suppressPageFocus=true;view.catalog(false);view.suppressPageFocus=false;view.redraw();
 await view.catalogRefresh.now();await settle();
 assert.deepEqual(done(),[],'the catalogue, redrawn and refreshed with nothing new');
 root.querySelector('[data-recipe-view=explore] input').click();await settle();
 done=recordMutations(root);view.redraw();
 assert.deepEqual(done(),[],'Udforsk');
 view.dispose();
});
