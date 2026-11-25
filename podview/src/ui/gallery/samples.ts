// The design canvas's own sample content for every K-Widget state (K-Widget's table; HA Green 9 Nov 14.30 and the
// product's texts), so the kit gallery can be laid next to the canvas's W-* boards. Test and gallery data only.
import type {WidgetHour, WidgetKind, WidgetProps} from '../Widget';

type Sample = Omit<WidgetProps, 'kind' | 'state'>;

const hours: WidgetHour[] = [['15.00', '8°'], ['16.00', '8°'], ['17.00', '7°'], ['18.00', '7°'], ['19.00', '7°']]
  .map(([time = '', value = '']) => ({time, value, glyph: 'cloud'}));
const weather: Sample = {big: '8°', prim: 'Skyet', ctx: 'Højst 8° · lavest 6°', hours};

export const WIDGET_SAMPLES: Record<WidgetKind, Record<string, Sample>> = {
  vejr: {
    sidstkendt: weather,
    frisk: weather,
    ukendt: {big: '—', prim: 'Vejret kunne ikke hentes', ctx: 'Home Assistant svarer ikke lige nu'},
  },
  robot: {
    oplader: {prim: 'Oplader', ctx: 'Batteri 100 % · senest 0,2 m² · 1,1 min'},
    rengoer: {prim: 'Rengør', ctx: 'Støvsugning og gulvvask', action: {label: 'Pause', onPress: () => undefined}},
    pause: {prim: 'På pause', ctx: 'Robotten mangler vand', alert: 'warning',
      action: {label: 'Fortsæt', onPress: () => undefined}},
    tilbasen: {prim: 'Kør til basen', ctx: 'Robotten sendes til basen.'},
    fejl: {prim: 'Robotfejl', ctx: 'Hovedbørsten sidder fast', alert: 'error'},
    ukendt: {prim: 'Status ukendt', ctx: 'Senest ved basen'},
  },
  lys: {
    ikkeforbundet: {prim: 'Ikke forbundet', ctx: 'Køkkenalrum'},
    taendt: {prim: 'Tændt', ctx: 'Køkkenalrum · 80 %'},
    slukket: {prim: 'Slukket', ctx: 'Køkkenalrum'},
    ukendt: {prim: 'Status ukendt', ctx: 'Køkkenalrum'},
  },
  tesla: {
    sidstkendt: {prim: '81 %', ctx: 'Ulåst · bagagerum åbent', alert: 'warning', level: 0.81},
    lader: {prim: '81 %', ctx: 'Lader · forventet færdig 20.43', level: 0.81},
    klima: {prim: '81 %', ctx: 'Klima · varmer', level: 0.81},
    laast: {prim: '81 %', ctx: 'Låst · 313 km', level: 0.81},
    ikkeforbundet: {prim: 'Ikke forbundet', ctx: 'Kræver tilslutning', level: 0},
  },
  musik: {
    tom: {prim: 'Hjem fra skole', ctx: 'Til eftermiddagen', tile: 'music'},
    ikketilg: {prim: 'Vælg musik', ctx: 'Fortsæt og playlister', tile: 'disc'},
    forslag: {prim: 'Regnvejr og torsdag aften', ctx: 'Dagens AI-valg · Find musik', tile: 'disc'},
  },
  radio: {
    vaelg: {prim: 'Vælg station', ctx: 'P1 · P3 · P4 · P6 · P8', tile: 'radio'},
    spiller: {prim: 'P8 Jazz', ctx: 'Køkkenalrum HomePod', tile: 'radio'},
    starter: {prim: 'P8 Jazz', ctx: 'Starter P8 Jazz…', tile: 'radio'},
    ikketilg: {prim: 'Ikke tilgængelig', ctx: 'HA svarer ikke', tile: 'radio'},
  },
  opskrift: {
    igang: {label: 'Opskrift', prim: 'Burgerboller', ctx: 'Trin 2 af 5', tile: 'recipe', steps: {total: 5, current: 2}},
    katalog: {prim: '9 opskrifter', ctx: '5 kategorier', tile: 'recipe'},
    tom: {prim: 'Ingen opskrifter', ctx: 'Der er ingen opskrifter endnu.', tile: 'recipe'},
  },
  timer: {
    start: {prim: 'Start en timer', ctx: 'Senest brugt 5:00'},
    startTom: {prim: 'Start en timer', ctx: ' '},
    koerer: {prim: '3:42', ctx: 'Tæller ned', ring: 0.74},
    pause: {prim: '3:42', ctx: 'På pause', ring: 0.74},
    faerdig: {prim: 'Tiden er gået', ctx: 'Stop alarm', ring: 1},
  },
  svar: {
    seneste: {prim: 'Atlético 1–2 Barcelona', ctx: 'Resultat · 11.32'},
    tom: {prim: 'Intet at vise endnu', ctx: 'Ingen visuelle svar endnu'},
  },
};
