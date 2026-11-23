// The kit's SliderField (createKitSliderField in ui/kit.js) as a component, with the same elements, classes, data
// attributes and aria, so the stage stylesheet applies unchanged: label, value output, scope line and the native
// range. The finger owns the value during a gesture: a draft keeps its context from the first touch until release,
// survives renders with the same `session`, and only the native change (the release) commits. A cancelled gesture
// (Escape, pointer cancel, blur, a disabled or blocked model, or a new session) commits nothing and the field shows
// the model again until the next touch.
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {CSSProperties, KeyboardEvent} from 'react';
import type {SliderModel} from './model';

interface Field<C> {
  draft: number | null;
  context: C | undefined;
  editing: boolean;
  aborted: boolean;
}

const idle = <C,>(): Field<C> => ({draft: null, context: undefined, editing: false, aborted: false});
const cancelled = <C,>(): Field<C> => ({draft: null, context: undefined, editing: false, aborted: true});
const STEP_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
const bool = (value: boolean) => String(value) as 'true' | 'false';

export interface LightSliderProps<S, C> {
  id: string;
  model: SliderModel;
  // The authority the field is drawn for; a change the field may not carry a draft across cancels it.
  session: S;
  keepDraft: (before: S, after: S) => boolean;
  // The context a gesture is bound to, read at its first touch.
  context: () => C;
  onCommit: (value: number, context: C | undefined) => void;
  // The field's own element (light-lamp-level carries its live state and inertness).
  className?: string;
  hidden?: boolean;
  inert?: boolean;
  dataLampLive?: 'true' | 'false';
  labelledBy?: string;
  // A read-out that replaces the value text while no draft is held.
  valueTextOverride?: string | null;
  // The label's text role (the kit's lamp rows wrote it in the markup before the kit painted the output).
  labelText?: string;
}

export function LightSlider<S, C>(props: LightSliderProps<S, C>) {
  const {id, model, session, keepDraft} = props;
  const [field, setField] = useState<Field<C>>(idle);
  const [seen, setSeen] = useState({session, scope: model.scope ?? ''});
  const ref = useRef(field);
  const input = useRef<HTMLInputElement>(null);
  const blocked = !!model.disabled || !!model.pending && !model.editableWhilePending;
  // The kit's setModel: a new scope, a disabled or blocked model, or a session the draft may not cross cancels it.
  const forced = blocked || (model.scope ?? '') !== seen.scope || !keepDraft(seen.session, session);
  if (seen.session !== session || seen.scope !== (model.scope ?? '')) setSeen({session, scope: model.scope ?? ''});
  if (forced && (field.draft !== null || field.editing || field.context !== undefined || !field.aborted)) {
    setField(cancelled<C>());
  }
  const write = (next: Field<C>) => {
    ref.current = next;
    setField(next);
  };
  const latest = useRef({blocked, props});
  useLayoutEffect(() => {
    ref.current = field;
    latest.current = {blocked, props};
  });
  const begin = () => {
    if (latest.current.blocked) return false;
    const now = ref.current;
    if (!now.editing) write({...now, context: latest.current.props.context(), editing: true, aborted: false});
    else if (now.aborted) write({...now, aborted: false});
    return true;
  };
  // The release: the native change event (React's onChange is the input event for a range).
  useEffect(() => {
    const node = input.current;
    if (!node) return undefined;
    const change = () => {
      const now = ref.current, value = now.draft;
      const commit = !latest.current.blocked && !now.aborted && value !== null;
      const next = commit ? idle<C>() : {...now};
      ref.current = next;
      setField(next);
      if (commit) latest.current.props.onCommit(value, now.context);
    };
    node.addEventListener('change', change);
    return () => {
      node.removeEventListener('change', change);
    };
  }, []);
  const onInput = (raw: string) => {
    if (latest.current.blocked || ref.current.aborted) {
      write({...ref.current});
      return;
    }
    if (!ref.current.editing) begin();
    const value = Number(raw);
    write({...ref.current, draft: Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null});
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      write(cancelled<C>());
    } else if (STEP_KEYS.has(event.key)) begin();
  };
  const cancel = () => {
    write(cancelled<C>());
  };
  const observed = typeof model.value === 'number' && Number.isFinite(model.value) ? model.value : null;
  const sure = observed !== null;
  const draft = field.draft;
  const value = draft ?? observed ?? 0;
  const state = draft !== null ? 'draft' : model.pending ? 'pending' : sure ? 'known' : model.mixed ? 'mixed'
    : 'unknown';
  const formatted = `${String(value)} %`;
  const message = draft !== null ? formatted
    : model.valueText || (sure ? formatted : model.mixed ? 'Forskellige niveauer' : 'Niveau ukendt');
  const valueText = draft === null && props.valueTextOverride ? props.valueTextOverride
    : message.replace(/ %$/, ' procent');
  const scope = model.scope ?? '';
  return (
    <div
      className={props.className ? `pv-kit-slider-field ${props.className}` : 'pv-kit-slider-field'}
      hidden={props.hidden}
      inert={props.inert}
      data-lamp-live={props.dataLampLive}
      data-field-state={state}
      aria-busy={bool(!!model.pending)}
    >
      <label id={`${id}-label`} htmlFor={id} data-kit-text="field-label">
        {props.labelText ?? 'Lysstyrke'}
      </label>
      <output
        htmlFor={id}
        data-kit-text={(draft !== null || sure) && message === formatted ? 'control-value' : 'meta'}
      >
        {message}
      </output>
      <p data-kit-text="meta" id={`${id}-scope`} hidden={!scope}>
        {scope}
      </p>
      <input
        ref={input}
        className="pv-kit pv-kit-slider pv-slider"
        data-kit="slider"
        data-kit-identity="light"
        data-value-known={bool(draft !== null || sure)}
        type="range"
        min="0"
        max="100"
        step="1"
        id={id}
        value={String(value)}
        style={{'--pv-slider-progress': `${String(value)}%`} as CSSProperties}
        disabled={!!model.disabled}
        aria-disabled={bool(blocked)}
        aria-labelledby={props.labelledBy ?? `${id}-label`}
        aria-describedby={`${id}-scope`}
        aria-valuetext={valueText}
        onPointerDown={begin}
        onKeyDown={onKeyDown}
        onChange={event => {
          onInput(event.currentTarget.value);
        }}
        onPointerCancel={cancel}
        onBlur={cancel}
      />
    </div>
  );
}
