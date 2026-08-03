import type { ReactNode } from 'react';

export interface CardProps {
  title?: string;
  sub?: string;
  children?: ReactNode;
  className?: string;
  'data-testid'?: string;
}

export function Card({ title, sub, children, className = '', 'data-testid': testId }: CardProps) {
  return (
    <div
      className={`bg-surface border border-border rounded p-4 ${className}`}
      data-testid={testId}
    >
      {title && <div className="font-semibold text-text">{title}</div>}
      {sub && <div className="text-sm text-text-muted mt-0.5">{sub}</div>}
      {children && <div className={title || sub ? 'mt-3' : ''}>{children}</div>}
    </div>
  );
}
