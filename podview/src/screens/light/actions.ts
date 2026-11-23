// Lys: what a tap does. Every tap is checked against the shell's facts as they are at the moment of the tap (not the
// drawing it was made on): a room, lamp or scene that is no longer current does nothing. Live, a tap goes to the
// command store (commands.ts) or the area reads (area.ts); in the local preview it is a scene event for the shell.
import {lightAreaPending, readLightArea, rememberScene, useLightArea} from './area';
import {actCurrentLight, useLightCommands} from './commands';
import {currentLightDevice, lightPorts} from './host';
import type {LightDevice} from './host';
import {lampRows, lightPage, roomModel, sameBinding, sameQueuedBinding, scenesModel, sceneBinding} from './model';
import type {LampBinding, LightInputs, SceneChip, SceneLevelBinding} from './model';

export const inputsNow = (): LightInputs => ({
  facts: lightPorts().facts(),
  area: useLightArea.getState(),
  entries: useLightCommands.getState().entries,
});

function shown(inputs: LightInputs, deviceId: string | undefined): LightDevice | undefined {
  const {facts} = inputs;
  return currentLightDevice(facts.state, facts.live) ?? facts.state.devices?.find(row => row.id === deviceId);
}

// A room card: show that room (live: read its area; local: select it in the example).
export function selectRoom(id: string, deviceId: string | undefined) {
  const inputs = inputsNow(), light = shown(inputs, deviceId), model = roomModel(inputs, light);
  const row = model?.rows.find(item => item.id === id);
  if (!light || !model || !row || row.selected) return;
  if (model.live) void readLightArea(id);
  else lightPorts().dispatch({type: 'light-select', ...sceneBinding(inputs.facts, light), optionId: `room:${id}`});
}

// A room's switch: every lamp in it on or off.
export function roomPower(id: string, deviceId: string | undefined) {
  const inputs = inputsNow(), light = shown(inputs, deviceId), model = roomModel(inputs, light);
  const row = model?.rows.find(item => item.id === id);
  if (!light || !model || !row?.enabled || !row.action) return;
  if (model.live) void actCurrentLight('toggle', {}, {areaId: id});
  else {
    lightPorts().dispatch({type: 'light-room-power', ...sceneBinding(inputs.facts, light), roomId: id,
      action: row.action});
  }
}

// »Sluk alt« / »Gendan lys« (local preview only).
export function homePower(deviceId: string | undefined) {
  const inputs = inputsNow(), light = shown(inputs, deviceId), model = roomModel(inputs, light);
  if (!light || !model || model.live) return;
  const binding = sceneBinding(inputs.facts, light);
  if (model.globalRestore) lightPorts().dispatch({type: 'light-home-restore', ...binding});
  else if (model.globalEnabled) lightPorts().dispatch({type: 'light-home-power', ...binding, action: 'turn_off'});
}

// The lamp as it is now, with the authority it may act with.
function lampNow(id: string) {
  const inputs = inputsNow(), light = currentLightDevice(inputs.facts.state, inputs.facts.live);
  return lampRows(inputs, light).find(row => row.id === id);
}

// A lamp's switch: acts only while the lamp is drawn with its current authority and no brightness waits behind a
// pending command. Returns whether it acted.
export function toggleLamp(id: string, drawn: LampBinding | null): boolean {
  const current = lampNow(id), binding = current?.binding;
  if (!current || !binding || !drawn || !sameBinding(drawn, binding) || binding.canQueueBrightness) return false;
  if (binding.local) {
    lightPorts().dispatch({type: 'light-toggle', sessionId: binding.sessionId, taskId: binding.taskId,
      revision: binding.revision, optionId: id});
  } else void actCurrentLight(current.on ? 'turn_off' : 'turn_on', {}, {entityId: id});
  return true;
}

// A released brightness gesture: one wish for the lamp it began on, while that lamp's authority is unchanged (a
// brightness queued behind a pending command keeps its authority). Returns whether it acted.
export function commitLamp(id: string, value: number, wish: LampBinding | null | undefined): boolean {
  const current = lampNow(id), binding = current?.binding;
  const same = wish?.canQueueBrightness ? sameQueuedBinding(wish, binding) : !!wish && sameBinding(wish, binding);
  if (!Number.isInteger(value) || value < 0 || value > 100 || !current?.dimmable || !binding || !same) return false;
  if (binding.local) {
    lightPorts().dispatch({type: 'light-brightness', sessionId: binding.sessionId, taskId: binding.taskId,
      revision: binding.revision, optionId: id, value});
  } else void actCurrentLight('brightness', {percent: value}, {entityId: id});
  return true;
}

// A scene chip: live it asks the owner for the scene and remembers it once accepted in the same area; local it is a
// scene event.
export function selectScene(chip: SceneChip) {
  const inputs = inputsNow();
  if (inputs.facts.live) {
    const area = currentLightDevice(inputs.facts.state, true)?.lightScope?.areaId;
    void Promise.resolve(actCurrentLight('scene', {choiceId: chip.binding.optionId},
      {sceneId: chip.binding.optionId})).then(result => {
      const now = inputsNow().facts;
      if (result?.outcome === 'accepted' && area && currentLightDevice(now.state, true)?.lightScope?.areaId === area) {
        rememberScene(chip.binding.optionId, area);
      }
    });
  } else lightPorts().dispatch({type: 'light-scene-select', ...chip.binding});
}

// The scene level slider's release: for the scene (live) or the room (local) it began on. Returns whether it acted.
export function commitSceneLevel(value: number, binding: SceneLevelBinding | null | undefined): boolean {
  if (!binding) return false;
  const inputs = inputsNow(), light = currentLightDevice(inputs.facts.state, inputs.facts.live);
  const now = scenesModel(inputs, light, null).binding;
  if (binding.sessionId !== inputs.facts.state.sessionId || binding.taskId !== light?.id ||
    binding.revision !== light.revision || binding.optionId !== now?.optionId || binding.roomId !== now.roomId) {
    return false;
  }
  if (inputs.facts.live) void actCurrentLight('brightness', {percent: value}, {sceneId: binding.optionId ?? ''});
  else lightPorts().dispatch({type: 'light-room-level', ...binding, value});
  return true;
}

// »Opdater lys« in the empty card: read home again (not a command).
export function reloadHome() {
  void lightPorts().loadLiveHome();
}

export const areaPending = lightAreaPending;

// A scene command shows its progress on its chip (the shell keeps its toast clear of it).
export function sceneCommandShown() {
  const page = lightPage(inputsNow());
  return !!page && !page.empty && page.scenes.visible && page.scenes.chips.some(chip => chip.loading);
}
