import {productLibrary} from './library-catalog.js';

// Component navigation only. Specimens load the canonical product entrypoint.
// This module owns no widget markup, state renderer or integration authority.
const $=id=>document.getElementById(id);
let selected=productLibrary[0],state=selected.states[0],compare=false,isolated=false;
let flowSteps=[],flowIndex=-1,pendingFlow=false,flowKind='visual';
let reducedMotion=false;
function applyMotion(frame){const host=frame.contentDocument?.querySelector('pv-widget-host');if(host&&((host.dataset.motion==='reduced')!==reducedMotion))frame.contentDocument.getElementById('quiet-view')?.click();}
const framing=new WeakMap();
function fit(viewport){const frame=viewport.querySelector('iframe');if(!frame)return;const box=framing.get(frame)||{x:0,y:0,width:1280,height:800};const scale=viewport.clientWidth/box.width;frame.style.transform=`scale(${scale}) translate(${-box.x}px,${-box.y}px)`;viewport.style.aspectRatio=`${box.width}/${box.height}`;}
const resize=new ResizeObserver(entries=>{for(const {target} of entries)fit(target);});
const urlFor=sample=>`/?stage=${encodeURIComponent(sample.stage)}`;
const readHash=()=>{const values=new URLSearchParams(location.hash.slice(1));const family=productLibrary.find(item=>item.id===values.get('component'));if(family){selected=family;state=family.states.find(item=>item.id===values.get('state'))||family.states[0];}compare=values.get('view')==='all';isolated=values.get('part')==='1'||selected.id==='voice';};
// Only canonical component, state and viewing mode survive old survey URLs.
const writeHash=()=>{const values=new URLSearchParams({component:selected.id,state:state.id,...(compare?{view:'all'}:{}),...(isolated?{part:'1'}:{})});history.replaceState(null,'',`#${values}`);};
function frameSetup(frame,sample){
 const selector=Object.hasOwn(sample,'selector')?sample.selector:selected.selector,showComponent=isolated&&!!selector;
 frame.title=`${selected.name} · ${sample.label}`;
 framing.delete(frame);frame.parentElement.style.maxWidth='';fit(frame.parentElement);
 frame.onload=()=>{
  const doc=frame.contentDocument;if(!doc)return;
  frame.contentWindow.customElements.whenDefined('pv-widget-host').then(()=>{
   if(!frame.isConnected||frame.contentDocument!==doc)return;
   applyMotion(frame);
   if(frame.id==='product-preview'&&pendingFlow){pendingFlow=false;advanceFlow();}
   if(sample.open){const button=doc.querySelector(sample.open);if(button&&!button.disabled)button.click();}
   if(showComponent){
    const crop=()=>{
     if(!frame.isConnected||frame.contentDocument!==doc)return;
     const dialog=doc.querySelector('dialog[open]');
     const nodes=dialog?[dialog]:[...doc.querySelectorAll(selector)].filter(item=>item.getBoundingClientRect().width>0);
     if(!nodes.length){framing.delete(frame);frame.parentElement.style.maxWidth='';fit(frame.parentElement);return;}
     const boxes=nodes.map(item=>item.getBoundingClientRect()),left=Math.min(...boxes.map(box=>box.x)),top=Math.min(...boxes.map(box=>box.y)),rect={x:left,y:top,width:Math.max(...boxes.map(box=>box.right))-left,height:Math.max(...boxes.map(box=>box.bottom))-top},x=Math.max(0,rect.x-8),y=Math.max(0,rect.y-8),width=Math.min(1280-x,rect.width+16),height=Math.min(800-y,rect.height+16);
     if(width>0&&height>0){framing.set(frame,{x,y,width,height});frame.parentElement.style.maxWidth=`${width}px`;fit(frame.parentElement);}
    };
    frame.contentWindow.requestAnimationFrame(crop);
    doc.addEventListener('click',()=>frame.contentWindow.requestAnimationFrame(crop));
   }
  });
 };
 frame.src=urlFor(sample);
}
function navigation(){
 const query=$('component-search').value.trim().toLocaleLowerCase('da');
 const matches=productLibrary.filter(item=>`${item.name} ${item.category} ${item.description}`.toLocaleLowerCase('da').includes(query));
 $('component-menu').replaceChildren();let category='';
 for(const item of matches){
  if(item.category!==category){category=item.category;const title=document.createElement('p');title.className='menu-category';title.textContent=category;$('component-menu').append(title);}
  const link=document.createElement('a');link.className='component-link';link.href=`#component=${encodeURIComponent(item.id)}`;link.setAttribute('aria-current',item.id===selected.id?'page':'false');
  const label=document.createElement('strong');label.style.fontWeight='inherit';label.textContent=item.name;const count=document.createElement('span');count.textContent=String(item.states.length);link.append(label,count);
  link.addEventListener('click',event=>{event.preventDefault();selected=item;state=item.states[0];render();});$('component-menu').append(link);
 }
 $('search-empty').hidden=matches.length>0;
 $('catalog-count').textContent=`${productLibrary.length} komponentgrupper · ${productLibrary.reduce((sum,item)=>sum+item.states.length,0)} tilstande`;
}
function render(){
 if(!pendingFlow){flowSteps=[];flowIndex=-1;$('flow-next').disabled=true;$('flow-next').textContent='Næste trin';$('flow-progress').textContent='Vælg en situation og følg den trin for trin.';}
 navigation();writeHash();$('conversation-flow').hidden=!['conversation','voice'].includes(selected.id);$('component-title').textContent=selected.name;$('component-description').textContent=selected.description;
 $('component-usage').textContent=selected.usage;$('component-interaction').textContent=selected.interaction;
 $('component-limitations').replaceChildren(...selected.limitations.map(value=>{const li=document.createElement('li');li.textContent=value;return li;}));
 $('state').replaceChildren(...selected.states.map(item=>{const option=document.createElement('option');option.value=item.id;option.textContent=item.label;return option;}));$('state').value=state.id;
 $('state-description').textContent=compare?'Se variationerne samlet. Vælg en tilstand for at åbne den og afprøve dens kontroller.':state.description;
 $('preview-label').textContent=`${selected.name} · ${state.label}`;
 $('isolate-component').disabled=!(Object.hasOwn(state,'selector')?state.selector:selected.selector);$('isolate-component').setAttribute('aria-pressed',String(isolated));$('isolate-component').textContent=isolated?'Hele skærmen':'Komponenten alene';
 $('state-open').href=`/?qa=1280x800&stage=${encodeURIComponent(state.stage)}`;
 $('state-open').title=state.open?'Åbn skærmen og tryk på komponentens detaljeknap.':'Åbn den samme tilstand i fuld størrelse.';
 $('single-view').setAttribute('aria-pressed',String(!compare));$('compare-view').setAttribute('aria-pressed',String(compare));
 $('single-preview').hidden=compare;$('comparison').hidden=!compare;
 for(const viewport of $('comparison').querySelectorAll('.screen-viewport'))resize.unobserve(viewport);
 $('comparison').replaceChildren();
 if(compare){
  $('product-preview').src='about:blank';
  for(const sample of selected.states){
   const article=document.createElement('article'),title=document.createElement('h2'),button=document.createElement('button'),viewport=document.createElement('div'),frame=document.createElement('iframe'),description=document.createElement('p');
   button.type='button';button.textContent=sample.label;const activate=()=>{state=sample;compare=false;render();$('state').focus();};button.addEventListener('click',activate);title.append(button);
   viewport.className='screen-viewport';viewport.addEventListener('click',activate);frame.loading='lazy';frame.tabIndex=-1;frame.setAttribute('aria-hidden','true');viewport.append(frame);description.textContent=sample.description;
   article.append(title,viewport,description);$('comparison').append(article);frameSetup(frame,sample);resize.observe(viewport);
  }
 }else frameSetup($('product-preview'),state);
}
const flows={
 'return-followup':['conversation-visual','conversation-complete','conversation-interrupted','conversation-working','conversation-followup','conversation-complete'],
 'auto-return':['conversation-visual','conversation-complete'],
 spoken:['conversation-listening','conversation-working','conversation-speaking','conversation-complete'],
 visual:['conversation-listening','conversation-working','conversation-visual','conversation-complete'],
 late:['conversation-listening','conversation-working','conversation-speaking','conversation-late','conversation-visual','conversation-complete'],
 followup:['conversation-visual','conversation-interrupted','conversation-working','conversation-followup','conversation-complete'],
 long:['conversation-visual','conversation-long','conversation-timer-finished','conversation-overview','conversation-resume','conversation-complete'],
 connection:['conversation-visual','conversation-visual-error','conversation-offline','conversation-reconnecting','conversation-reconnected','conversation-complete'],
 dialog:['conversation-visual','conversation-followup','conversation-complete'],
 output:['conversation-visual','conversation-followup','conversation-complete']
};
function advanceFlow(){
 const host=$('product-preview').contentDocument?.querySelector('pv-widget-host');
 if(!host?.applyConversationPreview){$('flow-progress').textContent='Skærmen er ved at åbne. Prøv Næste trin om et øjeblik.';return;}
 const next=flowIndex+1,stage=flowSteps[next];if(!stage)return;
 if(!host.applyConversationPreview(stage)){$('flow-progress').textContent='Luk den åbne detalje for at fortsætte forløbet. Dit indhold bliver stående.';return;}
 flowIndex=next;state=selected.states.find(item=>item.stage===stage)||state;writeHash();$('state').value=state.id;$('state-description').textContent=state.description;$('preview-label').textContent=`${selected.name} · ${state.label}`;$('state-open').href=`/?qa=1280x800&stage=${encodeURIComponent(stage)}`;
 $('flow-progress').textContent=`${next+1} af ${flowSteps.length} · ${state.label}`;
 if(['dialog','output'].includes(flowKind)&&next===0){host.ownerDocument.getElementById(flowKind==='output'?'output':'player-detail')?.click();$('flow-progress').textContent+=' · Prøv Næste trin med detaljen åben. Luk den, og prøv igen.';}
 if(flowKind==='long'&&stage==='conversation-long')$('flow-progress').textContent+=' · Scroll ned i svaret før næste trin.';
 if(flowKind==='long'&&stage==='conversation-overview')$('flow-progress').textContent+=' · Næste trin åbner samme svar ved din læseposition.';
 if(flowKind==='auto-return')$('flow-progress').textContent+=stage==='conversation-complete'?' · Vent 30 sekunder uden at røre produktet. Det går til overblik; svaret bevares. Prøv igen og scroll eller tryk for at afbryde.':' · Tryk Næste for at afslutte talen og starte de 30 sekunders ro.';
 if(flowKind==='return-followup')$('flow-progress').textContent+=stage==='conversation-complete'?(next===1?' · De 30 sekunder er startet. Vent lidt, og tryk Næste for at stille et nyt spørgsmål.':' · Det nye svar bliver stående.'):stage==='conversation-interrupted'?' · Ny tale afbryder automatisk retur. Det gamle svar bevares.':stage==='conversation-working'?' · Det gamle svar er stadig nyttigt, mens det nye bliver klart.':stage==='conversation-followup'?' · Nu overtager det nye svar.':'';
 const following=selected.states.find(item=>item.stage===flowSteps[next+1]);$('flow-next').disabled=!following;$('flow-next').textContent=following?`Næste: ${following.label}`:'Forløbet er gennemført';
}
$('flow-start').addEventListener('click',()=>{selected=productLibrary.find(item=>item.id==='conversation');state=selected.states[0];compare=false;isolated=false;flowKind=$('flow-choice').value;flowSteps=flows[flowKind]||flows.visual;flowIndex=-1;pendingFlow=true;$('flow-next').disabled=false;render();});
$('flow-next').addEventListener('click',advanceFlow);
$('preview-motion').addEventListener('click',()=>{reducedMotion=!reducedMotion;$('preview-motion').setAttribute('aria-pressed',String(reducedMotion));for(const frame of document.querySelectorAll('.screen-viewport iframe'))applyMotion(frame);});
$('component-search').addEventListener('input',navigation);
$('state').addEventListener('change',()=>{flowSteps=[];flowIndex=-1;$('flow-next').disabled=true;state=selected.states.find(item=>item.id===$('state').value)||selected.states[0];render();});
$('single-view').addEventListener('click',()=>{compare=false;render();});$('compare-view').addEventListener('click',()=>{compare=true;render();});
$('reset-example').addEventListener('click',render);
$('isolate-component').addEventListener('click',()=>{isolated=!isolated;render();});
$('focus-preview').addEventListener('click',()=>{const focused=document.body.classList.toggle('preview-focused');$('focus-preview').setAttribute('aria-pressed',String(focused));$('focus-preview').textContent=focused?'Vis komponentliste':'Mere plads';});
window.addEventListener('hashchange',()=>{readHash();render();});window.addEventListener('pagehide',()=>resize.disconnect(),{once:true});
resize.observe($('product-preview').parentElement);readHash();render();
