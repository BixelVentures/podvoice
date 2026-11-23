// The room's music player: a PodConnect media_player in the room (HA area). Status is the speaker's own state as HA
// reports it; play/pause, next, previous and volume are media_player.* on that entity. A tap shows its wish at once
// and never locks the controls; the speaker's next state confirms it, else the outcome is shown as unknown.
// While HA briefly has no state for the player (a restart, a resync) the last known track stays, marked as such.
import {create, useStore} from 'zustand';
import {commands} from '../../lib/ha/commands';
import type {HassEntityState} from '../../lib/ha/hass';
import {lastKnownPlayers, media, playerModel, playKey, roomPlayer, skipKey, volumeKey} from '../../lib/ha/media';
import type {PlayState} from '../../lib/ha/media';
import {useCatalog, useEntities, useEntity} from '../../lib/ha/transport';
import {KitButton} from '../../lib/ui/KitButton';
import {useRoom} from '../room';
import {BUTTON, icon, KitSlider, Notice, wishNotice} from '../ui';

export const STATE_LABEL: Record<PlayState, string> = {
  playing: 'Spiller',
  paused: 'På pause',
  idle: 'Klar',
  off: 'Slukket',
  on: 'Tændt',
  buffering: 'Henter',
  standby: 'Standby',
  unavailable: 'Ikke tilgængelig',
};

function useShownPlayer(entity: HassEntityState | null, entityId: string) {
  const last = lastKnownPlayers(state => state.models[entityId]);
  const model = entity ? playerModel(entity) : null;
  if (model?.available) return {model, lastKnown: false};
  if (last) return {model: last, lastKnown: true};
  return {model, lastKnown: false};
}

export function PlayerCard({entityId, compact = false}: {entityId: string; compact?: boolean}) {
  const entity = useEntity(entityId);
  const {model, lastKnown} = useShownPlayer(entity, entityId);
  const play = useStore(commands.store, state => state.wishes[playKey(entityId)]);
  const skip = useStore(commands.store, state => state.wishes[skipKey(entityId)]);
  const volume = useStore(commands.store, state => state.wishes[volumeKey(entityId)]);
  if (!model) {
    return (
      <article className="pv-kit pv-kit-hero pv-hero" data-kit="hero" data-kit-identity="music" data-kit-state="empty">
        <p data-kit-slot="title">Højttaleren er ikke tilgængelig</p>
        <span data-kit-slot="body">Home Assistant har ingen tilstand for {entityId} lige nu.</span>
      </article>
    );
  }
  const live = !lastKnown && model.available;
  const wished = play && (play.phase === 'sending' || play.phase === 'awaiting') ? (play.value as string) : null;
  const playing = (wished ?? model.state) === 'playing';
  const shownVolume =
    volume && (volume.phase === 'sending' || volume.phase === 'awaiting') ? (volume.value as number) : model.volume;
  const notice = wishNotice(play) || wishNotice(skip) || wishNotice(volume);
  const status = lastKnown ? 'Sidst kendt · ikke tilgængelig lige nu' : STATE_LABEL[model.state];
  return (
    <article
      className="pv-panel-player pv-kit pv-kit-hero pv-hero"
      data-kit="hero"
      data-kit-identity="music"
      data-kit-state={model.title ? 'ready' : 'empty'}
      data-player-state={lastKnown ? 'last-known' : model.state}
      data-compact={String(compact)}
      aria-label={`${model.name}: ${status}`}
    >
      <div className="pv-panel-player-now">
        {model.artwork ? (
          <img className="pv-panel-artwork" src={model.artwork} alt="" />
        ) : (
          <span className="pv-panel-artwork" aria-hidden="true">
            <img src={icon('music-note-beamed')} alt="" />
          </span>
        )}
        <div data-kit-slot="copy">
          <p data-kit-slot="title" className="pv-panel-track">
            {model.title || (model.state === 'off' ? 'Slukket' : 'Intet spiller')}
          </p>
          <span data-kit-slot="body" hidden={!model.artist}>
            {model.artist}
          </span>
          <small className="pv-panel-speaker" data-speaker-status={lastKnown ? 'last-known' : model.state}>
            <img src={icon('speaker-output')} alt="" /> {model.name} · {status}
          </small>
        </div>
      </div>
      <div className="pv-panel-transport" role="group" aria-label="Afspilning">
        <KitButton
          className={BUTTON}
          data-kit="button"
          data-kit-variant="icon"
          aria-label="Forrige"
          hidden={!model.can.previous}
          isDisabled={!live}
          onPress={() => {
            media.skip(entityId, 'previous');
          }}
        >
          <img src={icon('skip-start-fill')} alt="" />
        </KitButton>
        <KitButton
          className={`${BUTTON} main-control`}
          data-kit="button"
          data-kit-variant="primary"
          data-kit-size="56"
          aria-label={playing ? 'Pause' : 'Afspil'}
          aria-busy={play?.phase === 'sending' || play?.phase === 'awaiting'}
          data-wish={play?.phase ?? 'none'}
          hidden={!(playing ? model.can.pause : model.can.play)}
          isDisabled={!live}
          onPress={() => {
            media.playPause(entityId, !playing);
          }}
        >
          <img src={icon(playing ? 'pause-fill' : 'play-fill')} alt="" />
        </KitButton>
        <KitButton
          className={BUTTON}
          data-kit="button"
          data-kit-variant="icon"
          aria-label="Næste"
          hidden={!model.can.next}
          isDisabled={!live}
          onPress={() => {
            media.skip(entityId, 'next');
          }}
        >
          <img src={icon('skip-end-fill')} alt="" />
        </KitButton>
      </div>
      {model.can.volume || shownVolume !== null ? (
        <KitSlider
          id={`volume-${entityId}`}
          label="Lydstyrke"
          identity="music"
          value={shownVolume === null ? null : Math.round(shownVolume * 100)}
          disabled={!live || !model.can.volume}
          format={value => `${String(value)} %`}
          onCommit={value => {
            media.volume(entityId, value / 100);
          }}
        />
      ) : null}
      <Notice text={notice} />
    </article>
  );
}

