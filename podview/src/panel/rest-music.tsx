// Ro's music button, as the wall page's rest view draws the room player over the photo (styles/kit.css, rest view:
// .player and #player-empty at the bottom right, 390 × 96, on the rest glass): the room's speaker with its cover,
// track and artist and one play/pause key; without a track only the music icon. A tap on the card wakes the panel
// to Musik; play/pause is the room player's own command (lib/ha/media.ts: the wish shows at once, the speaker
// confirms, nothing is locked or resent). At night the card is hidden, as there. Another Spotify login playing in the
// room is shown, never controlled.
import {useStore} from 'zustand';
import {commands} from '../lib/ha/commands';
import {media, playKey} from '../lib/ha/media';
import {accountOf, isActive} from '../lib/ha/podconnect';
import {useEntity} from '../lib/ha/transport';
import {KitButton} from '../lib/ui/KitButton';
import {useNav} from './nav';
import {useRest} from './Rest';
import {useRoomPlayer, useShownPlayer} from './screens/Music';
import {icon} from './ui';

function openMusic() {
  useRest.getState().wake();
  const nav = useNav.getState();
  nav.home();
  nav.push('music');
}

function Empty() {
  return (
    <button
      id="player-empty"
      type="button"
      className="pv-rest-player pv-rest-player-empty"
      aria-label="Åbn Musik"
      data-opens="music"
      onClick={openMusic}
    >
      <span className="player-empty-art">
        <img src={icon('music-note-beamed')} alt="" />
      </span>
    </button>
  );
}

function Playing({entityId}: {entityId: string}) {
  const entity = useEntity(entityId);
  const {model, lastKnown} = useShownPlayer(entity, entityId);
  const play = useStore(commands.store, state => state.wishes[playKey(entityId)]);
  if (!model?.title) return <Empty />;
  const other = accountOf(entity) === 'other' && isActive(entity);
  const live = !lastKnown && model.available && !other;
  const wished = play && (play.phase === 'sending' || play.phase === 'awaiting') ? (play.value as string) : null;
  const playing = (wished ?? model.state) === 'playing';
  return (
    <div className="pv-rest-player player" data-player-state={lastKnown ? 'last-known' : model.state}>
      <button
        type="button"
        className="pv-rest-player-open"
        aria-label={`Åbn Musik · ${model.title}${model.artist ? ` · ${model.artist}` : ''}`}
        data-opens="music"
        onClick={openMusic}
      >
        {model.artwork ? (
          <img className="cover" src={model.artwork} alt="" />
        ) : (
          <span className="cover pv-rest-player-cover" aria-hidden="true">
            <img src={icon('music-note-beamed')} alt="" />
          </span>
        )}
        <span className="track">
          <strong>{model.title}</strong>
          <span hidden={!model.artist}>{model.artist}</span>
        </span>
      </button>
      <KitButton
        className="main-control pv-kit pv-kit-button pv-btn"
        data-kit="button"
        data-kit-variant="icon"
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
    </div>
  );
}

export function RestMusic({night}: {night: boolean}) {
  const {current} = useRoomPlayer();
  if (night) return null;
  return current ? <Playing entityId={current} /> : <Empty />;
}
