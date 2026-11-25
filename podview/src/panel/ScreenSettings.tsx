// Skærm og enhed (the canvas's A-Skaerm), a kit Sheet over the page; the topbar's clock opens it, as the old wall
// page's did. Lysstyrke is the wall's real screen brightness through the Home Assistant Companion app's kiosk mode
// (lib/ha/wall.ts): it reads the app's kiosk brightness sensor and sends `kiosk_set_brightness` once at the end of a
// drag. Without kiosk mode the slider is shown disabled and says why: nothing is faked. Automatisk dæmpning is the
// wall's own night dimming of Ro (21–7), on by default (screen-settings.ts). »Om skærmen« lists what HA knows: the
// Wi-Fi, the Companion device, the link to Home Assistant (»Prøv igen« without it, G3), the room (»Rum«) and
// »Version« (integration, build and bundle) for diagnostics. The canvas's removed »Denne skærm« section stays
// removed (owner, 9 Nov).
import {useMemo} from 'react';
import {useEntities, useLink, usePanelConfig, transport} from '../lib/ha/transport';
import {useWish} from '../lib/ha/commands';
import {brightnessKey, brightnessOf, findWallDevices, wall, wifiOf} from '../lib/ha/wall';
import {Button, ListRow, ListValue, SectionLabel, Sheet, Slider, SwitchKey} from '../ui';
import {BUILD, runningBundleId} from './build';
import {useRoom} from './room';
import {useScreenSettings} from './screen-settings';
import {Notice, wishNotice} from './ui';

export const KIOSK_TEXT = 'iPad · styres via Home Assistant-appens kiosktilstand.';
export const NO_KIOSK_TEXT = 'Lysstyrken styres af Home Assistant-appens kiosktilstand, som ikke er slået til på ' +
  'nogen skærm.';
export const KIOSK_OFF_NOTE = 'Slå kiosktilstand til i Home Assistant-appen på væggen for at styre lysstyrken herfra.';

/** The version line: what the wall runs (an update of the integration reaches it after a Home Assistant restart). */
export function useDiagnostics() {
  const config = usePanelConfig();
  const version = typeof config?.integration_version === 'string' ? config.integration_version : '?';
  const bundle = runningBundleId();
  return `PodVoice ${version} · build ${BUILD}${bundle ? ` · ${bundle}` : ''}`;
}

function Content() {
  const {generation, connected} = useLink();
  // The Companion devices are read from HA's registries when the sheet opens (and after a resync).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- generation re-reads the registries after a resync
  const device = useMemo(() => findWallDevices(transport.current())[0] ?? null, [generation]);
  const [brightness, kiosk, ssid] = useEntities(device ? [device.brightness, device.kioskMode, device.ssid] : []);
  const wish = useWish(device ? brightnessKey(device.slug) : '');
  const autoDim = useScreenSettings(state => state.autoDim);
  const setAutoDim = useScreenSettings(state => state.setAutoDim);
  const {room} = useRoom();
  const diagnostics = useDiagnostics();
  const level = brightnessOf(brightness ?? null);
  const controllable = !!device?.notify && kiosk?.state === 'on' && level !== null;
  const pending = wish && (wish.phase === 'sending' || wish.phase === 'awaiting') ? (wish.value as number) : null;
  const name = device ? [device.model, device.name].filter((part, index, all) => part && all.indexOf(part) === index)
    .join(' · ') : '';
  return (
    <div className="flex flex-col gap-6" data-device={controllable ? 'kiosk' : 'unbound'}>
      <section className="flex flex-col">
        <ListRow tone="line" className="min-h-14 flex-col items-stretch justify-center gap-0 border-pv-ink/7">
          <Slider variant="kit" showLabel label="Lysstyrke" tone="ink" value={controllable ? (pending ?? level) : null}
            isDisabled={!controllable} format={value => `${String(value)} %`} onCommit={value => {
              if (device && controllable) wall.brightness(device, value);
            }} />
          {controllable ? <Notice text={wishNotice(wish)} /> : (
            <p className="pb-3 text-[15px] leading-5 text-pv-ink-3">{KIOSK_OFF_NOTE}</p>
          )}
        </ListRow>
        <ListRow tone="line" className="min-h-14 justify-between border-pv-ink/7">
          <span className="flex flex-col">
            <span className="text-[17px] leading-6 font-semibold" id="screen-auto-dim">Automatisk dæmpning</span>
            <span className="text-[15px] leading-5 text-pv-ink-3">Nat 21–7 dæmpes fra Home Assistant.</span>
          </span>
          <SwitchKey aria-label="Automatisk dæmpning" isSelected={autoDim} onChange={setAutoDim} />
        </ListRow>
      </section>
      <section className="flex flex-col gap-2" aria-labelledby="screen-about">
        <SectionLabel id="screen-about">Om skærmen</SectionLabel>
        <ListRow tone="line" className="min-h-14 justify-between border-pv-ink/7">
          <span className="font-semibold">Wi-Fi</span>
          <ListValue className="text-base">{wifiOf(ssid ?? null)}</ListValue>
        </ListRow>
        <ListRow tone="line" className="min-h-14 justify-between border-pv-ink/7">
          <span className="font-semibold">Enhed</span>
          <ListValue className="truncate text-base">{name || 'Ikke oplyst'}</ListValue>
        </ListRow>
        <ListRow tone="line" className="min-h-14 justify-between border-pv-ink/7">
          <span className="font-semibold">Home Assistant</span>
          {connected ? <ListValue className="text-base">Forbundet</ListValue> : (
            // G3: read everything again from Home Assistant; nothing chosen is reset and nothing is resent.
            <span className="flex items-center gap-3">
              <ListValue className="text-base" role="status">Ingen forbindelse</ListValue>
              <Button variant="sekundaer" size={44} onPress={() => {
                transport.resync();
              }}>Prøv igen</Button>
            </span>
          )}
        </ListRow>
        <ListRow tone="line" className="min-h-14 justify-between border-pv-ink/7">
          <span className="font-semibold">Rum</span>
          <ListValue className="text-base">{room?.name ?? 'Ikke oplyst'}</ListValue>
        </ListRow>
        {/* The build stays for diagnostics, as a labelled row (G7 #23). */}
        <ListRow tone="line" className="min-h-14 justify-between gap-6 border-b-0">
          <span className="shrink-0 font-semibold">Version</span>
          <ListValue className="min-w-0 shrink truncate font-pv-mono text-[13px] leading-[18px]" data-diag="">
            {diagnostics}</ListValue>
        </ListRow>
      </section>
    </div>
  );
}

export function ScreenSettings({isOpen, onClose}: {isOpen: boolean; onClose: () => void}) {
  const device = isOpen ? findWallDevices(transport.current())[0] : undefined;
  return (
    <Sheet id="screen-settings" isOpen={isOpen} onClose={onClose} title="Skærm og enhed"
      description={device ? KIOSK_TEXT : NO_KIOSK_TEXT}>
      <Content />
    </Sheet>
  );
}
