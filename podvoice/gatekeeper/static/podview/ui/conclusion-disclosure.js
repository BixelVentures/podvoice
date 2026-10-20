// Existing answer conclusion disclosure; all source text stays in its paragraph.
export function conclusionDisclosure(paragraph){
 const button=paragraph.ownerDocument.createElement('button');button.type='button';button.className='text-control conclusion-toggle';button.textContent='Vis mere';button.hidden=true;
 paragraph.classList.add('pv-conclusion');paragraph.after(button);let expanded=false,lastText=null,observer;
 const measure=()=>{if(paragraph.hidden){button.hidden=true;return;}if(expanded)return;const overflow=paragraph.scrollHeight>paragraph.clientHeight+1;if(button.hidden===overflow)button.hidden=!overflow;};
 button.addEventListener('click',()=>{expanded=!expanded;paragraph.classList.toggle('is-expanded',expanded);button.setAttribute('aria-expanded',String(expanded));button.textContent=expanded?'Vis mindre':'Vis mere';if(!expanded)measure();});button.setAttribute('aria-expanded','false');
 return {update(){if(lastText!==paragraph.textContent){lastText=paragraph.textContent;expanded=false;paragraph.classList.remove('is-expanded');button.textContent='Vis mere';button.setAttribute('aria-expanded','false');}if(typeof ResizeObserver==='function'&&!observer){observer=new ResizeObserver(measure);observer.observe(paragraph);}measure();},disconnect(){observer?.disconnect();observer=null;},button};
}
