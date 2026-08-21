/**
 * Phase 4: E2E Fixture App Factories.
 *
 * Each fixture returns a MobileIRApp ready for E2E testing.
 * These are the same apps as in simulator-phase4.test.ts but
 * exported for use in Playwright E2E suites.
 */

import type { MobileIRApp } from '../../src/shared/simulatorTypes';

export function makeE2ECounterApp(): MobileIRApp {
  return {
    name: 'E2E-Counter', startScreen: 'Main', permissions: [], capabilities: [],
    screens: [{
      name: 'Main',
      states: [{ name: 'count', type: 'whole', initialValue: '0' }],
      rootChildren: [
        { id: 'title', kind: 'text', properties: { content: 'Counter', size: 'heading' }, events: [], children: [] },
        { id: 'display', kind: 'text', properties: { content: 'Count: {count}', testTag: 'counter-display' }, events: [], children: [] },
        { id: 'incBtn', kind: 'button', properties: { label: 'Increment', testTag: 'inc' }, events: [{ event: 'tapped', body: 'set count to count + 1' }], children: [] },
        { id: 'decBtn', kind: 'button', properties: { label: 'Decrement', testTag: 'dec' }, events: [{ event: 'tapped', body: 'set count to count - 1' }], children: [] },
        { id: 'resetBtn', kind: 'button', properties: { label: 'Reset', testTag: 'reset' }, events: [{ event: 'tapped', body: 'set count to 0' }], children: [] },
      ],
    }],
  };
}

export function makeE2ENavigationApp(): MobileIRApp {
  return {
    name: 'E2E-Navigation', startScreen: 'Home', permissions: [], capabilities: [],
    screens: [
      {
        name: 'Home', states: [],
        rootChildren: [
          { id: 'nav1', kind: 'navbar', properties: { title: 'Home' }, events: [], children: [] },
          { id: 'goA', kind: 'button', properties: { label: 'Go to Screen A', testTag: 'go-a' }, events: [{ event: 'tapped', body: 'go to ScreenA' }], children: [] },
          { id: 'goB', kind: 'button', properties: { label: 'Go to Screen B', testTag: 'go-b' }, events: [{ event: 'tapped', body: 'go to ScreenB' }], children: [] },
        ],
      },
      {
        name: 'ScreenA', states: [],
        rootChildren: [
          { id: 'nav2', kind: 'navbar', properties: { title: 'Screen A', showBack: true }, events: [{ event: 'back_tapped', body: 'go back' }], children: [] },
          { id: 'labelA', kind: 'text', properties: { content: 'This is Screen A', testTag: 'label-a' }, events: [], children: [] },
        ],
      },
      {
        name: 'ScreenB', states: [],
        rootChildren: [
          { id: 'nav3', kind: 'navbar', properties: { title: 'Screen B', showBack: true }, events: [{ event: 'back_tapped', body: 'go back' }], children: [] },
          { id: 'labelB', kind: 'text', properties: { content: 'This is Screen B', testTag: 'label-b' }, events: [], children: [] },
        ],
      },
    ],
  };
}

export function makeE2EFormsApp(): MobileIRApp {
  return {
    name: 'E2E-Forms', startScreen: 'Main', permissions: [], capabilities: [],
    screens: [{
      name: 'Main',
      states: [
        { name: 'name', type: 'text', initialValue: '' },
        { name: 'email', type: 'text', initialValue: '' },
        { name: 'agree', type: 'truth', initialValue: 'false' },
        { name: 'volume', type: 'whole', initialValue: '50' },
      ],
      rootChildren: [
        { id: 'nameInput', kind: 'input', properties: { label: 'Name', binding: 'name', testTag: 'name-input' }, events: [], children: [] },
        { id: 'emailInput', kind: 'input', properties: { label: 'Email', inputType: 'email', binding: 'email', testTag: 'email-input' }, events: [], children: [] },
        { id: 'agreeCheck', kind: 'checkbox', properties: { label: 'I agree', binding: 'agree', testTag: 'agree-check' }, events: [], children: [] },
        { id: 'volSlider', kind: 'slider', properties: { min: 0, max: 100, binding: 'volume', testTag: 'vol-slider' }, events: [], children: [] },
        { id: 'submitBtn', kind: 'button', properties: { label: 'Submit', testTag: 'submit-btn' }, events: [{ event: 'tapped', body: 'show "Form submitted"' }], children: [] },
      ],
    }],
  };
}

export function makeE2EVisualRegressionApp(): MobileIRApp {
  return {
    name: 'E2E-VisualRegression', startScreen: 'Main', permissions: [], capabilities: [],
    screens: [{
      name: 'Main',
      states: [{ name: 'variant', type: 'text', initialValue: 'default' }],
      rootChildren: [
        { id: 'title', kind: 'text', properties: { content: 'Visual Regression', size: 'heading', testTag: 'title' }, events: [], children: [] },
        { id: 'box', kind: 'card', properties: { width: 200, height: 200, backgroundColor: 'primary', testTag: 'color-box' }, events: [], children: [
          { id: 'label', kind: 'text', properties: { content: '{variant}', color: 'onPrimary', testTag: 'variant-label' }, events: [], children: [] },
        ]},
        { id: 'toggleBtn', kind: 'button', properties: { label: 'Toggle Variant', testTag: 'toggle' }, events: [{ event: 'tapped', body: 'set variant to alternate' }], children: [] },
      ],
    }],
  };
}

export const ALL_E2E_FIXTURES = {
  counter: makeE2ECounterApp,
  navigation: makeE2ENavigationApp,
  forms: makeE2EFormsApp,
  visualRegression: makeE2EVisualRegressionApp,
} as const;
