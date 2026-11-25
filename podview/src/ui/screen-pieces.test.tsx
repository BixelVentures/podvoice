// The kit's Vejr, Radio, Ro and Find musik pieces: the carousel's order, the station scale, the needle rule, the
// glass card's key rule and the catalogue's P1-first order.
import {render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {catalogueOrder} from '../lib/ha/radio';
import {RadioHero, stationAt, StationTile} from './Radio';
import {carouselOrder, GlassCard} from './Rest';
import {QuickPick} from './Shelf';

const P8 = {id: 'p8-jazz', name: 'P8 Jazz', logo: 'assets/radio-p8-jazz.svg', colour: '#7E57C8'};
const MARKS = ['P1', 'P3', 'P4', 'P6', 'P8'];

describe('screen pieces', () => {
  it('the carousel: the newest photo first, then every other once at random (no repeats in a round)', () => {
    const photos = [1, 5, 3, 4, 2].map(at => ({src: `${String(at)}.webp`, alt: '', at}));
    const order = carouselOrder(photos, () => 0.5);
    expect(order[0]?.src).toBe('5.webp');
    expect(new Set(order.map(photo => photo.src)).size).toBe(5);
  });

  it('the station scale: five stations at 10, 30, 50, 70 and 90 %', () => {
    expect(MARKS.map((_, index) => stationAt(index, MARKS.length))).toEqual(['10%', '30%', '50%', '70%', '90%']);
  });

  it('the catalogue reads P1 first, whatever order Speakers lists it in', () => {
    const speakers = ['p3', 'p1', 'p4-ostjylland', 'p6-beat', 'p8-jazz'].map(id => ({id}));
    expect(catalogueOrder(speakers).map(row => row.id)).toEqual(['p1', 'p3', 'p4-ostjylland', 'p6-beat', 'p8-jazz']);
  });

  it('the red needle stands only while a station plays (amber while it starts); none when unavailable', () => {
    const {rerender, container} = render(<RadioHero phase="spiller" station={P8} status="Spiller" title="P8 Jazz"
      sub="Jazz" marks={MARKS} index={4} />);
    expect(container.querySelector('[data-needle=spiller]')?.className).toContain('bg-pv-live');
    expect(screen.getByRole('img', {name: 'Stationsskala, valgt P8 Jazz'})).toBeTruthy();
    rerender(<RadioHero phase="starter" station={P8} status="Starter P8 Jazz…" title="P8 Jazz" sub="Jazz"
      marks={MARKS} index={4} />);
    expect(container.querySelector('[data-needle]')?.className).toContain('bg-pv-starting');
    rerender(<RadioHero phase="vaelg" station={null} status="Ingen station valgt" title="Vælg station"
      sub="5 stationer" marks={MARKS} index={null} />);
    expect(container.querySelector('[data-needle]')).toBeNull();
    rerender(<RadioHero phase="ikketilg" station={null} status="Ikke tilgængelig" title="Radio"
      sub="Home Assistant svarer ikke lige nu" marks={MARKS} index={null} />);
    expect(container.querySelector('[data-needle]')).toBeNull();
    expect(screen.getByRole('img', {name: 'Stationsskala'}).className).toContain('opacity-30');
  });

  it('a station tile is ringed in its colour when chosen, and grey and disabled when the radio is unavailable', () => {
    const press = vi.fn();
    const {rerender} = render(<StationTile {...P8} selected label="P8 Jazz" onPress={press} />);
    const tile = screen.getByRole('button', {name: 'P8 Jazz'});
    expect(tile.getAttribute('aria-pressed')).toBe('true');
    expect(tile.style.boxShadow).toContain('3px');
    rerender(<StationTile {...P8} selected={false} disabled label="P8 Jazz" onPress={press} />);
    expect(screen.getByRole<HTMLButtonElement>('button', {name: 'P8 Jazz'}).disabled).toBe(true);
    expect(document.querySelector('img')?.className).toContain('grayscale');
  });

  it('a glass card has a key only when it is given one (music and radio); the rest keep the arrow', () => {
    const {rerender} = render(<GlassCard chip={{glyph: 'timer', surface: 'bg-pv-ink'}} prim="3:42"
      ctx="Timer · tæller ned" label="Åbn Timer" onOpen={vi.fn()} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    rerender(<GlassCard chip={{picture: P8.logo}} prim="P8 Jazz" ctx="Direkte" label="Åbn Radio" onOpen={vi.fn()}
      control={{icon: 'stop', label: 'Stop radio', onPress: vi.fn()}} />);
    expect(screen.getByRole('button', {name: 'Stop radio'})).toBeTruthy();
  });

  it('a quick pick shows its »AI-valgt« badge', () => {
    render(<QuickPick title="Regnvejrs-jazz" badge="AI-valgt" cover={null} label="Afspil Regnvejrs-jazz"
      onPress={vi.fn()} />);
    expect(screen.getByRole('button', {name: 'Afspil Regnvejrs-jazz'}).textContent).toBe('Regnvejrs-jazzAI-valgt');
  });
});
