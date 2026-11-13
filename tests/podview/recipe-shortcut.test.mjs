import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const recipe = readFileSync(new URL('../../podvoice/gatekeeper/static/podview/recipe-view.js', import.meta.url), 'utf8');

function recipeView(fetch) {
 const RecipeView = vm.runInNewContext(recipe.replace(/^import .*\n/,'')
  .replace('export class RecipeView','class RecipeView')+'\nRecipeView',
 {Intl,Date,URL,JSON,document:{baseURI:'http://inert/view/'},fetch});
 return Object.assign(Object.create(RecipeView.prototype),{shortcut:null});
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

test('the catalogue renders the entry with both import answers and a download', () => {
 assert.match(recipe, /createKitDisclosure\(\{id:'recipe-shortcut',title:'Tilføj opskrift-genvej til iPhone'/);
 assert.match(recipe, /copyRow\('1\. PodView-adresse',address\)/);
 assert.match(recipe, /copyRow\('2\. Uploadkode',shortcut\.uploadCode,'Skjult'\)/);
 assert.match(recipe, /'Ny version af genvejen'/);
 assert.match(recipe, /link\.download = fileName/);
});

test('upload history names every phone outcome, including duplicates', () => {
 const begin = recipe.indexOf('  const renderUploads = () => {');
 const end = recipe.indexOf('  this.renderUploadHistory', begin);
 assert.ok(begin >= 0 && end > begin, 'canonical upload history render boundary');
 const node = (tag,text='') => ({tag,text,children:[],append(...n){this.children.push(...n);},
  replaceChildren(...n){this.children=n;}});
 const textOf = n => [n.text,...n.children.map(textOf)].filter(Boolean).join(' ');
 const panel = node('panel');
 const uploads = {panel,setDescription(){}};
 const render = new Function('uploads','kit','applyKitTextRole','element','meta','historyDate','action',
  recipe.slice(begin,end)+'; return renderUploads;')
  .call({uploads:[
   {id:'a',status:'duplicate',message:'Findes allerede',title:'Boller',updatedAt:1},
   {id:'b',status:'importing',message:'Henter opskriften fra siden',url:'https://example.com/x',updatedAt:1},
   {id:'c',status:'rejected',message:'Ingen opskrift fundet på siden',url:'https://example.com/y',updatedAt:1},
  ],uploadHistoryStatus:'ready'},uploads,()=>node('row'),e=>e,node,t=>node('meta',t),
  {format:()=>'i dag'},()=>node('button'));
 render();
 assert.deepEqual(panel.children.map(textOf),[
  'Boller i dag Findes allerede',
  'https://example.com/x i dag Henter · Henter opskriften fra siden',
  'https://example.com/y i dag Afvist · Ingen opskrift fundet på siden',
 ]);
});
