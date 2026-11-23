// Højttalere: the speaker sheet inside the shell's dialog (#rooms). The shell opens and closes the dialog (its
// container); React draws everything inside it: the title, the note, the rows and »Opdater liste«. Three owners
// fill it: PodConnect's speakers for music (SpeakerPicker, speakers.ts), radio's targets while radio holds the
// sheet (source.ts outputsModel), and the local preview's example speakers (publishDemoSpeakers). Radio opens the
// sheet itself when a station needs a speaker, and closes it when it no longer holds it.
import {useEffect, useRef, useState} from 'react';
import {create, useStore} from 'zustand';
import {createStore} from 'zustand/vanilla';
import {mountScreen} from '../../app/mount';
import type {RadioTarget} from '../../lib/api/radio';
import {KitButton} from '../../lib/ui/KitButton';
import type {RadioSource} from '../radio/source';
import type {SpeakerPicker, SpeakersState} from './speakers';
import {usePlayer} from './store';
import {openModal} from '../../lib/ui/modal';

// One example speaker in the local preview (the shell's scene owns them).
export interface DemoSpeaker {
  targetId: string;
  name: string;
  detail: string;
  pressed: boolean;
  disabled: boolean;
  revision: string;
}

interface DemoSpeakers {
  rows: readonly DemoSpeaker[];
  choose: (targetId: string) => void;
}

export const useDemoSpeakers = create<DemoSpeakers>(() => ({rows: [], choose: () => undefined}));

// The shell's scene after its render; an unchanged list notifies nobody.
export function publishDemoSpeakers(rows: readonly DemoSpeaker[], choose: (targetId: string) => void) {
  const state = useDemoSpeakers.getState();
  if (JSON.stringify(state.rows) !== JSON.stringify(rows) || state.choose !== choose)
    useDemoSpeakers.setState({rows, choose});
}

const EMPTY_PICKER = createStore<SpeakersState>(() => ({nextDestination: null, pendingChoice: null,
  queuedMove: null, rows: [], note: {hidden: false, text: 'Åbn listen for at hente aktuelle højttalere.'},
  busy: false, refreshDisabled: true}));
const EMPTY_RADIO = createStore(() => ({outputOpen: false}));

function RowContent({name, detail, status}: {name: string; detail: string; status: string}) {
  return (
    <>
      <img src="assets/icons/speaker-output.svg" alt="" />
      <span>
        <strong>{name}</strong>
        <small>{detail}</small>
      </span>
      <span className="target-status">{status}</span>
    </>
  );
}

const ROW_CLASS = 'pv-row pv-btn pv-kit pv-kit-listrow';

// A focused row that goes away (its speaker left the list) hands focus to »Opdater liste«, never to the page. The
// row lists run it: they are what re-renders when a row goes.
// `takeGone` answers the focused row once it has left the document (and forgets it).
type Focused = () => Element | null;
function useFocusHandoff(takeGone: Focused) {
  useEffect(() => {
    const row = takeGone();
    if (!row) return;
    const doc = row.ownerDocument, active = doc.activeElement;
    if (!active || active === row || active === doc.body || !active.isConnected)
      doc.querySelector<HTMLElement>('#rooms .speaker-list-refresh')?.focus();
  });
}

function MusicRows({picker, focusedRow}: {picker: SpeakerPicker; focusedRow: Focused}) {
  const rows = useStore(picker.store, state => state.rows);
  useFocusHandoff(focusedRow);
  return rows.map(view => (
    <KitButton
      key={view.key}
      className={ROW_CLASS}
      data-kit="listrow"
      data-speaker-id={view.row.speakerId}
      aria-pressed={view.pressed}
      aria-label={view.label}
      isDisabled={view.disabled}
      onPress={() => {
        void picker.choose(view.key);
      }}
    >
      <RowContent name={view.row.name} detail={view.detail} status={view.status} />
    </KitButton>
  ));
}

function RadioRows({radio, focusedRow}: {radio: RadioSource; focusedRow: Focused}) {
  // Drawn for the state this render read (so a memoized render follows every change).
  const model = radio.outputsModel(useStore(radio));
  useFocusHandoff(focusedRow);
  if (!model) return null;
  const {targets, actualTargetId, nextTargetId, lastTargetId, selectable, onChoose} = model;
  return targets.map((row: RadioTarget) => {
    const actual = actualTargetId === row.id;
    return (
      <KitButton
        key={`r:${row.id}`}
        className={ROW_CLASS}
        data-kit="listrow"
        aria-pressed={actual}
        isDisabled={!selectable(row)}
        onPress={() => {
          if (selectable(row)) onChoose(row);
        }}
      >
        <RowContent
          name={row.name}
          detail={row.availability === 'available' ? 'Tilgængelig' : 'Ikke tilgængelig'}
          status={actual ? 'Aktuelt output' : nextTargetId === row.id ? 'Næste afspilning'
            : lastTargetId === row.id ? 'Seneste output' : row.default ? 'Standardrum' : ''}
        />
      </KitButton>
    );
  });
}

