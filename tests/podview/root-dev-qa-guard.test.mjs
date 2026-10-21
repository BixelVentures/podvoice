import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('local QA wrapper never replaces a live or ingress route with demo content',()=>{
 const source=readFileSync(new URL('../../scripts/dev.mjs',import.meta.url),'utf8');
 const expression=source.match(/ if\((.+)\)\{\n  const \[w,h\]/)?.[1];assert.ok(expression,'explicit QA route guard');
 const allowed=new Function('url','qa',`return (${expression});`);
 for(const pathname of ['/','/index.html'])assert.equal(allowed({pathname},'1280x800'),true);
 for(const pathname of ['/view','/view/','/api/hassio_ingress/token/view/','/setup.html','/library.html'])assert.equal(allowed({pathname},'1280x800'),false,pathname);
 assert.equal(allowed({pathname:'/'},'arbitrary'),false);
});
