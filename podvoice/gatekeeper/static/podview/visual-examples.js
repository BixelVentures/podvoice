// Explicit examples only. No invented statistics about real people or live calendars.
const source = (scope) => [{id:'example',label:'Om eksemplet',url:'example-sources.html',scope}];
export const visualExamples = {
 'fact-card': {title:'Kampen i overblik',meta:'Fiktiv kamp · eksempeldata',content:{summary:'Tre tal gør det lettere at få overblik over kampen.',facts:[
  {id:'score',label:'Resultat',value:'2–1',detail:'Hjemmeholdet · udeholdet',sourceId:'example'},
  {id:'shots',label:'Afslutninger',value:'12 / 8',detail:'Hjemmeholdet / udeholdet',sourceId:'example'},
  {id:'possession',label:'Boldbesiddelse',value:'58 / 42 %',detail:'Hjemmeholdet / udeholdet',sourceId:'example'}
 ],sources:source('Fiktive hold og tal til afprøvning af visningen. Ingen kampdata er hentet.')}},
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
