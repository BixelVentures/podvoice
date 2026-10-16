// Explicit saved examples only. The fact example cites public NASA data; none is a live PodVoice response.
const source = (scope) => [{id:'example',label:'Om eksemplet',url:'example-sources.html',scope}];
export const visualExamples = {
 'fact-card': {title:'Hvor langt er der til Månen?',meta:'Kildebaseret eksempel · NASA',content:{summary:'Afstanden varierer, fordi Månens bane ikke er en perfekt cirkel.',facts:[
  {id:'average-distance',label:'Gennemsnitlig afstand',value:'384.400 km',detail:'Mellem Jorden og Månen. Gennemsnit, ikke afstanden lige nu.',sourceId:'nasa-moon'}
 ],sources:[{id:'nasa-moon',label:'NASA · How Far Away Is the Moon?',url:'https://spaceplace.nasa.gov/moon-distance/en/',scope:'Offentlig NASA-forklaring kontrolleret 15. oktober 2026. Gemt eksempel, ikke et liveopslag fra PodVoice.'}]}},
 'sourced-image': {title:'En pause ved vandet',meta:'Billede med forklaring og kilde',content:{summary:'Et billede kan give et svar noget, ordene alene ikke viser.',image:{url:'assets/lake.png',alt:'Illustration af en stille sø med bjerge og en rosa aftenhimmel.',caption:'Farverne i himlen spejler sig i den rolige sø.',credit:'PodView · AI-genereret eksempelbillede',kind:'illustration',sourceId:'example'},sources:source('Genereret illustration fra prototypen. Viser ikke et dokumenteret sted eller en aktuel hændelse.')}},
 'answer-timeline': {title:'En rolig morgen',meta:'Planlagt forløb · eksempeldata',content:{summary:'Det næste er nemmere at se, når rækkefølgen er tydelig.',events:[
  {id:'breakfast',time:'07.00',label:'Morgenmad sammen',detail:'Plads til en rolig start ved bordet.',status:'planned',sourceId:'example'},
  {id:'ready',time:'07.25',label:'Tasker og overtøj',detail:'Find det, der skal med.',status:'planned',sourceId:'example'},
  {id:'leave',time:'07.45',label:'Ud ad døren',detail:'Klar til dagens første tur.',status:'planned',sourceId:'example'}
 ],sources:source('En foreslået eksempelplan. Ingen kalender eller familiens aftaler er tilsluttet.')}},
 'simple-diagram': {title:'Ét spørgsmål. To udtryk.',meta:'Sådan er samspillet tænkt',content:{summary:'PodVoice ejer samtalen. PodView gør svaret lettere at se.',nodes:[
  {id:'question',label:'Du spørger',detail:'Med stemmen ved Voice PE.',sourceId:'example'},
  {id:'voice',label:'PodVoice svarer',detail:'Finder oplysninger og giver det talte svar.',sourceId:'example'},
  {id:'view',label:'PodView viser',detail:'Samme svar får en relevant visning på skærmen.',sourceId:'example'}
 ],sources:source('Foreslået samspil. Den lokale prototype er endnu ikke forbundet til PodVoice.')}}
};

