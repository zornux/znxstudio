import { describe, expect, test } from './harness';
import {
  DEFAULT_LAYOUT,
  LAYOUT_LIMITS,
  clamp,
  isZen,
  layoutClasses,
  layoutVariables,
  layoutsEqual,
  maximizePanel,
  moveSideBar,
  movePanel,
  panelExtent,
  parseLayout,
  resizePanel,
  resizeSideBar,
  toggleActivityBar,
  togglePanel,
  toggleSideBar,
  toggleStatusBar,
  zenLayout,
} from '../src/renderer/layout/layoutModel';
import {
  closePanel,
  DEFAULT_PANEL_PREFERENCES,
  DEFAULT_PANELS,
  inStrip,
  isHidden,
  movePanel as movePanelTab,
  openPanel,
  orderPanels,
  overflowPanels,
  parsePanelPreferences,
  resetPanelPreferences,
  resolveActivePanel,
  setActivePanel,
  setHidden,
  stripPanels,
  visiblePanels,
  type PanelDescriptor,
} from '../src/renderer/layout/panels';

describe('clamp', () => {
  test('bounds a value and rounds it', () => {
    expect(clamp(5, 10, 20)).toBe(10);
    expect(clamp(50, 10, 20)).toBe(20);
    expect(clamp(15.6, 10, 20)).toBe(16);
  });
  test('a non-finite value falls back to the minimum, never NaN', () => {
    expect(clamp(NaN, 10, 20)).toBe(10);
    expect(clamp(Infinity, 10, 20)).toBe(20);
  });
});

describe('layout operations', () => {
  test('every operation returns a new state and leaves the old one alone', () => {
    const moved = moveSideBar(DEFAULT_LAYOUT, 'right');
    expect(moved.sidebar.side).toBe('right');
    expect(DEFAULT_LAYOUT.sidebar.side).toBe('left');
  });

  test('toggles flip, and can be forced', () => {
    expect(toggleSideBar(DEFAULT_LAYOUT).sidebar.visible).toBe(false);
    expect(toggleSideBar(DEFAULT_LAYOUT, true).sidebar.visible).toBe(true);
    expect(toggleStatusBar(DEFAULT_LAYOUT).statusBarVisible).toBe(false);
    expect(toggleActivityBar(DEFAULT_LAYOUT).activityBarVisible).toBe(false);
  });

  test('moving a maximized panel to the side un-maximizes it, or the editor vanishes', () => {
    const maximized = maximizePanel(DEFAULT_LAYOUT, true);
    expect(maximized.panel.maximized).toBe(true);
    expect(movePanel(maximized, 'right').panel.maximized).toBe(false);
  });

  test('maximizing implies showing', () => {
    const hidden = togglePanel(DEFAULT_LAYOUT, false);
    const maximized = maximizePanel(hidden, true);
    expect(maximized.panel.visible).toBe(true);
    expect(maximized.panel.maximized).toBe(true);
  });

  test('hiding a maximized panel drops the maximization, so showing it again reveals the editor', () => {
    const maximized = maximizePanel(DEFAULT_LAYOUT, true);
    const hidden = togglePanel(maximized, false);
    expect(hidden.panel.maximized).toBe(false);
  });

  test('resizing the sidebar clamps to its limits', () => {
    expect(resizeSideBar(DEFAULT_LAYOUT, 10).sidebar.width).toBe(LAYOUT_LIMITS.sidebarWidth.min);
    expect(resizeSideBar(DEFAULT_LAYOUT, 5000).sidebar.width).toBe(LAYOUT_LIMITS.sidebarWidth.max);
  });

  test('resizing the panel changes the dimension its position uses', () => {
    const bottom = resizePanel(DEFAULT_LAYOUT, 300);
    expect(bottom.panel.height).toBe(300);
    expect(bottom.panel.width).toBe(DEFAULT_LAYOUT.panel.width);

    const right = resizePanel(movePanel(DEFAULT_LAYOUT, 'right'), 500);
    expect(right.panel.width).toBe(500);
    expect(right.panel.height).toBe(DEFAULT_LAYOUT.panel.height);
  });

  test('panelExtent reads whichever dimension is in use', () => {
    expect(panelExtent(DEFAULT_LAYOUT)).toBe(DEFAULT_LAYOUT.panel.height);
    expect(panelExtent(movePanel(DEFAULT_LAYOUT, 'right'))).toBe(DEFAULT_LAYOUT.panel.width);
  });
});

