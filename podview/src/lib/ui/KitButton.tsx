// The kit's Button (K-Btn) on React Aria's useButton: press handling for touch, mouse, keyboard and assistive
// technology (no ghost clicks, no 300 ms delay, virtual clicks), on a native <button> that keeps every kit
// attribute the stylesheet reads (data-kit*, aria-busy for the progress spinner, hidden). A disabled button is
// `disabled`; one with a command in flight stays enabled (taps queue, they are never locked).
import type {ButtonHTMLAttributes, ReactNode, Ref} from 'react';
import {mergeProps, useButton, useObjectRef} from 'react-aria';

export interface KitButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'disabled' | 'type'> {
  isDisabled?: boolean;
  onPress?: () => void;
  type?: 'button' | 'submit';
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement> | undefined;
  [data: `data-${string}`]: string | undefined;
}

export function KitButton(props: KitButtonProps) {
  const {isDisabled = false, onPress, type = 'button', children, ref: forwarded, ...rest} = props;
  const ref = useObjectRef(forwarded);
  const {buttonProps} = useButton({isDisabled, type, elementType: 'button', ...(onPress ? {onPress} : {})}, ref);
  return (
    <button {...mergeProps(rest, buttonProps)} ref={ref}>
      {children}
    </button>
  );
}
