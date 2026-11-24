// A weather fact card's display copy: »12.4 °C« as »12°« and »partlycloudy« as »Let skyet«, only for facts bound to an
// admitted HA weather receipt. Display copies only; the owner's values stay canonical for receipt inspection.
import {conditionLabel, weatherTemperature} from '../../screens/weather/observation.ts';
import {record} from './content.ts';
import type {Fact, Source} from './content.ts';

const KNOWN_CONDITIONS = new Set(['clear', 'sunny', 'partlycloudy', 'cloudy', 'rainy', 'pouring', 'snowy', 'fog',
  'windy', 'clear-night', 'lightning', 'lightning-rainy', 'snowy-rainy', 'exceptional']);

function displayValue(fact: Fact): string {
  const {value} = fact;
  if (fact.label === 'Temperatur' && /^-?\d{1,3}(?:\.\d{1,8})? °C$/.test(value)) {
    const number = Number(value.slice(0, -3));
    if (number >= -100 && number <= 100) return weatherTemperature(number, '°C');
  } else if (fact.label === 'Vejrforhold' && KNOWN_CONDITIONS.has(value)) {
    return conditionLabel(value);
  }
  return value;
}

// The facts to draw for this answer (the admitted ones, with display copies where they apply).
export interface WeatherFactsInput {
  live: boolean;
  kind: string;
  presentation?: boolean | undefined;
  provenance: {kind: string};
  receiptId?: string | undefined;
  ownerReceiptIds: readonly string[];
  weatherDisplayFactIds?: readonly string[] | undefined;
  facts: readonly Fact[];
  sources: readonly Source[];
}

export function weatherFacts(answer: WeatherFactsInput): readonly Fact[] {
  const original = answer.provenance.kind === 'ha_weather';
  const bound = answer.presentation === true && answer.provenance.kind === 'owner_sources' &&
    Array.isArray(answer.weatherDisplayFactIds);
  const {receiptId} = answer;
  if (!answer.live || answer.kind !== 'fact-card' || (!original && !bound) || !receiptId ||
    !answer.ownerReceiptIds.includes(receiptId) || !answer.sources.length ||
    answer.sources.some(source => record(source)?.kind !== 'owner_receipt' || record(source)?.receiptId !== receiptId)) {
    return answer.facts;
  }
  return answer.facts.map(fact => {
    if (fact.detail !== 'Aktuel måling' || (!original && !answer.weatherDisplayFactIds?.includes(fact.id))) return fact;
    const value = displayValue(fact);
    return value === fact.value ? fact : {...fact, value};
  });
}
