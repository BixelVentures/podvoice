import {applyKitComponent, applyKitDialog, applyKitTextRole, createKitComponent, createKitChoiceGroup, createKitDisclosure} from './ui/kit.js';

const alphabet = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅ#'];
const collator = new Intl.Collator('da');
const deletedKey = 'podview.deleted-recipes';
const historyKey = 'podview.recipe-history';
const sessionKey = 'podview.recipe-session.v1';
const sessionMaxAge = 30*86400000;
const recipeSignature = recipe=>JSON.stringify([recipe.steps,recipe.groups || [{title:'Råvarer',lines:recipe.ingredients}]]);
const historyDate = new Intl.DateTimeFormat('da-DK',{dateStyle:'medium',timeStyle:'short'});

function element(tag, text = '') {
 const node = document.createElement(tag);
 node.textContent = text;
 return node;
}
function kit(type, text, options) {
 return createKitComponent(type,{text,...options});
}
function action(label, run, variant = 'secondary', tone) {
 const button = kit('button',label,{variant,tone});
 button.addEventListener('click',run);
 return button;
}
function meta(text) {
 return applyKitTextRole(element('p',text),'meta');
}
function section(title, ...children) {
 const card = kit('card');
 const header = kit('sectionheader');
 header.append(applyKitTextRole(element('h2',title),'section-title'));
 card.append(header,...children);
 return card;
}

export class RecipeView {
 constructor(root, back, onCookingChange) {
  this.root = root;
  this.back = back;
  this.onCookingChange = onCookingChange;
  this.deleted = new Set();
  try {
   const deleted = JSON.parse(localStorage.getItem(deletedKey));
   if (Array.isArray(deleted)) this.deleted = new Set(deleted);
  } catch { /* The catalog remains usable without storage. */ }
  this.saved = [];
  this.uploads = [];
  this.sources = [];
  this.sessions = new Map();
  this.pendingSession = null;
  try {
   const raw = localStorage.getItem(sessionKey);
   if (raw && raw.length <= 65536) this.pendingSession = JSON.parse(raw);
   else if (raw) localStorage.removeItem(sessionKey);
  } catch {this.clearSession();}
  this.sessionScroll = ()=>{
   if (this.readingRecipe && this.readingRecipe === this.active) {
    const session = this.sessions.get(this.active);
    if (session) {session.scroll = this.root.scrollTop;this.persistSession();}
   }
  };
  this.root.addEventListener('scroll',this.sessionScroll);
  try {
   const entries = JSON.parse(localStorage.getItem(historyKey));
   this.history = Array.isArray(entries) ? entries.filter(entry=>typeof entry?.title === 'string'
    && typeof entry.completedAt === 'number' && Number.isFinite(new Date(entry.completedAt).getTime())).slice(0,5) : [];
  } catch {
   this.history = [];
  }
  this.catalog();
 }

 page(title, subtitle, back, ...actions) {
  this.stopCatalogRefresh();
  this.catalogResize?.disconnect();
  this.readingRecipe = null;
  this.goBack = back;
  if (this.coverUrl) URL.revokeObjectURL(this.coverUrl);
  this.coverUrl = null;
  delete this.root.dataset.recipeMode;
  delete this.root.dataset.recipePhase;
  const header = kit('topbar','',{className:'response-heading'});
  const copy = element('div');
  this.title = element('h1',title);
  applyKitTextRole(this.title,'headline');
  this.title.tabIndex = -1;
  copy.append(this.title,meta(subtitle));
  header.append(copy,...actions);
  this.root.replaceChildren(header);
  this.root.scrollTop = 0;
  this.root.parentElement.scrollTop = 0;
  this.onCookingChange();
  if (!this.suppressPageFocus) this.title.focus({preventScroll:true});
 }

 stopCatalogRefresh() {
  this.catalogRefresh?.dispose();
  this.catalogRefresh = null;
 }

 dispose() {
  this.stopCatalogRefresh();
  this.catalogResize?.disconnect();
  this.root.removeEventListener('scroll',this.sessionScroll);
 }

 persistSession() {
  const recipe = this.active, session = this.sessions.get(recipe);
  if (!recipe || !session || typeof recipe.source?.url !== 'string') return;
  try {
   const record = JSON.stringify({version:1,url:recipe.source.url,signature:recipeSignature(recipe),
    savedAt:Date.now(),steps:[...session.steps],ingredients:[...session.ingredients],
    expanded:session.ingredientsExpanded ?? true,scroll:session.scroll || 0});
   if (record.length <= 65536) localStorage.setItem(sessionKey,record);
  } catch { /* Cooking remains usable without browser storage. */ }
 }

 clearSession() {
  this.pendingSession = null;
  try {localStorage.removeItem(sessionKey);} catch { /* No storage access. */ }
 }

