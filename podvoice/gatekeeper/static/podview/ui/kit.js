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
/** Explicit text roles shared by detail compositions and library specimens. */
export function applyKitTextRole(node,role){
 if(!['section-title','group-title','field-label','body','meta','control-value','headline'].includes(role))throw new TypeError(`Unknown kit text role: ${role}`);
 data(node,'kitText',role);return node;
}
/** Retained icon + label inside the existing Button. Scalar choices do not use it. */
const buttonContents=new WeakMap();
export function syncKitButtonContent(node,{label,icon}={}){
 const text=String(label??'');if(icon!==undefined&&!/^assets\/icons\/[a-z0-9-]+\.svg$/.test(icon))throw new TypeError('Button icon must be a canonical local asset');
 if(!node.ownerDocument?.createElement){if(node.textContent!==text)node.textContent=text;return node;}
 let parts=buttonContents.get(node);
 if(!parts||!Array.from(node.children||[]).includes(parts.label)){
  const symbol=createKitComponent('icon',{document:node.ownerDocument,tag:'span',className:'--24'}),copy=node.ownerDocument.createElement('span');symbol.setAttribute('aria-hidden','true');copy.dataset.kitSlot='label';node.textContent='';node.append(symbol,copy);parts={symbol,label:copy};buttonContents.set(node,parts);data(node,'kitContent','icon-label');
 }
 if(icon===undefined)icon=parts.icon;parts.icon=icon;const hidden=!icon;if(parts.symbol.hidden!==hidden)parts.symbol.hidden=hidden;
 if(icon){const style=`--pv-icon-source:url("${icon}")`;if(parts.symbol.getAttribute('style')!==style)parts.symbol.setAttribute('style',style);}
 if(parts.label.textContent!==text)parts.label.textContent=text;return node;
}
/** Power is the existing Toggle family: checked always means observed on.
 * The effect owner handles confirmation and updates only after observation. */
export function syncKitPowerToggle(node,{checked=false,label='Klima'}={}){
 applyKitComponent(node,'toggle',{variant:'power',selected:checked,label,feedback:'progress'});
 syncKitButtonContent(node,{label:checked?'Tændt':'Slukket',icon:'assets/icons/power.svg'});
 if(!Array.from(node.children).some(child=>child.dataset?.kitSlot==='switch-track')){
  const track=node.ownerDocument.createElement('span'),thumb=node.ownerDocument.createElement('span');
  track.dataset.kitSlot='switch-track';track.setAttribute('aria-hidden','true');thumb.dataset.kitSlot='switch-thumb';track.append(thumb);node.append(track);
 }
 return node;
}

