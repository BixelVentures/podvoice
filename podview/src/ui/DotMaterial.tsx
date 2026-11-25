// The widgets' dot-matrix materials (K-Widget on the design canvas): a cloud for Vejr, arcs for Robot and Timer, a
// bulb for Lys and the dot car for Tesla. Each is computed from the canvas's own algorithm on a 9-px (car: 30-unit)
// grid, so the same inputs always draw the same dots; the grids are computed once per variant. Static states never
// move; a running state's dots breathe (animate-pv-*), and reduced motion stills them.
import {memo} from 'react';
import {cx} from './tv';

interface Square {
  x: number;
  y: number;
  w: number;
  delay: number;
}

const one = (value: number) => Math.round(value * 10) / 10;

function cloudDots(): Square[] {
  const dots: Square[] = [];
  const blobs = [[150, 140, 42], [198, 108, 56], [246, 146, 38]] as const;
  for (let y = 4.5; y < 290; y += 9) {
    for (let x = 4.5; x < 270; x += 9) {
      let d = 999;
      for (const [bx, by, br] of blobs) d = Math.min(d, Math.hypot(x - bx, y - by) - br);
      if (x > 112 && x < 284 && y > 136 && y < 184) d = Math.min(d, -1);
      if (d < 4) continue;
      const w = Math.max(0, 6.4 - d * 0.045) * Math.min(1, (290 - y) / 100);
      if (w > 0.8) dots.push({x: one(x - w / 2), y: one(y - w / 2), w: one(w), delay: 0});
    }
  }
  return dots;
}

function arcDots(broken: boolean): Square[] {
  const dots: Square[] = [];
  for (let y = 4.5; y < 221; y += 9) {
    for (let x = 4.5; x < 250; x += 9) {
      const r = Math.hypot(x - 262, y - 236);
      if (r < 26 || r > 300) continue;
      const phase = (r % 22) / 22;
      if (phase > 0.55) continue;
      if (broken && Math.sin(Math.atan2(y - 236, x - 262) * 7 + r * 0.05) > 0.45) continue;
      const w = (6.6 - r * 0.015) * Math.min(1, (y + 30) / 60) * (1 - Math.abs(phase - 0.27) * 1.4);
      if (w > 0.9) dots.push({x: one(x - w / 2), y: one(y - w / 2), w: one(w), delay: Math.round(-(r / 300) * 2400)});
    }
  }
  return dots;
}

function bulbDots(): Square[] {
  const dots: Square[] = [];
  for (let y = 4.5; y < 110; y += 9) {
    for (let x = 4.5; x < 150; x += 9) {
      const d = Math.hypot(x - 100, y - 50) - 26;
      if (d < 4 || (x > 90 && x < 110 && y > 66 && y < 100)) continue;
      const w = Math.max(0, 6 - d * 0.045) * Math.min(1, x / 60);
      if (w > 0.8) dots.push({x: one(x - w / 2), y: one(y - w / 2), w: one(w), delay: 0});
    }
  }
  return dots;
}

const CLOUD = cloudDots();
const ARCS = arcDots(false);
const ARCS_BROKEN = arcDots(true);
const BULB = bulbDots();

// Each dot is painted as the canvas painted its boxes: snapped to whole pixels (a 2.6-px dot at x 3.2 covers 3–6),
// with its corners still rounded.
function snap(x: number, y: number, w: number, h = w) {
  const left = Math.round(x);
  const top = Math.round(y);
  return {x: left, y: top, w: Math.round(x + w) - left, h: Math.round(y + h) - top};
}

// A breathing dot scales about its own centre.
const DOT = 'origin-center [transform-box:fill-box]';

const Squares = memo(function Squares({dots, width, height, animate}: {
  dots: Square[]; width: number; height: number; animate?: string;
}) {
  return (
    <svg width={width} height={height} viewBox={`0 0 ${String(width)} ${String(height)}`} className="block"
      aria-hidden="true">
      {dots.map(dot => {
        const box = snap(dot.x, dot.y, dot.w);
        if (box.w <= 0 || box.h <= 0) return null;
        return (
          <rect key={`${String(dot.x)}-${String(dot.y)}`} x={box.x} y={box.y} width={box.w} height={box.h}
            rx={Math.min(1, box.w / 2)}
            className={animate ? cx(DOT, animate, 'motion-reduce:animate-none') : undefined}
            style={animate ? {animationDelay: `${String(dot.delay)}ms`} : undefined} />
        );
      })}
    </svg>
  );
});

/** Vejr's cloud: 270×290 in the widget's top right, fading in from the left over 110 px. */
export function CloudMaterial({className}: {className?: string}) {
  return (
    <div className={cx('pointer-events-none absolute top-0 right-0 h-[290px] w-[270px]',
      '[mask-image:linear-gradient(90deg,transparent_0,#000_110px)]', className)} aria-hidden="true">
      <Squares dots={CLOUD} width={270} height={290} />
    </div>
  );
}

