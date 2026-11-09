// Synthetic review data, served only through the explicit local fixture flag.
// Both comparison columns use the same canonical RecipeView and data.
export const recipes = [
  {title:'Linsegryde med tomat',portions:'4 portioner',totalTime:'30 min',categories:['Aftensmad'],description:'Syntetisk opskrift til designafprøvning.',ingredients:['200 g røde linser','1 dåse hakkede tomater','1 løg','6 dl grøntsagsbouillon'],steps:['Skyl linserne, og hak løget.','Kom løg, linser, tomater og bouillon i en gryde.','Lad retten simre, til linserne er møre. Rør undervejs.'],source:{url:'https://example.invalid/podview-review/linsegryde',files:[]}},
  {
    title:'Ovnbagt blomkål med sprøde kikærter, citronyoghurt og friske urter',
    portions:'4 portioner',
    totalTime:'55 min',
    categories:['Aftensmad'],
    description:'Syntetisk opskrift til designafprøvning med en lang titel, en fuld ingrediensliste og flere trin. Blomkål og kikærter bages på hver sin plade og serveres med citronyoghurt og hakkede urter.',
    ingredients:[
      '1 stort blomkålshoved', '2 dåser kikærter, drænet og skyllet', '3 spsk olivenolie',
      '2 tsk stødt spidskommen', '1 tsk røget paprika', '½ tsk salt',
      '2 dl græsk yoghurt naturel', '1 usprøjtet citron, både skal og saft',
      '1 lille fed hvidløg', '1 håndfuld bredbladet persille',
      '1 håndfuld frisk mynte', '2 spsk ristede græskarkerner'
    ],
    steps:[
      'Forvarm ovnen til 220 °C. Beklæd to bageplader med bagepapir, så grøntsager og kikærter kan fordeles hver for sig.',
      'Del blomkålen i buketter af nogenlunde samme størrelse. Skær de tykkeste dele af stokken i mindre stykker, så de kan bages sammen med buketterne.',
      'Dup de drænede kikærter tørre. Vend dem med 1 spsk olivenolie, halvdelen af spidskommen og lidt salt, og fordel dem i ét lag på den første plade.',
      'Vend blomkålen med resten af olien, spidskommen, paprika og salt. Fordel stykkerne med lidt luft imellem dem på den anden plade.',
      'Bag begge plader i ca. 25 minutter. Rør kikærterne halvvejs, og tag hver plade ud, når indholdet er gyldent. Giv blomkålen et par minutter ekstra, hvis stokken stadig er hård.',
      'Rør yoghurt med fintrevet citronskal, lidt citronsaft og revet hvidløg. Smag til med salt, og tilsæt mere citronsaft lidt ad gangen, til dressingen er frisk og syrlig.',
      'Hak persille og mynte groft. Fordel citronyoghurten på et fad, læg blomkål og kikærter ovenpå, og drys med urter og ristede græskarkerner.'
    ],
    source:{url:'https://example.invalid/podview-review/blomkaal',files:[]}
  },
  {title:'Ovnbagte grøntsager',portions:'2 portioner',totalTime:'40 min',categories:['Tilbehør'],description:'Syntetisk opskrift til designafprøvning.',ingredients:['500 g blandede rodfrugter','2 spsk olie','1 tsk tørret timian'],steps:['Skær grøntsagerne i ensartede stykker.','Vend med olie og timian på en bageplade.','Bag ved 200 °C, til grøntsagerne er møre.'],source:{url:'https://example.invalid/podview-review/groentsager',files:[]}},
  {title:'Yoghurt med bær',portions:'2 portioner',totalTime:'5 min',categories:['Morgenmad'],description:'Syntetisk opskrift til designafprøvning.',ingredients:['3 dl yoghurt','150 g bær','4 spsk havregryn'],steps:['Fordel yoghurt i to skåle.','Fordel bær og havregryn over yoghurten.'],source:{url:'https://example.invalid/podview-review/yoghurt',files:[]}}
];
