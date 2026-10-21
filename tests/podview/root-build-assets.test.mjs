import test from 'node:test';
import assert from 'node:assert/strict';
import {composeStyles} from '../../scripts/build-assets.mjs';

test('generated stylesheet inlines exact small local SVG bytes after rebasing nested ownership',()=>{
 const icon=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h3"/></svg>'),reads=[];
 const source='.x{background:url("../../assets/icons/check.svg")}';
 const output=composeStyles(['ui/library/library.css'],()=>source,path=>{reads.push(path);return icon;});
 assert.deepEqual(reads,['assets/icons/check.svg']);
 const encoded=output.match(/data:image\/svg\+xml;base64,([^"\)]+)/)[1];
 assert.deepEqual(Buffer.from(encoded,'base64'),icon);
 assert.equal(output,composeStyles(['ui/library/library.css'],()=>source,()=>icon));
});
test('large SVG keeps its exact file request rather than inflating CSS',()=>{
 const source='.x{background:url(assets/icons/large.svg)}';
 const output=composeStyles(['widget-view.css'],()=>source,()=>Buffer.alloc(4097,32));
 assert.match(output,/url\(assets\/icons\/large.svg\)/);assert.doesNotMatch(output,/base64/);
});
test('external, query, fragment, non-icon and traversal URLs never become inline reads',()=>{
 const values=['https://example.test/a.svg','data:image/svg+xml;base64,AA==','#symbol','assets/icons/check.svg?v=1','assets/icons/check.svg#symbol','assets/photo.svg','../outside.svg'];
 const source=values.map(value=>`.x{background:url("${value}")}`).join('');
 const output=composeStyles(['widget-view.css'],()=>source,()=>assert.fail('unadmitted icon read'));
 for(const value of values)assert(output.includes(value),value);
});