 restoreSession() {
  const record = this.pendingSession;
  if (!record) return;
  this.pendingSession = null;
  try {
   const matches = this.saved.filter(recipe=>recipe.source?.url === record.url);
   const recipe = matches.length === 1 ? matches[0] : null;
   const groups = recipe?.groups || [{title:'Råvarer',lines:recipe?.ingredients}];
   const allowed = new Set(groups.flatMap(group=>group.lines.map((_,i)=>group.title+'-'+i)));
   if (record.version !== 1 || !recipe || recipeSignature(recipe) !== record.signature
    || !Number.isFinite(record.savedAt) || record.savedAt > Date.now()+60000
    || Date.now()-record.savedAt > sessionMaxAge || typeof record.expanded !== 'boolean'
    || !Number.isFinite(record.scroll) || record.scroll < 0 || record.scroll > 1000000
    || !Array.isArray(record.steps) || record.steps.length > recipe.steps.length
    || !record.steps.every(id=>typeof id === 'string' && /^(0|[1-9][0-9]*)$/.test(id) && Number(id) < recipe.steps.length)
    || new Set(record.steps).size !== record.steps.length
    || !Array.isArray(record.ingredients) || record.ingredients.length > allowed.size
    || !record.ingredients.every(id=>typeof id === 'string' && allowed.has(id))
    || new Set(record.ingredients).size !== record.ingredients.length) throw Error('invalid session');
   this.sessions.set(recipe,{steps:new Set(record.steps),ingredients:new Set(record.ingredients),
    ingredientsExpanded:record.expanded,scroll:record.scroll});
   this.active = recipe;
  } catch {this.clearSession();}
 }

 async refreshPublishedCatalog(signal) {
  const before = JSON.stringify(this.saved), status = this.catalogStatus;
  try {
   const response = await fetch(new URL('api/recipes',document.baseURI),{cache:'no-store',signal});
   if (!response.ok) throw new Error('Kataloget kunne ikke hentes');
   const {recipes} = await response.json();
   if (!Array.isArray(recipes)) throw new Error('Ugyldigt katalog');
   const previous = new Map(this.saved.map(recipe=>[recipe.source?.url,recipe]));
   this.saved = recipes.filter(recipe=>!this.deleted.has(recipe.source.url)).map(recipe=>{
    const existing = previous.get(recipe.source.url);
    return existing && this.sessions.has(existing) ? existing : recipe;
   });
   this.catalogStatus = 'ready';
   this.restoreSession();
  } catch {
   if (signal?.aborted) return false;
   this.catalogStatus = 'unavailable';
  }
  return status !== this.catalogStatus || before !== JSON.stringify(this.saved);
 }

 async refreshUploadHistory(signal) {
  const before = JSON.stringify(this.uploads), status = this.uploadHistoryStatus;
  try {
   const response = await fetch(new URL('api/recipe-upload-history',document.baseURI),{cache:'no-store',signal});
   if (!response.ok) throw new Error('Uploadhistorikken kunne ikke hentes');
   const {uploads} = await response.json();
   if (!Array.isArray(uploads)) throw new Error('Ugyldig uploadhistorik');
   this.uploads = uploads.filter(upload=>upload && typeof upload.id === 'string'
    && typeof upload.status === 'string' && typeof upload.message === 'string')
    .sort((a,b)=>(new Date(b.updatedAt || b.receivedAt).getTime() || 0)-(new Date(a.updatedAt || a.receivedAt).getTime() || 0)).slice(0,50);
   this.uploadHistoryStatus = 'ready';
  } catch {
   if (signal?.aborted) return false;
   this.uploadHistoryStatus = 'unavailable';
  }
  return status !== this.uploadHistoryStatus || before !== JSON.stringify(this.uploads);
 }

