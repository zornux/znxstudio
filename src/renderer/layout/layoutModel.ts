/**
 * The workbench layout (Phase 17A) — the pure model.
 *
 * HONEST SCOPE. ZnxStudio's shell is a fixed set of regions: an activity bar, one
 * sidebar, an editor area, and one tabbed panel. "Docking" here means those
 * regions can be moved, resized, hidden and restored — the sidebar to either
 * side, the panel to the bottom or the right — and that the arrangement is a
 * value that can be serialised, validated and swapped.
 *
 * It is NOT a free-form dock tree with tear-off floating windows: every module
 * in the IDE contributes to `setSideBar` / `addPanelView`, and an arbitrary
 * split tree would be a different contract for all of them. Saying "docking"
 * and shipping movable, resizable, persistable regions is the honest version.
 *
 * Every size is stored as a PIXEL extent and clamped on the way in, so a corrupt
 * or hostile settings file can never produce a sidebar wider than the window or
 * a panel of negative height.
 */

export type SideBarSide = 'left' | 'right';
export type PanelPosition = 'bottom' | 'right';

export interface LayoutState {
  sidebar: {
    side: SideBarSide;
    visible: boolean;
    /** Width in pixels when docked left or right. */
    width: number;
  };
  panel: {
    position: PanelPosition;
    visible: boolean;
    /** Height when docked at the bottom. */
    height: number;
    /** Width when docked at the right. */
    width: number;
    /** The panel fills the editor region, hiding the editor. */
    maximized: boolean;
  };
  /** The status bar can be hidden (zen mode, small screens). */
  statusBarVisible: boolean;
  /** The activity bar can be hidden; commands still reach every view. */
  activityBarVisible: boolean;
}

export const LAYOUT_LIMITS = {
  sidebarWidth: { min: 160, max: 720, default: 260 },
  panelHeight: { min: 80, max: 900, default: 240 },
  panelWidth: { min: 200, max: 900, default: 380 },
} as const;

export const DEFAULT_LAYOUT: LayoutState = {
  sidebar: { side: 'left', visible: true, width: LAYOUT_LIMITS.sidebarWidth.default },
  panel: { position: 'bottom', visible: true, height: LAYOUT_LIMITS.panelHeight.default, width: LAYOUT_LIMITS.panelWidth.default, maximized: false },
  statusBarVisible: true,
  activityBarVisible: true,
};

/**
 * Bound a value. Only NaN is unusable and falls back to the minimum; ±Infinity
 * is a direction, and clamps to the end it points at.
 */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.round(Math.min(max, Math.max(min, value)));
}

/* ------------------------------------------------------------ operations */

/** Every operation returns a NEW state, so a caller can diff, undo or discard it. */
export function moveSideBar(state: LayoutState, side: SideBarSide): LayoutState {
  return { ...state, sidebar: { ...state.sidebar, side } };
}

export function movePanel(state: LayoutState, position: PanelPosition): LayoutState {
  // A maximized panel that moves to the side would swallow the editor entirely;
  // moving it is an intent to see both, so un-maximize.
  return { ...state, panel: { ...state.panel, position, maximized: false } };
}

export function toggleSideBar(state: LayoutState, force?: boolean): LayoutState {
  return { ...state, sidebar: { ...state.sidebar, visible: force ?? !state.sidebar.visible } };
}

export function togglePanel(state: LayoutState, force?: boolean): LayoutState {
  const visible = force ?? !state.panel.visible;
  // Hiding a maximized panel and showing it again should not black out the editor.
  return { ...state, panel: { ...state.panel, visible, maximized: visible && state.panel.maximized } };
}

export function toggleStatusBar(state: LayoutState, force?: boolean): LayoutState {
  return { ...state, statusBarVisible: force ?? !state.statusBarVisible };
}

export function toggleActivityBar(state: LayoutState, force?: boolean): LayoutState {
  return { ...state, activityBarVisible: force ?? !state.activityBarVisible };
}

/** Maximizing implies showing: a maximized-but-hidden panel is not a state anyone wants. */
export function maximizePanel(state: LayoutState, force?: boolean): LayoutState {
  const maximized = force ?? !state.panel.maximized;
  return { ...state, panel: { ...state.panel, maximized, visible: maximized || state.panel.visible } };
}

