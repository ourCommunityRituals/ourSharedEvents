import { Button } from './Button';

export interface EmptyStateProps {
  icon?: string;
  title: string;
  message: string;
  action?: { label: string; href: string };
  'data-testid'?: string;
}

export function EmptyState({
  icon,
  title,
  message,
  action,
  'data-testid': testId,
}: EmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-4 py-16 px-6 text-center"
      data-testid={testId}
    >
      {icon && (
        <div className="text-4xl" aria-hidden="true">
          {icon}
        </div>
      )}
      <h3 className="font-semibold text-lg text-text">{title}</h3>
      <p className="text-text-muted text-sm max-w-sm">{message}</p>
      {action && (
        <Button href={action.href} variant="primary">
          {action.label}
        </Button>
      )}
    </div>
  );
}

export interface AccessDeniedProps {
  what?: string;
  action?: { label: string; href: string };
  'data-testid'?: string;
}

export function AccessDenied({ what, action, 'data-testid': testId }: AccessDeniedProps) {
  return (
    <EmptyState
      icon="🎧"
      title={what ? `${what} is DJ-only` : 'This area is for DJs'}
      message="Want in? Connect your account to start building sets and get on the air."
      action={action ?? { label: 'Get started', href: '/connect' }}
      data-testid={testId}
    />
  );
}