 catalog(refresh = true) {
  this.page('Opskrifter','',this.back);
  const layout = element('div');
  layout.dataset.recipeLayout = 'catalog';
  const entries = element('div');
  this.catalogEntries = entries;
  entries.tabIndex = 0;
  const index = element('nav');
  index.setAttribute('aria-label','Alfabetisk indeks');
  const marker = kit('card','',{tag:'output'});
  marker.hidden = true;
  marker.setAttribute('aria-hidden','true');
  const groups = new Map();
  const buttons = [];
  const uploads = createKitDisclosure({id:'recipe-upload-history',title:'Uploadhistorik',
   expanded:this.uploadHistoryExpanded,onToggle:expanded=>{this.uploadHistoryExpanded=expanded;}});
  const renderUploads = () => {
   uploads.panel.replaceChildren();
   const labels = {saved:'Gemt',received:'Modtaget',importing:'Importerer',rejected:'Afvist',failed:'Mislykkedes'};
   for (const upload of this.uploads) {
    const row = kit('listrow','',{tag:'div',variant:'read-only'});
    row.append(applyKitTextRole(element('h3',upload.title || upload.url || 'Opskriftslink'),'field-label'));
    const timestamp = new Date(upload.updatedAt || upload.receivedAt);
    if (Number.isFinite(timestamp.getTime())) {
     const time = applyKitTextRole(element('time',historyDate.format(timestamp)),'meta');
     time.dateTime = timestamp.toISOString();
     row.append(time);
    }
    const label = labels[upload.status] || 'Ukendt status', message = upload.message.trim();
    row.append(meta(!message || message.toLocaleLowerCase('da') === label.toLocaleLowerCase('da')
     ? label : label+' · '+message));
    uploads.panel.append(row);
   }
   if (this.uploadHistoryStatus === 'unavailable') {
    uploads.setDescription('Kunne ikke opdateres');
    uploads.panel.append(meta('Uploadhistorikken kunne ikke hentes. De viste oplysninger kan være ældre.'),
     action('Prøv igen',async()=>{await this.refreshUploadHistory();if(layout.isConnected) renderUploads();}));
   } else {
    uploads.setDescription(this.uploads.length ? this.uploads.length+' seneste uploads' : '');
    if (this.uploadHistoryStatus === 'ready' && !this.uploads.length) uploads.panel.append(meta('Der er ingen uploads endnu.'));
   }
  };
  this.renderUploadHistory = () => {if(layout.isConnected) renderUploads();};
  function jump(letter) {
   const group = groups.get(letter);
   if (group) entries.scrollTop += group.getBoundingClientRect().top - entries.getBoundingClientRect().top;
  }
  for (const letter of alphabet) {
   const button = element('button',letter);
   button.type = 'button';
   button.classList.add('text-control');
   button.addEventListener('click',()=>jump(letter));
   buttons.push(button);
   index.append(button);
  }
  function scrub(event) {
   const available = buttons.filter(button=>!button.hidden);
   const button = available.find(button=>event.clientY < button.getBoundingClientRect().bottom) || available.at(-1);
   if (!button) return;
   marker.value = button.textContent;
   marker.style.top = button.offsetTop+'px';
   marker.hidden = false;
   jump(button.textContent);
  }
  index.addEventListener('pointerdown',event=>{
   if (event.button !== 0) return;
   index.setPointerCapture(event.pointerId);
   scrub(event);
  });
  index.addEventListener('pointermove',event=>{
   if (index.hasPointerCapture(event.pointerId)) scrub(event);
  });
  index.addEventListener('lostpointercapture',()=>{marker.hidden=true;});
  function categoriesOf(recipe) { return recipe.categories?.length ? recipe.categories : ['Øvrige']; }
  const categories = [...new Set(this.saved.flatMap(categoriesOf))].sort(collator.compare);
  if (!categories.includes(this.catalogCategory)) this.catalogCategory = '';
  function updateIndex() {
   index.hidden = groups.size < 2 || entries.scrollHeight <= entries.clientHeight;
  }
  const render = () => {
   const recipes = this.saved.filter(recipe=>!this.catalogCategory || categoriesOf(recipe).includes(this.catalogCategory));
   entries.replaceChildren();
   groups.clear();
   for (const recipe of recipes.sort((a,b)=>collator.compare(a.title,b.title))) {
    const initial = recipe.title[0].toLocaleUpperCase('da');
    const letter = recipe === this.active ? 'I gang' : alphabet.includes(initial) ? initial : '#';
    if (!groups.has(letter)) {
     const group = element('section');
     if (recipe !== this.active) group.append(applyKitTextRole(element('h3',letter),'group-title'));
     groups.set(letter,group);
    }
    const row = kit('listrow', undefined, {variant: recipe === this.active ? 'resume' : undefined});
    row.dataset.recipe = recipe.title;
    if (recipe === this.active) row.setAttribute('aria-current','true');
    const copy = element('span');
    const age = Date.now() - (recipe.source?.uploadedAt ?? recipe.createdAt);
    const status = recipe === this.active ? this.sessions.get(recipe).steps.size+' af '+recipe.steps.length+' trin · Fortsæt'
     : [recipe.portions,recipe.totalTime || recipe.baking].filter(Boolean).join(' · ') || 'Gemt opskrift';
    const title = recipe.publisher ? recipe.title+' af '+recipe.publisher : recipe.title;
    if (recipe === this.active) copy.append(applyKitTextRole(element('small','I gang'),'meta'));
    copy.append(applyKitTextRole(element('strong',title),recipe === this.active ? 'section-title' : 'field-label'));
    copy.append(applyKitTextRole(element('small',
     age >= 0 && age < 7*86400000 ? 'Ny · '+status : status),'meta'));
    row.append(copy);
    const thumb = element('img');
    thumb.alt = '';
    thumb.referrerPolicy = 'no-referrer';
    thumb.src = recipe.image || 'assets/icons/image-square.svg';
    if (!recipe.image) thumb.dataset.recipeFallback = '';
    thumb.addEventListener('error',()=>{
     thumb.dataset.recipeFallback = '';
     thumb.src = 'assets/icons/image-square.svg';
    },{once:true});
    row.append(thumb);
    row.addEventListener('click',()=>{
     this.catalogScroll = entries.scrollTop;
     this.recipe(recipe);
    });
    groups.get(letter).append(row);
   }
   if (groups.has('I gang')) entries.append(groups.get('I gang'));
   alphabet.forEach((letter,i)=>{
    buttons[i].hidden = !groups.has(letter);
    if (groups.has(letter)) entries.append(groups.get(letter));
   });
   if (this.catalogStatus === 'unavailable') entries.append(meta('Kataloget kunne ikke opdateres. Åbn Opskrifter igen for at prøve igen.'));
   else if (!this.saved.length) entries.append(meta(this.catalogStatus === 'ready' ? 'Der er ingen opskrifter endnu.' : 'Henter opskrifter …'));
   const catalogHistory = this.history.filter(entry=>recipes.some(recipe=>recipe.title === entry.title
    && (!entry.sourceUrl || entry.sourceUrl === recipe.source?.url)));
   if (catalogHistory.length) {
    const rows = catalogHistory.map(({title,completedAt})=>{
     const row = kit('listrow','',{tag:'div',variant:'read-only'});
     const time = applyKitTextRole(element('time',historyDate.format(completedAt)),'meta');
     time.dateTime = new Date(completedAt).toISOString();
     row.append(applyKitTextRole(element('span',title),'body'),time);
     return row;
    });
    const history = createKitDisclosure({id:'recipe-history',title:'Senest gennemført',
     expanded:this.recipeHistoryExpanded,onToggle:expanded=>{this.recipeHistoryExpanded=expanded;}});
    history.panel.append(...rows);
    entries.append(history.node);
   }
   renderUploads();
   entries.append(uploads.node);
  };
  index.append(marker);
  layout.append(entries,index);
  if (categories.length) {
   const filters = createKitChoiceGroup({
    id:'recipe-category',label:'Kategori',variant:'navigation',
    choices:[{value:'',label:'Alle'},...categories],value:this.catalogCategory,
    onChange:value=>{
     this.catalogCategory = value;
     this.catalogScroll = 0;
     render();
     entries.scrollTop = 0;
     updateIndex();
    },
   });
   this.root.append(filters.node);
  }
  this.root.append(layout);
  render();
  updateIndex();
  this.catalogResize = new ResizeObserver(updateIndex);
  this.catalogResize.observe(entries);
  entries.scrollTop = this.active ? 0 : this.catalogScroll || 0;
  // A single bounded refresh loop belongs to this mounted catalog, not the widget host.
  const abort = new AbortController();
  let timer, inFlight = false, queued = false, historyPending = false;
  const active = () => layout.isConnected && !this.root.hidden && !document.hidden;
  const schedule = () => { clearTimeout(timer); if (active()) timer = setTimeout(run, 10000); };
  const run = async () => {
   if (abort.signal.aborted || !active()) return;
   if (inFlight) { queued = true; return; }
   clearTimeout(timer);
   inFlight = true;
   const [historyChanged, changed] = await Promise.all([
    this.refreshUploadHistory(abort.signal), this.refreshPublishedCatalog(abort.signal),
   ]);
   inFlight = false;
   if (abort.signal.aborted || !active()) return;
   if (changed) {
    const scroll = entries.scrollTop, rootScroll = this.root.scrollTop, parentScroll = this.root.parentElement.scrollTop, focused = document.activeElement;
    const retainFocus = this.root.contains(focused), focusedId = focused?.id, focusedRecipe = focused?.dataset?.recipe;
    const focusedChoice = focused?.type === 'radio' ? {name:focused.name,value:focused.value} : null;
    this.suppressPageFocus = true;
    try { this.catalog(false); } finally { this.suppressPageFocus = false; }
    this.catalogEntries.scrollTop = scroll;
    this.root.scrollTop = rootScroll;
    this.root.parentElement.scrollTop = parentScroll;
    if (retainFocus) {
     const restored = focusedChoice ? [...this.root.querySelectorAll('input[type=radio]')].find(node=>node.name === focusedChoice.name && node.value === focusedChoice.value)
      : focusedId ? [...this.root.querySelectorAll('[id]')].find(node=>node.id === focusedId)
      : focusedRecipe ? [...this.root.querySelectorAll('[data-recipe]')].find(node=>node.dataset.recipe === focusedRecipe) : null;
     (restored || this.catalogEntries).focus({preventScroll:true});
    }
    return;
   }
   // Do not replace the disclosure while a user is interacting inside it.
   historyPending ||= historyChanged;
   if (historyPending && !uploads.node.contains(document.activeElement)) { renderUploads(); historyPending = false; }
   if (queued) { queued = false; run(); } else schedule();
  };
  const visibility = () => { clearTimeout(timer); if (active()) run(); };
  const observer = new MutationObserver(visibility);
  observer.observe(this.root,{attributes:true,attributeFilter:['hidden']});
  document.addEventListener('visibilitychange',visibility);
  this.catalogRefresh = {dispose:()=>{
   clearTimeout(timer); abort.abort(); observer.disconnect();
   document.removeEventListener('visibilitychange',visibility);
  }};
  if (refresh) run(); else schedule();
 }

