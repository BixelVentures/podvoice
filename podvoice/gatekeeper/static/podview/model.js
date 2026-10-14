export const PEOPLE = ['Familien', 'Mads', 'Sofie', 'Frida', 'Svend'];
export const RECIPES = [
 {id:'pasta',title:'Pasta med tomat og mozzarella',time:20,tone:'tomato',description:'En enkel favorit med sød tomatsauce og frisk mozzarella.',ingredients:['Pasta','Tomater','Mozzarella','Basilikum'],steps:['Sæt vand over, og kog pastaen.','Lad tomaterne simre med lidt olie i 10 minutter.','Vend pastaen i saucen. Tilføj mozzarella og basilikum.']},
 {id:'salmon',title:'Laks med ovnkartofler',time:30,tone:'sage',description:'Alt på én plade. God tid til at være sammen imens.',ingredients:['Laks','Kartofler','Broccoli','Citron'],steps:['Tænd ovnen på 200 °C. Skær kartoflerne i både.','Bag kartoflerne i 15 minutter.','Tilføj laks og broccoli, og bag videre, til det er færdigt.']},
 {id:'wraps',title:'Tortillas, som I selv fylder',time:25,tone:'ochre',description:'Stil fyldet på bordet, og lad alle vælge selv.',ingredients:['Tortillas','Bønner','Majs','Avocado'],steps:['Gør grøntsagerne klar i små skåle.','Varm bønner og tortillas.','Saml ved bordet, og lad alle vælge deres fyld.']}
];
export function initialState(){return {distance:'far',viewer:'Familien',speaker:'Mads',connected:true,screen:'home',task:null,generation:0,notice:''};}
export function transition(s,event){
 const n={...s,notice:''};
 switch(event.type){
 case 'distance': if(['far','near'].includes(event.value))n.distance=event.value; break;
 case 'viewer': if(PEOPLE.includes(event.value))n.viewer=event.value; break;
 case 'speaker': if(PEOPLE.includes(event.value))n.speaker=event.value; break;
 case 'connection': n.connected=!!event.value; if(!n.connected)n.notice='Forbindelsen er afbrudt. Indholdet bliver stående.';break;
 case 'start':
  if(!s.connected){n.notice='Genopret forbindelsen for at starte.';break;}
  if(s.task){n.notice='Afslut eller overtag den aktive opgave først.';break;}
  n.generation=s.generation+1;n.task={id:'demo-'+n.generation,revision:1,owner:s.speaker,kind:'recipe',recipe:null,step:0};n.screen='choices';n.distance='near';break;
 case 'select':
  if(!s.connected){n.notice='Valget kan ikke sendes. Genopret forbindelsen.';break;}
  if(!s.task||event.taskId!==s.task.id||event.revision!==s.task.revision){n.notice='Det valg hører til en tidligere visning.';break;}
  if(!RECIPES.some(r=>r.id===event.recipeId)){n.notice='Forslaget findes ikke.';break;}
  n.task={...s.task,recipe:event.recipeId,step:0,revision:s.task.revision+1};n.screen='recipe';break;
 case 'step':
  if(!s.connected||!s.task||s.task.id!==event.taskId||s.task.revision!==event.revision){n.notice='Trinnet kunne ikke opdateres. Kontrollér forbindelsen og visningen.';break;}
  {const r=RECIPES.find(r=>r.id===s.task.recipe);if(r)n.task={...s.task,step:Math.max(0,Math.min(r.steps.length-1,s.task.step+event.delta)),revision:s.task.revision+1};}break;
 case 'takeover':
  if(!s.connected||!s.task){n.notice='Opgaven kan ikke overtages lige nu.';break;}
  n.task={...s.task,owner:s.viewer,revision:s.task.revision+1};n.speaker=s.viewer;n.notice='Opgaven er nu '+s.viewer+'s. Indholdet er bevaret.';break;
 case 'finish': n.task=null;n.screen='home';n.generation=s.generation+1;break;
 case 'home': if(s.task)n.notice='Afslut samtalen for at gå tilbage.';else n.screen='home';break;
 case 'memory': if(s.task)n.notice='Afslut samtalen for at åbne favoritter.';else {n.screen='memory';n.distance='near';}break;
 }
 return n;
}
export function canRemember(s){return s.connected&&s.screen==='recipe'&&!!s.task?.recipe;}
