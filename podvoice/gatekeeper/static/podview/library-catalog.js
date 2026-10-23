// Review navigation only. Every specimen is the real index.html composition;
// this catalogue neither renders product widgets nor grants action authority.
import {FORMATS} from './scene-model.js';
import {answerPreviewStatuses,devicePreviewStatuses} from './preview-scenes.js';

const state=(family,stage,label,description,extra={})=>({id:`${family}:${stage}${extra.open?`:open-${extra.key||'detail'}`:''}`,stage,label,description,...extra});
const answerNames={comparison:'Sammenligning',concise:'Kort svar',choices:'Valgmuligheder',chart:'Graf',steps:'Trinvis vejledning',checklist:'Tjekliste','fact-card':'Faktakort','sourced-image':'Billede med kilde','answer-timeline':'Svartidslinje','simple-diagram':'Diagram'};
const answerDescriptions={comparison:'Sammenlign muligheder på de samme felter.',concise:'En kort konklusion, når tekst forklarer mest.',choices:'Få tydelige muligheder, der kan vælges med touch.',chart:'Tal med enhed og en læsbar visuel sammenligning.',steps:'En vejledning med ét aktuelt trin og tydelig fremdrift.',checklist:'Punkter, som kan markeres uden at miste indholdet.','fact-card':'Udvalgte fakta med konklusion og synligt kildegrundlag.','sourced-image':'Et relevant billede med forklaring, alternativ tekst og kreditering.','answer-timeline':'Hændelser og planlagte tidspunkter i et læsbart forløb.','simple-diagram':'En enkel sammenhæng forklaret med forbundne dele.'};
const answerStates={
 ready:['Klar','Det nyttige svar er klar. Prøv de synlige kontroller og kilder.'],
 waiting:['Afventer indhold','Der er endnu ikke et færdigt svar. Dette er svarkomponentens ventetilstand, ikke et løfte fra PodVoice om et kommende kort.'],
 partial:['Delvist svar','Vis kun det indhold og de valg, som den eksisterende svarkomponent tillader før færdiggørelse.'],
 empty:['Tomt resultat','Intet brugbart resultat. Musikken og resten af skærmen bevares.'],
 error:['Fejl','Svaret kunne ikke leveres. Prøv igen er en eksplicit handling.'],
 offline:['Forbindelse mangler','Seneste svar bliver stående, mens handlinger afhænger af den aktuelle forbindelse.'],
 interrupted:['Afbrudt svar','Svarkomponentens afbrudte tilstand. Se Samtale for afbrydelse, hvor et allerede nyttigt svar bliver stående.']
};
const deviceNames={docked:'Ved basen',cleaning:'Rengør',paused:'På pause',docking:'Til basen',stopped:'Stoppet',pending:'Handling afventer',unknown:'Ukendt tilstand',fault:'Fejl',off:'Slukket',on:'Tændt',mixed:'Blandet',unavailable:'Ikke tilgængeligt'};
const deviceRules={docked:'Sekundær, rolig status. Åbn betjeningen for at vælge en rengøring.',cleaning:'Observeret rengøring. Ingen opdigtet procent, kort eller sluttid.',paused:'Pause er en normal tilstand. Fortsæt og stop er særskilte handlinger.',docking:'På vej til basen er ikke bevis for afsluttet rengøring.',stopped:'Rengøringen er stoppet; ressourcen er stadig tilgængelig.',pending:'Sidst observerede tilstand bliver, mens den konkrete handling afventer.',unknown:'Ukendt tilstand er hverken succes eller fejl. Ingen automatisk gentagelse.',fault:'Fejlen får en afgrænset, tydelig plads.',off:'Slukket er en kendt tilstand; det varme funktionsunivers bevares.',on:'Tændt vises med tekst og tilstand, ikke kun farve.',mixed:'En gruppe kan indeholde både tændte og slukkede lyskilder.',unavailable:'Ingen kendt forbindelsesstatus eller tilladelse må opfindes.'};

