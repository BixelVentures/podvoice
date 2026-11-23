// The speaker catalogue and the rules for one speaker row (from the pre-React speaker-output-view.js). Plain JS:
// the speaker picker (src/screens/player/SpeakerOutputView.tsx), the media fixtures and the tests read them.
import {mediaRoomBinding} from './media-observation.js';
// Current native catalogue in the existing output sheet; no action authority.
const fields = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const CATALOGUE_KEYS = ['ok', 'schema', 'bootId', 'roomId', 'accountId', 'status', 'catalogueId', 'retrievedAt',
  'source', 'speakers', 'moveAvailable', 'physicalResultVerified'];
const BLOCK_REASONS = ['no_rule', 'duplicate_rule', 'unavailable', 'no_homepod_id'];
const BASE_KEYS = ['speakerId', 'accountId', 'kind', 'nativeRoomId', 'homepodId', 'name', 'availability', 'default',
  'nativeSelected', 'outputSelected', 'selectable'];
const OPTIONAL_KEYS = ['startSelectable', 'startBlockedReason', 'moveBlockedReason'];
const PREFERRED = ['køkkenalrum', 'svend', 'frida'];

function catalogueRow(row, context, ids, rooms) {
  return row && typeof row === 'object' && !Array.isArray(row)
    && fields(row, [...BASE_KEYS, ...OPTIONAL_KEYS.filter(key => Object.hasOwn(row, key))])
    && !['startBlockedReason', 'moveBlockedReason'].some(key => Object.hasOwn(row, key) && row[key] !== null
      && !BLOCK_REASONS.includes(row[key]))
    && hex(row.speakerId) && !ids.has(row.speakerId) && text(row.nativeRoomId) && !rooms.has(row.nativeRoomId)
    && row.accountId === context.accountId && row.kind === 'configured_alias' && text(row.name)
    && ['available', 'unavailable', 'unknown'].includes(row.availability) && typeof row.default === 'boolean'
    && typeof row.nativeSelected === 'boolean' && [true, false, null].includes(row.outputSelected)
    && typeof row.selectable === 'boolean'
    && !(Object.hasOwn(row, 'startSelectable') && typeof row.startSelectable !== 'boolean')
    && !(row.homepodId !== null && (typeof row.homepodId !== 'string' || !/^[1-9][0-9]{0,19}$/.test(row.homepodId)));
}

export function speakerCatalogue(value, context, now = Date.now()) {
  if (!fields(value, CATALOGUE_KEYS) || value.ok !== true || value.schema !== 'podview.speaker-catalogue.v1'
    || value.bootId !== context.bootId || value.roomId !== context.roomId || value.accountId !== context.accountId
    || value.status !== 'observed' || !hex(value.catalogueId) || value.source !== 'podconnect.get_targets'
    || typeof value.moveAvailable !== 'boolean' || value.physicalResultVerified !== false
    || typeof value.retrievedAt !== 'number' || !Number.isFinite(value.retrievedAt)
    || value.retrievedAt * 1000 > now + 5000 || now - value.retrievedAt * 1000 > 30000
    || !Array.isArray(value.speakers) || value.speakers.length < 1 || value.speakers.length > 64) return null;
  const ids = new Set(), rooms = new Set();
  for (const row of value.speakers) {
    if (!catalogueRow(row, context, ids, rooms)) return null;
    ids.add(row.speakerId);
    rooms.add(row.nativeRoomId);
  }
  const rank = row => {
    const name = row.name.trim().toLocaleLowerCase('da').replace(/\s+homepod$/, '').replace(/['’]s$/, '');
    const index = PREFERRED.indexOf(name);
    return index < 0 ? PREFERRED.length : index;
  };
  return [...value.speakers].sort((a, b) =>
    rank(a) - rank(b) || a.name.localeCompare(b.name, 'da') || a.speakerId.localeCompare(b.speakerId));
}

export function configuredSpeakerLabel(value, snapshot, account, now = Date.now()) {
  const binding = mediaRoomBinding(snapshot, account);
  const rows = binding && speakerCatalogue(value, {bootId: snapshot.bootId, roomId: snapshot.roomId,
    accountId: account}, now);
  if (!rows) return '';
  const matches = rows.filter(row => row.accountId === binding.accountId && row.nativeRoomId === binding.nativeRoomId
    && row.homepodId === binding.nativeHomepodId);
  return matches.length === 1 ? matches[0].name : '';
}
// One table decides whether a speaker row can be chosen and which reason the row shows.
const SERVER_BLOCK_LABELS={
 no_rule:'Ingen PodConnect-regel tillader denne højttaler i rummet',
 duplicate_rule:'Flere PodConnect-regler matcher · ret opsætningen',
 unavailable:'Ikke tilgængelig',
 no_homepod_id:'Afspilningsmål er ikke bekræftet',
};
const ROW_STATES={
 ok:{disabled:false,label:ctx=>ctx.music?ctx.fenced==='accepted'?'Afventer bekræftelse af afspilningen'
  :'Kan vælges til den aktuelle afspilning':''},
 'busy-music':{disabled:true,label:()=>'Musikhandlingen behandles'},
 unavailable:{disabled:true,label:()=>'Ikke tilgængelig'},
 unknown:{disabled:true,label:()=>'Status ukendt'},
 'no-homepod':{disabled:true,label:()=>'Afspilningsmål er ikke bekræftet'},
 'no-start-rule':{disabled:true,
  label:(ctx,row)=>SERVER_BLOCK_LABELS[row?.startBlockedReason]||'Kan ikke vælges til afspilning'},
 'no-move':{disabled:true,
  label:(ctx,row)=>SERVER_BLOCK_LABELS[row?.moveBlockedReason]||'Kan ikke vælges til afspilning'},
 current:{disabled:false,label:()=>'Bruges til den aktuelle afspilning'},
};
// ctx: {busy, music, warmup, selection (capability), moveAvailable, fenced, actualOutput}
export function speakerRowState(row,ctx={}){
 const reason=row?.availability==='unknown'?'unknown':row?.availability!=='available'?'unavailable'
  :ctx.busy?'busy-music':ctx.music&&ctx.actualOutput?'current':!row.homepodId?'no-homepod'
  // Warm-up: the player shows the room's last report until its own read lands, so music may or may not play. Either
  // rule admits the speaker; the tap waits for that read (a last-known state never locks a speaker).
  :ctx.warmup?((ctx.moveAvailable===true&&row.selectable===true)||(ctx.selection===true&&row.startSelectable===true)
   ?'ok':'no-move')
  :ctx.music?(ctx.moveAvailable===true&&row.selectable===true?'ok':'no-move')
  :(ctx.selection===true&&row.startSelectable===true?'ok':'no-start-rule');
 const entry=ROW_STATES[reason];
 return {reason,disabled:entry.disabled,label:entry.label(ctx,row)};
}
// Only a music command in flight holds the speaker list; robot, light, search and dialogs do not.
export function musicBusy(controls){
 return !!(controls?.pending&&controls.activeOperation?.domain==='music');
}
