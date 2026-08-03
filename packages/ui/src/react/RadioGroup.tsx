import type { ChangeEvent } from 'react';

export interface RadioOption {
  value: string;
  label: string;
  checked?: boolean;
  disabled?: boolean;
}

export interface RadioGroupProps {
  name: string;
  legend: string;
  options: RadioOption[];
  required?: boolean;
  error?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  'data-testid'?: string;
}

export function RadioGroup({
  name,
  legend,
  options,
  required = false,
  error,
  onChange,
  'data-testid': testId,
}: RadioGroupProps) {
  const errorId = `${name}-error`;

  return (
    <fieldset className="flex flex-col gap-2" data-testid={testId}>
      <legend className="text-sm font-medium text-text mb-1">{legend}</legend>
      {options.map((opt) => (
        <label
          key={opt.value}
          className={
            'inline-flex items-center gap-2.5 text-sm text-text cursor-pointer ' +
            (opt.disabled ? 'opacity-40 cursor-not-allowed' : '')
          }
        >
          <input
            type="radio"
            name={name}
            value={opt.value}
            defaultChecked={opt.checked}
            required={required}
            disabled={opt.disabled}
            onChange={onChange}
            aria-describedby={error ? errorId : undefined}
            className={
              'w-4 h-4 border border-border bg-surface accent-accent ' +
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg'
            }
          />
          {opt.label}
        </label>
      ))}
      {error && (
        <div id={errorId} className="text-xs text-error font-medium mt-1" role="alert">
          {error}
        </div>
      )}
    </fieldset>
  );
}
