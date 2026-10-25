/** Shared, presentation-only native DOM recipes. Domain renderers retain all data,
 * keyed identity, event listeners and effect authority. Updates never replace content. */
export const KIT_COMPONENTS=Object.freeze([
 ['card','Card','article','Flade · indhold · handling','24 px indvendigt · radius 24'],
 ['hero','Hero','article','Status · instrument/værdi · metadata','32 px indvendigt · mindst 200 px høj'],
 ['tile','Tile','button','Ikon · titel · status · valg','24 px indvendigt · mindst 64 px trykflade'],
 ['chip','Chip / Segmented','button','Label · valgt tilstand','64 px høj · 24 px vandret'],
 ['button','Button','button','Label eller ikon · handling','64 px høj · 32 px vandret'],
 ['slider','Slider','input','Label · skala · værdi','64 px betjeningsområde'],
 ['toggle','Toggle','button','Navn · faktisk tilstand','64 px trykflade'],
 ['listrow','ListRow','button','Ikon/billede · titel · metadata · handling','64 px minimum · 16 px mellemrum'],
 ['sectionheader','SectionHeader','header','Titel · relevant sekundær handling','20/26 px titel · 16 px mellemrum'],
 ['topbar','TopBar / DetailHeader','header','Tilbage · én titel · højre status','64 px minimum · fælles baseline'],
 ['dialog','Dialog / Toast','section','Kontekst · indhold · lukning/resultat','32 px indvendigt · radius 24'],
 ['icon','Icon','span','Én genkendelig handling eller status','24 / 32 / 48 px · 2 px streg']
].map(([id,name,tag,anatomy,measure])=>Object.freeze({id,name,tag,anatomy,measure})));
// Native setters can trigger mutation observers even for an unchanged value.
// Keep repeat renders entirely quiet; dataset reflects setAttribute in the DOM.
const attribute=(node,name,value)=>{const next=String(value);if(node.getAttribute(name)!==next)node.setAttribute(name,next);};
const addClasses=(node,...tokens)=>{
 if(node.classList?.contains){const missing=tokens.filter(token=>!node.classList.contains(token));if(missing.length)missing.forEach(token=>node.classList.add(token));}
 else{const next=[...new Set(`${node.className||''} ${tokens.join(' ')}`.trim().split(/\s+/))].join(' ');if(node.className!==next)node.className=next;}
};
const data=(node,key,value)=>attribute(node,`data-${key.replace(/[A-Z]/g,letter=>`-${letter.toLowerCase()}`)}`,value);
const recipe=type=>{const found=KIT_COMPONENTS.find(item=>item.id===type);if(!found)throw new TypeError(`Unknown kit component: ${type}`);return found;};
// One native Slider paint projection. It reads the current value only and never
// sends an action; the retained owner keeps every gesture and effect handler.
const sliderBindings=new WeakSet();
export function syncKitSlider(node){
 const rawMin=Number(node.min),rawMax=Number(node.max),rawValue=Number(node.value);
 const min=Number.isFinite(rawMin)?rawMin:0,max=Number.isFinite(rawMax)&&rawMax>min?rawMax:min+100;
 const progress=Number.isFinite(rawValue)?Math.max(0,Math.min(100,(rawValue-min)/(max-min)*100)):0;
 const next=`${progress}%`;
 if(node.style?.getPropertyValue?.('--pv-slider-progress')!==next)node.style?.setProperty?.('--pv-slider-progress',next);
 return progress;
}
const paintSliderInput=event=>syncKitSlider(event.currentTarget);
export function applyKitComponent(node,type,options={}){
 recipe(type);addClasses(node,'pv-kit',`pv-kit-${type}`);
 const classes={card:'pv-card',hero:'pv-hero',tile:'pv-tile',chip:'pv-chip',button:'pv-btn',slider:'pv-slider',toggle:'pv-toggle',listrow:'pv-row',sectionheader:'pv-section-header',topbar:'pv-topbar',dialog:'pv-dialog',icon:'pv-icon'};
 addClasses(node,classes[type]);data(node,'kit',type);
 if(options.variant!==undefined)data(node,'kitVariant',options.variant);
 if(options.identity!==undefined){const identity=({vejr:'weather',lys:'light'})[options.identity]||options.identity;if(!['neutral','weather','robot','light','tesla'].includes(identity))throw new TypeError(`Unknown kit identity: ${options.identity}`);data(node,'kitIdentity',identity);}
 if(options.label!==undefined)attribute(node,'aria-label',options.label);
 if(options.selected!==undefined)attribute(node,type==='toggle'?'aria-checked':'aria-pressed',!!options.selected);
 if(options.disabled!==undefined){if('disabled' in node&&node.disabled!==!!options.disabled)node.disabled=!!options.disabled;attribute(node,'aria-disabled',!!options.disabled);}
 if(options.loading!==undefined)attribute(node,'aria-busy',!!options.loading);
 if(type==='toggle')attribute(node,'role','switch');
 if(type==='slider'){syncKitSlider(node);if(node.tagName?.toUpperCase()==='INPUT'&&!sliderBindings.has(node)){node.addEventListener('input',paintSliderInput);sliderBindings.add(node);}}
 return node;
}
export function createKitComponent(type,{document=globalThis.document,tag,className='',text,...options}={}){
 const node=document.createElement(tag||recipe(type).tag);
 if(className)node.className=className;
 if(node.tagName?.toUpperCase()==='BUTTON')node.type='button';
 if(type==='slider'){node.type='range';node.min='0';node.max='100';node.value='50';}
 if(text!==undefined)node.textContent=text;
 return applyKitComponent(node,type,options);
}
export function applyKitTemplate(node,kind){
 if(!['detail','response'].includes(kind))throw new TypeError(`Unknown kit template: ${kind}`);
 addClasses(node,'pv-kit-template',`pv-kit-template-${kind}`);data(node,'kitTemplate',kind);return node;
}
export function createKitTemplate(kind,{document=globalThis.document,className=''}={}){
 const node=document.createElement('section');if(className)node.className=className;return applyKitTemplate(node,kind);
}

