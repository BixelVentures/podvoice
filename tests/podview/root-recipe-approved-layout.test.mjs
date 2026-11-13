import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const root = new URL('../../podvoice/gatekeeper/static/podview/', import.meta.url);
const css = readFileSync(new URL('ui-kit.css', root), 'utf8');
const recipe = readFileSync(new URL('recipe-view.js', root), 'utf8');

test('recipe reading and cooking share the approved numbered-list geometry', () => {
  assert.ok(recipe.includes("number.dataset.recipeStepNumber"), "step numbers use canonical slot");
  assert.ok(/#recipe-view \[data-recipe-layout=reading\] ol\{[^}]*list-style:none/.test(css), "approved recipe CSS contract");
  assert.ok(/#recipe-view \[data-recipe-layout=reading\] li\{[^}]*grid-template-columns:var\(--pv-icon-s\) minmax\(0,1fr\)/.test(css), "approved recipe CSS contract");
  assert.ok(/#recipe-view \[data-recipe-layout=reading\] li>\[data-recipe-step-number\]\{[^}]*grid-column:1;grid-row:1/.test(css), "approved recipe CSS contract");
  assert.ok(/#recipe-view \[data-recipe-layout=reading\] li>:is\(h3,p,button\)\{grid-column:2\}/.test(css), "approved recipe CSS contract");
  // The approved recipe is already full-width. Shared detail inset previously
  // narrowed it a second time and changed instruction wrapping.
  assert.doesNotMatch(css, /\.responses>:is\([^}]*#recipe-view[^}]*\)\[?[^}]*padding-inline:var\(--pv-s2\)/);
});

test('recipe catalog resume, ingredient disclosure, and overview use canonical kit styling', () => {
  assert.ok(/\.pv-kit-listrow\[data-kit-variant=resume\]\[aria-current=true\]\{background:var\(--pv-dark\);color:var\(--pv-on-dark\)\}/.test(css), "approved recipe CSS contract");
  assert.ok(/\.pv-kit-disclosure\[data-kit-layout=card-header\][^{]*\{[^}]*border-radius/.test(css), "approved recipe CSS contract");
  assert.ok(css.includes("#recipe-view .pv-kit.pv-kit-button[data-kit-variant=quiet]{font:var(--pv-t-label)}"), "recipe quiet actions retain approved label typography");
  assert.ok(css.includes("#recipe-view [data-recipe-layout=ingredients]>div:not([hidden]){display:grid"), "ingredient disclosure uses canonical grid");
  assert.ok(/:is\(#home-recipes,#home-radio\)\[data-overview-size=s\]/.test(css), "approved recipe CSS contract");
});

// Run the actual catalogue projection with inert DOM nodes. The regression is
// filtering a different category while a cooking task must remain pinned.
function renderCatalogue(view) {
  const entries = node('div'), groups = new Map(), alphabet = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅ#'];
  const begin = recipe.indexOf('  const render = () => {');
  const end = recipe.indexOf('  index.append(marker);', begin);
  assert.ok(begin >= 0 && end > begin, 'canonical catalogue render boundary');
  const factory = new Function('entries','groups','alphabet','buttons','collator','categoriesOf',
    'element','kit','applyKitTextRole','meta','uploads','renderUploads',
    'shortcutUpdate','shortcutBox','renderShortcut',
    recipe.slice(begin,end)+'; return render;');
  const render = factory.call(view,entries,groups,alphabet,alphabet.map(()=>node('button')),
    new Intl.Collator('da'),r=>r.categories || ['Øvrige'],node,
    (type,text,options={})=>Object.assign(node(type,text),{variant:options.variant}),
    e=>e,text=>node('p',text),{node:node('uploads')},()=>{},
    node('shortcut-update'),{node:node('shortcut')},()=>{});
  return {entries,render};
}
function node(tag,text='') {
  return {tag,text,dataset:{},attributes:{},children:[],events:{},
    append(...nodes){this.children.push(...nodes);},
    replaceChildren(...nodes){this.children=nodes;},
    setAttribute(key,value){this.attributes[key]=value;},
    addEventListener(type,handler){this.events[type]=handler;}};
}
const textOf=n=>n.text+n.children.map(textOf).join(' ');
const recipeRows=n=>n.children.flatMap(c=>c.dataset.recipe?[c]:recipeRows(c));
test('active recipe stays once above the alphabetical catalogue across category changes',()=>{
  const burger={title:'Burgerboller',categories:['Brød'],steps:['Ælt','Bag'],source:{url:'https://example.invalid/burger'}};
  const curry={title:'Karry',categories:['Aftensmad'],steps:['Kog'],source:{url:'https://example.invalid/curry'}};
  const view={saved:[burger,curry],active:burger,sessions:new Map([[burger,{steps:new Set(['0'])}]]),
    catalogCategory:'Aftensmad',history:[],catalogStatus:'ready',recipe(r){this.opened=r;}};
  const {entries,render}=renderCatalogue(view);render();
  let rows=recipeRows(entries);
  assert.deepEqual(rows.map(r=>r.dataset.recipe),['Burgerboller','Karry']);
  assert.equal(rows[0].variant,'resume');assert.equal(rows[0].attributes['aria-current'],'true');
  assert.match(textOf(rows[0]),/I gang.*1 af 2 trin · Fortsæt/);
  rows[0].events.click();assert.equal(view.opened,burger,'resume opens the same session object');
  view.catalogCategory='';render();rows=recipeRows(entries);
  assert.deepEqual(rows.map(r=>r.dataset.recipe),['Burgerboller','Karry'],'active recipe is not duplicated in B');
  view.active=null;render();rows=recipeRows(entries);
  assert.ok(rows.every(r=>r.variant!=='resume'),'completion removes the pinned row');
  view.active=burger;view.sessions.clear();view.catalogCategory='Aftensmad';render();
  assert.deepEqual(recipeRows(entries).map(r=>r.dataset.recipe),['Karry'],'no fabricated session for a stale active object');
});


test('background owner avoids initial focus/eager refresh and restores the validated session once',async()=>{
  const burger={title:'Burgerboller',steps:['Ælt','Bag'],ingredients:['Mel'],source:{url:'https://example.invalid/burger'}};
  const record={version:1,url:burger.source.url,signature:JSON.stringify([burger.steps,[{title:'Råvarer',lines:burger.ingredients}]]),
    savedAt:Date.now(),steps:['0'],ingredients:[],expanded:true,scroll:20};
  let focus=0,reads=0,removed=0;
  const create=(tag,text='')=>Object.assign(node(tag,text),{focus(){focus++;}});
  const RecipeView=vm.runInNewContext(recipe.replace(/^import .*\n/,'').replace('export class RecipeView','class RecipeView')+'\nRecipeView',{
    Intl,Date,URL,document:{baseURI:'http://inert/',createElement:create},
    localStorage:{getItem:key=>key==='podview.recipe-session.v1'?JSON.stringify(record):null,removeItem(){removed++;}},
    createKitComponent:(type,options)=>create(type,options.text),applyKitTextRole:n=>n,
    fetch:async()=>{reads++;return {ok:true,json:async()=>({recipes:[structuredClone(burger)]})};},
  });
  // Keep actual constructor/page/refresh/restore code. The mounted catalogue
  // DOM and polling are separate: capture the exact refresh flag given to it.
  RecipeView.prototype.catalog=function(refresh=true){this.initialRefresh=refresh;this.page('Opskrifter','',()=>{});};
  const mount=()=>Object.assign(create('section'),{parentElement:create('main')});
  const foreground=new RecipeView(mount(),()=>{},()=>{});
  assert.equal(foreground.initialRefresh,true,'normal constructor retains immediate catalogue refresh');
  assert.equal(focus,1,'normal constructor retains initial heading focus');
  const background=new RecipeView(mount(),()=>{},()=>{},{background:true});
  assert.equal(background.initialRefresh,false,'background constructor does not start eager reads');
  assert.equal(focus,1,'hidden heading never receives focus');assert.equal(reads,0);
  assert.equal(background.active,undefined,'pending session is not trusted before catalogue validation');
  await background.refreshPublishedCatalog();
  assert.equal(reads,1,'WidgetHost can hydrate through one existing catalogue read');
  assert.equal(background.active,background.saved[0]);
  assert.equal(background.sessions.get(background.active).steps.has('0'),true);
  assert.equal(background.pendingSession,null);assert.equal(removed,0);
});

// O1: one malformed catalogue row is skipped; the rest of the catalogue shows.
test('a recipe without a source is skipped and the rest of the catalogue is shown',async()=>{
  const good={title:'Karry',steps:['Kog'],ingredients:['Ris'],source:{url:'https://example.invalid/karry'}};
  const RecipeView=vm.runInNewContext(recipe.replace(/^import .*\n/,'').replace('export class RecipeView','class RecipeView')+'\nRecipeView',{
    Intl,Date,URL,document:{baseURI:'http://inert/'},
    fetch:async()=>({ok:true,json:async()=>({recipes:[{title:'Uden kilde',steps:[]},null,{title:'Tom',source:{}},structuredClone(good)]})}),
  });
  const view=Object.assign(Object.create(RecipeView.prototype),{saved:[],deleted:new Set(),sessions:new Map(),catalogStatus:'loading',restoreSession(){}});
  await view.refreshPublishedCatalog();
  assert.equal(view.catalogStatus,'ready','the catalogue stays available');
  assert.deepEqual(view.saved.map(r=>r.title),['Karry'],'only the well-formed recipe is shown');
});

test('the catalogue tells how to add a recipe: Share → Home Assistant',()=>{
  const view={saved:[],active:null,sessions:new Map(),catalogCategory:'',history:[],catalogStatus:'ready'};
  const {entries,render}=renderCatalogue(view);render();
  assert.match(textOf(entries),/Tilføj opskrift: Del → Home Assistant fra Safari eller Chrome på iPhone\./);
});
