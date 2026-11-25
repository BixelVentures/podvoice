// Ro's music card (A-FotoRo: always at the bottom right, a glass card): the room's speaker as the player shows it.
// Music: the cover, the track and the artist with one pause/play key; radio: the station's logo, »Direkte · <room>«
// and a stop key; nothing playing: »Vælg musik« with the part of the day and the arrow. A tap on the card wakes the
// panel to Musik (or Radio); the key is the room player's own command (lib/ha/media.ts and lib/ha/radio.ts: the wish
// shows at once, the speaker confirms, nothing is locked or resent), and Ro stays. Another Spotify login playing in
// the room is shown, never controlled.
import {useStore} from 'zustand';
import {commands} from '../lib/ha/commands';
import {discoveryPeriodLabel} from '../lib/format/discovery';
import {media, playKey} from '../lib/ha/media';
import {accountOf, isActive} from '../lib/ha/podconnect';
import {radio} from '../lib/ha/radio';
import {useEntity} from '../lib/ha/transport';
import {useNow} from '../lib/hooks/clock';
import {GlassCard} from '../ui/Rest';
import type {ScreenId} from './nav';
import {useNav} from './nav';
import {useRest} from './Rest';
import {useRoomPlayer, useShownPlayer} from './screens/Music';
import {useRadioNow} from './screens/radio-now';

function open(screen: ScreenId) {
  useRest.getState().wake();
  const nav = useNav.getState();
  nav.home();
  nav.push(screen);
}

function Empty() {
  const now = useNow();
  return (
    <GlassCard data-rest-player="empty" chip={{glyph: 'music', surface: 'bg-pv-music'}} prim="Vælg musik"
      ctx={discoveryPeriodLabel(now)} label="Åbn Musik · Vælg musik" opens="music" onOpen={() => { open('music'); }} />
  );
}

function Playing({entityId}: {entityId: string}) {
  const entity = useEntity(entityId);
  const {model, lastKnown} = useShownPlayer(entity, entityId);
  const play = useStore(commands.store, state => state.wishes[playKey(entityId)]);
  const radioNow = useRadioNow();
  const onRadio = entity?.attributes.podconnect_source === 'radio' && radioNow.station &&
    radioNow.current?.entity_id === entityId && radioNow.phase === 'spiller';
  if (onRadio && radioNow.station) {
    const station = radioNow.station;
    return (
      <GlassCard data-rest-player="radio" data-player-state={radioNow.stopping ? 'stopping' : 'playing'}
        chip={{picture: station.logo}} prim={station.name} ctx={`Direkte · ${radioNow.current?.name ?? ''}`}
        label={`Åbn Radio · ${station.name}`} opens="radio" onOpen={() => { open('radio'); }}
        control={{icon: 'stop', label: 'Stop radio', busy: radioNow.stopping, onPress: () => {
          radio.stop(radioNow.current);
        }}} />
    );
  }
  if (!model?.title) return <Empty />;
  const other = accountOf(entity) === 'other' && isActive(entity);
  const live = !lastKnown && model.available && !other;
  const wished = play && (play.phase === 'sending' || play.phase === 'awaiting') ? (play.value as string) : null;
  const playing = (wished ?? model.state) === 'playing';
  const can = playing ? model.can.pause : model.can.play;
  return (
    <GlassCard data-rest-player="playing" data-player-state={lastKnown ? 'last-known' : model.state}
      chip={model.artwork ? {picture: model.artwork} : {glyph: 'music', surface: 'bg-pv-music'}}
      prim={model.title} ctx={[model.artist, other ? 'en anden konto' : ''].filter(Boolean).join(' · ')}
      label={`Åbn Musik · ${model.title}${model.artist ? ` · ${model.artist}` : ''}`} opens="music"
      onOpen={() => { open('music'); }}
      control={can ? {icon: playing ? 'pause' : 'play', label: playing ? 'Pause' : 'Afspil', disabled: !live,
        busy: play?.phase === 'sending' || play?.phase === 'awaiting', onPress: () => {
          media.playPause(entityId, !playing);
        }} : null} />
  );
}

export function RestMusic() {
  const {current} = useRoomPlayer();
  return current ? <Playing entityId={current} /> : <Empty />;
}