function DemoRows() {
  const {rows, choose} = useDemoSpeakers();
  return rows.map(row => (
    <KitButton
      key={row.targetId}
      className="pv-kit pv-kit-listrow pv-row"
      data-kit="listrow"
      data-target-id={row.targetId}
      data-revision={row.revision}
      aria-pressed={row.pressed}
      isDisabled={row.disabled}
      onPress={() => {
        choose(row.targetId);
      }}
    >
      <RowContent name={row.name} detail={row.detail} status="" />
    </KitButton>
  ));
}

// The refresh button: busy while the list is read again (the kit's progress), never locked otherwise.
function Refresh({picker, disabled}: {picker: SpeakerPicker; disabled: boolean}) {
  const [busy, setBusy] = useState(false);
  return (
    <KitButton
      className="speaker-list-refresh pv-button pv-ghost pv-kit pv-kit-button pv-btn"
      data-kit="button"
      data-feedback="progress"
      {...(busy ? {'data-pv-state': 'busy'} : {})}
      aria-busy={busy}
      isDisabled={disabled}
      onPress={() => {
        if (busy) return;
        setBusy(true);
        void picker.open().finally(() => {
          setBusy(false);
        });
      }}
    >
      Opdater liste
    </KitButton>
  );
}

export function SpeakerSheet({dialog}: {dialog: HTMLDialogElement}) {
  const host = usePlayer(state => state.host) as {live?: boolean; liveRadio?: RadioSource | null};
  const speakers = usePlayer(state => state.speakers) as SpeakerPicker | null;
  const live = host.live === true, picker = live ? speakers : null;
  const radio = live ? host.liveRadio ?? null : null;
  const view = useStore(picker?.store ?? EMPTY_PICKER);
  const radioOpen = useStore((radio ?? EMPTY_RADIO), state => state.outputOpen);
  const radioMessage = useStore((radio ?? EMPTY_RADIO),
    () => radio?.outputsModel()?.message ?? '');
  // Radio holds the sheet while outputOpen: it opens the dialog when it needs a speaker and closes it after.
  const heldByRadio = useRef(false);
  useEffect(() => {
    if (radioOpen) {
      heldByRadio.current = true;
      if (!dialog.open) openModal(dialog);
    } else if (heldByRadio.current) {
      heldByRadio.current = false;
      if (dialog.open) dialog.close();
    }
  }, [radioOpen, dialog]);
  useEffect(() => {
    const closed = () => {
      picker?.closed();
      radio?.closeOutputs();
    };
    const cancelled = () => {
      radio?.closeOutputs();
    };
    dialog.addEventListener('close', closed);
    dialog.addEventListener('cancel', cancelled);
    return () => {
      dialog.removeEventListener('close', closed);
      dialog.removeEventListener('cancel', cancelled);
    };
  }, [dialog, picker, radio]);
  useEffect(() => {
    if (picker) dialog.classList.add('pv-card');
  }, [dialog, picker]);
  // A focused row that goes away (its speaker left the list) hands focus to »Opdater liste«, never to the page.
  const options = useRef<HTMLDivElement>(null);
  const focusedRow = useRef<Element | null>(null);
  const takeGone = () => {
    const row = focusedRow.current;
    if (!row || row.isConnected) return null;
    focusedRow.current = null;
    return row;
  };
  useEffect(() => {
    const node = options.current;
    if (!node) return;
    const focused = (event: FocusEvent) => {
      focusedRow.current = event.target as Element
    };
    node.addEventListener('focus', focused, true);
    return () => {
      node.removeEventListener('focus', focused, true);
    };
  }, []);
  const note = radioOpen ? {hidden: false, text: radioMessage} : view.note;
  return (
    <form method="dialog">
      <header className="pv-dialog-header">
        <h2 id="room-title">{live ? 'Højttalere' : 'Afspil på'}</h2>
        <button className="dialog-close pv-kit pv-kit-button pv-btn pv-dialog-close" data-kit="button"
          data-kit-variant="icon" value="close" aria-label="Luk">
          <img src="assets/icons/x-lg.svg" alt="" />
        </button>
      </header>
      {live ? (
        <p className="pv-dialog-description" role="status" aria-live="polite" hidden={note.hidden}>{note.text}</p>
      ) : (
        <p className="pv-dialog-description">Vælg højttaler til din musik.</p>
      )}
      <div
        id="room-options"
        className="pv-dialog-content"
        aria-busy={live ? (!radioOpen && view.busy) : undefined}
        ref={options}
      >
        {!live ? <DemoRows /> : radioOpen && radio ? <RadioRows radio={radio} focusedRow={takeGone} />
          : picker ? <MusicRows picker={picker} focusedRow={takeGone} /> : null}
      </div>
      {picker ? (
        <div className="pv-actions pv-dialog-actions">
          <Refresh picker={picker} disabled={!radioOpen && view.refreshDisabled} />
        </div>
      ) : null}
    </form>
  );
}

// The shell mounts the sheet once into its dialog.
export function mountSpeakerSheet(dialog: HTMLDialogElement): () => void {
  const root = mountScreen(dialog, <SpeakerSheet dialog={dialog} />);
  return () => {
    root.unmount();
  };
}