export function resizeSideBar(state: LayoutState, width: number): LayoutState {
  const { min, max } = LAYOUT_LIMITS.sidebarWidth;
  return { ...state, sidebar: { ...state.sidebar, width: clamp(width, min, max) } };
}

/** Resizes whichever dimension the panel's current position uses. */
export function resizePanel(state: LayoutState, extent: number): LayoutState {
  if (state.panel.position === 'bottom') {
    const { min, max } = LAYOUT_LIMITS.panelHeight;
    return { ...state, panel: { ...state.panel, height: clamp(extent, min, max) } };
  }
  const { min, max } = LAYOUT_LIMITS.panelWidth;
  return { ...state, panel: { ...state.panel, width: clamp(extent, min, max) } };
}

/** The extent the panel currently uses, in its current position. */
export function panelExtent(state: LayoutState): number {
  return state.panel.position === 'bottom' ? state.panel.height : state.panel.width;
}

/**
 * Zen mode: the code, and nothing else. Reversible, because it is expressed as a
 * state rather than a mode flag — leaving zen restores whatever was saved.
 */
export function zenLayout(state: LayoutState): LayoutState {
  return {
    ...state,
    sidebar: { ...state.sidebar, visible: false },
    panel: { ...state.panel, visible: false, maximized: false },
    statusBarVisible: false,
    activityBarVisible: false,
  };
}

export function isZen(state: LayoutState): boolean {
  return !state.sidebar.visible && !state.panel.visible && !state.statusBarVisible && !state.activityBarVisible;
}

/* ---------------------------------------------------------- persistence */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Read a layout from persisted (therefore untrusted) JSON. Anything missing or
 * out of range falls back to the default: a broken settings file must not be
 * able to render the IDE unusable.
 */
export function parseLayout(value: unknown): LayoutState {
  const root = asRecord(value);
  const sidebar = asRecord(root.sidebar);
  const panel = asRecord(root.panel);

  const side: SideBarSide = sidebar.side === 'right' ? 'right' : 'left';
  const position: PanelPosition = panel.position === 'right' ? 'right' : 'bottom';

  return {
    sidebar: {
      side,
      visible: bool(sidebar.visible, DEFAULT_LAYOUT.sidebar.visible),
      width: clamp(Number(sidebar.width ?? DEFAULT_LAYOUT.sidebar.width), LAYOUT_LIMITS.sidebarWidth.min, LAYOUT_LIMITS.sidebarWidth.max),
    },
    panel: {
      position,
      visible: bool(panel.visible, DEFAULT_LAYOUT.panel.visible),
      height: clamp(Number(panel.height ?? DEFAULT_LAYOUT.panel.height), LAYOUT_LIMITS.panelHeight.min, LAYOUT_LIMITS.panelHeight.max),
      width: clamp(Number(panel.width ?? DEFAULT_LAYOUT.panel.width), LAYOUT_LIMITS.panelWidth.min, LAYOUT_LIMITS.panelWidth.max),
      maximized: bool(panel.maximized, false) && bool(panel.visible, true),
    },
    statusBarVisible: bool(root.statusBarVisible, true),
    activityBarVisible: bool(root.activityBarVisible, true),
  };
}

/** True when two layouts would render identically. */
export function layoutsEqual(a: LayoutState, b: LayoutState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The CSS custom properties a layout implies. Keeps the DOM code trivial. */
export function layoutVariables(state: LayoutState): Record<string, string> {
  return {
    '--znxstudio-sidebar-width': `${state.sidebar.width}px`,
    '--znxstudio-panel-height': `${state.panel.height}px`,
    '--znxstudio-panel-width': `${state.panel.width}px`,
  };
}

/** The classes the workbench root should carry for a layout. */
export function layoutClasses(state: LayoutState): string[] {
  const classes = [`sidebar-${state.sidebar.side}`, `panel-${state.panel.position}`];
  if (!state.sidebar.visible) classes.push('sidebar-hidden');
  if (!state.panel.visible) classes.push('panel-hidden');
  if (state.panel.maximized) classes.push('panel-maximized');
  if (!state.statusBarVisible) classes.push('statusbar-hidden');
  if (!state.activityBarVisible) classes.push('activitybar-hidden');
  if (isZen(state)) classes.push('is-zen');
  return classes;
}