 checklist(title, lines, checked, unit, onChange, headingRole) {
  const count = meta('');
  count.setAttribute('role','status');
  const list = document.createElement('pv-checklist');
  list.setAttribute('aria-label',title);
  const items = lines.map((label,i)=>({label,id:unit==='trin færdige'?String(i):title+'-'+i}));
  function render() {
   count.textContent = items.filter(item=>checked.has(item.id)).length+' af '+items.length+' '+unit;
   list.data = {items,checked:[...checked],connected:true,state:'ready'};
  }
  list.addEventListener('pv-action',event=>{
   const id = event.detail?.option_id;
   if (event.detail?.action_id !== 'choose' || !items.some(item=>item.id===id)) return;
   event.stopPropagation();
   if (checked.has(id)) checked.delete(id);
   else checked.add(id);
   render();
   onChange?.();
  });
  const card = section(title,list);
  if (headingRole) {
   const heading = applyKitTextRole(element('h3',title),headingRole);
   card.firstChild.replaceChildren(heading);
  }
  card.firstChild.append(count);
  render();
  return {card,render};
 }

 recipe(recipe) {
  const session = this.sessions.get(recipe) || {ingredients:new Set(),steps:new Set()};
  this.sessions.set(recipe,session);
  const subtitle = [recipe.portions,recipe.totalTime,recipe.baking,recipe.cookingTime && recipe.cookingTime+' tilberedning',recipe.waiting].filter(Boolean).join(' · ');
  const groups = recipe.groups || [{title:'Råvarer',lines:recipe.ingredients}];
  const ingredients = createKitDisclosure({
   id:'recipe-ingredients',title:'Ingredienser',expanded:session.ingredientsExpanded ?? true,
   onToggle:expanded=>{session.ingredientsExpanded = expanded;this.persistSession();},
  });
  applyKitComponent(ingredients.node,'card');
  ingredients.node.dataset.recipeLayout = 'ingredients';
  ingredients.node.dataset.kitLayout = 'card-header';
  applyKitTextRole(ingredients.trigger.querySelector('[data-kit-slot=title]'),'section-title');
  const ingredientCount = groups.reduce((count,group)=>count+group.lines.length,0);
  ingredients.setDescription(session.ingredients.size+' af '+ingredientCount+' fundet frem');
  for (const group of groups) {
   const {card} = this.checklist(group.title,group.lines,session.ingredients,'fundet frem',
    ()=>{ingredients.setDescription(session.ingredients.size+' af '+ingredientCount+' fundet frem');this.persistSession();},'group-title');
   if (groups.length === 1) card.firstChild.hidden = true;
   ingredients.panel.append(card);
  }
  this.page(recipe.title,'',()=>this.catalog());
  const reading = element('div');
  reading.dataset.recipeLayout = 'reading';
  const progress = meta('');
  progress.setAttribute('role','status');
  const steps = element('ol');
  steps.setAttribute('role','list');
  const stepButtons = [];
  const rows = recipe.steps.map((instruction,index)=>{
   const row = element('li');
   const number = applyKitTextRole(element('span',String(index+1)+'.'),'group-title');
   number.dataset.recipeStepNumber = '';
   row.append(number);
   if (recipe.phases?.[index]) {
    row.append(applyKitTextRole(element('h3',recipe.phases[index]),'group-title'));
   }
   const copy = applyKitTextRole(element('p',instruction),'body');
   const toggle = applyKitTextRole(action(instruction,()=>{
    if (this.active !== recipe) return;
    const id = String(index);
    if (session.steps.has(id)) session.steps.delete(id);
    else session.steps.add(id);
    updateStep.call(this);

   }),'body');
   stepButtons.push({copy,toggle});
   row.append(copy,toggle);
   steps.append(row);
   return row;
  });
  const controls = element('div');
  controls.dataset.recipeLayout = 'controls';
  const advance = action('',()=>{
   if (this.active !== recipe) {
    if (this.active) {this.recipe(this.active);return;}
    this.active = recipe;
    updateStep.call(this);
    return;
   }
   if (session.steps.size !== recipe.steps.length) return;
   this.history = [{title:recipe.title,sourceUrl:recipe.source?.url,completedAt:Date.now()},...this.history].slice(0,5);
   try { localStorage.setItem(historyKey,JSON.stringify(this.history)); } catch { /* Keep the in-memory history. */ }
   this.sessions.delete(recipe);
   this.active = null;
   this.clearSession();
   this.root.dataset.cooking = 'false';
   this.catalog();
  },'primary');
  const confirm = element('dialog');
  const heading = element('h2','Nulstil opskrift?');
  heading.id = 'recipe-stop-title';
  confirm.setAttribute('aria-labelledby',heading.id);
  const header = element('header');
  header.append(heading);
  const description = meta('Alle ingrediens- og trinafkrydsninger ryddes. Opskriften bliver liggende i kataloget.');
  const actions = element('div');
  const stop = action('Nulstil opskrift',()=>confirm.showModal());
  actions.append(action('Fortsæt madlavning',()=>confirm.close()),action('Nulstil',()=>{
   confirm.close();
   this.active = null;
   this.sessions.delete(recipe);
   this.clearSession();
   this.root.dataset.cooking = 'false';
   this.catalog();
  },'primary','danger'));
  confirm.append(header,description,actions);
  applyKitDialog(confirm,{header,description,actions});
  controls.append(advance,stop);

  const method = section('Sådan gør du',steps);

  const file = recipe.source?.files[0];
  const intro = kit('hero','',{tag:'article'});
  intro.dataset.recipeLayout = 'intro';
  const summary = kit('sectionheader');
  summary.dataset.recipeLayout = 'summary';
  if (subtitle) summary.append(applyKitTextRole(element('p',subtitle),'section-title'));
  if (recipe.description) summary.append(applyKitTextRole(element('p',recipe.description),'body'));
  if (recipe.publisher) summary.append(meta('Af '+recipe.publisher));
  const age = Date.now() - (recipe.source?.uploadedAt ?? recipe.createdAt);
  if (age >= 0 && age < 7*86400000) summary.append(meta('Ny'));
  summary.append(progress);
  intro.append(summary);
  {
   if (file) this.coverUrl = URL.createObjectURL(file);
   const picture = element('img');
   picture.src = this.coverUrl || recipe.image || 'assets/icons/image-square.svg';
   if (!file && !recipe.image) picture.dataset.recipeFallback = '';
   picture.referrerPolicy = 'no-referrer';
   picture.addEventListener('error',()=>{
    picture.dataset.recipeFallback = '';
    picture.alt = '';
    picture.src = 'assets/icons/image-square.svg';
   },{once:true});
   picture.alt = file || recipe.image ? 'Originalt billede til '+recipe.title : '';
   const images = [...(recipe.source?.files || []),...new Set([recipe.image,...(recipe.images || [])].filter(Boolean))];
   if (!images.length) intro.prepend(picture);
   else {
    const gallery = element('dialog');
    gallery.dataset.recipeLayout = 'gallery';
    gallery.setAttribute('aria-label','Billeder af '+recipe.title);
    const large = element('img');
    large.referrerPolicy = 'no-referrer';
    const position = meta('');
    position.setAttribute('role','status');
    const unavailable = meta('Billedet kunne ikke indlæses.');
    unavailable.hidden = true;
    large.addEventListener('error',()=>{large.hidden = true;unavailable.hidden = false;});
    const controls = element('div');
    const open = kit('button','',{variant:'secondary'});
    open.dataset.recipeLayout = 'gallery-trigger';
    open.setAttribute('aria-haspopup','dialog');
    open.append(picture,meta(images.length === 1 ? 'Vis billede' : images.length+' billeder'));
    intro.prepend(open);
    let index = 0;
    let galleryUrl;
    const previous = kit('button','Forrige',{variant:'secondary'});
    const next = kit('button','Næste',{variant:'secondary'});
    const close = action('Luk',()=>gallery.close(),'primary');
    controls.append(previous,position,next,close);
    previous.hidden = next.hidden = position.hidden = images.length === 1;
    gallery.append(large,unavailable,controls);
    applyKitDialog(gallery,{actions:controls});
    for (const [button,offset] of [[open,0],[previous,-1],[next,1]]) {
     button.addEventListener('click',()=>{
      index = (index+offset+images.length)%images.length;
      if (galleryUrl) URL.revokeObjectURL(galleryUrl);
      const image = images[index];
      galleryUrl = typeof image === 'string' ? null : URL.createObjectURL(image);
      unavailable.hidden = true;
      large.hidden = false;
      large.alt = 'Opskriftsbillede '+(index+1);
      large.src = galleryUrl || image;
      position.textContent = (index+1)+' af '+images.length;
      if (!gallery.open) gallery.showModal();
     });
    }
    gallery.addEventListener('close',()=>{
     if (galleryUrl) URL.revokeObjectURL(galleryUrl);
     galleryUrl = null;
     index = 0;
    });
    reading.append(gallery);
   }
  }
  const facts = [];
  const origin = recipe.publisher || (recipe.source?.url ? new URL(recipe.source.url).hostname : '');
  for (const [label,value] of [['Kilde',origin],['Udbytte',recipe.portions],['Samlet tid',recipe.totalTime],['Hævning',recipe.waiting],['Bagetid',recipe.baking],['Tilberedningstid',recipe.cookingTime]]) {
   if (value) facts.push([label,value]);
  }
  for (const [label,timestamp] of [['Uploadet',recipe.source?.uploadedAt],['Tilføjet',recipe.createdAt]]) {
   if (!Number.isFinite(timestamp)) continue;
   const date = new Date(timestamp);
   const time = applyKitTextRole(element('time',new Intl.DateTimeFormat('da-DK',{dateStyle:'long'}).format(date)),'meta');
   time.dateTime = date.toISOString();
   facts.push([label,time]);
  }
  if (recipe.source?.url) facts.push(['Original URL',recipe.source.url]);
  for (const file of recipe.source?.files || []) facts.push(['Originalfil',file.name]);
  const completions = this.history.filter(entry=>entry.title === recipe.title
   && (!entry.sourceUrl || entry.sourceUrl === recipe.source?.url));
  const history = completions.map(({completedAt})=>{
   const time = applyKitTextRole(element('time',historyDate.format(completedAt)),'meta');
   time.dateTime = new Date(completedAt).toISOString();
   return ['Gennemført',time];
  });
  const columns = element('div');
  columns.dataset.recipeLayout = 'source-columns';
  for (const [heading,items] of [['Fakta',facts],['Senest gennemført',history]]) {
   if (!items.length) continue;
   const column = element('section');
   column.append(applyKitTextRole(element('h3',heading),'group-title'));
   for (const [label,value] of items) {
    const row = kit('listrow','',{tag:'div',variant:'read-only'});
    row.append(applyKitTextRole(element('span',label),'field-label'),
     typeof value === 'string' ? meta(value) : value);
    column.append(row);
   }
   columns.append(column);
  }
  reading.append(ingredients.node,method);
  const source = createKitDisclosure({
   id:'recipe-about',title:'Om opskriften',description:origin,
  });
  source.node.dataset.recipeLayout = 'source';
  if (columns.childElementCount) source.panel.append(columns);

  const deleteDialog = element('dialog');
  const deleteHeader = element('header');
  const deleteTitle = element('h2','Slet opskrift?');
  deleteTitle.id = 'recipe-delete-title';
  deleteDialog.setAttribute('aria-labelledby',deleteTitle.id);
  deleteHeader.append(deleteTitle);
  const deleteDescription = meta('»'+recipe.title+'« fjernes fra kataloget på denne enhed.');
  const deleteActions = element('div');
  const deleteError = meta('');
  deleteError.setAttribute('role','alert');
  const cancelDelete = action('Annuller',()=>deleteDialog.close());
  cancelDelete.autofocus = true;
  deleteActions.append(cancelDelete,action('Slet opskrift',()=>{
   if (recipe.source?.url && recipe.source.recipe !== recipe) {
    const deleted = new Set([...this.deleted,recipe.source.url]);
    try {
     localStorage.setItem(deletedKey,JSON.stringify([...deleted]));
    } catch {
     deleteError.textContent = 'Opskriften kunne ikke slettes. Prøv igen.';
     return;
    }
    this.deleted = deleted;
   }
   this.saved = this.saved.filter(entry=>entry !== recipe);
   this.sessions.delete(recipe);
   if (this.active === recipe) {this.active = null;this.clearSession();}
   this.root.dataset.cooking = String(Boolean(this.active));
   if (recipe.source?.recipe === recipe) {
    this.sources = this.sources.filter(entry=>entry !== recipe.source);
   }
   deleteDialog.close();
   this.catalog();
  },'primary','danger'));
  deleteDialog.append(deleteHeader,deleteDescription,deleteError,deleteActions);
  applyKitDialog(deleteDialog,{header:deleteHeader,description:deleteDescription,actions:deleteActions});
  source.panel.append(action('Slet opskrift',()=>{
   deleteError.textContent = '';
   deleteDialog.showModal();
  },'quiet'),deleteDialog);
  reading.append(source.node);
  intro.append(controls);
  this.root.append(intro);
  this.root.append(reading,confirm);

  function updateStep() {
   const active = this.active === recipe;
   const index = recipe.steps.findIndex((_,i)=>!session.steps.has(String(i)));
   this.root.dataset.cooking = String(Boolean(this.active));
   progress.textContent = active
    ? index < 0 ? 'Alle trin færdige' : 'Trin '+(index+1)+' af '+rows.length
    : rows.length+' trin';
   for (const [i,row] of rows.entries()) {
    const current = active && i===index;
    if (current) row.setAttribute('aria-current','step');
    else row.removeAttribute('aria-current');
    const completed = session.steps.has(String(i));
    row.dataset.completed = String(completed);
    const {copy,toggle} = stepButtons[i];
    toggle.hidden = !active;
    copy.hidden = !toggle.hidden;
    toggle.setAttribute('aria-pressed',String(completed));
   }
   stop.hidden = !active;
   advance.hidden = active && index >= 0;
   advance.textContent = active
    ? 'Afslut madlavning'
    : this.active ? 'Fortsæt '+this.active.title : 'Start opskrift';
   this.persistSession();
   this.onCookingChange();
  }
  this.readingRecipe = recipe;
  updateStep.call(this);
  if (this.active === recipe && session.scroll) this.root.scrollTop = session.scroll;

 }

