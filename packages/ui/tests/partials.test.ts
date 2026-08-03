import { describe, it, expect } from 'vitest';
import {
  page,
  header,
  bottomNav,
  button,
  emptyState,
  accessDenied,
  formInput,
  textarea,
  formSelect,
  checkbox,
  radioGroup,
  formGroup,
} from '../src/partials';
import { ocrStylesheet, styleTag } from '../src/css';

describe('page()', () => {
  it('emits a full document linking the shared stylesheet, no inline <style>', () => {
    const html = page({ title: 'Dashboard', body: '<p>hi</p>' });
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<link rel="stylesheet" href="/ui.css">');
    expect((html.match(/<style/g) ?? []).length).toBe(0);
    expect((html.match(/<link rel="stylesheet"/g) ?? []).length).toBe(1);
  });
});

describe('stylesheet', () => {
  it('rootBlock emits two :root blocks (Tier 1 + Tier 2), not one', () => {
    // We no longer enforce exactly one :root — the 3-tier split uses two.
    expect((ocrStylesheet.match(/:root/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('styleTag wraps in <style>', () => {
    expect(styleTag()).toMatch(/^<style>/);
  });

  it('stylesheet contains light mode media query (automatic, system preference)', () => {
    expect(ocrStylesheet).toContain('prefers-color-scheme: light');
  });

  it('stylesheet contains [data-theme="light"] forced override (Claude Design + manual toggle)', () => {
    expect(ocrStylesheet).toContain('[data-theme="light"]');
  });

  it('stylesheet contains [data-theme="dark"] forced override (lock dark regardless of system)', () => {
    expect(ocrStylesheet).toContain('[data-theme="dark"]');
  });

  it('stylesheet contains prefers-reduced-motion block (WCAG 2.3.3)', () => {
    expect(ocrStylesheet).toContain('prefers-reduced-motion');
  });

  it('stylesheet contains :focus-visible rules on interactive components (WCAG 2.4.11)', () => {
    expect(ocrStylesheet).toContain(':focus-visible');
    expect(ocrStylesheet).toMatch(/\.btn:focus-visible/);
    expect(ocrStylesheet).toMatch(/\.nav-item:focus-visible/);
    expect(ocrStylesheet).toMatch(/\.input:focus-visible/);
  });

  it('[data-theme="light"] block re-maps all semantic tokens to light values', () => {
    expect(ocrStylesheet).toMatch(/\[data-theme="light"\][\s\S]*?--bg[\s\S]*?--accent/);
  });

  it('[data-theme="dark"] block re-maps all semantic tokens to dark values', () => {
    expect(ocrStylesheet).toMatch(/\[data-theme="dark"\][\s\S]*?--bg[\s\S]*?--accent/);
  });
});

describe('XSS safety', () => {
  const evil = '"><script>alert(1)</script>';

  it('header() escapes user text', () => {
    expect(header({ title: evil })).not.toMatch(/<script>/);
  });
  it('button() escapes label', () => {
    expect(button({ label: evil })).not.toMatch(/<script>/);
  });
  it('emptyState() escapes title and message', () => {
    expect(emptyState({ title: evil, message: evil })).not.toMatch(/<script>/);
  });
  it('button() neutralises javascript: hrefs', () => {
    expect(button({ label: 'x', href: 'javascript:alert(1)' })).not.toMatch(/javascript:/);
  });
});

describe('tap targets', () => {
  it('btn class carries min-height:var(--tap-min)', () => {
    expect(button({ label: 'Go' })).toMatch(/class="btn btn-primary"/);
    expect(ocrStylesheet).toMatch(/\.btn\{[^}]*min-height:var\(--tap-min\)/);
  });
});

describe('accessDenied()', () => {
  it('always offers a next step — no dead ends', () => {
    const denied = accessDenied();
    expect(denied).toMatch(/class="empty-state"/);
    expect(denied).toMatch(/class="btn btn-primary"/);
    expect(denied).toMatch(/href="\/connect"/);
  });
});

describe('bottomNav()', () => {
  it('marks the active item and leaves others unmarked', () => {
    const nav = bottomNav([
      { href: '/a', label: 'A', icon: '🅰️', active: true },
      { href: '/b', label: 'B', icon: '🅱️' },
    ]);
    expect(nav).toMatch(/class="nav-item active" href="\/a"/);
    expect(nav).toMatch(/class="nav-item" href="\/b"/);
  });
});

describe('formInput()', () => {
  it('renders label + input with correct id/name', () => {
    const html = formInput({ id: 'email', label: 'Email', type: 'email' });
    expect(html).toContain('<label for="email">Email</label>');
    expect(html).toContain('id="email"');
    expect(html).toContain('name="email"');
    expect(html).toContain('type="email"');
  });

  it('adds required mark and attribute when required', () => {
    const html = formInput({ id: 'name', label: 'Name', required: true });
    expect(html).toContain('class="required-mark"');
    expect(html).toContain('required');
  });

  it('wires aria-invalid and aria-describedby on error', () => {
    const html = formInput({ id: 'email', label: 'Email', error: 'Invalid format' });
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="email-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Invalid format');
  });

  it('adds input-error class on error', () => {
    const html = formInput({ id: 'f', label: 'F', error: 'Oops' });
    expect(html).toContain('class="input input-error"');
  });

  it('escapes XSS in label, placeholder, and error', () => {
    const evil = '"><script>alert(1)</script>';
    const html = formInput({ id: 'x', label: evil, placeholder: evil, error: evil });
    expect(html).not.toMatch(/<script>/);
  });
});

describe('textarea()', () => {
  it('renders label + textarea', () => {
    const html = textarea({ id: 'bio', label: 'Bio', rows: 5 });
    expect(html).toContain('<label for="bio">Bio</label>');
    expect(html).toContain('<textarea id="bio"');
    expect(html).toContain('rows="5"');
  });

  it('escapes XSS in value', () => {
    const html = textarea({ id: 'x', label: 'X', value: '<script>alert(1)</script>' });
    expect(html).not.toMatch(/<script>/);
  });
});

describe('formSelect()', () => {
  it('renders label + select with options', () => {
    const html = formSelect({
      id: 'tier',
      label: 'Tier',
      options: [
        { value: 'free', label: 'Free' },
        { value: 'pro', label: 'Pro', selected: true },
      ],
    });
    expect(html).toContain('<label for="tier">Tier</label>');
    expect(html).toContain('<option value="free">Free</option>');
    expect(html).toContain('<option value="pro" selected>Pro</option>');
  });
});

describe('checkbox()', () => {
  it('renders an accessible checkbox with label', () => {
    const html = checkbox({ id: 'agree', label: 'I agree', checked: true });
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('id="agree"');
    expect(html).toContain('checked');
    expect(html).toContain('I agree');
  });
});

describe('radioGroup()', () => {
  it('renders a fieldset with radios and legend', () => {
    const html = radioGroup({
      name: 'size',
      legend: 'Event size',
      options: [
        { value: 'small', label: 'Small' },
        { value: 'large', label: 'Large', checked: true },
      ],
    });
    expect(html).toContain('<fieldset');
    expect(html).toContain('<legend>Event size</legend>');
    expect(html).toContain('type="radio"');
    expect(html).toContain('value="large"');
    expect(html).toContain('checked');
  });

  it('shows error with role=alert', () => {
    const html = radioGroup({
      name: 'x',
      legend: 'X',
      options: [{ value: 'a', label: 'A' }],
      error: 'Required',
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Required');
  });
});

describe('formGroup()', () => {
  it('wraps fields in a fieldset with legend', () => {
    const html = formGroup({ legend: 'Contact', fields: '<p>fields</p>' });
    expect(html).toContain('<fieldset class="form-group">');
    expect(html).toContain('<legend>Contact</legend>');
    expect(html).toContain('<p>fields</p>');
  });
});

describe('stylesheet — form field classes', () => {
  it('contains .form-field layout class', () => {
    expect(ocrStylesheet).toContain('.form-field');
  });
  it('contains .form-error class', () => {
    expect(ocrStylesheet).toContain('.form-error');
  });
  it('contains .input-error class', () => {
    expect(ocrStylesheet).toContain('.input-error');
  });
});
