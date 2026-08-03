export interface LoadingProps {
  label?: string;
  'data-testid'?: string;
}

export function Loading({ label = 'Loading…', 'data-testid': testId }: LoadingProps) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-12"
      role="status"
      aria-label={label}
      data-testid={testId}
    >
      <div
        className="w-8 h-8 rounded-full border-[3px] border-border border-t-accent animate-spin"
        aria-hidden="true"
      />
      <span className="text-sm text-text-muted">{label}</span>
    </div>
  );
}
