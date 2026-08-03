import type { ChangeEvent } from 'react';

export interface FormInputProps {
  id: string;
  label: string;
  type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'search' | 'date';
  placeholder?: string;
  value?: string;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
  error?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  'data-testid'?: string;
}

const INPUT_BASE =
  'w-full px-3 py-2.5 rounded-sm border font-sans text-sm text-text bg-surface ' +
  'placeholder:text-text-muted transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

export function FormInput({
  id,
  label,
  type = 'text',
  placeholder,
  value,
  required = false,
  disabled = false,
  hint,
  error,
  onChange,
  'data-testid': testId,
}: FormInputProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;
  const inputCls = `${INPUT_BASE} ${error ? 'border-error' : 'border-border'}`;

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
      <input
        id={id}
        name={id}
        type={type}
        className={inputCls}
        placeholder={placeholder}
        value={value}
        required={required}
        disabled={disabled}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        onChange={onChange}
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
