const states=[
 ['timers','Timere','Vælg en fast tid eller brug plus/minus. Navn og præcise sekunder er sekundære.'],
 ['fact-card','Faktakort','Få relevante tal, forklaring og kilder. Her er tallene fiktive eksempeldata.'],
 ['sourced-image','Billede med kilde','Et billede med alternativ tekst, forklaring, kreditering og kilde.'],
 ['answer-timeline','Tidslinje','Et forløb med tydelig forskel på planlagte og registrerede hændelser.'],
 ['simple-diagram','Enkelt diagram','Et kort forløb, der forklarer sammenhængen med læsbar tekst.'],
 ['quiet','Ro uden musik','Foto, ur og vejr. Ingen afspiller uden en aktiv eller pauset afspilning.'],
 ['weather','Vejr','Tryk på temperaturen åbner vejrudsigten. Timer og musik fortsætter. Tilbage vender tilbage til opgaven.'],
 ['top','Topsange','Et afgrænset udvalg fra den tilsluttede konto. Ingen opdigtede afspilningstal eller fuld historik.'],
 ['stack','Sammen i gang','Timeren får fokus. Robot og lys står sammen nedenunder; musikken har sin faste plads til højre. Tryk for detaljer.'],
 ['music-stack','Musik + aktiviteter','Musikforslag leder. De samme aktiviteter bliver kompakte, genkendelige widgets nedenunder.'],
 ['rest','Ro','Fotografiet fylder. Tid, dato og vejr kan aflæses på afstand. Musik bliver kompakt.'],
 ['nothing','Ingen aktiviteter','Vis en rolig, færdig tomtilstand. Musikken er stadig tilgængelig. Intet opdigtet dashboard fylder pladsen.'],
 ['listening','Lytter','En lille midlertidig status fra Voice PE. Fotoet og aktiviteterne bliver, indtil der er nyttigt indhold at vise.'],
 ['music','Musikvalg','Hele rækken er en trykflade. Et valg beholder sit ID, uanset om det vælges med tale eller touch.'],
 ['waiting','Afventende','Fortæl kort, hvad der sker. Bevar musikken og timeren; vis ingen kunstig procent eller uendelig dekorativ aktivitet.'],
 ['partial','Første del','Vis det nyttige med det samme. Gør det tydeligt, at mere er på vej. Vent med valg, til de er gyldige.'],
 ['ready','Kort svar','Et kort, nyttigt svar om vejret. Åbn vejrudsigten for mere indsigt.'],
 ['empty','Tomt resultat','Et tomt resultat er et svar. Forklar det og giv én vej videre; ingen tomme skeletter eller opdigtede forslag.'],
 ['error','Svaret fejlede','Bevar resten af skærmen. En konkret besked og Prøv igen. Fejl skal ikke overtage musik eller timer.'],
 ['pending','Handling afventer','Vis at anmodningen er sendt. Bevar sidste kendte afspilning, indtil resultatet er observeret. Ingen dobbeltklik eller falsk succes.'],
 ['offline','Forbindelse afbrudt','Bevar sidste kendte indhold. Blokér fjernhandlinger. Den lokale timer kan fortsætte. Genforbindelse må ikke gentage gamle klik.'],
 ['connecting','Genforbinder','Bevar indhold og bloker fjernhandlinger, indtil et autoritativt snapshot er hentet. Ingen automatisk gentagelse.'],
 ['ended','Samtalen slut','Samtalen slutter; svaret og ressourcerne bliver. En samtaleafslutning er ikke en annullering af timer eller musik.'],
 ['paused','Musik på pause','Pause ændrer én kontrol og en status. Billedet og det valgte rum bliver på plads.'],
 ['unknown','Udfald ukendt','Ukendt er hverken succes eller fejl. Ingen automatisk gentagelse; den fremtidige ejer skal levere en ny autoritativ status.'],
 ['complete','Timer færdig','Afslutning bliver stående, indtil den er håndteret. Skjul og annuller er forskellige handlinger.'],
 ['vacuum','Robot','Én status, relevante kontroller, detaljer ved behov. På vej til basen er ikke det samme som rengøring afsluttet.'],
 ['light','Lys','En enkel tilstand og en enkel handling. Flere kontroller tilføjes kun, når den konkrete enhed understøtter dem.']
];
for(const [status,label]of [['empty','Ingen afspilning'],['loading','Henter afspilning'],['missing-art','Manglende omslag'],['offline','Sidst kendt afspilning'],['error','Afspilning fejlede']])for(const [mode,name]of [['rest','Ro'],['active','Høj player']])states.push([`player-${mode}-${status}`,`${name} · ${label}`,'Deterministisk lokal prøve af samme player. Ingen konto- eller højttalerhandlinger.']);
const nav=document.querySelector('#states');
for(const [id,label,rule] of states){const b=document.createElement('button');b.textContent=label;b.type='button';b.dataset.id=id;b.addEventListener('click',()=>select(id));nav.append(b);}
function select(id){const s=states.find(x=>x[0]===id);for(const b of nav.children)b.setAttribute('aria-pressed',String(b.dataset.id===id));document.querySelector('#state-preview').src=`/?stage=${id}`;document.querySelector('#state-title').textContent=s[1];document.querySelector('#state-rule').textContent=s[2];document.querySelector('#state-open').href=`/?stage=${id}`;}
select('music-stack');
const observer=new ResizeObserver(entries=>{for(const {target,contentRect} of entries){const scale=contentRect.width/1024;target.style.height=`${600*scale}px`;target.querySelector('iframe').style.transform=`scale(${scale})`;}});for(const el of document.querySelectorAll('.mini,.preview'))observer.observe(el);
window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
fetch('references.json').then(r=>r.json()).then(refs=>{const parent=document.querySelector('#references');for(const r of refs){const a=document.createElement('a');a.href=r.url;a.target='_blank';a.rel='noopener';const title=document.createElement('strong');title.textContent=r.title;const note=document.createElement('span');note.textContent=r.note;a.append(title,note);parent.append(a);}}).catch(()=>{document.querySelector('#references').textContent='Referencerne indlæses separat.';});