/** Retained anatomy inside the existing Dialog primitive. Owners keep native form,
 * close, selection and effect handlers; this helper only binds presentation parts. */
export function applyKitDialog(node,{header,content,description,actions,close,variant='default'}={}){
 applyKitComponent(node,'dialog',{variant});
 for(const [part,element] of [['header',header],['content',content],['description',description],['actions',actions]])if(element)addClasses(element,`pv-dialog-${part}`);
 if(close){applyKitComponent(close,'button',{variant:'icon'});addClasses(close,'pv-dialog-close');}
 return node;
}
export function createKitDialog({document=globalThis.document,title='',description='',message='',variant='default',close=true}={}){
 const node=createKitComponent('dialog',{document,tag:variant==='toast'?'p':'section',variant});
 const content=document.createElement(variant==='toast'?'span':'div');node.dialogParts={content};
 if(variant==='toast'){content.textContent=message;node.append(content);applyKitDialog(node,{content,variant});return node;}
 const header=document.createElement('header'),heading=document.createElement('h2'),copy=document.createElement('p');heading.textContent=title;header.append(heading);copy.textContent=description;
 let closeButton;if(close){closeButton=createKitComponent('button',{document,label:'Luk',variant:'icon'});const icon=createKitComponent('icon',{document,tag:'img'});icon.src='assets/icons/x-lg.svg';icon.alt='';closeButton.append(icon);header.append(closeButton);}
 node.dialogParts={header,heading,description:copy,content,close:closeButton};node.append(header);if(description)node.append(copy);node.append(content);
 applyKitDialog(node,{header,description:description?copy:null,content,close:closeButton,variant});return node;
}

/** ListRow disclosure composition. Domain content and effects remain with owner. */
export function createKitDisclosure({document=globalThis.document,id,title,description='',expanded=false,onToggle,iconSrc}={}){
 if(!id)throw new TypeError('Disclosure needs a stable id');
 const node=document.createElement('section'),trigger=createKitComponent('listrow',{document,label:title}),copy=document.createElement('span'),heading=document.createElement('strong'),detail=document.createElement('small'),panel=document.createElement('div');
 node.className='pv-kit-disclosure';trigger.type='button';trigger.id=id+'-trigger';panel.id=id+'-panel';heading.textContent=title;detail.textContent=description;copy.append(heading,detail);trigger.append(copy);node.append(trigger,panel);trigger.setAttribute('aria-controls',panel.id);panel.setAttribute('aria-labelledby',trigger.id);
 if(iconSrc){const icon=createKitComponent('icon',{document,tag:'img'});icon.src=iconSrc;icon.alt='';trigger.append(icon);}
 const setExpanded=value=>{expanded=!!value;if(!expanded&&panel.contains?.(document.activeElement))trigger.focus?.();attribute(trigger,'aria-expanded',expanded);panel.hidden=!expanded;};
 const setDescription=value=>{detail.textContent=value||'';detail.hidden=!value;};
 trigger.addEventListener('click',()=>{setExpanded(!expanded);onToggle?.(expanded);});setExpanded(expanded);setDescription(description);
 return {node,trigger,panel,setExpanded,setDescription};
}

/** Native single-choice inputs use existing Chip visuals and native arrow keys. */
export function createKitChoiceGroup({document=globalThis.document,id,label,choices=[],value,onChange}={}){
 if(!id)throw new TypeError('Choice group needs a stable id');
 const node=document.createElement('fieldset'),legend=document.createElement('legend'),row=document.createElement('div'),inputs=[];
 node.className='pv-kit-choice-group';legend.textContent=label;row.className='pv-kit-choice-options';node.append(legend,row);let selected=value,blocked=false;
 const setValue=next=>{selected=next;for(const input of inputs)if(input.checked!==(input.value===String(next)))input.checked=input.value===String(next);};
 for(const choice of choices){const item=typeof choice==='string'?{value:choice,label:choice}:choice,option=createKitComponent('chip',{document,tag:'label'}),input=document.createElement('input'),text=document.createElement('span');input.type='radio';input.name=id;input.value=String(item.value);input.id=id+'-'+inputs.length;text.textContent=item.label;option.classList?.add('pv-kit-choice-label');option.append(input,text);row.append(option);inputs.push(input);input.addEventListener('change',()=>{if(blocked||input.disabled){setValue(selected);return;}if(input.checked){selected=input.value;onChange?.(selected);}});}
 const setDisabled=value=>{blocked=!!value;attribute(node,'aria-disabled',blocked);for(const input of inputs)attribute(input,'aria-disabled',blocked);};
 const setChoiceDisabled=(choice,disabled)=>{const input=inputs.find(item=>item.value===String(choice));if(input)input.disabled=!!disabled;};
 setValue(value);return {node,inputs,setValue,setDisabled,setChoiceDisabled};
}
