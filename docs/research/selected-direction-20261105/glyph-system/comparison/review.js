import { KIT_COMPONENTS } from '/ui/kit.js';
import { productLibrary } from '/library-catalog.js';

const $ = id => document.getElementById(id);
const components = KIT_COMPONENTS.map(component => ({
    ...component, key: component.id, kind: 'components', description: component.anatomy
}));
const templates = [
    { key: 'detail', name: 'Detaljeskabelon', description: 'Topbar, status, valg og historik i en fælles ramme.' },
    { key: 'response', name: 'Svarskabelon', description: 'Svarindhold, uddybning og handlinger i en fælles ramme.' }
].map(template => ({ ...template, kind: 'templates' }));
const screens = productLibrary.map(family => ({ ...family, key: family.id, kind: 'screen' }));
const weatherFamily = screens.find(family => family.key === 'weather');
if (weatherFamily) weatherFamily.states = [...weatherFamily.states, ...[
    ['sunny','Sol'], ['clear-night','Klar nat'], ['cloudy','Skyet'], ['rainy','Regn'],
    ['snowy','Sne'], ['fog','Tåge'], ['windy','Blæst'], ['lightning','Torden']
].map(([weatherCondition,label]) => ({id:'material-weather-'+weatherCondition, stage:'weather-ready',
    label:label+' · materialeeksempel', weatherCondition}))];
const extra = [
    { key: 'recipes', name: 'Opskrifter', description: 'Eksisterende katalog, ingredienser og trin. Eksempeldata er syntetiske og ens i begge kolonner.', states: [{ id: 'recipes-example', stage: 'nothing', label: 'Syntetisk katalog · kort og lang opskrift', open: '#home-recipes', recipeFixture: 'example' }, { id: 'recipes', stage: 'nothing', label: 'Katalog uden forbindelse', open: '#home-recipes' }] },
    { key: 'setup', name: 'Forbind PodView', description: 'Den eksisterende formular til enhedsadgang.', states: [{ id: 'setup', path: '/setup.html', label: 'Før forbindelse' }] }
].map(entry => ({ ...entry, kind: 'screen' }));

const experiments = [
    {
        key: 'material', name: 'Materiale og tilstand',
        description: 'Mønsteret er et ekstra lag i den eksisterende statusflade.',
        examples: [['weather', 'weather-ready', 'Vejr · kendt tilstand'], ['robot', 'robot-detail-cleaning', 'Robot · observeret rengøring'], ['robot', 'robot-detail-offline', 'Robot · offline'], ['lights', 'hue-kitchen', 'Lys · kendt tændt status'], ['timer', 'timer-detail-running', 'Timer · aktivt ur']],
        notes: [['Forslag', 'Brug ét domænemønster i et afgrænset felt. Vejrformen følger tilstanden. Robot bruger samme buede celleidentitet i hvile og aktivitet. Lysmaterialets vægt følger observeret lysstyrke; rum og overblik får kun et numerisk niveau, når alle relevante lamper deler samme kendte niveau. Ingen gennemsnitsprocent beregnes.'], ['Tilstandsregel', 'Bevar tekst og målte værdier. Ved ukendt eller forældet status vises en rolig flade. En igangværende handling beholder den senest observerede tilstand.'], ['Bevægelse', 'Normal bevægelse er standard. Robot viser et sweep under observeret rengøring og falder til ro ved pause eller pending. Tesla viser energibaner ved gyldig opladning. Lysniveau og lokale trinvalg får korte overgange; vejret viser den kendte tilstands form. Ukendt eller forældet status giver ingen aktivitetsbevægelse. Reduceret bevægelse er en alternativ visning.']]
    },
    {
        key: 'small-family', name: 'Én Small-familie',
        description: 'Lys, Tesla, Find musik, Radio, Opskrifter og Timer deler samme forslag til plads og hierarki.',
        examples: [['composition', 'nothing', 'Overblik uden aktiv timer'], ['composition', 'conversation-overview', 'Overblik med aktiviteter']],
        notes: [['Forslag', 'Giv de seks widgets samme fodaftryk på overblikket i den brede visning. Vejr og Robot kan bruge de større formater.'], ['Placering', 'Det eksisterende ikon og navn ejer genkendelsen. Timeren beholder samme Small-plads gennem hvile og aktivitet i kandidatens brede og tabletkomposition.']]
    },
    {
        key: 'interaction', name: 'Valg, handling og feedback',
        description: 'Samme kontrol skal bevare sit navn, sin plads og sin betydning gennem et tilstandsskift.',
        examples: [['lights', 'hue-kitchen', 'Lys · rumvalg og tænd/sluk'], ['robot', 'robot-detail-pending', 'Robot · afventer'], ['answer-sourced-image', 'answer-sourced-image-image-failure', 'Svar · billedet mangler']],
        notes: [['Handling', 'Det aktiverede mål viser feedback. Bevar observeret tilstand, indtil ejeren melder et nyt resultat.'], ['Valg', 'Rumvalg navigerer, og et powerfelt betjener. Handlingsknapper er fælles neutrale: mørk primær og lys sekundær; på mørkt instrument bruges lys primær og mørk sekundær. Domænefarve hører til identitet, materiale og status. Fare og fejl har særskilt semantik.'], ['Fejl', 'Bevar brugbart indhold. Vis genforsøg, når den eksisterende ejer tilbyder det.']]
    }
].map(rule => ({
    ...rule,
    kind: 'screen',
    states: rule.examples.flatMap(([family, stage, label]) => {
        const state = screens.find(entry => entry.key === family)?.states.find(item => item.stage === stage);
        return state ? [{ ...state, label }] : [];
    })
}));

