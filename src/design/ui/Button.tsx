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
  secondary: 'bg-raised text-ink border-[0.5px] border-white/10 hover:bg-overlay',
  ghost: 'text-ink-2 hover:text-ink hover:bg-raised',
  quiet: 'text-liquid hover:text-liquid-bright',
};

const SIZE: Record<ButtonSize, string> = {
  // 44px minimum target on md/lg — the iOS touch guideline, not a rounded 40.
  sm: 'h-9 px-3 text-caption rounded-md gap-1.5',
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