describe('zen mode', () => {
  test('hides everything but the code, and is detectable', () => {
    const zen = zenLayout(DEFAULT_LAYOUT);
    expect(isZen(zen)).toBe(true);
    expect(zen.panel.maximized).toBe(false);
    expect(isZen(DEFAULT_LAYOUT)).toBe(false);
  });

  test('the widths are preserved, so leaving zen restores the sizes', () => {
    const sized = resizeSideBar(DEFAULT_LAYOUT, 400);
    expect(zenLayout(sized).sidebar.width).toBe(400);
  });
});

describe('parseLayout', () => {
  test('reads a well-formed layout', () => {
    expect(parseLayout(DEFAULT_LAYOUT)).toEqual(DEFAULT_LAYOUT);
  });

  test('nonsense yields the default rather than an unusable IDE', () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('sidebar')).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout([])).toEqual(DEFAULT_LAYOUT);
  });

  test('an out-of-range width is clamped, not honoured', () => {
    const parsed = parseLayout({ sidebar: { width: 99999 }, panel: { height: -50 } });
    expect(parsed.sidebar.width).toBe(LAYOUT_LIMITS.sidebarWidth.max);
    expect(parsed.panel.height).toBe(LAYOUT_LIMITS.panelHeight.min);
  });

  test('an unknown side or position falls back to the default', () => {
    const parsed = parseLayout({ sidebar: { side: 'top' }, panel: { position: 'left' } });
    expect(parsed.sidebar.side).toBe('left');
    expect(parsed.panel.position).toBe('bottom');
  });

  test('a hidden panel can never be restored as maximized', () => {
    expect(parseLayout({ panel: { visible: false, maximized: true } }).panel.maximized).toBe(false);
  });
});

describe('layoutsEqual, layoutVariables and layoutClasses', () => {
  test('equality is structural', () => {
    expect(layoutsEqual(DEFAULT_LAYOUT, parseLayout(DEFAULT_LAYOUT))).toBe(true);
    expect(layoutsEqual(DEFAULT_LAYOUT, moveSideBar(DEFAULT_LAYOUT, 'right'))).toBe(false);
  });

  test('variables carry the pixel extents', () => {
    expect(layoutVariables(DEFAULT_LAYOUT)['--znxstudio-sidebar-width']).toBe('260px');
  });

  test('classes describe the arrangement', () => {
    expect(layoutClasses(DEFAULT_LAYOUT)).toEqual(['sidebar-left', 'panel-bottom']);
    expect(layoutClasses(zenLayout(DEFAULT_LAYOUT))).toContain('is-zen');
    expect(layoutClasses(maximizePanel(DEFAULT_LAYOUT, true))).toContain('panel-maximized');
  });
});

/* ------------------------------------------------------------- panels */

const PANELS: PanelDescriptor[] = [
  { id: 'problems', title: 'Problems' },
  { id: 'output', title: 'Output' },
  { id: 'terminal', title: 'Terminal' },
  { id: 'debug', title: 'Debug' },
];

describe('panel preferences', () => {
  test('with no preferences, registration order stands', () => {
    expect(orderPanels(PANELS, DEFAULT_PANEL_PREFERENCES).map((p) => p.id)).toEqual(['problems', 'output', 'terminal', 'debug']);
  });

  test('preferred panels come first; the rest keep registration order', () => {
    const ordered = orderPanels(PANELS, { order: ['debug', 'terminal'], hidden: [] });
    expect(ordered.map((p) => p.id)).toEqual(['debug', 'terminal', 'problems', 'output']);
  });

  test('a preference naming a panel that no longer exists is ignored', () => {
    expect(orderPanels(PANELS, { order: ['ghost', 'debug'], hidden: [] }).map((p) => p.id)).toEqual([
      'debug',
      'problems',
      'output',
      'terminal',
    ]);
  });

  test('hiding removes a tab but never the panel itself', () => {
    const hidden = setHidden(DEFAULT_PANEL_PREFERENCES, 'output', true);
    expect(isHidden(hidden, 'output')).toBe(true);
    expect(visiblePanels(PANELS, hidden).map((p) => p.id)).toEqual(['problems', 'terminal', 'debug']);
    expect(orderPanels(PANELS, hidden)).toHaveLength(4);
  });

  test('unhiding is idempotent and does not duplicate', () => {
    let prefs = setHidden(DEFAULT_PANEL_PREFERENCES, 'output', true);
    prefs = setHidden(prefs, 'output', true);
    expect(prefs.hidden).toEqual(['output']);
    prefs = setHidden(prefs, 'output', false);
    expect(prefs.hidden).toHaveLength(0);
  });

  test('moving a panel ranks every panel, so a partial order stays unambiguous', () => {
    const moved = movePanelTab(PANELS, DEFAULT_PANEL_PREFERENCES, 'terminal', -1);
    expect(moved.order).toEqual(['problems', 'terminal', 'output', 'debug']);
  });

  test('moving past either end is a no-op', () => {
    expect(movePanelTab(PANELS, DEFAULT_PANEL_PREFERENCES, 'problems', -1)).toEqual(DEFAULT_PANEL_PREFERENCES);
    expect(movePanelTab(PANELS, DEFAULT_PANEL_PREFERENCES, 'debug', 1)).toEqual(DEFAULT_PANEL_PREFERENCES);
  });

  test('moving an unknown panel changes nothing', () => {
    expect(movePanelTab(PANELS, DEFAULT_PANEL_PREFERENCES, 'ghost', 1)).toEqual(DEFAULT_PANEL_PREFERENCES);
  });

  test('parsePanelPreferences drops junk and collapses duplicates', () => {
    expect(parsePanelPreferences({ order: ['a', 'a', 7], hidden: 'nope' })).toEqual({ order: ['a'], hidden: [], opened: [], active: null });
    expect(parsePanelPreferences(null)).toEqual(DEFAULT_PANEL_PREFERENCES);
  });

  test('reset restores registration order and shows everything', () => {
    expect(resetPanelPreferences()).toEqual(DEFAULT_PANEL_PREFERENCES);
  });
});

