// A level (volume, brightness) on React Aria Components' Slider. It follows the finger locally and sends once when
// the gesture ends (onChangeEnd, also when the gesture is cancelled); a change without a gesture (assistive
// technology setting the value) sends at once. So a draft never outlives its gesture; while no gesture runs the
// slider shows `value` (the wish, else what Home Assistant reports). `null` is a level HA does not report.
import {useContext, useLayoutEffect, useRef, useState} from 'react';
import type {RefObject} from 'react';
import {
  Label, Slider as AriaSlider, SliderOutput, SliderStateContext, SliderThumb, SliderTrack,
} from 'react-aria-components';
import {cx} from './tv';

export interface SliderProps {
  label: string;
  value: number | null;
  min?: number;
  max?: number;
  isDisabled?: boolean;
  format: (value: number) => string;
  onCommit: (value: number) => void;
  className?: string;
  [data: `data-${string}`]: string | undefined;
}

export const UNKNOWN_LEVEL = 'Ikke oplyst';

type Dragging = RefObject<(() => boolean) | null>;

// Tells the slider whether its thumb is in a gesture right now.
function DragProbe({draggingRef}: {draggingRef: Dragging}) {
  const state = useContext(SliderStateContext);
  useLayoutEffect(() => {
    draggingRef.current = state ? () => state.isThumbDragging(0) : null;
  }, [state, draggingRef]);
  return null;
}

export function Slider({label, value, min = 0, max = 100, isDisabled = false, format, onCommit, className,
  ...data}: SliderProps) {
  const [draft, setDraft] = useState<number | null>(null);
  const draggingRef: Dragging = useRef(null);
  const known = value !== null || draft !== null;
  const shown = draft ?? value ?? min;
  return (
    <AriaSlider
      {...data}
      className={cx('grid grid-cols-[minmax(0,1fr)_auto] font-pv text-pv-body', className)}
      minValue={min}
      maxValue={max}
      step={1}
      value={shown}
      isDisabled={isDisabled}
      data-known={known ? 'true' : 'false'}
      onChange={next => {
        if (draggingRef.current?.() === false) {
          setDraft(null);
          onCommit(next);
        } else setDraft(next);
      }}
      onChangeEnd={next => {
        setDraft(null);
        onCommit(next);
      }}
    >
      <DragProbe draggingRef={draggingRef} />
      <Label className="min-w-0 truncate font-medium text-pv-ink-2">{label}</Label>
      <SliderOutput className="text-right font-semibold text-pv-ink tabular-nums">
        {() => (known ? format(shown) : UNKNOWN_LEVEL)}
      </SliderOutput>
      {/* The thumb's centre travels between half a thumb from either end, as a native range's does. */}
      <SliderTrack className="relative col-span-2 mx-3 h-pv-hit touch-none">
        {({state}) => (
          <>
            <span className="absolute -inset-x-3 top-1/2 h-1.5 -translate-y-1/2 rounded-pv-pill bg-pv-line" />
            <span
              className="absolute top-1/2 -left-3 h-1.5 -translate-y-1/2 rounded-pv-pill bg-pv-ink"
              style={{width: `calc(${String(state.getThumbPercent(0) * 100)}% + 12px)`}}
              hidden={!known}
            />
            <SliderThumb
              className={cx(
                'top-1/2 size-6 rounded-pv-pill bg-pv-ink outline-none data-[focus-visible]:outline-2',
                'data-[focus-visible]:outline-offset-4 data-[focus-visible]:outline-pv-ink',
                known ? '' : 'opacity-0',
              )}
            />
          </>
        )}
      </SliderTrack>
    </AriaSlider>
  );
}
