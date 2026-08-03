export interface NavItem {
  href: string;
  label: string;
  icon: string;
  active?: boolean;
}

export interface BottomNavProps {
  items: NavItem[];
  'data-testid'?: string;
}

export function BottomNav({ items, 'data-testid': testId }: BottomNavProps) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 flex items-center justify-around bg-surface border-t border-border pb-safe"
      data-testid={testId}
      aria-label="Main navigation"
    >
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          className={
            'flex flex-col items-center gap-1 min-h-tap min-w-[4rem] py-3 text-xs font-medium ' +
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ' +
            (item.active ? 'text-accent' : 'text-text-muted hover:text-text')
          }
          aria-current={item.active ? 'page' : undefined}
        >
          <span aria-hidden="true">{item.icon}</span>
          <span>{item.label}</span>
        </a>
      ))}
    </nav>
  );
}