describe('bottom-panel container (UX-2)', () => {
  const PANELS: PanelDescriptor[] = [
    { id: 'terminal', title: 'Terminal' },
    { id: 'diagnostics', title: 'Problems' },
    { id: 'security-scan', title: 'Security Scan' },
    { id: 'cpu-profiler', title: 'CPU' },
    { id: 'ai-review', title: 'AI Review' },
  ];

  test('only the default classic set shows as tabs; the long tail is overflow', () => {
    const strip = stripPanels(PANELS, DEFAULT_PANEL_PREFERENCES).map((p) => p.id);
    expect(strip).toEqual(['diagnostics']);
    const overflow = overflowPanels(PANELS, DEFAULT_PANEL_PREFERENCES).map((p) => p.id);
    expect(overflow).toEqual(['terminal', 'security-scan', 'cpu-profiler', 'ai-review']);
    expect(DEFAULT_PANELS.includes('terminal')).toBe(false);
  });

  test('opening a non-default panel adds it to the strip; closing returns it to overflow', () => {
    const opened = openPanel(DEFAULT_PANEL_PREFERENCES, 'security-scan');
    expect(inStrip(opened, 'security-scan')).toBe(true);
    expect(stripPanels(PANELS, opened).map((p) => p.id)).toContain('security-scan');

    const closed = closePanel(opened, 'security-scan');
    expect(inStrip(closed, 'security-scan')).toBe(false);
    expect(overflowPanels(PANELS, closed).map((p) => p.id)).toContain('security-scan');
  });

  test('closing a DEFAULT panel records it as hidden (still reachable via overflow)', () => {
    const closed = closePanel(DEFAULT_PANEL_PREFERENCES, 'diagnostics');
    expect(inStrip(closed, 'diagnostics')).toBe(false);
    expect(overflowPanels(PANELS, closed).map((p) => p.id)).toContain('diagnostics');
  });

  test('last-active is remembered and cleared when its tab closes', () => {
    const active = setActivePanel(openPanel(DEFAULT_PANEL_PREFERENCES, 'ai-review'), 'ai-review');
    expect(resolveActivePanel(stripPanels(PANELS, active), active, active.active ?? null)).toBe('ai-review');
    expect(closePanel(active, 'ai-review').active).toBeNull();
  });
});

describe('resolveActivePanel', () => {
  test('ignores a preferred panel that was never opened', () => {
    expect(resolveActivePanel(stripPanels(PANELS, DEFAULT_PANEL_PREFERENCES), DEFAULT_PANEL_PREFERENCES, 'terminal')).toBe('output');
  });

  test('falls to the first visible panel when the preferred one was hidden', () => {
    const hidden = setHidden(DEFAULT_PANEL_PREFERENCES, 'terminal', true);
    expect(resolveActivePanel(PANELS, hidden, 'terminal')).toBe('problems');
  });

  test('respects the user order when falling back', () => {
    const prefs = { order: ['debug'], hidden: ['terminal'] };
    expect(resolveActivePanel(PANELS, prefs, 'terminal')).toBe('debug');
  });

  test('with everything hidden there is no active panel', () => {
    const prefs = { order: [], hidden: PANELS.map((p) => p.id) };
    expect(resolveActivePanel(PANELS, prefs, 'debug')).toBeNull();
  });

  test('with no panels at all there is no active panel', () => {
    expect(resolveActivePanel([], DEFAULT_PANEL_PREFERENCES, null)).toBeNull();
  });
});