export const productLibrary=[
 {id:'composition',name:'Overblik og Ro',category:'Skærm',description:'Den samlede komposition med et fleksibelt venstreområde og vedvarende player.',usage:'Brug overblikket til det aktuelle og Ro til billedrammen. Sekundære widgets må ligge længere nede i scroll.',interaction:'Åbn en widget, brug Tilbage, og prøv scroll. Musik og timere skal bevare deres identitet.',limitations:['Ro bruger den eksisterende baggrund. Privat fotoalbum er udskudt.'],states:[
  ...[['first-connecting','Første forbindelse'],['first-unavailable','Ingen forbindelse endnu'],['first-denied','Home Assistant kræver login'],['first-empty','Forbundet uden tilgængeligt indhold']].map(([stage,label])=>state('composition',stage,label,'Lokalt tilstandseksempel. Ingen faktisk HA-login, netværksforbindelse eller enheder. Prøv igen viser forbindelsestilstanden uden netværkskald.')),
  state('composition','night','Ro · nat','Nattevisning med dæmpet foto og varmt ur. Lokalt eksempel; ingen påstået solsensor.'),
  state('composition','activities-combined','Timer, robot og opladning · lokalt eksempel','Aktiv timer i den faste timerbar med robot og opladning i deres egne widgets; ingen fysisk betjening.'),
  state('composition','conversation-overview','Overblik med aktiviteter','To kolonner, aktiv timer og stor player. Scroll i venstre side.'),
  state('composition','nothing','Overblik uden aktive timere','Indgange til hjemmet, uden at opfinde aktive ressourcer.'),
  state('composition','rest','Ro med musik','Foto, ur og dato med kompakt afspilning.'),
  state('composition','quiet','Ro uden musik','Den fotografiske flade uden en aktiv player.'),
  state('composition','conversation-visual','Svar med aktiviteter','Svaret tager fokus; kun relevante aktive ressourcer er sekundære.'),
  state('composition','answer-fact-card-long','Langt indhold','Prøv scroll og kontrollér, at playeren bliver på sin plads.')
 ]},
 {id:'voice',name:'Samtalestatus',category:'Skærm',description:'Én rolig status øverst midt på skærmen. Den viser faktisk aktivitet og overtager aldrig svarområdet.',usage:'Status vises kun under en aktiv samtale. Mikrofonen betyder aktivt input. Ingen bølgende lydmåler.',interaction:'Se de seks synlige faser samlet. Åbn Hele skærmen for at vurdere placering og vægt sammen med player og indhold.',limitations:['Lokale gengivelser af ejerens faser. Fysisk tale, fuld duplex og lydoutput kræver PodVoice-prøve.','Ingen status betyder ikke, at et nyttigt visuelt svar skal lukkes.'],states:[
  state('voice','header-listening','Lytter','Du taler. Eksisterende indhold bliver stående.'),
  state('voice','header-thinking','Arbejder','PodVoice arbejder. Ingen stor tom svarflade.'),
  state('voice','header-speaking','Svarer','PodVoice taler. Et visuelt svar kan komme uafhængigt.'),
  state('voice','header-ready','Klar til opfølgning','Ejerens åbne samtalevindue. Det betyder ikke, at du først nu må tale.'),
  state('voice','header-closing','Afslutter','Samtalens ejer afslutter. Et nyttigt svar bliver stående.'),
  state('voice','header-waiting','Status ukendt','Ingen sikker tale- eller lyttetilstand. Ingen lovet visualisering.')
 ]},
 {id:'conversation',name:'Samtale og feedback',category:'Skærm',description:'Taleaktivitet og visuelt indhold har hver deres forløb.',usage:'Samtalen bestemmer fokus. Et mundtligt svar behøver ikke en stor svarflade.',interaction:'Start et samtaleforløb og gå til næste trin. Pause musik eller åbn en detalje undervejs; dit indhold bevares. Tilstandsvælgeren åbner også enkelte øjebliksbilleder.',limitations:['Det oprindelige spørgsmål leveres endnu ikke særskilt af PodVoice. Eksempelspørgsmål er skrevet til denne vurdering.','Fuld duplex og forsinkede svar kræver fortsat faktisk PodVoice-prøve. Tilstandsskift her er ikke lydafspilning eller en fysisk afbrydelse.'],states:[
  state('conversation','conversation-overview','Ingen samtale','Ingen permanent statusbar. Overblikket har plads.'),
  state('conversation','conversation-listening','Du taler','Lyttestatus; det eksisterende indhold bliver stående.'),
  state('conversation','conversation-working','PodVoice arbejder','Kompakt aktivitet uden en stor tom svarkasse.'),
  state('conversation','conversation-speaking','Kun mundtligt svar','Overblikket bliver stående, mens PodVoice svarer.'),
  state('conversation','conversation-visual','Visuelt svar under tale','Et nyttigt svar får fokus, mens player og timer fortsætter.'),
  state('conversation','conversation-late','Visualisering kommer senere','Sidste nyttige svar bliver. Aktiviteten lover ikke et bestemt visuelt resultat.'),
  state('conversation','conversation-complete','Tale afsluttet','Status forsvinder; det nyttige svar bliver stående.'),
  state('conversation','conversation-interrupted','Du afbryder','Ny lyttestatus, mens det tidligere nyttige svar bevares.'),
  state('conversation','conversation-followup','Opfølgende spørgsmål','Nyt indhold i samme svareksempel med ny revision.'),
  state('conversation','conversation-long','Langt svar','Læs og scroll i svaret. Musik, timer og valg fortsætter.'),
  state('conversation','conversation-resume','Tilbage til samme svar','Det samme svar åbner igen med bevaret læseposition. Musik og timer ændres ikke.'),
  state('conversation','conversation-timer-finished','Den aktive timer bliver færdig','Forløbet flytter den lokale tid til timerens deadline. Den samme timer afsluttes; ingen fysisk alarm.'),
  state('conversation','conversation-visual-error','Det nye visuelle svar fejler','Det nyttige svar bevares. Fejlen påstår ikke, at tale eller musik er fejlet.'),
  state('conversation','conversation-offline','Forbindelsen afbrydes','Sidst kendte indhold bevares. Ingen automatisk genudførelse.'),
  state('conversation','conversation-reconnecting','Genopretter forbindelsen','Samme svar og ressourcer bliver stående.'),
  state('conversation','conversation-reconnected','Ny lokal status modtaget','Lokal snapshot-gendannelse uden genafspilning af handlinger. Ikke en live-forbindelse.'),
  state('conversation','conversation-visual-timer-finished','Timer færdig under svaret','Timeren er færdig i den synlige ressourcezone. Ingen dobbeltbesked.'),
  state('conversation','conversation-long-timer-finished','Timer færdig under langt svar','Timeren ligger længere nede. En færdigbesked skal stadig kunne findes uden at scrolle.'),
  state('conversation','offline','Forbindelsen forsvinder','Seneste indhold bevares, og fjernhandlinger må ikke gentages.'),
  state('conversation','connecting','Genforbindelse','Indhold bliver, mens forbindelsen genoprettes.'),
  state('conversation','header-ready','Klar til at lytte videre','Den eksisterende status for fortsættelse af samtalen.'),
  state('conversation','header-waiting','Status ukendt','Ingen sikker tale- eller lyttetilstand kan udledes.'),
  ...FORMATS.map(format=>state('conversation',`answer-${format}-ready`,`Svarformat · ${answerNames[format]}`,answerDescriptions[format],{answerFormat:format}))
 ]},
 {id:'music',name:'Musikvalg',category:'Musik',description:'De fire aftalte musikfaner med genkendelige valg og bevarede billeder.',usage:'Stemning, Humør, For dig og Senest bruger samme musikområde.',interaction:'Skift fane, vælg musik, og prøv Andre forslag. Valgene er lokale og spiller ikke lyd.',limitations:['Musikudvalget er eksempeldata, ikke en læsning af din Spotify-konto.','For dig viser den eksisterende topsangskilde; personlige mixes, daylist og Discover Weekly er ikke tilsluttet.'],states:[
  ...[['mood','Stemning'],['feeling','Humør'],['top','For dig'],['recent','Senest']].map(([stage,label])=>state('music',`music-${stage}`,label,'Fanevalg bevarer den faste player og bruger samme musikkomponent.')),
  state('music','music-refreshing','Nye forslag afventer','Eksisterende forslag bevares, mens en opdatering afventer.'),
  state('music','music-refresh-error','Opdatering fejlede','Tidligere forslag bevares. Ingen falsk succes.'),
  state('music','music-initial-empty','Ingen musik endnu','Første tomme udvalg uden tidligere forslag eller aktiv afspilning. Ingen tom refresh forklædes som førstegangsindhold.'),
  state('music','music-long-metadata','Lange titler og kunstnernavne','Forfattede typografieksempler i de eksisterende sang-, kunstner- og albumtekstroller. Samme lokale ID’er, cover og klikforløb.'),
  state('music','music-refresh-empty','Ingen nye forslag','Det tomme opdateringsresultat erstatter ikke brugbare tidligere valg.'),
  state('music','pending','Afspilning afventer','Det valgte nummer er endnu ikke en observeret afspilning.'),
  state('music','music-offline','Forbindelse mangler','Musikfaner og tidligere valg kan stadig læses; ingen ny afspilning.'),
  state('music','music-unknown','Udfald ukendt','Forbindelsen afbrydes efter valg; ingen automatisk gentagelse.'),
  state('music','music-long-output','Langt højttalernavn','Lang kendt destination i den samme player og overblikskortets fakta.')
 ]},
 {id:'player',name:'Musikplayer',category:'Musik',description:'Fast højrezone med stort cover, højttaler, transport og adskilt volumen.',usage:'Playeren bevarer position og indhold, når venstre opgaveområde ændrer sig.',interaction:'Tryk på cover eller titel for detaljer, højttaleren for outputvalg, og prøv pause eller volumen.',limitations:['Transport og outputvalg er lokale eksempler. Der sendes ingen kommandoer til højttalere.','Manglende native position giver ingen opdigtet afspilningsfremdrift.'],states:[
  state('player','conversation-overview','Spiller','Den store højreplayer i overblikket.'),
  state('player','music-paused','På pause','Samme cover og destination, ændret transporttilstand.'),
  ...['active','rest'].flatMap(mode=>[['empty','Ingen afspilning'],['loading','Første indlæsning'],['missing-art','Omslag mangler'],['offline','Sidst kendt afspilning'],['error','Fejl']].map(([status,label])=>state('player',`player-${mode}-${status}`,`${mode==='active'?'Stor':'Ro'} · ${label}`,'Den eksisterende player bevarer sin egen anatomi; ingen separat loadingflade.'))),
  state('player','conversation-overview','Udvidet player og kø','Detaljer åbner som et roligt lag over den samme skærm.',{open:'#player-detail',key:'player'}),
  state('player','player-queue-empty','Tom kø','Den kendte aktive sang bevares i playeren, mens køen er tom.'),
  state('player','player-queue-error','Køfejl med kendt sang','Køen kunne ikke hentes. Den kendte aktive sang, cover og destination bevares; ingen falsk køkvittering.'),
  state('player','player-long-metadata','Lange sang- og køtitler','Forfattede lange titler og kunstnernavne i den samme player og kø. Navigation bevarer samme sang og køidentiteter.'),
  state('player','player-long-output','Langt højttalernavn','Lang destinationslabel med samme sang, cover og kø.'),
  state('player','conversation-overview','Skift højttaler','Den eksisterende højttalervælger. Et eksplicit valg ændrer det lokale output.',{open:'#output',key:'output'})
 ]},
 {id:'weather',name:'Vejr',category:'Hjem',description:'Kompakt overblik og en fotofri detalje med de relevante timer.',usage:'Vejret fylder lidt i overblikket. Et spørgsmål kan give et større, fokuseret vejrsvar.',interaction:'Åbn vejret fra kortet eller headeren; scroll gennem prognosen og læs kilden.',limitations:['Vejrdata er et fast lokalt eksempel, ikke dagens vejrudsigt. Tilstandene beviser ikke en aktuel kildeforbindelse.','Vejrejeren har ingen selvstændig kommando-pending eller providerfejltilstand. Tom kilde og sidst kendt prognose vises ærligt.'],states:[
  state('weather','conversation-overview','Overblikskort','Lille vejrværdi og kort kontekst i overblikket.'),
  state('weather','weather-long','Langt sted og vejrtekst','Forfattede lange labels i den eksisterende lokale vejrmodel; timepunkter, enheder og eksempelmarkering bevares.'),
  state('weather','weather-connection-error','Vejrforbindelsen fejlede','Eksisterende ærlig Home Assistant-forbindelsesfejl uden opfundet prognose eller providerfejltilstand.'),
  state('weather','weather-ready','Vejrdetalje','Fotofri prognose med timer, vind og kilde.'),
  state('weather','weather-empty','Ingen vejrdata','Den samme vejrdetalje uden et leveret kildegrundlag.'),
  state('weather','weather-stale','Sidst kendte vejrdata','Forældet prognose bevares og kvalificeres; der opfindes ingen opdatering.'),
  state('weather','weather-unconnected','Ikke forbundet','Ingen kilde eller prognose; samme ærlige tomme vejr-Hero.'),
  state('weather','weather-offline','Offline med kendt prognose','Den seneste prognose bevares og markeres sidst kendt.'),
  state('weather','conversation-visual','Vejr som svar','En konklusion og udvalgte fakta om et konkret eksempelspørgsmål.')
 ]},
 {id:'timer',name:'Timer',category:'Hjem',description:'Tom indgang, aktivt instrument og en tydelig afslutning.',usage:'En aktiv timer må bruge mere plads end den tomme indgang. Færdig skal kunne findes uden at lede.',interaction:'Start en lokal timer, åbn detaljer og afslut den. Ingen fysisk alarm afspilles.',limitations:['Timeren er lokal. Native alarmlyd og stopkvittering er ikke efterprøvet her.'],states:[
  ...[['empty','Ingen timer','Indgang til at vælge en tid.'],['running','Aktiv timer','Tiden tæller ned lokalt.'],['finished','Tiden er gået','Færdigtilstanden bliver, indtil den håndteres.'],['multiple','Timer og seneste tider','Én aktiv timer. Tidligere varigheder kan vælges uden at starte en ekstra timer.'],['stale','Sidst kendt timer','Forældet observation skal fremgå uden en falsk ny bekræftelse.']].flatMap(([status,label,rule])=>['overview','detail','rest'].map(layer=>state('timer',`timer-${layer}-${status}`,`${label} · ${{overview:'overblik',detail:'detalje',rest:'Ro'}[layer]}`,rule)))
  ,...['overview','detail','rest'].map(layer=>state('timer',`timer-${layer}-paused`,`Timer på pause · ${{overview:'overblik',detail:'detalje',rest:'Ro'}[layer]}`,'Samme lokale timer på pause; annullér eller afslut før ny varighed.'))
 ]},
 {id:'robot',name:'Robotstøvsuger',category:'Hjem',description:'Én genkendelig robot med status, betjening og fælles hændelseshistorik.',usage:'Ved basen er sekundært. Aktivitet og fejl kan få mere vægt; ingen opdigtet kortvisning.',interaction:'Åbn Betjen robot, vælg områder og gentagelser, eller genbrug et lokalt historikvalg.',limitations:['Start og statusændringer er lokale eksempler. Robotten bevæger sig ikke.','En accepteret start er ikke dokumentation for en afsluttet rengøring.'],states:[
  state('robot','robot-detail-many-rooms','9 rum · 2 kort · indstillinger','Forfattet lokalt eksempel: ni rum på Stueplan og et andet kort. Anvend Kort eller Rengøringstype for at udskifte de tilbudte valg; ingen Home Assistant-enhed betjenes.'),
  ...devicePreviewStatuses.robot.map(status=>state('robot',`robot-detail-${status}`,deviceNames[status],deviceRules[status])),
  state('robot','robot-overview-docked','Overblik · ved basen','Sekundært kort i det fælles overblik.'),
  state('robot','robot-overview-cleaning','Overblik · rengør','Aktiv status i samme kortanatomi.'),
  state('robot','robot-rest-cleaning','Ro · rengør','Den kompakte ressource er tilgængelig over billedrammen.'),
  state('robot','robot-detail-offline','Forbindelse mangler','Sidst kendte rengøring bevares. Betjening er ikke tilgængelig.'),
  ...[['empty','Ingen robotdata','Manglende opsætning med helper og uden tom historik.'],['stale','Sidst kendte robotdata','Seneste observation bliver stående uden aktive kommandoer.'],['long','Langt rum- og kortnavn','Lange faktisk understøttede metadata i samme Hero, pleje-ListRows og S/M/L-kort.'],['care','Pleje og dockstatus','Observerede eksempelværdier for filter, børste, vandbeholder og dockfejl.']].map(([status,label,description])=>state('robot',`robot-detail-${status}`,label,description)),
  state('robot','robot-detail-docked','Områder og gentagelser','Den eksisterende rengøringsformular; justér før eksplicit Start.',{open:'[data-robot-control]',key:'controls'})
 ]},
 {id:'lights',name:'Lys',category:'Hjem',description:'Et dæmpet varmt funktionsunivers med ærlig status.',usage:'Ikke tilsluttet lys fylder mindre end et aktuelt svar. En gruppe kan have blandet tilstand.',interaction:'Prøv de tilgængelige lokale lyskontroller; forbindelsesfejl må ikke ligne et slukket lys.',limitations:['Lysbetjening her er simuleret. Tilgængelighed i hjemmet skal bekræftes af den faktiske ejer.','Farve/temperatur og rigtige scener er ikke optaget i den aktuelle kontrakt; biblioteket opfinder ingen dialog eller kommando.'],states:[
  ...devicePreviewStatuses.light.map(status=>state('lights',`light-detail-${status}`,deviceNames[status],deviceRules[status])),
  state('lights','light-overview-unavailable','Overblik · ikke tilgængeligt','Rolig og ærlig indgang uden påstand om tændt lys.'),
  state('lights','light-overview-on','Overblik · tændt','Samme kortfamilie som de øvrige enheder.'),
  state('lights','light-rest-on','Ro · rum ikke tilknyttet','Ingen lysressource før PodViews eget HA-rum er eksplicit tilknyttet.'),
  state('lights','light-detail-offline','Forbindelse mangler','Sidst kendt lysstatus bliver; fjernbetjening afventer forbindelse.'),
  ...[['empty','Ingen lysdata','Manglende opsætning; ingen spøgelseslamper eller scener.'],['stale','Sidst kendt lysstatus','Kendte lamper bliver stående uden aktive kommandoer.'],['long','Langt lampe- og rumnavn','Samme lampe valgt med lange labels; prøv også S/M/L.'],['room-living','Rum · Stuen','Eksisterende rumvalg med stuens to lamper.'],['room-kitchen','Rum · Køkkenet','Eksisterende rumvalg med dæmpbar lampe og kontakt.'],['lamp','Lampe · Loftlys','Eksisterende lampevalg med lysstyrke og tænd/sluk; ingen ny farvedialog.']].map(([status,label,description])=>state('lights',`light-detail-${status}`,label,description))
 ]},
 {id:'radio',name:'Radio',category:'Hjem',description:'Stationsvalg bruger den eksisterende musikplayer.',usage:'Radio har sin egen indgang, men ikke en separat afspiller eller et ekstra playerlayout.',interaction:'Vælg en station og se, hvordan kilde og titel ændres i højreplayeren.',limitations:['Stationsvalget er visuelt og lokalt. Der er ingen DR-stream eller lydforbindelse.','Radioejeren tilbyder valgt, pause, tomt valg og offline; der findes ingen særskilt radiofejl eller kommandopending at demonstrere.'],states:[
  state('radio','radio-ready','Stationsvalg','P3, P1, P4 og flere i den eksisterende valgkomponent.'),
  state('radio','radio-selected','Station valgt','Radioindhold i samme højreplayer.'),
  state('radio','radio-paused','På pause','Den valgte station bevares på pause.'),
  state('radio','radio-offline','Forbindelse mangler','Stationerne bliver synlige; valg er ikke en liveafspilning.'),
  state('radio','first-denied','Adgang afvist · stationsvalg','Åbn det eksisterende stationsvalg uden adgang. Stationerne er synlige, men kan ikke vælges; lokalt eksempel uden DR-forbindelse.',{open:'#home-radio',key:'denied'}),
  state('radio','first-unavailable','Ikke forbundet · stationsvalg','Åbn det eksisterende stationsvalg uden forbindelse. Ingen valgt station eller afspilning opfindes.',{open:'#home-radio',key:'unavailable'})
 ]},
 {id:'vehicle',name:'Tesla',category:'Hjem',description:'Ærlig ikke-tilsluttet bil samt tydeligt lokale og passive status-eksempler.',usage:'Bilen er en sekundær destination. Ukendte værdier må ikke ligne målte data.',interaction:'Åbn de eksisterende detaljer om opladning, klima og øvrige muligheder.',limitations:['Ingen Tesla-integration, målinger eller betjening er tilsluttet. Passive ukendte/sidst kendte observationer og lokale ladeeksempler er særskilt mærket.','Bilkontrakten tilbyder ingen kommando-pending, fault eller bagagerumskommando. De manglende tilstande opfindes ikke.'],states:[
  state('vehicle','conversation-overview','Overblik · ikke tilsluttet','Den kompakte bilindgang uden påstået batteri eller rækkevidde.'),
  state('vehicle','vehicle-unconnected','Detaljer · ikke tilsluttet','Bilens faktiske nuværende produktstatus og åbne detaljeafsnit.'),
  state('vehicle','vehicle-charging','Opladning · lokalt eksempel','Eksempel på batteri, ladeeffekt og forventet sluttid; ingen bilforbindelse.'),
  state('vehicle','vehicle-charging-overview','Overblik · lokalt ladeeksempel','Samme eksempel i overblikkets aktivitet uden reel bilforbindelse.'),
  state('vehicle','vehicle-unknown','Ukendt · passivt eksempel','Den eksisterende passive kontrakt uden kendte målinger, model eller handlinger.'),
  state('vehicle','vehicle-stale','Sidst kendt · passivt eksempel','Kendte passive fakta kvalificeres som sidst kendte; ingen aktive bilkommandoer.')
 ]},
 ...FORMATS.map(format=>({id:`answer-${format}`,name:answerNames[format],category:'Visuelle svar',description:answerDescriptions[format],usage:'Ét afgrænset svar med tydeligt hierarki og plads til indhold. Playeren bliver til højre.',interaction:format==='steps'?'Gå frem og tilbage mellem trinene. Åbn kilder og vend tilbage uden at stoppe musik.':format==='checklist'?'Markér punkter og se, at resten af indholdet bevares.':format==='choices'||format==='comparison'?'Vælg en mulighed og følg den videre i samme opgave.':'Prøv kilder, scroll og lukning. At skjule svaret stopper ikke andre ressourcer.',limitations:['Indholdet er lokalt eksempelmateriale. Det dokumenterer rendering, ikke PodVoices livelevering af dette format.'],states:[
  ...answerPreviewStatuses.map(status=>state(`answer-${format}`,`answer-${format}-${status}`,...answerStates[status])),
  ...(['fact-card','sourced-image','answer-timeline','simple-diagram'].includes(format)?[state(`answer-${format}`,`answer-${format}-long`,'Langt svar','Længere konklusion, forklaring og billedtekst i samme renderer. Prøv Vis mere og scroll; playeren bevares.')]:[]),
  state(`answer-${format}`,`answer-${format}-ready`,'Åbne kilder','Åbn og luk det eksisterende kildegrundlag uden at miste svaret.',{open:'#answer-host details:not([hidden]) > summary',key:'sources'}),
  ...(['sourced-image','simple-diagram'].includes(format)?[state(`answer-${format}`,`answer-${format}-image-failure`,'Billede kunne ikke hentes','Bevidst manglende lokal billedfil. Forklaring, alternativ tekst og kilde bevares; ingen netværkskilde simuleres.')]:[]),
  ...(['steps','checklist'].includes(format)?[state(`answer-${format}`,`answer-${format}-complete`,'Gennemført','Gennemført vejledning eller liste bevares, indtil brugeren forlader den.')]:[])
 ]})),
 {id:'history',name:'Svarhistorik',category:'Detaljer',description:'Tidligere svar vises som en overskuelig liste med spørgsmål og kort uddrag.',usage:'Historikken åbner i venstre område, mens musikplayeren er tilgængelig.',interaction:'Vælg et spørgsmål, åbn svaret, og gå tilbage til samme sted i historikken.',limitations:['Eksemplerne er lokale. Den nuværende backendhistorik er ikke varig familiehukommelse eller en fuld transskription.'],states:[
  state('history','visual-history','Visuelle forhåndsvisninger','De ti eksisterende svarformater i den kanoniske historik.'),
  state('history','conversation-overview','Tom historik','Ingen tidligere svar må opfindes.',{open:'#open-history',key:'empty'}),
  state('history','conversation-complete','Efter samtalen','Et nyttigt svar står stadig efter talens afslutning.')
 ]},
 {id:'overlays',name:'Detaljer og kontroller',category:'Detaljer',description:'Rolige lag med en tydelig tilbagevej til den samme opgave.',usage:'Detaljer åbnes kun, når de hjælper. Bagvedliggende indhold og ressourcer bevares.',interaction:'Åbn, betjen og luk med den synlige Luk-knap eller Escape. Fokus skal vende tilbage til åbneren.',limitations:['Lokale dialoger beviser ikke observerede udfald fra fysiske enheder.'],states:[
  state('overlays','conversation-visual','Player over et svar','Svar og timer bevares under playerdetaljen.',{open:'#player-detail',key:'player'}),
  state('overlays','conversation-visual','Højttalere over et svar','Outputvælgeren åbnes ved et eksplicit højttalerskift.',{open:'#output',key:'output'}),
  state('overlays','robot-detail-docked','Robotbetjening','Valg af områder og gentagelser før Start.',{open:'[data-robot-control]',key:'robot'}),
  state('overlays','timer-detail-running','Timerdetalje','Timeren åbner i det eksisterende opgaveområde; playeren bliver synlig.')
 ]}
];