const one = (parent, selector) => parent.querySelector(selector);
const byId = id => document.getElementById(id);
const overview = {
    key: 'small-family', kind: 'screen', name: 'Overblik i kode',
    description: 'Faste Small-pladser gennem hvile og aktivitet. Samme lokale data i begge kolonner; ingen enheder betjenes.',
    states: [
        { id: 'design-overview', label: 'Valgt designreference', stage: 'robot-overview-docked', reference: 'overview' },
        { id: 'design-active', label: 'Robot, Tesla og timer aktive · eksempel', stage: 'activities-combined' },
        { id: 'design-paused', label: 'Timer pauset · eksempel', stage: 'timer-overview-paused' },
        { id: 'design-finished', label: 'Timer færdig · eksempel', stage: 'timer-overview-finished' }
    ]
};
const smallWidgets = [
    ['light','Lys','light-overview-on'], ['tesla','Tesla','activities-combined'],
    ['music','Find musik','robot-overview-docked'], ['radio','Radio','robot-overview-docked'],
    ['recipes','Opskrifter','robot-overview-docked'], ['timer','Timer','timer-overview-empty']
].map(([widgetSpecimen,name,stage]) => ({key:'small-'+widgetSpecimen, name, kind:'screen', widgetSpecimen,
    description:'Den eksisterende widget i Small. Samme lokale tilstand i begge kolonner.',
    states:[{id:'small-'+widgetSpecimen,stage,label:'Small · lokalt eksempel',widgetSpecimen}]}));
const sections = [
    ['widgets', smallWidgets],
    ['komponenter', components],
    ['skabeloner', templates],
    ['skaerme', [...screens, ...extra]],
    ['regler', experiments]
];
const template = byId('pair-template');
const lazy = new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
        if (!isIntersecting) continue;
        lazy.unobserve(target);
        target.dispatchEvent(new Event('mount-preview'));
    }
}, { rootMargin: '260px' });

function renderNotes(article, notes = []) {
    const target = one(article, '.notes');
    target.hidden = notes.length === 0;
    for (const [label, copy] of notes) {
        const row = document.createElement('p');
        const strong = document.createElement('strong');
        strong.textContent = label + ' · ';
        row.append(strong, copy);
        target.append(row);
    }
}

