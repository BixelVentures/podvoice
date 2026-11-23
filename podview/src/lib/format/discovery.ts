// The part of the day music suggestions are for (the device clock in Europe/Copenhagen), and its heading.
export type DiscoveryPeriod = 'morning' | 'afternoon' | 'evening';

export function discoveryPeriod(now: number | Date): DiscoveryPeriod {
  const hour = Number(new Intl.DateTimeFormat('da-DK', {hour: 'numeric', hourCycle: 'h23',
    timeZone: 'Europe/Copenhagen'}).format(now));
  return hour < 11 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
}

export const DISCOVERY_PERIOD: Record<DiscoveryPeriod, string> = {morning: 'Godmorgen', afternoon: 'Til eftermiddagen',
  evening: 'Til aftenen'};

// The same period heading the music page uses, for the resting music card's context line.
export const discoveryPeriodLabel = (now: number | Date) => DISCOVERY_PERIOD[discoveryPeriod(now)];
