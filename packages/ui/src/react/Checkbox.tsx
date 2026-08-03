import type { ChangeEvent } from 'react';

export interface CheckboxProps {
  id: string;
  label: string;
  name?: string;
  value?: string;
  checked?: boolean;
  required?: boolean;
  disabled?: boolean;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  'data-testid'?: string;
}

export function Checkbox({
  id,
  label,
  name,
  value = 'on',
  checked,
  required = false,
  disabled = false,
  onChange,
  'data-testid': testId,
}: CheckboxProps) {
  return (
    <label
      className={
        'inline-flex items-center gap-2.5 text-sm text-text cursor-pointer ' +
        (disabled ? 'opacity-40 cursor-not-allowed' : '')
      }
      data-testid={testId}
    >
      <input
        type="checkbox"
        id={id}
        name={name ?? id}
        value={value}
        defaultChecked={checked}
        required={required}
        disabled={disabled}
        onChange={onChange}
        className={
          'w-4 h-4 rounded-sm border border-border bg-surface accent-accent ' +
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg'
        }
      />
      {label}
    </label>
  );
}
