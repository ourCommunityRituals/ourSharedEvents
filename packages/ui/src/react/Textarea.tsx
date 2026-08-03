import type { ChangeEvent } from 'react';

export interface TextareaProps {
  id: string;
  label: string;
  placeholder?: string;
  value?: string;
  rows?: number;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
  error?: string;
  onChange?: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  'data-testid'?: string;
}

const TEXTAREA_BASE =
  'w-full px-3 py-2.5 rounded-sm border font-sans text-sm text-text bg-surface resize-y ' +
  'placeholder:text-text-muted transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

export function Textarea({
  id,
  label,
  placeholder,
  value,
  rows = 4,
  required = false,
  disabled = false,
  hint,
  error,
  onChange,
  'data-testid': testId,
}: TextareaProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;
  const cls = `${TEXTAREA_BASE} ${error ? 'border-error' : 'border-border'}`;

  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
        {required && (
          <span aria-hidden="true" className="text-danger ml-0.5">
            *
          </span>
        )}
      </label>
      <textarea
        id={id}
        name={id}
        className={cls}
        placeholder={placeholder}
        rows={rows}
        required={required}
        disabled={disabled}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        onChange={onChange}
        defaultValue={value}
      />
      {hint && !error && (
        <div id={hintId} className="text-xs text-text-muted">
          {hint}
        </div>
      )}
      {error && (
        <div id={errorId} className="text-xs text-error font-medium" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