/** Robot's and Timer's arcs: 250×221 in the top right; `broken` leaves gaps (a robot fault). */
export function ArcsMaterial({broken = false, animate, className}: {broken?: boolean; animate?: string;
  className?: string}) {
  return (
    <div className={cx('pointer-events-none absolute top-0 right-0 h-[221px] w-[250px]',
      '[mask-image:linear-gradient(90deg,transparent_0,#000_110px)]', className)} aria-hidden="true">
      <Squares dots={broken ? ARCS_BROKEN : ARCS} width={250} height={221} {...(animate ? {animate} : {})} />
    </div>
  );
}

/** Lys's bulb: 150×110 scaled to .74 at right 12 / top 62, fading in from the top over 50 px. */
export function BulbMaterial({className}: {className?: string}) {
  return (
    <div className={cx('pointer-events-none absolute top-[62px] right-3 h-[110px] w-[150px] origin-top-right',
      'scale-[.74] [mask-image:linear-gradient(180deg,transparent_0,#000_50px)]', className)} aria-hidden="true">
      <Squares dots={BULB} width={150} height={110} />
    </div>
  );
}

// The car: a body outline and two wheels on a 30-unit grid (the canvas's 1000-unit drawing), each dot 4.4 px.
const BODY = [[30, 300], [44, 236], [128, 208], [300, 124], [430, 92], [612, 90], [738, 122], [878, 190], [958, 212],
  [988, 258], [982, 300]] as const;
const WHEELS = [[236, 300], [804, 300]] as const;

function inPolygon(x: number, y: number, polygon: readonly (readonly [number, number])[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i] ?? [0, 0];
    const [xj, yj] = polygon[j] ?? [0, 0];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

interface CarDot {
  x: number;
  y: number;
  part: 'tire' | 'body' | 'cabin';
  gx: number;
}

const CAR: CarDot[] = (() => {
  const dots: CarDot[] = [];
  const k = 0.155;
  for (let y = 84; y < 362; y += 30) {
    for (let x = 24; x < 1000; x += 30) {
      const tire = WHEELS.some(([a, b]) => {
        const r = Math.hypot(x - a, y - b);
        return r > 34 && r < 62;
      });
      const near = WHEELS.some(([a, b]) => Math.hypot(x - a, y - b) < 70);
      const body = inPolygon(x, y, BODY) && !near;
      if (!tire && !body) continue;
      dots.push({x: one((x - 24) * k - 2.2), y: one((y - 84) * k * 1.2 - 2.2), gx: x,
        part: tire ? 'tire' : y < 200 && x > 280 && x < 820 ? 'cabin' : 'body'});
    }
  }
  return dots;
})();

export type CarTone = 'parked' | 'charging' | 'climate' | 'unknown';

const CAR_FILL: Record<CarTone, string> = {
  parked: 'fill-pv-car-parked',
  charging: 'fill-pv-ok',
  climate: 'fill-pv-ok',
  unknown: 'fill-pv-car-unknown',
};

/**
 * Tesla's dot car at left 20 / top 80 (151×52 at .88): tires in ink, the body filled to the battery level in the
 * tone's colour over a faint empty body; charging makes the charge flow, the climate warms the cabin.
 */
export const CarMaterial = memo(function CarMaterial({level, tone, className}: {
  level: number; tone: CarTone; className?: string;
}) {
  const fill = Math.max(0, Math.min(1, level));
  return (
    <div className={cx('pointer-events-none absolute top-20 left-5 h-[52px] w-[151px] origin-top-left scale-[.88]',
      className)} aria-hidden="true">
      <svg width={151} height={52} viewBox="0 0 151 52" className="block overflow-visible">
        {CAR.map(dot => {
          const on = (dot.gx - 30) / 958 <= fill;
          const warm = tone === 'climate' && dot.part === 'cabin';
          const flow = tone === 'charging' && on && !warm && dot.part !== 'tire';
          const color = dot.part === 'tire' ? 'fill-pv-ink' : warm ? 'fill-pv-timer-accent' : on ? CAR_FILL[tone]
            : 'fill-pv-ink/10';
          const animate = warm ? 'animate-pv-warm' : flow ? 'animate-pv-flow' : '';
          const box = snap(dot.x, dot.y, 4.4);
          return (
            <ellipse key={`${String(dot.x)}-${String(dot.y)}`} cx={box.x + box.w / 2} cy={box.y + box.h / 2}
              rx={box.w / 2} ry={box.h / 2}
              className={cx(color, animate && cx(DOT, animate, 'motion-reduce:animate-none'))}
              style={animate ? {animationDelay: `${String(Math.round(dot.gx * (warm ? 3 : 2)))}ms`} : undefined} />
          );
        })}
      </svg>
    </div>
  );
});

export const DOT_COUNTS = {cloud: CLOUD.length, arcs: ARCS.length, arcsBroken: ARCS_BROKEN.length, bulb: BULB.length,
  car: CAR.length};