function addPair(parent, entry, id, eager = false) {
    const article = template.content.firstElementChild.cloneNode(true);
    article.id = id;
    const title = one(article, 'h3');
    title.id = id + '-title';
    title.textContent = entry.name;
    article.setAttribute('aria-labelledby', title.id);
    one(article, '.description').textContent = entry.description;
    const stateField = one(article, '.state-field');
    const stateSelect = one(article, '.state');
    const widthSelect = one(article, '.width');
    const motionSelect = one(article, '.motion');
    const reset = one(article, '.reset');
    const status = one(article, '.status');
    const frames = [...article.querySelectorAll('iframe')];
    const previews = frames.map(frame => frame.parentElement);
    frames.forEach(frame => frame.remove());
    const screen = entry.kind === 'screen';
    let active = false;
    let run = 0;
    let variantObservers = [];
    let labels = [];
    if (screen) {
        stateSelect.replaceChildren(...entry.states.map(state => new Option(state.label, state.id)));
        if (entry.key === 'composition') stateSelect.value = entry.states.find(state => state.stage === 'nothing').id;
    }
    stateField.hidden = !screen || entry.states.length < 2;
    one(article, '.width-field').hidden = !screen || !!entry.widgetSpecimen;
    article.toggleAttribute('data-screen', screen);
    reset.disabled = true;
    status.textContent = 'Indlæses, når eksemplet kommer i syne';
    renderNotes(article, entry.notes);
    parent.append(article);

    function fit() {
        if (screen) {
            const cropped = entry.widgetSpecimen && !frames.some(frame => {
                const root = frame.contentDocument?.documentElement;
                return root && frame.contentDocument.querySelector('pv-widget-host') && !root.hasAttribute('data-widget-specimen');
            });
            const width = cropped ? 320 : Number(widthSelect.value);
            const height = cropped ? 217 : 800;
            for (const [index, frame] of frames.entries()) {
                const preview = previews[index];
                const scale = Math.min(1, preview.clientWidth / width);
                frame.style.width = width + 'px';
                frame.style.height = height + 'px';
                frame.style.transform = 'scale(' + scale + ')';
                preview.style.height = (height * scale) + 'px';
            }
        } else if (active) {
            const height = Math.max(200, ...frames.map(frame => {
                const stage = frame.contentDocument?.querySelector('.kit-specimen:not([hidden]) .kit-specimen-stage');
                return Math.ceil((stage?.getBoundingClientRect().bottom ?? 0) + 16);
            }));
            for (const frame of frames) frame.style.height = height + 'px';
        }
    }

    function showVariant() {
        const index = Number(stateSelect.value || 0);
        for (const frame of frames) {
            const doc = frame.contentDocument;
            const samples = doc?.querySelectorAll('.kit-specimen');
            if (!samples?.length) continue;
            samples.forEach((sample, i) => { sample.hidden = i !== index; });
            doc.body.dataset.specimenReady = 'true';
        }
        fit();
    }

    function load() {
        const epoch = ++run;
        let ready = 0;
        labels = [];
        variantObservers.forEach(observer => observer.disconnect());
        variantObservers = [];
        reset.disabled = true;
        status.textContent = 'Åbner begge visninger…';
        const state = entry.states?.find(item => item.id === stateSelect.value) ?? entry.states?.[0];
        for (const frame of frames) {
            const design = frame.dataset.version;
            const params = new URLSearchParams({ design, run: epoch, motion: motionSelect.value });
            if (state?.stage) params.set('stage', state.stage);
            if (state?.open) params.set('open', state.open);
            if (state?.reference) params.set('reference', state.reference);
            if (state?.recipeFixture) params.set('recipeFixture', state.recipeFixture);
            if (state?.weatherCondition) params.set('weatherCondition', state.weatherCondition);
            if (state?.widgetSpecimen) { params.set('widgetSpecimen', state.widgetSpecimen); params.set('size', 's'); }
            if (!screen) params.set('specimen', '1');
            const path = screen
                ? (state?.path ?? '/index.html') + '?' + params
                : '/library.html?' + params + '#level=' + entry.kind + '&recipe=' + entry.key;
            frame.title = entry.name + ' · ' + (design === 'current' ? 'Nuværende' : 'Ny retning');
            const open = one(frame.closest('.side'), '.open');
            open.href = path;
            open.hidden = !screen;
            frame.onload = () => {
                const doc = frame.contentDocument;
                if (run !== epoch || !doc || new URL(doc.URL).searchParams.get('run') !== String(epoch)) return;
                if (entry.widgetSpecimen) {
                    const observer = new MutationObserver(fit);
                    observer.observe(doc.documentElement, {attributes:true, attributeFilter:['data-widget-specimen']});
                    variantObservers.push(observer);
                }
                if (!screen) {
                    const found = [...doc.querySelectorAll('.kit-specimen > h2')].map(heading => heading.textContent);
                    if (!found.length) {
                        status.textContent = 'Komponenteksemplet kunne ikke indlæses.';
                        reset.disabled = false;
                        return;
                    }
                    if (!labels.length) {
                        const previous = stateSelect.value;
                        labels = found;
                        stateSelect.replaceChildren(...labels.map((label, i) => new Option(label, String(i))));
                        if (previous && Number(previous) < labels.length) stateSelect.value = previous;
                        stateField.hidden = labels.length < 2;
                    }
                    showVariant();
                    const observer = new ResizeObserver(fit);
                    observer.observe(doc.querySelector('#kit-specimens'));
                    variantObservers.push(observer);
                }
                if (++ready === frames.length) {
                    status.textContent = screen
                        ? 'Lokale eksempeldata · lydløs afprøvning'
                        : 'Samme variant i begge kolonner';
                    reset.disabled = false;
                    fit();
                }
            };
            frame.src = path;
        }
    }

    function mount() {
        if (active) return;
        active = true;
        frames.forEach((frame, i) => previews[i].append(frame));
        load();
    }

    fit();
    new ResizeObserver(fit).observe(one(article, '.comparison'));
    stateSelect.addEventListener('change', () => {
        if (!active) mount();
        else if (screen) load();
        else showVariant();
    });
    widthSelect.addEventListener('change', fit);
    motionSelect.addEventListener('change', () => active ? load() : mount());
    reset.addEventListener('click', load);
    if (eager) mount();
    else {
        article.addEventListener('mount-preview', mount, { once: true });
        lazy.observe(article);
    }
}

