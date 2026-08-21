import { Emitter, type Event } from '../core/Emitter';
import type { SimulatorDeviceProfile, SimulatorOrientation, SimulatorTheme } from '../../shared/simulatorTypes';
import type { SimulatorEnvironmentModel } from './SimulatorEnvironmentModel';
import type { SimulatorClock } from './SimulatorClock';

export type NavigationMode = 'three_button' | 'gesture';

export interface StatusBarState {
  clock: string;
  batteryLevel: number;
  batteryCharging: boolean;
  wifiEnabled: boolean;
  signalStrength: number;
  airplaneMode: boolean;
  networkType: string;
  darkIcons: boolean;
  backgroundColor: string;
}

export interface ViewportMetrics {
  deviceWidth: number;
  deviceHeight: number;
  statusBarHeight: number;
  navigationBarHeight: number;
  keyboardHeight: number;
  safeTop: number;
  safeBottom: number;
  safeLeft: number;
  safeRight: number;
  appViewportWidth: number;
  appViewportHeight: number;
}

export class SimulatorViewport {
  readonly frame: HTMLDivElement;
  private readonly statusBar: HTMLDivElement;
  private readonly appContainer: HTMLDivElement;
  private readonly navigationBar: HTMLDivElement;
  private readonly keyboardRegion: HTMLDivElement;
  private readonly errorBanner: HTMLDivElement;
  private navigationMode: NavigationMode = 'gesture';
  private env: SimulatorEnvironmentModel;
  private clock: SimulatorClock;
  private clockTimerId: number | null = null;

  private readonly _onMetricsChange = new Emitter<ViewportMetrics>();
  readonly onMetricsChange: Event<ViewportMetrics> = this._onMetricsChange.event;

  constructor(env: SimulatorEnvironmentModel, clock: SimulatorClock) {
    this.env = env;
    this.clock = clock;
    this.frame = document.createElement('div');
    this.frame.className = 'zsim-device-frame';

    this.statusBar = document.createElement('div');
    this.statusBar.className = 'zsim-status-bar';
    this.frame.appendChild(this.statusBar);

    this.appContainer = document.createElement('div');
    this.appContainer.className = 'zsim-app-container';
    this.frame.appendChild(this.appContainer);

    this.errorBanner = document.createElement('div');
    this.errorBanner.className = 'zsim-error-banner zsim-hidden';
    this.frame.appendChild(this.errorBanner);

    this.navigationBar = document.createElement('div');
    this.navigationBar.className = 'zsim-navigation-bar';
    this.frame.appendChild(this.navigationBar);

    this.keyboardRegion = document.createElement('div');
    this.keyboardRegion.className = 'zsim-keyboard-region zsim-hidden';
    this.frame.appendChild(this.keyboardRegion);

    this.env.onChange(() => this.applyEnvironment());
    this.applyEnvironment();
    this.startClock();
  }

  getAppContainer(): HTMLDivElement {
    return this.appContainer;
  }

  mountApp(element: HTMLElement): void {
    this.appContainer.innerHTML = '';
    this.appContainer.appendChild(element);
  }

  getNavigationMode(): NavigationMode {
    return this.navigationMode;
  }

  setNavigationMode(mode: NavigationMode): void {
    this.navigationMode = mode;
    this.renderNavigationBar();
    this.updateMetrics();
  }

  showKeyboard(inputMode: string, height = 280): void {
    this.keyboardRegion.className = 'zsim-keyboard-region';
    this.keyboardRegion.textContent = '';
    const label = document.createElement('div');
    label.className = 'zsim-keyboard-label';
    label.textContent = `⌨ Virtual Keyboard (${inputMode})`;
    this.keyboardRegion.appendChild(label);
    const hint = document.createElement('div');
    hint.className = 'zsim-keyboard-hint';
    hint.textContent = 'Type with physical keyboard';
    this.keyboardRegion.appendChild(hint);
    this.keyboardRegion.style.height = `${height}px`;
    this.env.set('keyboard', { visible: true, height, mode: inputMode as never });
    this.updateMetrics();
  }

  hideKeyboard(): void {
    this.keyboardRegion.className = 'zsim-keyboard-region zsim-hidden';
    this.keyboardRegion.style.height = '0';
    this.env.set('keyboard', { visible: false, height: 0, mode: 'text' });
    this.updateMetrics();
  }

  showError(message: string, diagnosticId?: string): void {
    this.errorBanner.className = 'zsim-error-banner';
    this.errorBanner.innerHTML = '';
    const icon = document.createElement('span');
    icon.textContent = '⊘ ';
    this.errorBanner.appendChild(icon);
    const msg = document.createElement('span');
    msg.textContent = message;
    this.errorBanner.appendChild(msg);
    if (diagnosticId) {
      const id = document.createElement('span');
      id.className = 'zsim-error-id';
      id.textContent = ` [${diagnosticId}]`;
      this.errorBanner.appendChild(id);
    }
    const actions = document.createElement('div');
    actions.className = 'zsim-error-actions';
    const reload = document.createElement('button');
    reload.textContent = 'Reload';
    reload.addEventListener('click', () => this._onReloadRequest.fire());
    actions.appendChild(reload);
    const dismiss = document.createElement('button');
    dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', () => this.clearError());
    actions.appendChild(dismiss);
    this.errorBanner.appendChild(actions);
  }

  private readonly _onReloadRequest = new Emitter<void>();
  readonly onReloadRequest: Event<void> = this._onReloadRequest.event;

