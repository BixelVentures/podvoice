// An icon from the panel's set (public/assets/icons/*.svg, Phosphor): decorative, the control names itself.
import {cx} from './tv';

export const iconUrl = (name: string) => `assets/icons/${name}.svg`;

export function Icon({name, className}: {name: string; className?: string}) {
  return <img className={cx('pointer-events-none size-pv-icon-s shrink-0 select-none', className)} src={iconUrl(name)}
    alt="" draggable={false} />;
}
