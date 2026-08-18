/**
 * Device preview frame for the visual designer. Renders a phone/tablet bezel
 * around the design canvas and handles device size presets, orientation
 * toggling, and theme switching.
 */

import { Emitter, type Event } from '../core/Emitter';

// ---------------------------------------------------------------------------
// Device presets
// ---------------------------------------------------------------------------

export interface DevicePreset {
  id: string;
  label: string;
  width: number;
  height: number;
  category: 'phone' | 'tablet';
}

export const DEVICE_PRESETS: readonly DevicePreset[] = [
  { id: 'pixel-7', label: 'Pixel 7', width: 412, height: 915, category: 'phone' },
  { id: 'pixel-7a', label: 'Pixel 7a', width: 412, height: 892, category: 'phone' },
  { id: 'pixel-fold', label: 'Pixel Fold', width: 841, height: 701, category: 'phone' },
  { id: 'samsung-s24', label: 'Galaxy S24', width: 360, height: 780, category: 'phone' },
  { id: 'small-phone', label: 'Small Phone', width: 320, height: 568, category: 'phone' },
  { id: 'medium-phone', label: 'Medium Phone', width: 393, height: 852, category: 'phone' },
  { id: 'large-phone', label: 'Large Phone', width: 430, height: 932, category: 'phone' },
  { id: 'tablet-10', label: 'Tablet 10"', width: 800, height: 1280, category: 'tablet' },
  { id: 'tablet-7', label: 'Tablet 7"', width: 600, height: 1024, category: 'tablet' },
  { id: 'pixel-tablet', label: 'Pixel Tablet', width: 1280, height: 800, category: 'tablet' },
];

export type Orientation = 'portrait' | 'landscape';
export type PreviewTheme = 'light' | 'dark';

/** Stable on-screen envelope at 100% designer zoom. */
const PREVIEW_STAGE_WIDTH = 760;
const PREVIEW_STAGE_HEIGHT = 640;

// ---------------------------------------------------------------------------
// DeviceFrame
// ---------------------------------------------------------------------------

export class DeviceFrame {
  private preset: DevicePreset = DEVICE_PRESETS[0];
  private orientation: Orientation = 'portrait';
  private theme: PreviewTheme = 'light';
  private scale = 1;

  readonly element: HTMLDivElement;
  readonly viewport: HTMLDivElement;
  readonly toolbar: HTMLDivElement;

  private readonly _onDidChange = new Emitter<void>();
  readonly onDidChange: Event<void> = this._onDidChange.event;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'zd-device-frame';

    this.toolbar = this.buildToolbar();
    this.element.appendChild(this.toolbar);

    const bezel = document.createElement('div');
    bezel.className = 'zd-device-bezel';
    const stage = document.createElement('div');
    stage.className = 'zd-device-stage';
    stage.appendChild(bezel);
    this.element.appendChild(stage);

    const camera = document.createElement('span');
    camera.className = 'zd-device-camera';
    camera.setAttribute('aria-hidden', 'true');
    bezel.appendChild(camera);

    const statusBar = document.createElement('div');
    statusBar.className = 'zd-device-statusbar';
    statusBar.innerHTML = `
      <span class="zd-statusbar-time">12:00</span>
      <span class="zd-statusbar-icons" aria-hidden="true">
        <span class="zd-status-signal"></span>
        <span class="zd-status-wifi"></span>
        <span class="zd-status-battery"></span>
      </span>
    `;
    bezel.appendChild(statusBar);

    this.viewport = document.createElement('div');
    this.viewport.className = 'zd-device-viewport';
    bezel.appendChild(this.viewport);

    const navBar = document.createElement('div');
    navBar.className = 'zd-device-navbar';
    navBar.innerHTML = '<span class="zd-nav-pill"></span>';
    bezel.appendChild(navBar);