// Which of the room's players is shown: the chosen one (last tap wins), else the one playing, paused or available.
const usePlayerChoice = create<{byRoom: Record<string, string | undefined>}>(() => ({byRoom: {}}));

export function RoomMusic({compact = false}: {compact?: boolean}) {
  const {room} = useRoom();
  const players = room?.players ?? [];
  const states = useEntities(players);
  const chosen = usePlayerChoice(state => (room ? state.byRoom[room.id] : undefined));
  const current = chosen && players.includes(chosen) ? chosen : (roomPlayer(states)?.entity_id ?? players[0] ?? null);
  if (!room || !current) {
    return (
      <article className="pv-kit pv-kit-hero pv-hero" data-kit="hero" data-kit-identity="music" data-kit-state="empty">
        <p data-kit-slot="title">Ingen højttaler i rummet</p>
        <span data-kit-slot="body">
          Home Assistant har ingen PodConnect-højttaler i dette område. Placér højttaleren i et område i Home Assistant.
        </span>
      </article>
    );
  }
  return (
    <>
      {players.length > 1 && !compact ? (
        <div className="pv-panel-chips" role="radiogroup" aria-label="Højttaler">
          {players.map((id, index) => (
            <KitButton
              key={id}
              role="radio"
              aria-checked={id === current}
              className="pv-panel-chip"
              onPress={() => {
                usePlayerChoice.setState(state => ({byRoom: {...state.byRoom, [room.id]: id}}));
              }}
            >
              {nameOf(states[index] ?? null, id)}
            </KitButton>
          ))}
        </div>
      ) : null}
      <PlayerCard entityId={current} compact={compact} />
    </>
  );
}

const nameOf = (entity: HassEntityState | null, entityId: string) => {
  const name = entity?.attributes.friendly_name;
  return typeof name === 'string' ? name : entityId;
};

// Musik: every PodConnect speaker HA has, by room (the aside keeps the current room's player). Each is controlled
// on its own entity; the status shown is that speaker's.
export function MusicScreen() {
  const {rooms} = useRoom();
  const unplaced = useCatalog().unplaced.players;
  const groups = [...rooms.filter(room => room.players.length), ...(unplaced.length
    ? [{id: '', name: 'Uden område', players: unplaced, lights: []}]
    : [])];
  return (
    <section id="music-view" className="response-widget" aria-labelledby="music-title">
      <header className="response-heading">
        <div>
          <h1 id="music-title">Musik</h1>
          <p>{groups.length ? 'Højttalere i hjemmet' : 'Ingen PodConnect-højttalere i Home Assistant'}</p>
        </div>
      </header>
      {groups.map(group => (
        <section key={group.id || 'unplaced'} className="pv-panel-speakers" aria-label={group.name}>
          <h2>{group.name}</h2>
          {group.players.map(id => (
            <PlayerCard key={id} entityId={id} />
          ))}
        </section>
      ))}
      {/* TODO(podvoice): Find musik, the queue and moving music between rooms stay PodConnect/PodVoice's; until
          they are reachable from HA they open in the PodVoice panel. */}
      <p className="screen-explanation">Find musik, kø og flyt mellem rum findes indtil videre i PodVoice-panelet.</p>
    </section>
  );
}
