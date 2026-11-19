// Preserve element identity so focus, CSS transitions and browser state survive updates.
const key = node => node.nodeType===1 ? node.getAttribute('data-key') || node.id || (node.hasAttribute('data-action') ? `action:${node.getAttribute('data-action')}:${node.getAttribute('data-value')||''}` : null) : null;
const sameType=(a,b)=>a.nodeType===b.nodeType&&a.nodeName===b.nodeName;
function updateNode(current,desired){
 if(current.nodeType!==1){if(current.nodeValue!==desired.nodeValue)current.nodeValue=desired.nodeValue;return;}
 for(const attribute of [...current.attributes])if(!desired.hasAttribute(attribute.name))current.removeAttribute(attribute.name);
 for(const attribute of [...desired.attributes])if(current.getAttribute(attribute.name)!==attribute.value)current.setAttribute(attribute.name,attribute.value);
 if(current.nodeName==='INPUT'&&current.getAttribute('type')==='range'){const value=desired.getAttribute('value')??'';if(current.value!==value)current.value=value;}
 reconcile(current,desired);
}
export function reconcile(parent,desired){
 const previous=[...parent.childNodes];const used=new Set();
 for(const [index,wanted] of [...desired.childNodes].entries()){
  const wantedKey=key(wanted);
  let current=wantedKey?previous.find(n=>!used.has(n)&&key(n)===wantedKey&&sameType(n,wanted)):null;
  if(!wantedKey){const positional=previous[index];current=positional&&!used.has(positional)&&!key(positional)&&sameType(positional,wanted)?positional:previous.find(n=>!used.has(n)&&!key(n)&&sameType(n,wanted));}
  if(current){used.add(current);updateNode(current,wanted);}else current=wanted.cloneNode(true);
  const at=parent.childNodes[index];if(at!==current)parent.insertBefore(current,at||null);
 }
 for(const old of previous)if(!used.has(old)&&old.parentNode===parent)parent.removeChild(old);
}