    this.applyDimensions();
  }

  getPreset(): DevicePreset { return this.preset; }
  getOrientation(): Orientation { return this.orientation; }
  getTheme(): PreviewTheme { return this.theme; }
  getScale(): number { return this.scale; }

  setPreset(preset: DevicePreset): void {
    this.preset = preset;
    this.applyDimensions();
    this._onDidChange.fire();
  }

  setOrientation(orientation: Orientation): void {
    this.orientation = orientation;
    this.applyDimensions();
    this._onDidChange.fire();
  }

  toggleOrientation(): void {
    this.setOrientation(this.orientation === 'portrait' ? 'landscape' : 'portrait');
  }

  setTheme(theme: PreviewTheme): void {
    this.theme = theme;
    this.viewport.dataset.previewTheme = theme;
    this._onDidChange.fire();
  }

  toggleTheme(): void {
    this.setTheme(this.theme === 'light' ? 'dark' : 'light');
  }

  setScale(scale: number): void {
    this.scale = Math.max(0.25, Math.min(2, scale));
    this.applyDimensions();
    this._onDidChange.fire();
  }

  effectiveWidth(): number {
    return this.orientation === 'portrait' ? this.preset.width : this.preset.height;
  }

  effectiveHeight(): number {
    return this.orientation === 'portrait' ? this.preset.height : this.preset.width;
  }

  private applyDimensions(): void {
    const w = this.effectiveWidth();
    const h = this.effectiveHeight();
    const bezel = this.element.querySelector('.zd-device-bezel') as HTMLElement;
    if (bezel) {
      bezel.dataset.deviceId = this.preset.id;
      bezel.dataset.deviceCategory = this.preset.category;
      bezel.dataset.orientation = this.orientation;
      bezel.style.width = `${w}px`;
      bezel.style.height = `${h}px`;
      // CSS zoom participates in layout, unlike transform, so the frame does
      // not reserve its full logical-pixel size after being fitted. Device
      // resolution and aspect ratio stay accurate while every preset fits the
      // same stage; the toolbar scale remains the user's relative zoom control.
      const fittedScale = Math.min(PREVIEW_STAGE_WIDTH / w, PREVIEW_STAGE_HEIGHT / h);
      bezel.style.setProperty('zoom', String(fittedScale * this.scale));
      bezel.style.transform = '';
      bezel.style.transformOrigin = '';
    }
  }

  private buildToolbar(): HTMLDivElement {
    const bar = document.createElement('div');
    bar.className = 'zd-device-toolbar';

    // Device selector
    const deviceSelect = document.createElement('select');
    deviceSelect.className = 'zd-toolbar-select';
    deviceSelect.setAttribute('aria-label', 'Device');
    for (const category of ['phone', 'tablet'] as const) {
      const group = document.createElement('optgroup');
      group.label = category === 'phone' ? 'Phones and foldables' : 'Tablets';
      for (const preset of DEVICE_PRESETS.filter((candidate) => candidate.category === category)) {
        const opt = document.createElement('option');
        opt.value = preset.id;
        opt.textContent = preset.label;
        group.appendChild(opt);
      }
      deviceSelect.appendChild(group);
    }
    deviceSelect.addEventListener('change', () => {
      const found = DEVICE_PRESETS.find((p) => p.id === deviceSelect.value);
      if (found) this.setPreset(found);
    });
    bar.appendChild(deviceSelect);

    const dimensions = document.createElement('span');
    dimensions.className = 'zd-toolbar-dimensions';
    dimensions.setAttribute('aria-live', 'polite');
    dimensions.textContent = `${this.effectiveWidth()} × ${this.effectiveHeight()}`;
    bar.appendChild(dimensions);

    // Orientation toggle
    const orientBtn = document.createElement('button');
    orientBtn.className = 'zd-toolbar-btn';
    orientBtn.setAttribute('aria-label', 'Toggle orientation');
    orientBtn.title = 'Toggle orientation';
    orientBtn.textContent = '↻';
    orientBtn.addEventListener('click', () => this.toggleOrientation());
    bar.appendChild(orientBtn);

    // Theme toggle
    const themeBtn = document.createElement('button');
    themeBtn.className = 'zd-toolbar-btn';
    themeBtn.setAttribute('aria-label', 'Toggle light/dark theme');
    themeBtn.title = 'Toggle theme';
    themeBtn.textContent = '◑';
    themeBtn.addEventListener('click', () => this.toggleTheme());
    bar.appendChild(themeBtn);

    // Zoom controls
    const zoomOut = document.createElement('button');
    zoomOut.className = 'zd-toolbar-btn';
    zoomOut.textContent = '−';
    zoomOut.title = 'Zoom out';
    zoomOut.setAttribute('aria-label', 'Zoom out');
    zoomOut.addEventListener('click', () => this.setScale(this.scale - 0.1));
    bar.appendChild(zoomOut);

    const zoomLabel = document.createElement('span');
    zoomLabel.className = 'zd-toolbar-zoom';
    zoomLabel.textContent = '100%';
    bar.appendChild(zoomLabel);

    const zoomIn = document.createElement('button');
    zoomIn.className = 'zd-toolbar-btn';
    zoomIn.textContent = '+';
    zoomIn.title = 'Zoom in';
    zoomIn.setAttribute('aria-label', 'Zoom in');
    zoomIn.addEventListener('click', () => this.setScale(this.scale + 0.1));
    bar.appendChild(zoomIn);

    this._onDidChange.event(() => {
      zoomLabel.textContent = `${Math.round(this.scale * 100)}%`;
      deviceSelect.value = this.preset.id;
      dimensions.textContent = `${this.effectiveWidth()} × ${this.effectiveHeight()}`;
      themeBtn.textContent = this.theme === 'light' ? '◑' : '◐';
    });

    return bar;
  }

  dispose(): void {
    this._onDidChange.dispose();
    this.element.remove();
  }
}
