export interface HeaderProps {
  title: string;
  live?: boolean;
  'data-testid'?: string;
}

export function Header({ title, live, 'data-testid': testId }: HeaderProps) {
  return (
    <header
      className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-border bg-bg/90 backdrop-blur-sm"
      data-testid={testId}
    >
      <h1 className="text-xl font-bold text-text">{title}</h1>
      {live !== undefined && (
        <span
          className={
            live
              ? 'text-xs font-semibold px-2 py-1 rounded-pill bg-live text-black'
              : 'text-xs font-semibold px-2 py-1 rounded-pill bg-surface text-text-muted border border-border'
          }
          data-testid={testId ? `${testId}-badge` : undefined}
        >
          {live ? 'Live' : 'Offline'}
        </span>
      )}
    </header>
  );
}
