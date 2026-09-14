import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'quiet';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to the container — the default for anything in a sheet. */
  block?: boolean;
  children: ReactNode;
}

const VARIANT: Record<ButtonVariant, string> = {
  // Emerald means "this releases or confirms capital". Used sparingly.
  primary: 'bg-liquid text-base font-medium hover:bg-liquid-bright active:bg-liquid-bright',
  secondary: 'bg-raised text-ink border-[0.5px] border-[var(--hairline-strong)] hover:bg-overlay',
  ghost: 'text-ink-2 hover:text-ink hover:bg-raised',
  quiet: 'text-liquid hover:text-liquid-bright',
};

const SIZE: Record<ButtonSize, string> = {
  // md and lg are 44px and 52px of real box. `sm` is 36px because a row of
  // three of them at 44 is a wall, so it carries `.target` instead: the box
  // stays 36 and the hit area is 44, which is the distinction the brief is
  // making when it says pad the target and leave the glyph alone.
  sm: 'target h-9 px-3 text-caption rounded-md gap-1.5',
  md: 'h-11 px-4 text-body rounded-md gap-2',
  lg: 'h-[3.25rem] px-5 text-lead rounded-lg gap-2',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  block,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={clsx(
        'press inline-flex select-none items-center justify-center whitespace-nowrap',
        'transition-colors duration-150',
        'disabled:pointer-events-none disabled:opacity-40',
        VARIANT[variant],
        SIZE[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    />
  );
}