export function applyKitComponent(node,type,options={}){
 recipe(type);addClasses(node,'pv-kit',`pv-kit-${type}`);
 const classes={card:'pv-card',hero:'pv-hero',tile:'pv-tile',chip:'pv-chip',button:'pv-btn',slider:'pv-slider',toggle:'pv-toggle',listrow:'pv-row',sectionheader:'pv-section-header',topbar:'pv-topbar',dialog:'pv-dialog',icon:'pv-icon'};
 addClasses(node,classes[type]);data(node,'kit',type);
 if(options.variant!==undefined)data(node,'kitVariant',options.variant);
 if(options.identity!==undefined){const identity=({vejr:'weather',lys:'light'})[options.identity]||options.identity;if(!['neutral','weather','robot','light','tesla'].includes(identity))throw new TypeError(`Unknown kit identity: ${options.identity}`);data(node,'kitIdentity',identity);}
 if(options.label!==undefined)attribute(node,'aria-label',options.label);
 if(options.selected!==undefined)attribute(node,type==='toggle'?'aria-checked':'aria-pressed',!!options.selected);
 if(options.disabled!==undefined){if('disabled' in node&&node.disabled!==!!options.disabled)node.disabled=!!options.disabled;attribute(node,'aria-disabled',!!options.disabled);}
 if(options.feedback!==undefined){if(!['label','progress'].includes(options.feedback))throw new TypeError(`Unknown Button feedback: ${options.feedback}`);data(node,'feedback',options.feedback);}
 if(options.tone!==undefined){if(!['neutral','warning','danger'].includes(options.tone))throw new TypeError(`Unknown Button tone: ${options.tone}`);data(node,'tone',options.tone);}
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
export function createKitDisclosure({document=globalThis.document,id,title,description='',expanded=false,onToggle,iconSrc,leadingIcon}={}){
 if(!id)throw new TypeError('Disclosure needs a stable id');
 const node=document.createElement('section'),trigger=createKitComponent('listrow',{document}),copy=document.createElement('span'),heading=document.createElement('strong'),detail=document.createElement('small'),panel=document.createElement('div');
 node.className='pv-kit-disclosure';trigger.type='button';trigger.id=id+'-trigger';panel.id=id+'-panel';heading.textContent=title;applyKitTextRole(heading,'group-title');applyKitTextRole(detail,'meta');copy.dataset.kitSlot='copy';heading.dataset.kitSlot='title';detail.dataset.kitSlot='description';detail.textContent=description;copy.append(heading,detail);node.append(trigger,panel);trigger.setAttribute('aria-controls',panel.id);panel.setAttribute('aria-labelledby',trigger.id);panel.setAttribute('role','region');
 if(leadingIcon){const icon=createKitComponent('icon',{document,tag:'img'});icon.src=leadingIcon;icon.alt='';icon.dataset.kitSlot='leading-icon';trigger.dataset.leadingIcon='true';trigger.append(icon);}
 trigger.append(copy);
 if(iconSrc){const icon=createKitComponent('icon',{document,tag:'img'});icon.src=iconSrc;icon.alt='';icon.dataset.kitSlot='trailing-icon';trigger.append(icon);trigger.dataset.trailingIcon='true';}
 let disabled=false;
 const setExpanded=value=>{expanded=!!value&&!disabled;if(!expanded&&panel.contains?.(document.activeElement))trigger.focus?.();attribute(trigger,'aria-expanded',expanded);panel.hidden=!expanded;};
 const setDescription=value=>{detail.textContent=value||'';detail.hidden=!value;data(trigger,'hasSummary',!!value);attribute(detail,'aria-hidden',!value);};
 const setDisabled=value=>{disabled=!!value;if(disabled)setExpanded(false);if(trigger.disabled!==disabled)trigger.disabled=disabled;attribute(trigger,'aria-disabled',disabled);};
 trigger.addEventListener('click',()=>{if(disabled)return;setExpanded(!expanded);onToggle?.(expanded);});setExpanded(expanded);setDescription(description);
 return {node,trigger,panel,setExpanded,setDescription,setDisabled};
}

/** Reveal a selected item inside its own horizontal viewport only.
 * No parent scrolling, animation, effect command or repeated-render movement. */
export function revealKitItem(item,viewport){
 if(!item?.getBoundingClientRect||!viewport?.getBoundingClientRect)return;
 const box=item.getBoundingClientRect(),frame=viewport.getBoundingClientRect();if(!box.width||!frame.width)return;
 const delta=box.left<frame.left?box.left-frame.left:box.right>frame.right?box.right-frame.right:0;if(delta)viewport.scrollLeft+=delta;
}

/** Native single-choice inputs use existing Chip visuals and native arrow keys. */
export function createKitChoiceGroup({document=globalThis.document,id,label,choices=[],value,onChange,variant,layout}={}){
 if(!id)throw new TypeError('Choice group needs a stable id');
 const node=document.createElement('fieldset'),legend=document.createElement('legend'),row=document.createElement('div'),inputs=[];
 node.className='pv-kit-choice-group';if(['level','navigation'].includes(variant))data(node,'choiceVariant',variant);if(layout==='row')data(node,'choiceLayout','row');legend.textContent=label;applyKitTextRole(legend,'field-label');row.className='pv-kit-choice-options';node.append(legend,row);let selected=value,blocked=false;
 const setValue=next=>{const changed=selected!==next;selected=next;for(const input of inputs)if(input.checked!==(input.value===String(next)))input.checked=input.value===String(next);if(changed&&variant==='navigation')revealKitItem(inputs.find(input=>input.checked)?.parentElement,row);};
 for(const choice of choices){const item=typeof choice==='string'?{value:choice,label:choice}:choice,option=createKitComponent('chip',{document,tag:'label'}),input=document.createElement('input'),text=document.createElement('span');input.type='radio';input.name=id;input.value=String(item.value);input.id=id+'-'+inputs.length;text.textContent=item.label;option.classList?.add('pv-kit-choice-label');option.append(input,text);row.append(option);inputs.push(input);input.addEventListener('change',()=>{if(blocked||input.disabled){setValue(selected);return;}if(input.checked){selected=input.value;onChange?.(selected);}});}
 const setDisabled=value=>{blocked=!!value;attribute(node,'aria-disabled',blocked);for(const input of inputs)attribute(input,'aria-disabled',blocked);};
 const setChoiceDisabled=(choice,disabled)=>{const input=inputs.find(item=>item.value===String(choice));if(input)input.disabled=!!disabled;};
 setValue(value);return {node,inputs,setValue,setDisabled,setChoiceDisabled};
}

/** Label/value composition of the existing Slider. Observation is presentation;
 * only an explicit native change reaches the owner's captured command context. */
export function createKitSliderField({document=globalThis.document,id,label,identity='neutral',onCommit,getContext}={}){
 if(!id)throw new TypeError('Slider field needs a stable id');
 const node=document.createElement('div'),heading=document.createElement('label'),description=document.createElement('p'),input=createKitComponent('slider',{document,identity}),output=document.createElement('output');
 node.className='pv-kit-slider-field';heading.id=id+'-label';heading.htmlFor=id;heading.textContent=label;applyKitTextRole(heading,'field-label');applyKitTextRole(output,'control-value');applyKitTextRole(description,'meta');description.id=id+'-scope';input.id=id;output.htmlFor=id;input.setAttribute('aria-labelledby',heading.id);input.setAttribute('aria-describedby',description.id);node.append(heading,output,description,input);
 let model={value:null,scope:'',disabled:false,pending:false,mixed:false},draft=null,context,editing=false,aborted=false;
 const text=(element,value)=>{if(element.textContent!==value)element.textContent=value;};
 const paint=()=>{
  const known=Number.isFinite(model.value),value=draft??(known?model.value:0),state=draft!==null?'draft':model.pending?'pending':known?'known':model.mixed?'mixed':'unknown',message=draft!==null?`${draft} %`:model.valueText||(known?`${model.value} %`:model.mixed?'Forskellige niveauer':'Niveau ukendt');
  applyKitTextRole(output,/^\d+\s*%$/.test(message)?'control-value':'meta');data(node,'fieldState',state);data(input,'valueKnown',draft!==null||known);attribute(node,'aria-busy',!!model.pending);attribute(input,'aria-disabled',!!(model.disabled||model.pending));if(input.disabled!==!!model.disabled)input.disabled=!!model.disabled;
  if(input.value!==String(value))input.value=String(value);syncKitSlider(input);text(output,message);text(description,model.scope||'');if(description.hidden!==!model.scope)description.hidden=!model.scope;attribute(input,'aria-valuetext',message.replace(/ %$/,' procent'));
 };
 const cancelDraft=()=>{draft=null;context=undefined;editing=false;aborted=true;paint();};
 const begin=()=>{if(model.disabled||model.pending)return false;if(!editing){context=getContext?.();editing=true;}aborted=false;return true;};
 input.addEventListener('pointerdown',begin);
 input.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();cancelDraft();}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key))begin();});
 input.addEventListener('input',()=>{if(model.disabled||model.pending||aborted){paint();return;}if(!editing)begin();draft=Math.max(0,Math.min(100,Number(input.value)));paint();});
 input.addEventListener('change',()=>{if(model.disabled||model.pending||aborted||draft===null){paint();return;}const value=draft,binding=context;draft=null;context=undefined;editing=false;paint();onCommit?.(value,binding);});
 for(const event of ['pointercancel','blur'])input.addEventListener(event,cancelDraft);
 const setModel=value=>{const next={value:null,scope:'',disabled:false,pending:false,mixed:false,...value};if(!Number.isFinite(next.value)||next.value<0||next.value>100)next.value=null;if(next.scope!==model.scope||next.disabled||next.pending){draft=null;context=undefined;editing=false;aborted=true;}model=next;paint();};
 paint();return {node,label:heading,description,input,output,setModel,cancelDraft};
}
