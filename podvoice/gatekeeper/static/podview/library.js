import {attachPressedState} from './ui/pressed-state.js';
import {KIT_COMPONENTS,createKitComponent,applyKitComponent,createKitTemplate,createKitDialog} from './ui/kit.js';
import {productLibrary} from './library-catalog.js';

// Documentation staging only: primitive specimens import the same native DOM
// factory as the product. Only composed screens load the product entrypoint.
// Domain state, integrations and effect authority remain in their existing owners.
const $=id=>document.getElementById(id);
attachPressedState(document);
// Documentation controls decorate their retained native nodes. They use the same
// Button/Chip primitives as specimens, while the existing shell keeps its density.
for(const button of document.querySelectorAll('[data-library-level],#single-view,#compare-view,#isolate-component,#preview-motion,#touch-areas,#sizes-view'))applyKitComponent(button,'chip');
for(const id of ['focus-preview','flow-start','flow-next','reset-example'])applyKitComponent($(id),'button',{variant:'secondary'});
// Documentation-only control forwards the existing local fault events. It never
// mutates a host state or grants playback/integration authority.
const radioConnectionPreview=document.createElement('button');
radioConnectionPreview.id='radio-connection-preview';radioConnectionPreview.type='button';radioConnectionPreview.hidden=true;
applyKitComponent(radioConnectionPreview,'button',{variant:'secondary'});
radioConnectionPreview.textContent='Afbryd forbindelsen · lokalt';
$('reset-example').after(radioConnectionPreview);
function radioPreviewConnection(frame,activate=false){
 const doc=frame?.contentDocument,host=doc?.querySelector('pv-widget-host');
 if(!doc||doc.location?.origin!==location.origin||doc.location?.pathname!=='/'||host?.live!==false||host.dataset.mode!=='demo')return null;
 if(typeof host.dispatch!=='function'||!host.state||typeof host.state.connected!=='boolean')return null;
 if(activate)host.dispatch(host.state.connected?{type:'offline'}:{type:'snapshot',generation:host.state.generation});
 return (host.state.connected?'Afbryd forbindelsen':'Genopret forbindelsen')+' · lokalt';
}
radioConnectionPreview.addEventListener('click',()=>{if(radioConnectionPreview.hidden)return;const label=radioPreviewConnection($('product-preview'),true);if(label)radioConnectionPreview.textContent=label;});
// Twelve public kit recipes group existing owners; catalog entries are specimens,
// never a second primitive inventory or a second renderer.
const families={card:['music','player','weather'],hero:['composition','timer'],tile:['composition'],chip:['music','robot','answer-choices'],button:['player','timer','robot'],slider:['player','lights'],toggle:['lights'],listrow:['radio','music','player','answer-checklist'],sectionheader:['music','weather','robot'],topbar:['composition','weather','robot'],dialog:['overlays','player','timer','voice'],icon:['player','composition','music']};
const kit=KIT_COMPONENTS.map((item,i)=>({...item,families:families[item.id],owner:'dist/ui/kit.js · delt native DOM-fabrik',number:i+1}));
const templates=[
 {id:'detail',name:'Detaljeskabelon',families:['weather','timer','robot','lights','player','vehicle'],owner:'Eksisterende domæneejere',anatomy:'Global Tilbage → én overskrift → status/instrument → primær og sekundære handlinger → valg/historik/kilder.'},
 {id:'response',name:'Svarskabelon',families:productLibrary.filter(item=>item.id.startsWith('answer-')).map(item=>item.id).concat('history'),owner:'AnswerWidget · VisualComponent · LibraryComponent',anatomy:'Faktisk transskription når den findes → titel → konklusion/indhold → uddybning → kilder og handlinger. Historik genbruger samme svar.'}
];
const screens=productLibrary.filter(item=>!item.id.startsWith('answer-')&&!['voice','overlays'].includes(item.id)).map(item=>({id:item.id,name:item.name,families:item.id==='conversation'?[item.id,...productLibrary.filter(family=>family.id.startsWith('answer-')).map(family=>family.id)]:[item.id],owner:`Komposition af de ${KIT_COMPONENTS.length} delte komponenter`,anatomy:screenRecipe(item.id)+' · '+item.usage}));
function screenRecipe(id){
 const recipes={composition:'TopBar + Card + Hero + Tile + Button + Icon',music:'TopBar + SectionHeader + Card + Chip + Button + Icon',player:'TopBar + Card + Button + Slider + ListRow + Dialog + Icon',weather:'TopBar + SectionHeader + Hero + ListRow + Icon',timer:'TopBar + Hero + Tile + Button + Dialog + Icon',robot:'TopBar + Hero + Tile + Chip + Button + ListRow + Icon',lights:'TopBar + Hero + Tile + Toggle + Slider + Icon',vehicle:'TopBar + Hero + Tile + ListRow + Icon',radio:'TopBar + SectionHeader + Tile + ListRow + Button + Icon',history:'TopBar + Card + ListRow + Icon',conversation:'TopBar + Card + Hero + Dialog + Icon'};
 return recipes[id]||'TopBar + SectionHeader + Card + Button + Icon';
}
// S/M/L specimens crop the actual overview owner in the product iframe.
// This table supplies selectors only; content and actions stay in those owners.
const widgetSizeTargets={weather:'#home-weather',music:'#home-music',robot:'#now-view>.resource-card[data-kind=vacuum],#now-view>.resource-preview[data-kind=vacuum]',lights:'#now-view>.resource-card[data-kind=light],#now-view>.resource-preview[data-kind=light]',vehicle:'#home-vehicle',radio:'#home-radio',timer:'#timer-card'};
const widgetSizes=[{id:'s',label:'Small',width:199,height:177},{id:'m',label:'Medium',width:414,height:177},{id:'l',label:'Large',width:414,height:370}];
const hasWidgetSizes=id=>Object.hasOwn(widgetSizeTargets,id);
let level='tokens',entry=kit[0],selected=productLibrary[0],state=selected.states[0],compare=false,isolated=false,sizeCompare=false;
const entries=()=>level==='templates'?templates:level==='screens'?screens:kit;
function selectEntry(item,preserve=false){entry=item;if(!preserve||!item.families.includes(selected.id)){selected=productLibrary.find(family=>family.id===item.families[0]);state=selected.states.find(sample=>sample.stage===(selected.id==='composition'?'conversation-overview':item.id==='hero'&&selected.id==='timer'?'timer-detail-running':''))||selected.states[0];}isolated=level==='components'&&!!(item.selector||selected.selector);sizeCompare=level==='screens'&&hasWidgetSizes(selected.id);}
let flowSteps=[],flowIndex=-1,pendingFlow=false,flowKind='visual';
let reducedMotion=false,touchAreas=false;
// Library-only inspection paints the real DOM control bounds. It never wraps
// controls, forwards clicks, changes authority or creates simulated feedback.
function applyTouchInspection(doc,enabled=touchAreas){
 if(!doc?.documentElement)return;
 if(enabled){if(doc.documentElement.dataset.libraryTouchAreas!=='true')doc.documentElement.dataset.libraryTouchAreas='true';}
 else if(doc.documentElement.dataset.libraryTouchAreas!==undefined)delete doc.documentElement.dataset.libraryTouchAreas;
}
function renderTouchInspection(){
 applyTouchInspection(document);$('touch-areas').setAttribute('aria-pressed',String(touchAreas));$('touch-area-legend').hidden=!touchAreas;
 for(const frame of document.querySelectorAll('.screen-viewport iframe'))applyTouchInspection(frame.contentDocument);
}
function applyMotion(frame){const host=frame?.contentDocument?.querySelector('pv-widget-host'),motion=reducedMotion?'reduced':'normal';if(!host||host.dataset.motion===motion)return;host.dataset.motion=motion;host.motion?.cancel();host.motion?.releaseGeometry(false);}
const framing=new WeakMap();
function fit(viewport){const frame=viewport.querySelector('iframe');if(!frame)return;const box=framing.get(frame)||{x:0,y:0,width:1280,height:800};const scale=viewport.clientWidth/box.width;viewport.style.overflow=framing.has(frame)?'clip':'';frame.style.position=framing.has(frame)?'absolute':'';frame.style.inset=framing.has(frame)?'0 auto auto 0':'';frame.style.transform=`scale(${scale}) translate(${-box.x}px,${-box.y}px)`;viewport.style.aspectRatio=`${box.width}/${box.height}`;}
const resize=new ResizeObserver(entries=>{for(const {target} of entries)fit(target);});
const urlFor=sample=>`/?stage=${encodeURIComponent(sample.stage)}`;
const readHash=()=>{const values=new URLSearchParams(location.hash.slice(1));const family=productLibrary.find(item=>item.id===values.get('component'));if(family){selected=family;state=family.states.find(item=>item.id===values.get('state'))||family.states[0];}compare=values.get('view')==='all';sizeCompare=values.get('view')==='sizes';isolated=values.get('part')==='1'||selected.id==='voice';};
const writeHash=()=>{const values=new URLSearchParams({component:selected.id,state:state.id,view:sizeCompare?'sizes':compare?'all':'single',...(isolated?{part:'1'}:{}),...(typeof level==='string'?{level,recipe:entry.id}: {})});history.replaceState(null,'',`#${values}`);};
function readHierarchy(){
 const values=new URLSearchParams(location.hash.slice(1)),family=productLibrary.find(item=>item.id===values.get('component'));
 level=['tokens','components','templates','screens'].includes(values.get('level'))?values.get('level'):family?'components':'tokens';
 const choices=entries();selectEntry(choices.find(item=>item.id===values.get('recipe'))||choices.find(item=>item.families.includes(selected.id))||choices[0],!!family);
 if(values.has('part'))isolated=values.get('part')==='1';
 if(values.has('view')){compare=values.get('view')==='all';sizeCompare=values.get('view')==='sizes';}
}
function tokenBoard(){
 const groups=[
 ['Neutrale flader og tekst',['--pv-bg','--pv-surface','--pv-surface-2','--pv-line','--pv-ink','--pv-ink-2','--pv-ink-3','--pv-on-dark']],
 ['Vejr · tint / strong / ink',['--pv-weather','--pv-weather-strong','--pv-weather-ink']],
 ['Robot · tint / strong / ink',['--pv-robot','--pv-robot-strong','--pv-robot-ink']],
 ['Lys · tint / strong / ink',['--pv-light','--pv-light-strong','--pv-light-ink']],
 ['Tesla · tint / strong / ink',['--pv-tesla','--pv-tesla-strong','--pv-tesla-ink']],
 ['Typografi',['--pv-type-meta','--pv-type-body','--pv-type-label','--pv-type-title','--pv-type-display','--pv-type-value']],
 ['Afstande',['--pv-s1','--pv-s2','--pv-s3','--pv-s4','--pv-s5']],
 ['Form og touch',['--pv-r-s','--pv-r-l','--pv-r-pill','--pv-hit-min','--pv-hit']],
 ['Dybde og bevægelse',['--pv-shadow','--pv-d-press','--pv-d-fast','--pv-d-move','--pv-ease']]];
 const computed=getComputedStyle(document.documentElement);$('foundation-tokens').replaceChildren();
 for(const [title,tokens] of groups){const section=document.createElement('section'),heading=document.createElement('h2'),grid=document.createElement('div');section.className='token-section';heading.textContent=title;grid.className='token-grid';
  for(const token of tokens){const card=document.createElement('div'),sample=document.createElement('div'),code=document.createElement('code'),value=document.createElement('small'),actual=computed.getPropertyValue(token).trim();card.className='token-specimen';sample.className='token-sample';code.textContent=token;value.textContent=actual||'Ikke defineret i den indlæste kilde';
   if(title==='Neutrale flader og tekst'||title.includes('tint /'))sample.style.background=actual;else if(title==='Typografi'){sample.textContent='Aa 012';sample.style.fontSize=actual;sample.style.height='auto';sample.style.minHeight='64px';}else{sample.textContent=actual||'—';if(token==='--pv-shadow'){sample.style.boxShadow=actual;sample.textContent='Fælles elevation';}if(title==='Form og touch'&&token.includes('radius'))sample.style.borderRadius=actual;}
   card.append(sample,code,value);grid.append(card);
  }section.append(heading,grid);$('foundation-tokens').append(section);
 }
}
function frameSetup(frame,sample){
 frame.title=`${selected.name} · ${sample.label}`;
 framing.delete(frame);frame.parentElement.style.maxWidth='';fit(frame.parentElement);
 frame.onload=()=>{
  const doc=frame.contentDocument;if(!doc)return;applyTouchInspection(doc);
  frame.contentWindow.customElements.whenDefined('pv-widget-host').then(()=>{
   if(!frame.isConnected||frame.contentDocument!==doc)return;
   applyMotion(frame);
   if(frame.id==='product-preview'){const label=radioPreviewConnection(frame);radioConnectionPreview.disabled=!label;if(label)radioConnectionPreview.textContent=label;}
   if(frame.id==='product-preview'&&pendingFlow){pendingFlow=false;advanceFlow();}
   if(sample.open){const button=doc.querySelector(sample.open);if(button&&!button.disabled)button.click();}
  });
 };
 frame.src=urlFor(sample);
}
const sizePreviewCleanup=new WeakMap();
function clearWidgetSizePreviews(){
 for(const frame of $('widget-size-previews').querySelectorAll('iframe')){sizePreviewCleanup.get(frame)?.();resize.unobserve(frame.parentElement);}
 $('widget-size-previews').replaceChildren();
}
function renderWidgetSizePreviews(){
 const target=$('widget-size-previews'),heading=document.createElement('h2'),description=document.createElement('p'),grid=document.createElement('div');
 heading.textContent=`${selected.name} · Small / Medium / Large`;description.textContent=selected.id==='timer'?'Timerindgang – aktiv timer bruger sin eksisterende brede flade med resterende tid og sluttid. Her sammenlignes den inaktive indgang i tre størrelser.':'Samme produktkomponent og tilstand i tre faktiske størrelser. Medium viser aktuelle nøgletal; Large viser flere kendte oplysninger. Manglende kildedata udfyldes ikke. Åbn kortet for at fortsætte i samme skærm.';grid.className='library-widget-size-grid';target.append(heading,description,grid);
 for(const size of widgetSizes){
  const example=document.createElement('article'),title=document.createElement('h3'),viewport=document.createElement('div'),frame=document.createElement('iframe'),measurement=document.createElement('p');
  example.className='library-widget-size-case';example.dataset.widgetSize=size.id;title.textContent=`${size.label} · ${size.width} × ${size.height}`;viewport.className='screen-viewport';frame.title=`${selected.name} · ${state.label} · ${size.label}`;frame.loading='lazy';measurement.className='library-widget-size-measure';measurement.textContent='Samme aktuelle produktdata';viewport.append(frame);example.append(title,viewport,measurement);grid.append(example);resize.observe(viewport);
  const family=selected.id,sample=family==='timer'?{...state,stage:'timer-overview-empty',label:'Timerindgang – aktiv timer bruger bred flade'}:state;
  frame.onload=()=>{
   const doc=frame.contentDocument;if(!doc)return;applyTouchInspection(doc);
   frame.contentWindow.customElements.whenDefined('pv-widget-host').then(()=>{
    if(!frame.isConnected||frame.contentDocument!==doc)return;const host=doc.querySelector('pv-widget-host');if(!host)return;
    // Initial library staging is a layout setup, never a user navigation cue.
    // Cancel the actual owner before dispatch so no FLIP transform enters the crop.
    host.dataset.motion='reduced';host.motion?.cancel();host.motion?.releaseGeometry(false);host.dispatch({type:'show',id:'now'});
    const widget=doc.querySelector(widgetSizeTargets[family]);if(!widget){applyMotion(frame);measurement.textContent='Denne tilstand tilbyder ikke et overblikskort.';return;}
    widget.dataset.kitSize=size.id;widget.dataset.libraryWidgetPreview='true';host.render();
    let queued=null,observer,staging=true,navigationRevision=0,cropFeed=null,cropOverflow='',cropPriority='';
    const measure=()=>{
     queued=null;if(!frame.isConnected||frame.contentDocument!==doc)return;if(staging)host.motion?.cancel();
     const detail=host.state.focus!=='now';example.dataset.expanded=String(detail);
     if(detail){if(cropFeed){cropFeed.style.setProperty('overflow-y',cropOverflow,cropPriority);cropFeed=null;}delete host.dataset.libraryWidgetSizes;framing.delete(frame);measurement.textContent='Samme klikforløb · brug Tilbage i produktet';}
     else{
      host.dataset.libraryWidgetSizes='true';const feed=doc.querySelector('.responses');
      // Crop only after the real product scroll owner exposes the whole widget.
      // Translating its iframe cannot undo clipping or a genuine scroll-edge fade.
      // The isolated crop owns its scroll position. Wheel input must not move the
      // product feed beneath the retained rectangle; expanded previews stay native.
      if(feed&&!cropFeed){cropFeed=feed;cropOverflow=feed.style.getPropertyValue('overflow-y');cropPriority=feed.style.getPropertyPriority('overflow-y');feed.style.setProperty('overflow-y','hidden','important');}
      if(feed){const box=widget.getBoundingClientRect(),bounds=feed.getBoundingClientRect(),top=bounds.top+feed.clientTop,bottom=top+feed.clientHeight,delta=box.height>feed.clientHeight?box.top-top:box.bottom>bottom?box.bottom-bottom:box.top<top?box.top-top:0;if(delta)feed.scrollTop=Math.max(0,Math.min(feed.scrollHeight-feed.clientHeight,feed.scrollTop+delta));host.scrollEdges?.measure(feed);}
      const box=widget.getBoundingClientRect();framing.set(frame,{x:box.x,y:box.y,width:box.width,height:box.height});measurement.textContent=`Renderet ${Math.round(box.width)} × ${Math.round(box.height)} px · ${sample.label}`;
     }
     fit(viewport);if(staging){staging=false;applyMotion(frame);}
    };
    const schedule=()=>{
     const revision=++navigationRevision;if(queued!==null){frame.contentWindow.cancelAnimationFrame(queued);queued=null;}
     // A real Back retains its normal motion in the expanded product. Recrop only
     // when that owner's actual animations settle; no guessed delay or polling.
     const animations=!staging&&host.state.focus==='now'?[...(host.motion?.animations?.values()||[])]:[];
     if(animations.length)Promise.allSettled(animations.map(animation=>animation.finished)).then(()=>{if(revision===navigationRevision&&frame.isConnected)queued=frame.contentWindow.requestAnimationFrame(measure);});
     else queued=frame.contentWindow.requestAnimationFrame(measure);
    };
    observer=new frame.contentWindow.MutationObserver(schedule);observer.observe(host,{attributes:true,attributeFilter:['data-level','data-view']});sizePreviewCleanup.set(frame,()=>{navigationRevision++;observer.disconnect();if(queued!==null)frame.contentWindow.cancelAnimationFrame(queued);if(cropFeed){cropFeed.style.setProperty('overflow-y',cropOverflow,cropPriority);cropFeed=null;}});
    host.dataset.libraryWidgetSizes='true';schedule();
   });
  };
  frame.src=urlFor(sample);
 }
}
function navigation(){
 const query=$('component-search').value.trim().toLocaleLowerCase('da');
 const matches=entries().filter(item=>`${item.name} ${item.owner} ${item.anatomy} ${item.families.map(id=>productLibrary.find(family=>family.id===id).name).join(' ')}`.toLocaleLowerCase('da').includes(query));
 $('component-menu').replaceChildren();
 for(const item of matches){
  const link=document.createElement('a');link.className='component-link';link.href=`#level=${level}&recipe=${encodeURIComponent(item.id)}`;link.setAttribute('aria-current',item.id===entry.id?'page':'false');
  const label=document.createElement('strong');label.style.fontWeight='inherit';label.textContent=`${level==='components'?`${item.number}. `:''}${item.name}`;link.append(label);
  link.addEventListener('click',event=>{event.preventDefault();selectEntry(item);render();});$('component-menu').append(link);
 }
 $('search-empty').hidden=matches.length>0||level==='tokens';$('component-menu').hidden=level==='tokens';
 $('component-search').parentElement.querySelector('label[for="component-search"]').hidden=level==='tokens';$('component-search').hidden=level==='tokens';
 $('catalog-count').textContent=level==='tokens'?'Én fælles tokenkilde':level==='components'?`${KIT_COMPONENTS.length} delte komponenter`:level==='templates'?'2 fælles templates':`${productLibrary.length} domæne- og tilstandsgrupper · ingen ekstra kitkomponenter`;
 for(const button of document.querySelectorAll('[data-library-level]'))button.setAttribute('aria-pressed',String(button.dataset.libraryLevel===level));
}
function render(){
 radioConnectionPreview.hidden=!(level==='screens'&&selected.id==='radio'&&!compare&&!sizeCompare);radioConnectionPreview.disabled=true;
 clearWidgetSizePreviews();
 const sizeAvailable=level==='screens'&&hasWidgetSizes(selected.id);sizeCompare=sizeCompare&&sizeAvailable;$('sizes-view').hidden=!sizeAvailable;$('sizes-view').setAttribute('aria-pressed',String(sizeCompare));$('widget-size-previews').hidden=!sizeCompare;
 const standalone=level==='components'||level==='templates';
 $('kit-specimens').hidden=!standalone;
 for(const id of ['variant-family','conversation-flow','single-preview','comparison','state-description'])$(id).hidden=standalone;
 document.querySelector('.variant-family').hidden=standalone;
 document.querySelector('.state-toolbar').hidden=standalone;
 document.querySelector('.component-notes').hidden=standalone;
 document.querySelector('.coverage').hidden=standalone;
 if(standalone){navigation();writeHash();$('foundation').hidden=true;$('library-workspace').hidden=false;$('product-preview').src='about:blank';$('component-title').textContent=entry.name;$('component-description').textContent=level==='components'?'Selvstændige eksemplarer fra den samme DOM-fabrik, som produktets ejere bruger.':'Fælles kompositionsramme. Domæneejeren leverer indhold og handlinger.';$('component-owner').textContent=entry.owner;$('component-anatomy').textContent=entry.anatomy;renderSpecimens();return;}

 if(!pendingFlow){flowSteps=[];flowIndex=-1;$('flow-next').disabled=true;$('flow-next').textContent='Næste trin';$('flow-progress').textContent='Vælg en situation og følg den trin for trin.';}
 navigation();writeHash();$('foundation').hidden=level!=='tokens';$('library-workspace').hidden=level==='tokens';if(level==='tokens'){$('product-preview').src='about:blank';for(const viewport of $('comparison').querySelectorAll('.screen-viewport'))resize.unobserve(viewport);$('comparison').replaceChildren();tokenBoard();return;}
 $('variant-family').replaceChildren(...entry.families.map(id=>{const option=document.createElement('option');option.value=id;option.textContent=productLibrary.find(item=>item.id===id).name;return option;}));$('variant-family').value=selected.id;
 $('component-owner').textContent=entry.owner;$('component-anatomy').textContent=entry.anatomy;
 $('conversation-flow').hidden=!['conversation','voice'].includes(selected.id);$('component-title').textContent=entry.name;$('component-description').textContent=selected.description;
 $('component-usage').textContent=selected.usage;$('component-interaction').textContent=selected.interaction;
 $('component-limitations').replaceChildren(...selected.limitations.map(value=>{const li=document.createElement('li');li.textContent=value;return li;}));
 $('state').replaceChildren(...selected.states.map(item=>{const option=document.createElement('option');option.value=item.id;option.textContent=item.label;return option;}));$('state').value=state.id;
 $('state-description').textContent=compare?'Se variationerne samlet. Vælg en tilstand for at åbne den og afprøve dens kontroller.':state.description;
 $('preview-label').textContent=`${selected.name} · ${state.label}`;
 $('isolate-component').disabled=!(entry.selector||(Object.hasOwn(state,'selector')?state.selector:selected.selector));$('isolate-component').setAttribute('aria-pressed',String(isolated));$('isolate-component').textContent=isolated?'Hele skærmen':'Komponenten alene';
 $('state-open').href=`/?qa=1280x800&stage=${encodeURIComponent(state.stage)}`;
 $('state-open').title=state.open?'Åbn skærmen og tryk på komponentens detaljeknap.':'Åbn den samme tilstand i fuld størrelse.';
 $('single-view').setAttribute('aria-pressed',String(!compare&&!sizeCompare));$('compare-view').setAttribute('aria-pressed',String(compare));
 $('single-preview').hidden=compare||sizeCompare;$('comparison').hidden=!compare;
 for(const viewport of $('comparison').querySelectorAll('.screen-viewport'))resize.unobserve(viewport);
 $('comparison').replaceChildren();
 if(sizeCompare){$('product-preview').src='about:blank';renderWidgetSizePreviews();}
 else if(compare){
  $('product-preview').src='about:blank';
  for(const sample of selected.states){
   const article=document.createElement('article'),title=document.createElement('h2'),button=document.createElement('button'),viewport=document.createElement('div'),frame=document.createElement('iframe'),description=document.createElement('p');
   button.type='button';applyKitComponent(button,'button',{variant:'secondary'});button.textContent=sample.label;const activate=()=>{state=sample;compare=false;render();$('state').focus();};button.addEventListener('click',activate);title.append(button);
   viewport.className='screen-viewport';viewport.setAttribute('role','button');viewport.tabIndex=0;viewport.setAttribute('aria-label',`${sample.label} · Afprøv denne tilstand`);viewport.addEventListener('click',activate);viewport.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();activate();}});frame.loading='lazy';frame.tabIndex=-1;frame.setAttribute('aria-hidden','true');viewport.append(frame);description.textContent=sample.description;
   article.append(title,viewport,description);$('comparison').append(article);frameSetup(frame,sample);resize.observe(viewport);
  }
 }else frameSetup($('product-preview'),state);
}
function specimenNode(type,variant='default',identity){
 const options={variant,identity,...(['tile','chip','toggle'].includes(type)||type==='button'&&variant==='selected'?{selected:variant==='selected'}:{}),...(['button','tile','chip','toggle','slider','listrow'].includes(type)?{disabled:variant==='disabled'||type==='button'&&variant==='loading'}:{}),loading:variant==='loading',label:entry.name};
 const node=createKitComponent(type,options);
 const text=(tag,value,cls='')=>{const el=document.createElement(tag);el.textContent=value;if(cls)el.className=cls;return el;};
 const icon=()=>{const el=createKitComponent('icon',{tag:'img',label:'',className:'specimen-icon'});el.src='assets/icons/play-fill.svg';el.alt='';return el;};
 if(type==='slider'){node.value='45';if(variant==='vertical')node.classList.add('--v');return node;}
 if(type==='icon'){if(['24','48'].includes(variant))node.classList.add(`--${variant}`);const img=document.createElement('img');img.src='assets/icons/play-fill.svg';img.alt='';node.append(img);return node;}
 if(type==='button'||type==='chip'){node.textContent=type==='button'?(variant==='selected'?'Valg til':variant==='loading'?'Afventer':variant==='error'?'Prøv igen':'Afspil'):'Køkken';if(type==='button'&&variant==='error')node.dataset.state='error';if(type==='button'&&variant==='selected')node.addEventListener('click',()=>{const selected=node.getAttribute('aria-pressed')!=='true';applyKitComponent(node,'button',{selected});node.textContent=selected?'Valg til':'Valg fra';});if(variant==='primary')node.classList.add('--primary');if(variant==='icon'){node.textContent='';node.classList.add('--icon');node.append(icon());}if(variant==='danger'){node.textContent='Stop';node.classList.add('--danger');}}
 else if(type==='toggle'){node.append(text('span','Køkken'),text('span',variant==='selected'?'Til':'Fra','kit-toggle-state'));}
 else if(type==='topbar'){node.append(createKitComponent('button',{text:'Tilbage'}),text('h2','Tesla'),text('span','14.32','specimen-clock'));}
 else if(type==='sectionheader'){node.append(text('h2','Seneste hændelser'),createKitComponent('button',{text:'Se alle'}));}
 else if(type==='dialog'){
  const dialog=createKitDialog({document,title:'Højttalere',description:'Vælg højttaler til din musik.',message:'Forbindelsen er tilbage.',variant:variant==='toast'?'toast':'default'});if(variant==='loading')applyKitComponent(dialog,'dialog',{loading:true});
  if(variant!=='toast')for(const [name,detail] of [['Køkkenet','HomePod'],['Stuen','HomePod'],['Soveværelse','Ikke tilgængelig']]){const row=createKitComponent('listrow',{document,label:name,selected:name==='Køkkenet',disabled:name==='Soveværelse'}),symbol=createKitComponent('icon',{document,tag:'img'}),copy=document.createElement('span'),end=document.createElement('span');symbol.src='assets/icons/speaker-output.svg';symbol.alt='';copy.append(text('strong',name),text('small',detail));end.className='target-status';end.setAttribute('aria-hidden','true');row.append(symbol,copy,end);dialog.dialogParts.content.append(row);}
  return dialog;
 }
 else if(type==='listrow'){node.append(icon(),text('span','Køkken','kit-row-title'),text('span','Klar','kit-row-meta'));}
 else if(type==='hero'){node.append(text('span','Batteri','kit-meta'),text('strong','78 %','kit-value'),text('span','Parkeret · opdateret 14.32','kit-meta'));}
 else if(type==='tile'){node.append(icon(),text('strong','Køkken'),text('span',variant==='selected'?'Valgt':'Ikke valgt','kit-meta'));}
 else{node.append(text('h2','Musik til eftermiddagen'),text('p','Indhold, status og handling leveres af den eksisterende domæneejer.'),createKitComponent('button',{text:'Åbn musik',identity}));}
 if(['tile','chip','toggle'].includes(type)&&!options.disabled)node.addEventListener('click',()=>applyKitComponent(node,type,{selected:node.getAttribute(type==='toggle'?'aria-checked':'aria-pressed')!=='true'}));
 return node;
}
function renderSpecimens(){
 const target=$('kit-specimens');target.replaceChildren();
 const add=(label,node,description)=>{const sample=document.createElement('section'),heading=document.createElement('h2'),stage=document.createElement('div'),note=document.createElement('p');sample.className='kit-specimen';heading.textContent=label;stage.className='kit-specimen-stage';stage.append(node);note.textContent=description;sample.append(heading,stage,note);target.append(sample);};
 if(level==='templates'){
  const shell=createKitTemplate(entry.id);shell.append(specimenNode('topbar'),specimenNode('sectionheader'));
  if(entry.id==='detail'){shell.append(specimenNode('hero'));const tiles=document.createElement('div');tiles.className='kit-template-tiles';for(let i=0;i<3;i++)tiles.append(specimenNode('tile'));shell.append(tiles,specimenNode('listrow'));}
  else shell.append(specimenNode('card'),specimenNode('button'));
  add(entry.name,shell,entry.anatomy);return;
 }
 const summary=document.createElement('p');summary.className='kit-specimen-measure';summary.textContent=`${entry.measure} · ${entry.anatomy}`;target.append(summary);
 const variants=['default',...(['tile','chip','toggle'].includes(entry.id)?['selected']:[]),...(entry.id==='button'?['primary','icon','danger','selected','error']:[]),...(entry.id==='slider'?['vertical']:[]),...(entry.id==='icon'?['24','48']:[]),...(['button','chip','tile','slider','toggle','listrow'].includes(entry.id)?['disabled']:[]),'loading',...(entry.id==='dialog'?['toast']:[])];
 const labels={default:'Standard',selected:'Valgt',disabled:'Deaktiveret',loading:'Opdaterer · indhold bevares',primary:'Primær',icon:'Ikonknap · 64 × 64',danger:'Destruktiv handling',vertical:'Lodret',24:'24 px',48:'48 px',toast:'Toast · faktisk resultat',error:'Fejl · eksplicit ejerstatus'};
 for(const variant of variants)add(labels[variant],specimenNode(entry.id,variant),variant==='loading'?'Samme indhold og DOM. aria-busy angiver en igangværende opdatering; markøren stopper uden at opfinde et resultat.':variant==='selected'&&entry.id==='button'?'Tryk for at skifte dette lokale valg. Det samme native element bevares; ingen produktkommando sendes.':entry.measure);
 if(['card','hero','tile','button'].includes(entry.id))for(const [identity,label] of [['weather','Vejr'],['robot','Robot'],['light','Lys'],['tesla','Tesla']])add(label,specimenNode(entry.id,entry.id==='button'?'selected':'default',identity),'Samme anatomi · fælles tint / strong / ink.');
 const usages=document.createElement('p');usages.className='kit-specimen-measure';usages.textContent='Bruges i: '+entry.families.map(id=>productLibrary.find(item=>item.id===id).name).join(' · ');target.append(usages);
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
 if(flowKind==='auto-return')$('flow-progress').textContent+=stage==='conversation-complete'?' · Vent 30 sekunder uden at røre produktet. Det går til Lige nu; svaret bevares. Efter tre minutters pause går Lige nu til Ro. Prøv igen og scroll eller tryk for at afbryde.':' · Tryk Næste for at afslutte talen og starte de 30 sekunders ro.';
 if(flowKind==='return-followup')$('flow-progress').textContent+=stage==='conversation-complete'?(next===1?' · De 30 sekunder er startet. Vent lidt, og tryk Næste for at stille et nyt spørgsmål.':' · Det nye svar bliver stående.'):stage==='conversation-interrupted'?' · Ny tale afbryder automatisk retur. Det gamle svar bevares.':stage==='conversation-working'?' · Det gamle svar er stadig nyttigt, mens det nye bliver klart.':stage==='conversation-followup'?' · Nu overtager det nye svar.':'';
 const following=selected.states.find(item=>item.stage===flowSteps[next+1]);$('flow-next').disabled=!following;$('flow-next').textContent=following?`Næste: ${following.label}`:'Forløbet er gennemført';
}
$('flow-start').addEventListener('click',()=>{level='screens';selected=productLibrary.find(item=>item.id==='conversation');entry=screens.find(item=>item.id==='conversation');state=selected.states[0];compare=false;isolated=false;flowKind=$('flow-choice').value;flowSteps=flows[flowKind]||flows.visual;flowIndex=-1;pendingFlow=true;$('flow-next').disabled=false;render();});
$('flow-next').addEventListener('click',advanceFlow);
for(const button of document.querySelectorAll('[data-library-level]'))button.addEventListener('click',()=>{level=button.dataset.libraryLevel;$('component-search').value='';selectEntry(entries()[0]);render();});
$('variant-family').addEventListener('change',()=>{selected=productLibrary.find(item=>item.id===$('variant-family').value);state=selected.states[0];isolated=level==='components'&&!!(entry.selector||selected.selector);render();});
$('touch-areas').addEventListener('click',()=>{touchAreas=!touchAreas;renderTouchInspection();});
$('preview-motion').addEventListener('click',()=>{reducedMotion=!reducedMotion;$('preview-motion').setAttribute('aria-pressed',String(reducedMotion));for(const frame of document.querySelectorAll('.screen-viewport iframe'))applyMotion(frame);});
$('component-search').addEventListener('input',navigation);
$('state').addEventListener('change',()=>{flowSteps=[];flowIndex=-1;$('flow-next').disabled=true;state=selected.states.find(item=>item.id===$('state').value)||selected.states[0];render();});
$('single-view').addEventListener('click',()=>{compare=false;sizeCompare=false;render();});$('compare-view').addEventListener('click',()=>{compare=true;sizeCompare=false;render();});$('sizes-view').addEventListener('click',()=>{compare=false;sizeCompare=true;render();});
$('reset-example').addEventListener('click',render);
$('isolate-component').addEventListener('click',()=>{isolated=!isolated;render();});
$('focus-preview').addEventListener('click',()=>{const focused=document.body.classList.toggle('preview-focused');$('focus-preview').setAttribute('aria-pressed',String(focused));$('focus-preview').textContent=focused?'Vis komponentliste':'Mere plads';});
window.addEventListener('hashchange',()=>{readHash();readHierarchy();render();});window.addEventListener('pagehide',()=>{clearWidgetSizePreviews();resize.disconnect();},{once:true});
resize.observe($('product-preview').parentElement);readHash();readHierarchy();render();
