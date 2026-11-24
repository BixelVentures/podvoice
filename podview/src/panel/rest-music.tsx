// Ro's music button: the room player over the photo (at the bottom right, 390 × 96, on the rest glass): the
// room's speaker with its cover,
// track and artist and one play/pause key; without a track only the music icon. A tap on the card wakes the panel
// to Musik; play/pause is the room player's own command (lib/ha/media.ts: the wish shows at once, the speaker
// confirms, nothing is locked or resent). At night the card is hidden, as there. Another Spotify login playing in the
// room is shown, never controlled.
import {Button} from 'react-aria-components';
import {useStore} from 'zustand';
import {commands} from '../lib/ha/commands';
import {media, playKey} from '../lib/ha/media';
import {accountOf, isActive} from '../lib/ha/podconnect';
import {useEntity} from '../lib/ha/transport';
import {cx, Icon, IconButton, pressable} from '../ui';
import {useNav} from './nav';
import {useRest} from './Rest';
import {useRoomPlayer, useShownPlayer} from './screens/Music';

// The card on the rest glass at Ro's bottom right, 96 high.
const CARD =
  'absolute right-pv-s3 bottom-pv-s3 z-2 box-border h-24 overflow-hidden rounded-pv-l bg-pv-surface/88 p-pv-s2 ' +
  'text-pv-ink shadow-pv backdrop-blur-[16px]';

function openMusic() {
  useRest.getState().wake();
  const nav = useNav.getState();
  nav.home();
  nav.push('music');
}

function Empty() {
  return (
    <Button
      className={cx(pressable, CARD, 'grid place-items-center px-pv-s3')}
      aria-label="Åbn Musik"
      data-opens="music"
      data-rest-player="empty"
      onPress={openMusic}
    >
      <Icon name="music-note-beamed" className="size-pv-icon-m brightness-0" />
    </Button>
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
    <div
      className={cx(CARD, 'grid w-[390px] grid-cols-[minmax(0,1fr)_48px] grid-rows-[64px] items-center gap-pv-s2')}
      data-rest-player="playing"
      data-player-state={lastKnown ? 'last-known' : model.state}
    >
      <Button
        className={cx(pressable, 'grid h-16 min-w-0 grid-cols-[64px_minmax(0,1fr)] items-center gap-pv-s2',
          'rounded-pv-s bg-transparent text-left')}
        aria-label={`Åbn Musik · ${model.title}${model.artist ? ` · ${model.artist}` : ''}`}
        data-opens="music"
        onPress={openMusic}
      >
        {model.artwork ? (
          <img className="size-16 rounded-pv-s object-cover" src={model.artwork} alt="" decoding="async" />
        ) : (
          <span className="grid size-16 place-items-center rounded-pv-s bg-pv-surface-2" aria-hidden="true">
            <Icon name="music-note-beamed" className="size-pv-icon-m brightness-0" />
          </span>
        )}
        <span className="flex min-h-12 min-w-0 flex-col justify-center">
          <strong className="truncate text-pv-body font-semibold text-pv-ink">{model.title}</strong>
          <span className="truncate text-pv-meta text-pv-ink-2" hidden={!model.artist}>
            {model.artist}
          </span>
        </span>
      </Button>
      <IconButton
        variant="quiet"
        size="round"
        aria-label={playing ? 'Pause' : 'Afspil'}
        busy={play?.phase === 'sending' || play?.phase === 'awaiting'}
        data-wish={play?.phase ?? 'none'}
        hidden={!(playing ? model.can.pause : model.can.play)}
        isDisabled={!live}
        onPress={() => {
          media.playPause(entityId, !playing);
        }}
      >
        <Icon name={playing ? 'pause-fill' : 'play-fill'} className="size-pv-icon-m brightness-0" />
      </IconButton>
    </div>
  );
}

export function RestMusic({night}: {night: boolean}) {
  const {current} = useRoomPlayer();
  if (night) return null;
  return current ? <Playing entityId={current} /> : <Empty />;
}