// Household-shaped saved QA history. No receipt IDs, live flags or owner authority.
const householdSource=scope=>[{id:'example',label:'PodView · lokalt eksempel',url:'example-sources.html',scope}];
export const visualHistoryExamples={
 'fact-card':{title:'Kaffe til morgenbordet',meta:'Faktakort · eksempel',content:{summary:'Til én kop filterkaffe.',facts:[{id:'water',label:'Vand',value:'250 ml',detail:'Bruges til at brygge kaffen.',sourceId:'example'},{id:'coffee',label:'Kaffe',value:'15 g',detail:'Justér mængden efter smag.',sourceId:'example'}],sources:householdSource('Lokalt opskriftseksempel til designprøve. Ingen køkkenvægt eller kaffemaskine er tilsluttet.')}},
 'sourced-image':{title:'Musik til en rolig morgen',meta:'Billede med kilde · eksempel',content:{summary:'En illustration til en rolig akustisk stemning.',image:{url:'assets/morning-acoustic.png',alt:'En kop kaffe og frugt ved et solfyldt vindue med udsigt over vandet.',caption:'Morgenstemning i PodView. Ikke nummerets albumomslag.',credit:'PodView · eksisterende AI-genereret eksempelillustration',kind:'illustration',sourceId:'example'},sources:householdSource('Eksisterende prototypeillustration. Intet nyt modelkald; ikke et live PodVoice-billedsvar.')}},
 'answer-timeline':{title:'En rolig morgen sammen',meta:'Tidslinje · eksempel',content:{summary:'Et eksempel på rækkefølgen før dagen begynder.',events:[{id:'breakfast',time:'07.00',label:'Morgenmad ved bordet',detail:'Plads til at spise i ro.',status:'planned',sourceId:'example'},{id:'ready',time:'07.25',label:'Tasker og overtøj',detail:'Find det, der skal med.',status:'planned',sourceId:'example'},{id:'leave',time:'07.45',label:'Ud ad døren',detail:'Et planlagt eksempel, ikke en kalenderaftale.',status:'planned',sourceId:'example'}],sources:householdSource('Lokal eksempelplan. Familiens kalender og aftaler er ikke tilsluttet.')}},
 'simple-diagram':{title:'Fra spørgsmål til visuelt svar',meta:'Enkelt diagram · eksempel',content:{summary:'Princippet bag PodVoice og PodView.',nodes:[{id:'voicepe',label:'Du spørger ved Voice PE',detail:'Din stemme starter den almindelige samtale.',sourceId:'example'},{id:'podvoice',label:'PodVoice behandler spørgsmålet',detail:'Eksisterende værktøjer kan levere kildebundne oplysninger.',sourceId:'example'},{id:'podview',label:'PodView viser svaret',detail:'Illustreret princip. Dette diagram er gemt eksempelindhold.',sourceId:'example'}],sources:householdSource('Lokal principskitse for produktets samspil. Ikke en aktuel systemstatus eller et live PodVoice-diagramsvar.')}}
};

// Selected visual-explanation design: saved educational example, not a live producer.
const bicycleExplanation={title:'Gear ændrer, hvor let du træder.',meta:'Gemt forklaring · AI-illustration',content:{summary:'Et lavt gear gør det lettere at træde op ad bakke.',illustration:{url:'assets/bicycle-drivetrain-illustration.png',alt:'AI-illustration af cyklens baghjul, kæde og pedaler, set fra siden.',caption:'AI-genereret illustration · principskitse, ikke en teknisk tegning.',credit:'PodView · AI-genereret eksempel',kind:'illustration',sourceId:'bicycle-art'},nodes:[
 {id:'pedals',label:'Pedaler',detail:'Du træder og drejer kranken.',sourceId:'rei-gears'},
 {id:'chain',label:'Kæde',detail:'Kæden forbinder tandhjulene foran og bagpå.',sourceId:'rei-gears'},
 {id:'wheel',label:'Baghjul',detail:'Gearvalget ændrer forholdet mellem pedaltråd og hjulets omdrejninger.',sourceId:'rei-gears'}
],sources:[{id:'rei-gears',label:'REI · Bike gears and shifting',url:'https://www.rei.com/learn/expert-advice/bike-gears-and-shifting.html',scope:'Gemt dansk forklaring baseret på REI Expert Advice, kontrolleret 16. oktober 2026. Ikke et liveopslag.'},{id:'bicycle-art',label:'Om illustrationen',url:'example-sources.html',scope:'AI-genereret eksempelillustration til denne lokale designprøve. Mekaniske detaljer er forenklede; ikke dokumentation eller en teknisk tegning.'}]}};
visualExamples['simple-diagram']=bicycleExplanation;
visualHistoryExamples['simple-diagram']=structuredClone(bicycleExplanation);
