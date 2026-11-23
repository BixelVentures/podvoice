// Bil on Home: the Tesla card (#home-vehicle, lærred K-Widget tesla). The shell owns the card itself (its kit card
// recipe, its size and the press that opens the vehicle page) and mounts this once inside it; the component draws
// the card's own state (data-kit-state, the dot car's tone and level, the facts' counts) and everything inside: the
// title, the status line, the battery value, the dot car and the read-only facts. An observation is passive: the card
// shows what is known, never a control.
// Motion (docs/MOTION.md): a fresh charging reading is acknowledged once on the battery value (the shell's shared
// leaf motion, 120 ms), only while Home is in front.
import {useLayoutEffect, useRef} from 'react';
import {mountScreen} from '../../app/mount';
import {useShell} from '../../lib/store/shell';
import {vehicleOverviewFacts, vehicleUpdatedLabel} from './model';
import type {VehicleModel} from './model';
import {setHomeChargeAnimation, useHomeVehicle} from './state';

interface ChargeMotion {
  animate?: (node: Element, frames: Keyframe[], duration: number) => Animation | null | undefined;
}

const CLIMATE_ON = ['heat', 'cool', 'auto', 'heat_cool', 'fan_only', 'dry'];

// What the card says about the car, as a pure function of the model.
export function homeVehicleCard(vehicle: VehicleModel) {
  const unconnected = vehicle.mode === 'unconnected';
  const percent = vehicle.batteryPercent;
  const battery =
    !unconnected && typeof percent === 'number' && Number.isFinite(percent) && percent >= 0 && percent <= 100
      ? `${String(Math.round(percent))} %`
      : '';
  const tone =
    unconnected || vehicle.stale === true
      ? 'unknown'
      : vehicle.charging.status === 'charging'
        ? 'charging'
        : CLIMATE_ON.includes(vehicle.climate.status ?? '')
          ? 'climate'
          : 'parked';
  // K-Widget tesla: a car that is offline keeps its last-known battery and access (»sidstkendt«).
  const lastKnown = vehicle.mode === 'observed' && vehicle.connectionState === 'offline';
  const lock = typeof vehicle.locked === 'boolean' ? (vehicle.locked ? 'Låst' : 'Ulåst') : '';
  const trunkOpen = vehicle.access?.rearTrunk === 'open';
  const lastKnownAccess = lastKnown && lock ? [lock, trunkOpen ? 'bagagerum åbent' : ''].filter(Boolean).join(' · ') : '';
  // The resource tile's fact rows: at most six, labels and values bounded as the shared tile bounds them.
  const facts = vehicleOverviewFacts(vehicle)
    .slice(0, 6)
    .map(fact => ({
      ...fact,
      label: fact.label.trim().slice(0, 80),
      value: fact.value.trim().slice(0, 180) + (fact.stale ? ' · ikke opdateret' : ''),
    }));
  const context = unconnected
    ? ''
    : [vehicle.shortStatus || vehicle.status, vehicleUpdatedLabel(vehicle)].filter(Boolean).join(' · ').trim().slice(0, 300);
  return {
    kitState: unconnected ? 'unavailable' : 'ready',
    battery,
    tone,
    level: battery ? String(Math.round(percent as number) / 100) : '0',
    status: lastKnownAccess || (trunkOpen ? 'Bagagerum åbent' : vehicle.status),
    facts,
    context,
  };
}

export function HomeVehicleCard({container}: {container: HTMLElement | null}) {
  const {model, cue} = useHomeVehicle();
  const card = homeVehicleCard(model);
  const motion = useShell(shell => shell.motion) as ChargeMotion | null;
  const value = useRef<HTMLSpanElement>(null);

  // The card's own state, read by the stylesheet.
  useLayoutEffect(() => {
    if (!container) return;
    const set = (key: string, next: string) => {
      if (container.dataset[key] !== next) container.dataset[key] = next;
    };
    set('kitState', card.kitState);
    set('hasOverviewValue', String(!!card.battery));
    set('carTone', card.tone);
    container.style.setProperty('--pv-car-level', card.level);
    set('hasFacts', String(!!(card.facts.length || card.context)));
    set('factCount', String(card.facts.length));
  }, [container, card.kitState, card.battery, card.tone, card.level, card.facts.length, card.context]);
  useLayoutEffect(() => {
    if (cue > 0 && value.current) setHomeChargeAnimation(motion?.animate?.(value.current, [{opacity: 0.65},
      {opacity: 1}], 120));
  }, [cue, motion]);

  return (
    <>
      <img src="assets/icons/car-front.svg" alt="" />
      <span>
        <strong>Tesla</strong>
        <small id="home-vehicle-status">{card.status}</small>
        <span ref={value} className="resource-value" hidden={!card.battery}>
          {card.battery}
        </span>
      </span>
      <span className="vehicle-dots" aria-hidden="true">
        <i data-layer="tires" />
        <i data-layer="empty" />
        <i data-layer="fill" />
        <i data-layer="cabin" />
      </span>
      <span className="resource-facts" role="list" hidden={!card.facts.length}>
            {card.facts.map(fact => (
              <span
                key={fact.id}
                className="resource-fact pv-kit pv-kit-listrow pv-row"
                data-kit="listrow"
                data-kit-variant="read-only"
                data-fact-id={fact.id}
                role="listitem"
              >
                <span className="resource-fact-label">{fact.label}</span>
                <span className="resource-fact-value">{fact.value}</span>
              </span>
            ))}
      </span>
      <span className="resource-context" hidden={!card.context}>
        {card.context}
      </span>
    </>
  );
}

// The shell mounts the card's content once; the card element itself stays the shell's.
export function mountHomeVehicle(container: HTMLElement) {
  return mountScreen(container, <HomeVehicleCard container={container} />);
}