 showSource(panel, source) {
  if (source.url) {
   const link = element('a','Åbn originalt link');
   link.href = source.url;
   link.target = '_blank';
   link.rel = 'noopener noreferrer';
   panel.append(link);
  }
  for (const file of source.files) panel.append(meta(file.name));
 }

 inbox() {
  this.page('Indbakke','Lokale kilder',()=>this.catalog(),action('Tilføj kilde',()=>this.importSource(),'primary'));
  if (!this.sources.length) this.root.append(section('Ingen kilder endnu',meta('Tilføj et link eller billeder af en opskrift.')));
  for (const source of this.sources) {
   const row = createKitDisclosure({id:'recipe-source-'+source.id,title:source.title,
    description:source.recipe?'Gemt i kataloget':'Klar til gennemgang'});
   this.showSource(row.panel,source);
   row.panel.append(source.recipe?action('Åbn opskrift',()=>this.recipe(source.recipe)):action('Tilføj opskriftstekst',()=>this.importSource(source)));
   this.root.append(row.node);
  }
 }

 importSource(source) {
  this.page(source?'Tilføj opskriftstekst':'Tilføj kilde','Gemmes i denne browservisning',()=>this.inbox());
  const form = element('form');
  const feedback = meta('');
  feedback.setAttribute('role','status');
  const fields = {};
  const schema = source
   ? [['title','Titel','input'],['ingredients','Ingredienser · én pr. linje','textarea'],['steps','Fremgangsmåde · ét trin pr. linje','textarea']]
   : [['url','Link til original','input'],['files','Billeder af original','input']];
  for (const [key,label,tag] of schema) {
   const control = element(tag);
   const wrapper = element('label',label);
   if (key==='url') control.type='url';
   if (key==='files') {control.type='file';control.accept='image/*';control.multiple=true;}
   wrapper.append(control);
   fields[key] = control;
   form.append(wrapper);
  }
  const submit = kit('button',source?'Gem opskrift':'Gem kilde',{variant:'primary'});
  submit.type = 'submit';
  form.append(submit,feedback);
  form.addEventListener('submit',event=>{
   event.preventDefault();
   if (source) {
    const title = fields.title.value.trim();
    const ingredients = fields.ingredients.value.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
    const steps = fields.steps.value.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
    if (!title || !ingredients.length || !steps.length) {feedback.textContent='Udfyld titel, ingredienser og fremgangsmåde.';return;}
    source.title = title;
    source.recipe = {title,ingredients,steps,source,createdAt:Date.now()};
    this.saved.push(source.recipe);
   } else {
    const url = fields.url.value.trim();
    const files = [...fields.files.files];
    if (!url && !files.length) {feedback.textContent='Tilføj et link eller mindst ét billede.';return;}
    if (url && !/^https?:\/\//i.test(url)) {feedback.textContent='Brug et link, der starter med https:// eller http://.';return;}
    if (url && this.sources.some(entry=>entry.url===url)) {feedback.textContent='Linket ligger allerede i indbakken.';return;}
    if (files.some(file=>!file.type.startsWith('image/'))) {feedback.textContent='Vælg filer i et billedformat.';return;}
    this.sources.push({id:this.sources.length+1,title:files[0]?.name || new URL(url).hostname,url,files,uploadedAt:Date.now()});
   }
   this.inbox();
  });
  if (source) {
   const original = section('Original');
   this.showSource(original,source);
   this.root.append(original);
  }
  this.root.append(section(source?'Opskrift':'Original',form));
 }
}
