// Hjem (»Lige nu«): the overview's cards in their fixed places. The host orders the cards (alignOverview moves them
// out of their .home-shortcuts adapters into the overview), sizes them and fills the media, weather, vehicle and
// timer cards through their own renderers (resource-tile.js, music-results.js, the weather and timer screens); this
// tree draws their anatomy once and the copy only the host decides (the rows under the cards, the recipe card, the
// car's status line).
import {useShell} from './Topbar';
import type {ShellStore} from './store';

const CARD = 'pv-kit pv-kit-card pv-card';

function RecipeStepBar({steps, current}: {steps: number; current: number}) {
  const label = current < 0 ? 'Alle trin færdige' : `Trin ${String(current + 1)} af ${String(steps)}`;
  return (
    <span className="pv-step-bar" role="img" aria-label={label}>
      {Array.from({length: steps}, (_, index) => (
        <i
          key={index}
          data-step={current < 0 || index < current ? 'done' : index === current ? 'current' : 'ahead'}
        ></i>
      ))}
    </span>
  );
}

export function Overview({store}: {store: ShellStore}) {
  const {home, recipe} = useShell(store);
  const host = () => store.host;
  return (
    <section
      id="now-view"
      className="response-widget"
      aria-labelledby="now-title"
      hidden
      data-activities={home.activities ?? undefined}
    >
      <header className="response-heading" hidden>
        <div data-customize="now">
          <h1 id="now-title" aria-label="Lige nu">
            <button id="now-rest" aria-label="Lige nu · Vis Ro" onClick={() => host()?.openRest()}>
              Lige nu
            </button>
          </h1>
          <p id="now-summary" hidden>
            {home.summary}
          </p>
        </div>
      </header>
      <div className="home-shortcuts">
        <button
          id="home-weather"
          className={CARD}
          data-kit="card"
          data-kit-identity="weather"
          onClick={() => host()?.showFocus('weather')}
        >
          <img src="assets/icons/cloud-sun.svg" alt="" />
          <span>
            <strong>
              <span className="home-temperature">16°</span>
              <span className="home-condition">Let skyet</span>
            </strong>
            <small>Mårslet · Se vejrudsigten</small>
            <span className="home-forecast">Eftermiddag 16° · Aften 11°</span>
          </span>
          <img src="assets/icons/chevron-right.svg" alt="" />
        </button>
        <button id="home-music" className={CARD} data-kit="card" onClick={() => host()?.showFocus('music')}>
          <img src="assets/icons/music-note-beamed.svg" alt="" />
          <span>
            <strong>Musik</strong>
            <small>Stemninger og dine sange</small>
          </span>
          <img src="assets/icons/chevron-right.svg" alt="" />
        </button>
      </div>
      <div id="now-activities" className="now-activities">
        <button id="now-music" className="activity-row" hidden onClick={() => host()?.focusPlayPause()}>
          <span>{home.musicLabel}</span>
          <strong id="now-track">{home.track}</strong>
          <small>Se kontrol til højre</small>
        </button>
        <div id="device-activities"></div>
        <button
          id="restore-resources"
          className="text-control"
          hidden={!home.restoreResources}
          onClick={() => host()?.restoreResources()}
        >
          Vis skjulte aktiviteter
        </button>
        <div id="now-empty" className="now-empty" hidden>
          <img src="assets/icons/check-circle-fill.svg" alt="" />
          <h2>Alt er roligt.</h2>
          <p>Her samles dine timere og det, der er i gang derhjemme.</p>
        </div>
        <button id="restore-timer" className="text-control" hidden onClick={() => host()?.restoreTimer()}>
          Vis den skjulte timer
        </button>
      </div>
      <div id="timer-card" className="timer-overview">
        <div className="timer-active-list" hidden></div>
        <button id="open-timers" className="timer-shortcut" onClick={() => host()?.showFocus('timers')}>
          <img src="assets/icons/timer.svg" alt="" />
          <span>
            <strong>Timer</strong>
            <small>Start en timer</small>
          </span>
          <img src="assets/icons/chevron-right.svg" alt="" />
        </button>
      </div>
      <div className="home-shortcuts home-extensions">
        <button id="home-radio" className={CARD} data-kit="card" onClick={() => host()?.showFocus('radio')}>
          <img src="assets/icons/boombox.svg" alt="" />
          <span>
            <strong>Radio</strong>
            <small>P3, P1, P4 og flere</small>
          </span>
          <img src="assets/icons/chevron-right.svg" alt="" />
        </button>
        <button
          id="home-vehicle"
          className={CARD}
          data-kit="card"
          data-kit-identity="tesla"
          onClick={() => host()?.showFocus('vehicle')}
        >
          <img src="assets/icons/car-front.svg" alt="" />
          <span>
            <strong>Tesla</strong>
            <small id="home-vehicle-status">{home.vehicleStatus}</small>
            <span className="resource-value" hidden></span>
          </span>
          <span className="vehicle-dots" aria-hidden="true">
            <i data-layer="tires"></i>
            <i data-layer="empty"></i>
            <i data-layer="fill"></i>
            <i data-layer="cabin"></i>
          </span>
        </button>
      </div>
      <button
        id="home-recipes"
        type="button"
        data-overview-size="s"
        className={CARD}
        data-kit="card"
        onClick={() => host()?.openRecipes()}
      >
        <img src="assets/icons/card.svg" alt="" />
        <span>
          <strong>{recipe.heading}</strong>
          <span className="resource-value" hidden={!recipe.name}>
            {recipe.name}
          </span>
          <small>{recipe.status}</small>
        </span>
        {recipe.steps > 0 ? <RecipeStepBar steps={recipe.steps} current={recipe.current} /> : null}
      </button>
      <button
        id="quick-controls"
        hidden
        className="screen-settings text-control"
        aria-haspopup="dialog"
        onClick={event => host()?.openScreenSettings(event.currentTarget)}
      >
        Skærmvisning
      </button>
    </section>
  );
}
