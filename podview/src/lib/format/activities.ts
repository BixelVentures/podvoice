// »Hvad skal musikken til?« (Find musik D, Stemning.dc.html): the six activity tiles, the small hint each may carry
// and the tile that fits now. A hint comes only from the clock (Europe/Copenhagen, as discoveryPeriod
// reads it) and the panel's weather entity; when nothing real fits, a tile has no hint and none is suggested.

import {discoveryPeriod} from './discovery';

export const ACTIVITIES = [
  {id: 'cooking', title: 'Madlavning'},
  {id: 'focus', title: 'Fokus'},
  {id: 'hygge', title: 'Hygge'},
  {id: 'party', title: 'Fest'},
  {id: 'sleep', title: 'Godnat'},
  {id: 'workout', title: 'Træning'},
] as const;
export type ActivityId = (typeof ACTIVITIES)[number]['id'];
export const ACTIVITY_IDS: readonly ActivityId[] = ACTIVITIES.map(activity => activity.id);
export const activityTitle = (id: ActivityId) => ACTIVITIES.find(activity => activity.id === id)?.title ?? id;

// Each activity's colour square in »Jeres seneste stemninger« (the canvas's own colours).
export const ACTIVITY_COLOUR: Record<ActivityId, string> = {
  cooking: '#C27A5A', focus: '#8FA3A6', hygge: '#5A4E6E', party: '#B5654A', sleep: '#3F5560', workout: '#4A5A66',
};

// HA weather conditions that make it a day for Hygge, and the word the tile says.
const INDOOR_WEATHER: Record<string, string> = {
  rainy: 'Regnvejr', pouring: 'Regnvejr', 'lightning-rainy': 'Regnvejr', lightning: 'Torden', snowy: 'Snevejr',
  'snowy-rainy': 'Slud', hail: 'Hagl', fog: 'Tåge', windy: 'Blæsevejr', 'windy-variant': 'Blæsevejr',
};

const WEEKDAYS = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];

function clock(now: number | Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {hour: 'numeric', hourCycle: 'h23', weekday: 'short',
    timeZone: 'Europe/Copenhagen'}).formatToParts(now);
  const hour = Number(parts.find(part => part.type === 'hour')?.value);
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find(part => part.type === 'weekday')
    ?.value ?? '');
  return {hour, day};
}

export interface ActivityContext {
  hints: Partial<Record<ActivityId, string>>;
  suggested: ActivityId | null;
}

/** The hints that are true now, and the one tile that fits best (the first rule that holds), or none. */
export function activityContext(now: number | Date, weather: string | null | undefined): ActivityContext {
  const {hour, day} = clock(now);
  const weekend = day === 5 || day === 6;
  const hints: Partial<Record<ActivityId, string>> = {};
  // Dinner is cooked in the first two hours of the evening (discoveryPeriod's evening starts at 17).
  const cooking = discoveryPeriod(now) === 'evening' && hour < 19;
  if (cooking) hints.cooking = 'Nu: 17–19';
  const indoor = weather ? INDOOR_WEATHER[weather] : undefined;
  if (indoor) hints.hygge = indoor;
  // Friday and Saturday are the party nights; the tile names the day.
  if (weekend) hints.party = WEEKDAYS[day] ?? '';
  const late = hour >= 19 && hour < 23;
  if (late) hints.sleep = 'I aften';
  const workday = day >= 1 && day <= 5 && hour >= 8 && hour < 16;
  if (workday) hints.focus = 'Hverdag';
  const suggested: ActivityId | null = cooking ? 'cooking'
    : late && weekend ? 'party'
      : late ? 'sleep'
        : indoor ? 'hygge'
          : workday ? 'focus' : null;
  return {hints, suggested};
}

/** »I dag 09.12«, »I går 20.31«, »Tirsdag 17.05« (this week), »12. nov. 17.05« (older); '' when unreadable. */
export function activityWhen(at: string, now: number | Date = Date.now()): string {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return '';
  const zone = {timeZone: 'Europe/Copenhagen'} as const;
  const time = new Intl.DateTimeFormat('da-DK', {...zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'})
    .format(ms).replace(':', '.');
  const dayOf = (value: number | Date) => new Intl.DateTimeFormat('en-CA', {...zone, year: 'numeric', month: '2-digit',
    day: '2-digit'}).format(value);
  const days = Math.round((Date.parse(dayOf(now)) - Date.parse(dayOf(ms))) / 86_400_000);
  if (days <= 0) return `I dag ${time}`;
  if (days === 1) return `I går ${time}`;
  if (days < 7) return `${WEEKDAYS[clock(ms).day] ?? ''} ${time}`;
  return `${new Intl.DateTimeFormat('da-DK', {...zone, day: 'numeric', month: 'short'}).format(ms)} ${time}`;
}
