import type { ReactNode } from 'react';

export interface ButtonProps {
  children?: ReactNode;
  label?: string;
  href?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  block?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  onClick?: () => void;
  className?: string;
  'data-testid'?: string;
}

const VARIANT_CLASSES = {
  primary: 'bg-accent text-black hover:bg-accent-hover',
  secondary: 'bg-surface text-text border border-border hover:bg-surface-hover',
  danger: 'bg-danger text-white hover:bg-danger-hover',
} as const;

const BASE =
  'inline-flex items-center justify-center gap-2 min-h-tap px-5 py-3.5 ' +
  'rounded-sm font-sans font-semibold text-sm transition-opacity ' +
  'disabled:opacity-40 disabled:cursor-not-allowed no-underline ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

export function Button({
  children,
  label,
  href,
  variant = 'primary',
  block = false,
  disabled = false,
  type = 'button',
  onClick,
  className = '',
  'data-testid': testId,
}: ButtonProps) {
  const cls = [BASE, VARIANT_CLASSES[variant], block ? 'w-full' : '', className]
    .filter(Boolean)
    .join(' ');

  const content = children ?? label;

  if (href) {
    return (
      <a href={href} className={cls} data-testid={testId} aria-disabled={disabled}>
        {content}
      </a>
    );
  }

  return (
    <button type={type} className={cls} disabled={disabled} onClick={onClick} data-testid={testId}>
      {content}
    </button>
  );
}
