// Foto-Ro: the photo, the large clock and the date. Its [hidden] is the page's, set by the host inside the Ro <->
// Hjem motion (ui/ro-motion.js); #photo-clock's digits are rolled by SceneMotion.value.
import {ClockText, useShell} from './Topbar';
import type {ShellStore} from './store';

export function RoPhoto({store}: {store: ShellStore}) {
  const {clock} = useShell(store);
  return (
    <>
      <button
        id="photo-view"
        className="photo-view"
        data-pv-press="none"
        aria-description="Åbn dagens overblik"
        hidden
        onClick={() => store.host?.showFocus('now')}
      >
        <img src="ambient.webp" alt="Bjerglandskab ved en sø" />
        <span className="photo-time">
          <span id="photo-clock"></span>
          <ClockText id="photo-date" text={clock.photoDate} label={clock.label} />
        </span>
        <span className="photo-caption">Tryk for at åbne hjemmet</span>
      </button>
      <button id="photo-weather" className="photo-weather" hidden onClick={() => store.host?.showFocus('weather')}>
        <img src="assets/icons/cloud-sun.svg" alt="" />
        <strong>16°</strong>
        <span>Let skyet</span>
      </button>
    </>
  );
}
