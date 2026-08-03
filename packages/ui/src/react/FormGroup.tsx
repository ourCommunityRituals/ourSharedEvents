import type { ReactNode } from 'react';

export interface FormGroupProps {
  legend: string;
  required?: boolean;
  children?: ReactNode;
  className?: string;
  'data-testid'?: string;
}

export function FormGroup({
  legend,
  required = false,
  children,
  className = '',
  'data-testid': testId,
}: FormGroupProps) {
  return (
    <fieldset
      className={`flex flex-col gap-4 border border-border rounded p-4 ${className}`}
      data-testid={testId}
    >
      <legend className="text-sm font-semibold text-text px-1">
        {legend}
        {required && (
          <span aria-hidden="true" className="text-danger ml-0.5">
            *
          </span>
        )}
      </legend>
      {children}
    </fieldset>
  );
}
