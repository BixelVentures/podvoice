// Ported from tests/podview/recipe-categories.test.mjs (node:test) to Vitest when the recipe screen moved to React.
// Same assertions; rankCategories and RECIPE_FILTERS come from model.ts.
//
// Opskrifter: the filter row holds »Alle« and the six categories with the most recipes (ties alphabetically); the
// rest are under »Flere«. Derived from the catalogue itself; a recipe without categories counts as »Øvrige«.
import {test} from 'vitest';
import assert from 'node:assert/strict';
import {RECIPE_FILTERS,rankCategories} from './model';

const recipe=(...categories)=>({title:categories.join('+'),categories});

test('categories rank by recipe count, ties alphabetically in Danish order',()=>{
 const ranked=rankCategories([recipe('Brød','Morgenmad'),recipe('Brød'),recipe('Aftensmad'),recipe('Øl'),
  recipe('Ærter'),recipe(),{title:'Uden'}]);
 assert.deepEqual(ranked,[{name:'Brød',count:2},{name:'Øvrige',count:2},{name:'Aftensmad',count:1},
  {name:'Morgenmad',count:1},{name:'Ærter',count:1},{name:'Øl',count:1}]);
});

test('a recipe counts once per category even if it repeats it',()=>{
 assert.deepEqual(rankCategories([recipe('Kager','Kager')]),[{name:'Kager',count:1}]);
});

test('the row holds at most six categories besides Alle',()=>{
 assert.equal(RECIPE_FILTERS,6);
 const many=['A','B','C','D','E','F','G','H'].map((name,n)=>Array.from({length:8-n},()=>recipe(name))).flat();
 assert.deepEqual(rankCategories(many).slice(0,RECIPE_FILTERS).map(c=>c.name),['A','B','C','D','E','F']);
});
