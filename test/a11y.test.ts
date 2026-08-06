import { describe, expect, test } from './harness';
import { auditA11y, hasAccessibleName, isInteractive, type A11yElement } from '../src/renderer/a11y/a11y';

describe('accessibility audit (20A)', () => {
  test('interactive detection covers tags and roles, skips hidden', () => {
    expect(isInteractive({ tag: 'button' })).toBe(true);
    expect(isInteractive({ tag: 'input' })).toBe(true);
    expect(isInteractive({ tag: 'div', role: 'tab' })).toBe(true);
    expect(isInteractive({ tag: 'div', role: 'menuitemcheckbox' })).toBe(true);
    expect(isInteractive({ tag: 'span' })).toBe(false);
    expect(isInteractive({ tag: 'button', hidden: true })).toBe(false);
  });

  test('accessible name accepts text, aria-label, labelledby, title, alt, or a label', () => {
    expect(hasAccessibleName({ tag: 'button', text: 'Save' })).toBe(true);
    expect(hasAccessibleName({ tag: 'button', ariaLabel: 'Close' })).toBe(true);
    expect(hasAccessibleName({ tag: 'button', ariaLabelledby: 'x' })).toBe(true);
    expect(hasAccessibleName({ tag: 'button', title: 'Run' })).toBe(true);
    expect(hasAccessibleName({ tag: 'input', hasLabel: true })).toBe(true);
    expect(hasAccessibleName({ tag: 'textarea', placeholder: 'Message…' })).toBe(true);
    expect(hasAccessibleName({ tag: 'button', text: '   ' })).toBe(false);
    expect(hasAccessibleName({ tag: 'button' })).toBe(false);
  });

  test('audit flags only unnamed interactive controls', () => {
    const elements: A11yElement[] = [
      { tag: 'button', text: 'OK' }, // named
      { tag: 'button', ariaLabel: 'Close' }, // named
      { tag: 'button' }, // UNNAMED
      { tag: 'button', role: 'tab' }, // UNNAMED
      { tag: 'span', text: 'label' }, // not interactive
      { tag: 'input', hasLabel: true }, // named
      { tag: 'button', hidden: true }, // hidden, skipped
    ];
    const report = auditA11y(elements);
    expect(report.total).toBe(7);
    expect(report.interactive).toBe(5);
    expect(report.unnamed).toHaveLength(2);
    expect(report.unnamed.map((f) => f.tag)).toEqual(['button', 'button']);
  });

  test('a fully-labelled control set reports zero unnamed', () => {
    const elements: A11yElement[] = [
      { tag: 'button', ariaLabel: 'Run' },
      { tag: 'button', title: 'Build' },
      { tag: 'a', text: 'Docs' },
    ];
    expect(auditA11y(elements).unnamed).toHaveLength(0);
  });
});