  showCompileError(message: string): void {
    this.errorBanner.className = 'zsim-error-banner zsim-compile-error';
    this.errorBanner.innerHTML = '';
    const label = document.createElement('div');
    label.textContent = 'Preview paused — source contains errors';
    label.className = 'zsim-compile-label';
    this.errorBanner.appendChild(label);
    const detail = document.createElement('div');
    detail.className = 'zsim-compile-detail';
    detail.textContent = message;
    this.errorBanner.appendChild(detail);
  }

  clearError(): void {
    this.errorBanner.className = 'zsim-error-banner zsim-hidden';
    this.errorBanner.innerHTML = '';
  }

  getMetrics(): ViewportMetrics {
    const envState = this.env.get();
    const profile = envState.device;
    const isLandscape = envState.orientation === 'landscape';
    const deviceWidth = isLandscape ? profile.height : profile.width;
    const deviceHeight = isLandscape ? profile.width : profile.height;
    const statusBarHeight = profile.statusBarHeight;
    const navBarHeight = this.navigationMode === 'gesture' ? 20 : profile.navigationArea;
    const keyboardHeight = envState.keyboard.visible ? envState.keyboard.height : 0;
    return {
      deviceWidth, deviceHeight, statusBarHeight,
      navigationBarHeight: navBarHeight, keyboardHeight,
      safeTop: profile.safeArea.top, safeBottom: profile.safeArea.bottom + navBarHeight,
      safeLeft: profile.safeArea.left, safeRight: profile.safeArea.right,
      appViewportWidth: deviceWidth,
      appViewportHeight: deviceHeight - statusBarHeight - navBarHeight - keyboardHeight,
    };
  }

  private applyEnvironment(): void {
    const envState = this.env.get();
    const profile = envState.device;
    const isLandscape = envState.orientation === 'landscape';
    const w = isLandscape ? profile.height : profile.width;
    const h = isLandscape ? profile.width : profile.height;
    this.frame.style.width = `${w}px`;
    this.frame.style.height = `${h}px`;
    this.frame.dataset.theme = envState.theme === 'system' ? 'light' : envState.theme;
    this.frame.style.fontSize = `${14 * envState.fontScale}px`;
    if (envState.reducedMotion) this.frame.classList.add('zsim-reduced-motion');
    else this.frame.classList.remove('zsim-reduced-motion');
    this.renderStatusBar(envState);
    this.renderNavigationBar();
    this.updateMetrics();
  }

  private renderStatusBar(envState?: ReturnType<SimulatorEnvironmentModel['get']>): void {
    const state = envState ?? this.env.get();
    const isDark = state.theme === 'dark';
    this.statusBar.className = `zsim-status-bar ${isDark ? 'zsim-sb-dark' : 'zsim-sb-light'}`;
    this.statusBar.style.height = `${state.device.statusBarHeight}px`;
    this.statusBar.innerHTML = '';

    const left = document.createElement('div');
    left.className = 'zsim-sb-left';
    const clockEl = document.createElement('span');
    clockEl.className = 'zsim-sb-clock';
    const d = new Date(this.clock.now());
    clockEl.textContent = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    left.appendChild(clockEl);
    this.statusBar.appendChild(left);

    const right = document.createElement('div');
    right.className = 'zsim-sb-right';
    if (state.airplaneMode) {
      const airplane = document.createElement('span');
      airplane.textContent = '✈';
      right.appendChild(airplane);
    } else {
      if (state.wifiEnabled) {
        const wifi = document.createElement('span');
        wifi.textContent = '⏣';
        right.appendChild(wifi);
      }
      const signal = document.createElement('span');
      signal.textContent = '▂▄▆█'.slice(0, state.signalStrength);
      right.appendChild(signal);
    }
    const batteryIcon = state.battery.charging ? '⚡' : state.battery.level <= 20 ? '▪' : '█';
    const battery = document.createElement('span');
    battery.className = 'zsim-sb-battery';
    battery.textContent = `${batteryIcon}${state.battery.level}%`;
    right.appendChild(battery);
    this.statusBar.appendChild(right);
  }

  private renderNavigationBar(): void {
    this.navigationBar.innerHTML = '';
    if (this.navigationMode === 'three_button') {
      this.navigationBar.className = 'zsim-navigation-bar zsim-nav-buttons';
      for (const icon of ['◁', '○', '□']) {
        const btn = document.createElement('button');
        btn.className = 'zsim-nav-btn';
        btn.textContent = icon;
        this.navigationBar.appendChild(btn);
      }
      this.navigationBar.style.height = `${this.env.get().device.navigationArea}px`;
    } else {
      this.navigationBar.className = 'zsim-navigation-bar zsim-nav-gesture';
      const indicator = document.createElement('div');
      indicator.className = 'zsim-gesture-indicator';
      this.navigationBar.appendChild(indicator);
      this.navigationBar.style.height = '20px';
    }
  }

  private startClock(): void {
    this.clockTimerId = this.clock.setInterval(() => {
      const clockEl = this.statusBar.querySelector('.zsim-sb-clock');
      if (clockEl) {
        const d = new Date(this.clock.now());
        clockEl.textContent = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
      }
    }, 60000);
  }

  private updateMetrics(): void {
    this._onMetricsChange.fire(this.getMetrics());
  }

  dispose(): void {
    if (this.clockTimerId !== null) this.clock.clearInterval(this.clockTimerId);
    this._onMetricsChange.dispose();
    this._onReloadRequest.dispose();
    this.frame.remove();
  }
}
