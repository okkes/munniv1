import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'outline' | 'ghost' | 'danger';
type Size = 'md' | 'sm';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-brand text-on-brand border-transparent',
  outline: 'bg-transparent text-ink border-line',
  ghost: 'bg-transparent text-ink border-transparent',
  danger: 'bg-negative text-white border-transparent',
};

const SIZE_CLASSES: Record<Size, string> = {
  md: 'h-12 px-5 text-[15px] rounded-btn',
  sm: 'h-9 px-3.5 text-[13px] rounded-[10px]',
};

export function Button({ variant = 'primary', size = 'md', className = '', children, ...rest }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 border font-semibold cursor-pointer transition-[transform,opacity] duration-100 active:scale-[0.98] active:opacity-90 disabled:opacity-40 disabled:pointer-events-none ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
