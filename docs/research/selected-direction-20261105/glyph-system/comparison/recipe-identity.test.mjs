import test from 'node:test';
import assert from 'node:assert/strict';
import {installRecipeIdentity} from './recipe-identity.js';
const recipe = (title='Linsegryde',url='https://example.test/linser') => ({title,source:{url},steps:['Kog','Server']});
function fixture(){
 const original=recipe();
 const view={saved:[original],sessions:new Map(),active:null,next:[recipe()],
  // Same identity/changed contract as pinned refreshPublishedCatalog.
  async refreshPublishedCatalog(){const before=JSON.stringify(this.saved),previous=new Map(this.saved.map(r=>[r.source.url,r]));this.saved=this.next.map(r=>previous.has(r.source.url)&&this.sessions.has(previous.get(r.source.url))?previous.get(r.source.url):r);if(this.restore){this.active=this.saved[0];this.sessions.set(this.active,this.restore);}return before!==JSON.stringify(this.saved);}};
 const host={live:false,recipeView:view};installRecipeIdentity(host);return {view,host,original};
}
test('completed session and unchanged refresh preserve retained row start identity',async()=>{
 const {view,original,host}=fixture();view.sessions.set(original,{steps:new Set(['0','1'])});view.sessions.delete(original);
 const wrapper=view.refreshPublishedCatalog;installRecipeIdentity(host);assert.equal(view.refreshPublishedCatalog,wrapper);
 assert.equal(await view.refreshPublishedCatalog(),false);
 // Existing DOM handler still closes over the recipe originally rendered.
 view.sessions.set(original,{steps:new Set()});view.active=original;
 assert(view.saved.includes(view.active));assert(view.sessions.has(view.active));
});
test('changed content, source and deletion remain authoritative',async()=>{
 for(const next of [[recipe('Ny titel')],[recipe('Linsegryde','https://example.test/ny')],[]]){
  const {view,original}=fixture();view.next=next;assert.equal(await view.refreshPublishedCatalog(),true);assert(!view.saved.includes(original));assert.deepEqual(view.saved,next);
 }
});
test('restored active reference and exact session move together to retained recipe',async()=>{
 const {view,original}=fixture();const session={steps:new Set(['0']),ingredients:new Set(['salt'])};view.restore=session;const fetched=view.next[0];
 await view.refreshPublishedCatalog();assert.equal(view.active,original);assert.equal(view.saved[0],original);assert.equal(view.sessions.get(original),session);assert(!view.sessions.has(fetched));
});