// Optional framing hints for the review canvas; selectors point into the same
// product document. They must never be used to construct substitute widgets.
const familySelectors={voice:'pv-widget-host>.voice-surface:not([hidden])',music:'#music-response',player:'.player:not([hidden]),#player-empty:not([hidden])',weather:'#weather-view',timer:'#timers-view',robot:'#device-view',lights:'#device-view',radio:'#radio-view',vehicle:'#vehicle-view',history:'#history'};
for(const family of productLibrary){
 family.selector=family.id.startsWith('answer-')?'#answer-host':familySelectors[family.id];
 for(const item of family.states){
  item.selector=family.selector??null;
  if(item.open)item.selector=family.id.startsWith('answer-')?'#answer-host':item.open==='#player-detail'?'#music-detail':item.open==='#output'?'#rooms':item.open==='#open-history'?'#history':item.open==='#home-radio'?'#radio-view':'dialog[aria-labelledby="local-robot-title"][open]';
  else if(family.id==='composition')item.isolationNote='Kompositionen vurderes som en hel skærm; vælg en widget i listen for at se den alene.';
  else if(family.id==='conversation'){
   if(item.answerFormat)item.selector='#answer-host';
   else if(['offline','connecting'].includes(item.stage))item.selector='#playback-status:not([hidden])';
   else if(item.stage==='conversation-overview'){item.selector=null;item.isolationNote='Ingen samtaleaktivitet er synlig i denne tilstand.';}
   else if(item.stage==='conversation-complete')item.selector='#answer-host';
   else item.selector='pv-widget-host>.voice-surface:not([hidden])';
  }
  else if(family.id==='weather'&&item.stage==='conversation-overview')item.selector='#home-weather';
  else if(family.id==='weather'&&item.stage==='conversation-visual')item.selector='#answer-host';
  else if(family.id==='vehicle'&&item.stage==='conversation-overview')item.selector='#home-vehicle';
  else if(family.id==='timer'){
   item.selector=item.stage.includes('-overview-')?'#timer-card':item.stage.includes('-rest-')?'#resource-rail':'#timers-view';
   if(item.stage==='timer-rest-empty'){item.selector=null;item.isolationNote='Ro viser ingen timer, når der ikke er en aktiv timer. Den tomme indgang findes i overblikket.';}
  }
  else if(['robot','lights'].includes(family.id)&&!item.stage.includes('-detail-'))item.selector=`${item.stage.includes('-rest-')?'#resource-rail':'#now-view >'} [data-kind="${family.id==='robot'?'vacuum':'light'}"]`;
  else if(family.id==='history'&&item.stage==='conversation-complete')item.selector='#answer-host';
  else if(family.id==='overlays'&&item.stage==='timer-detail-running')item.selector='#timers-view';
 }
}

export const libraryCategories=[...new Set(productLibrary.map(item=>item.category))];
export const libraryStateCount=productLibrary.reduce((total,item)=>total+item.states.length,0);
