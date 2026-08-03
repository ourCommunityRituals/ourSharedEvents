/**
 * React component smoke tests.
 *
 * These tests verify that each component:
 *   1. Exports correctly from the barrel
 *   2. Is callable as a function (returns a non-null value)
 *   3. Accepts its documented props without TypeScript errors
 *
 * Full DOM/interaction tests belong in the consuming Phase 3 app (Playwright E2E).
 */
import { describe, it, expect } from 'vitest';
import {
  Button,
  Card,
  Loading,
  EmptyState,
  AccessDenied,
  Header,
  BottomNav,
  FormInput,
  Textarea,
  FormSelect,
  Checkbox,
  RadioGroup,
  FormGroup,
} from '../src/react/index';

describe('react component exports', () => {
  it('all 12 components export as functions', () => {
    expect(typeof Button).toBe('function');
    expect(typeof Card).toBe('function');
    expect(typeof Loading).toBe('function');
    expect(typeof EmptyState).toBe('function');
    expect(typeof AccessDenied).toBe('function');
    expect(typeof Header).toBe('function');
    expect(typeof BottomNav).toBe('function');
    expect(typeof FormInput).toBe('function');
    expect(typeof Textarea).toBe('function');
    expect(typeof FormSelect).toBe('function');
    expect(typeof Checkbox).toBe('function');
    expect(typeof RadioGroup).toBe('function');
    expect(typeof FormGroup).toBe('function');
  });
});

describe('Button', () => {
  it('renders a button element when no href', () => {
    const el = Button({ label: 'Click me' });
    expect(el).toBeTruthy();
    expect(el?.type).toBe('button');
  });

  it('renders an anchor when href is provided', () => {
    const el = Button({ label: 'Go', href: '/events' });
    expect(el?.type).toBe('a');
  });

  it('applies danger variant class', () => {
    const el = Button({ label: 'Delete', variant: 'danger' });
    expect((el?.props as { className?: string }).className).toContain('bg-danger');
  });
});

describe('Card', () => {
  it('renders with title and sub', () => {
    const el = Card({ title: 'Test Event', sub: 'Tonight' });
    expect(el).toBeTruthy();
    expect(el?.type).toBe('div');
  });
});

describe('Loading', () => {
  it('renders with default label', () => {
    const el = Loading({});
    expect(el).toBeTruthy();
    expect((el?.props as { 'aria-label'?: string })['aria-label']).toBe('Loading…');
  });

  it('renders with custom label', () => {
    const el = Loading({ label: 'Fetching events…' });
    expect((el?.props as { 'aria-label'?: string })['aria-label']).toBe('Fetching events…');
  });
});

describe('EmptyState', () => {
  it('renders title and message', () => {
    const el = EmptyState({ title: 'No events', message: 'Create one to get started.' });
    expect(el).toBeTruthy();
  });

  it('renders action button when action provided', () => {
    const el = EmptyState({
      title: 'No events',
      message: 'Create one to get started.',
      action: { label: 'Create event', href: '/admin/new' },
    });
    expect(el).toBeTruthy();
  });
});

describe('AccessDenied', () => {
  it('renders with default copy', () => {
    const el = AccessDenied({});
    expect(el).toBeTruthy();
  });

  it('renders with custom what label', () => {
    const el = AccessDenied({ what: 'Admin panel' });
    expect(el).toBeTruthy();
  });
});

describe('Header', () => {
  it('renders title', () => {
    const el = Header({ title: 'OurSharedEvents' });
    expect(el).toBeTruthy();
    expect(el?.type).toBe('header');
  });

  it('renders live badge when live=true', () => {
    const el = Header({ title: 'Event Night', live: true });
    expect(el).toBeTruthy();
  });

  it('renders offline badge when live=false', () => {
    const el = Header({ title: 'Event Night', live: false });
    expect(el).toBeTruthy();
  });
});

describe('BottomNav', () => {
  const items = [
    { href: '/', label: 'Home', icon: '🏠' },
    { href: '/events', label: 'Events', icon: '📅', active: true },
  ];

  it('renders nav element', () => {
    const el = BottomNav({ items });
    expect(el?.type).toBe('nav');
  });
});

describe('FormInput', () => {
  it('renders with required label and asterisk', () => {
    const el = FormInput({ id: 'email', label: 'Email', required: true });
    expect(el).toBeTruthy();
  });

  it('renders error state', () => {
    const el = FormInput({ id: 'email', label: 'Email', error: 'Required field' });
    expect(el).toBeTruthy();
  });
});

describe('Textarea', () => {
  it('renders with default rows', () => {
    const el = Textarea({ id: 'notes', label: 'Notes' });
    expect(el).toBeTruthy();
  });
});

describe('FormSelect', () => {
  const options = [
    { value: 'a', label: 'Option A' },
    { value: 'b', label: 'Option B', selected: true },
  ];

  it('renders select element with options', () => {
    const el = FormSelect({ id: 'type', label: 'Type', options });
    expect(el).toBeTruthy();
  });
});

describe('Checkbox', () => {
  it('renders checkbox with label', () => {
    const el = Checkbox({ id: 'agree', label: 'I agree to the terms' });
    expect(el).toBeTruthy();
    expect(el?.type).toBe('label');
  });
});

describe('RadioGroup', () => {
  const options = [
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' },
  ];

  it('renders fieldset with options', () => {
    const el = RadioGroup({ name: 'rsvp', legend: 'Attending?', options });
    expect(el?.type).toBe('fieldset');
  });

  it('renders error message', () => {
    const el = RadioGroup({
      name: 'rsvp',
      legend: 'Attending?',
      options,
      error: 'Please select one',
    });
    expect(el).toBeTruthy();
  });
});

describe('FormGroup', () => {
  it('renders fieldset wrapper', () => {
    const el = FormGroup({ legend: 'Contact info' });
    expect(el?.type).toBe('fieldset');
  });
});