addPair(byId('overview-preview'), overview, 'small-family', true);
for (const [sectionId, entries] of sections) {
    const parent = one(byId(sectionId), '.entries');
    for (const entry of entries) addPair(parent, entry, 'eksempel-' + entry.key);
}

for (const [name, file] of [
    ['Lys', '02-lights.png'], ['Aktiv Robot', '03-robot-active.png'], ['Komponenttilstande', '04-component-states.png']
]) {
    const figure = document.createElement('figure');
    figure.className = 'reference';
    const link = document.createElement('a');
    link.href = './references/' + file;
    link.target = '_blank';
    link.rel = 'noopener';
    const image = new Image();
    image.loading = 'lazy';
    image.src = link.href;
    image.alt = 'Valgt designreference · ' + name;
    link.append(image);
    const caption = document.createElement('figcaption');
    caption.textContent = name;
    figure.append(link, caption);
    byId('references').append(figure);
}

const navigation = [...byId('catalog').querySelectorAll('a')];
function updateNavigation() {
    const sectionsInOrder = navigation.map(link => document.querySelector(link.hash));
    const boundary = one(document, '.masthead').getBoundingClientRect().bottom + 40;
    const current = sectionsInOrder.findLast(section => section.getBoundingClientRect().top <= boundary) ?? sectionsInOrder[0];
    for (const link of navigation) {
        if (link.hash === '#' + current.id) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
    }
}

if (location.hash.startsWith('#item=')) {
    const legacy = new URLSearchParams(location.hash.slice(1)).get('item');
    const id = legacy === 'small-family' ? 'overblik' : 'eksempel-' + legacy;
    const target = byId(id);
    if (target) {
        history.replaceState(null, '', '#' + id);
        target.scrollIntoView();
    }
}
window.addEventListener('scroll', updateNavigation, { passive: true });
updateNavigation();
