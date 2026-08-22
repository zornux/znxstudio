import { Emitter, type Event } from '../core/Emitter';
import type {
  MobileIRApp,
  MobileIRScreen,
  MobileIRNode,
  ChangeClassification,
  SimulatorEnvironment,
  SimulatorTheme,
  SimulatorOrientation,
  ConnectivityMode,
} from '../../shared/simulatorTypes';
import { SimulatorStateStore } from './SimulatorStateStore';
import { SimulatorNavigation } from './SimulatorNavigation';
import { SimulatorActions } from './SimulatorActions';
import { SimulatorCapabilities } from './SimulatorCapabilities';
import { SimulatorHttp } from './SimulatorHttp';
import { SimulatorStorage } from './SimulatorStorage';
import { SimulatorPermissions } from './SimulatorPermissions';
import { SimulatorDiagnostics, SimulatorEventLog } from './SimulatorDiagnostics';
import { DEFAULT_DEVICE_PROFILE } from './SimulatorDeviceProfile';
import { SimulatorClock } from './SimulatorClock';
import { SimulatorEnvironmentModel } from './SimulatorEnvironmentModel';
import { SimulatorGestureEngine } from './SimulatorGestureEngine';
import { SimulatorFocusManager } from './SimulatorFocusManager';
import { SimulatorAnimationScheduler } from './SimulatorAnimationScheduler';
import { SimulatorPerformance } from './SimulatorPerformance';
import { SimulatorNetworkInspector } from './SimulatorNetworkInspector';
import { SimulatorStateDebugger } from './SimulatorStateDebugger';
import { SimulatorAccessibility } from './SimulatorAccessibility';
import { SimulatorResponsive } from './SimulatorResponsive';
import { SimulatorRegistry } from './SimulatorRegistry';
import { SimulatorScreenshot } from './SimulatorScreenshot';

export class SimulatorRuntime {
  readonly stateStore = new SimulatorStateStore();
  readonly navigation = new SimulatorNavigation();
  readonly permissions = new SimulatorPermissions();
  readonly capabilities = new SimulatorCapabilities();
  readonly storage = new SimulatorStorage();
  readonly http: SimulatorHttp;
  readonly diagnostics = new SimulatorDiagnostics();
  readonly eventLog = new SimulatorEventLog();
  readonly actions: SimulatorActions;

  readonly clock = new SimulatorClock();
  readonly environmentModel = new SimulatorEnvironmentModel();
  readonly gestureEngine = new SimulatorGestureEngine();
  readonly focusManager = new SimulatorFocusManager();
  readonly animationScheduler: SimulatorAnimationScheduler;
  readonly perf: SimulatorPerformance;
  readonly networkInspector: SimulatorNetworkInspector;
  readonly stateDebugger: SimulatorStateDebugger;
  readonly accessibility = new SimulatorAccessibility();
  readonly responsive = new SimulatorResponsive();
  readonly registry = new SimulatorRegistry();
  readonly screenshot: SimulatorScreenshot;

  private app: MobileIRApp | null = null;
  private environment: SimulatorEnvironment = {
    theme: 'light',
    fontScale: 1,
    reducedMotion: false,
    highContrast: false,
    orientation: 'portrait',
    deviceProfile: DEFAULT_DEVICE_PROFILE,
    connectivity: 'online',
  };

  private readonly _onDidLoadApp = new Emitter<MobileIRApp>();
  readonly onDidLoadApp: Event<MobileIRApp> = this._onDidLoadApp.event;

  private readonly _onDidChangeScreen = new Emitter<MobileIRScreen>();
  readonly onDidChangeScreen: Event<MobileIRScreen> = this._onDidChangeScreen.event;

  private readonly _onDidChangeEnvironment = new Emitter<SimulatorEnvironment>();
  readonly onDidChangeEnvironment: Event<SimulatorEnvironment> = this._onDidChangeEnvironment.event;

  private readonly _onDidReload = new Emitter<ChangeClassification>();
  readonly onDidReload: Event<ChangeClassification> = this._onDidReload.event;

  private readonly _onToast = new Emitter<string>();
  readonly onToast: Event<string> = this._onToast.event;

  constructor() {
    this.http = new SimulatorHttp(this.capabilities.connectivity);
    this.animationScheduler = new SimulatorAnimationScheduler(this.clock);
    this.perf = new SimulatorPerformance(this.clock);
    this.networkInspector = new SimulatorNetworkInspector(this.http, this.clock);
    this.stateDebugger = new SimulatorStateDebugger(this.stateStore, this.navigation, this.permissions, this.clock);
    this.screenshot = new SimulatorScreenshot(this.environmentModel, this.clock);
    this.actions = new SimulatorActions(
      this.stateStore,
      this.navigation,
      this.http,
      this.storage,
      this.permissions,
      this.capabilities,
      this.diagnostics,
      this.eventLog,
      (msg: string) => this._onToast.fire(msg),
    );

    this.navigation.onDidNavigate(({ screen }) => {
      const screenModel = this.findScreen(screen);
      if (screenModel) {
        this.initScreenState(screenModel);
        this._onDidChangeScreen.fire(screenModel);
        this.eventLog.log('screen_opened', `Opened screen: ${screen}`);
        this.eventLog.log('lifecycle', `Screen ${screen} created`);
        this.focusManager.onScreenOpen();
      } else {
        this.diagnostics.error('navigation_error', `Screen '${screen}' not found`);
      }
    });
  }

  loadApp(app: MobileIRApp): void {
    this.app = app;
    this.diagnostics.clear();
    this.eventLog.clear();
    this.stateStore.reset();

    this.validateApp(app);

    this.navigation.reset(app.startScreen);
    const startScreen = this.findScreen(app.startScreen);
    if (startScreen) {
      this.initScreenState(startScreen);
      this.eventLog.log('lifecycle', `Application "${app.name}" started`);
      this.eventLog.log('screen_opened', `Opened screen: ${app.startScreen}`);
      this._onDidLoadApp.fire(app);
      this._onDidChangeScreen.fire(startScreen);
    } else {
      this.diagnostics.error('navigation_error', `Start screen '${app.startScreen}' not found`);
    }
  }

  reload(newApp: MobileIRApp): void {
    if (!this.app) {
      this.loadApp(newApp);
      return;
    }

    const classification = this.classifyChange(this.app, newApp);
    this.app = newApp;
    this.diagnostics.clear();
    this.validateApp(newApp);

    switch (classification) {
      case 'StyleOnly':
      case 'Content':
      case 'Layout':
        break;
      case 'StateShape': {
        const screen = this.currentScreenModel();
        if (screen) this.initScreenState(screen);
        break;
      }
      case 'Navigation':
      case 'Capability':
      case 'ApplicationStructure':
        this.stateStore.reset();
        this.navigation.reset(newApp.startScreen);
        const startScreen = this.findScreen(newApp.startScreen);
        if (startScreen) this.initScreenState(startScreen);
        break;
    }

    this._onDidReload.fire(classification);
    this.eventLog.log('lifecycle', `Hot reload: ${classification}`);

    const currentModel = this.currentScreenModel();
    if (currentModel) this._onDidChangeScreen.fire(currentModel);
  }

  getApp(): MobileIRApp | null {
    return this.app;
  }

  currentScreenModel(): MobileIRScreen | null {
    if (!this.app) return null;
    return this.findScreen(this.navigation.currentScreen());
  }

  findScreen(name: string): MobileIRScreen | null {
    return this.app?.screens.find((s) => s.name === name) ?? null;
  }

  allScreens(): MobileIRScreen[] {
    return this.app?.screens ?? [];
  }

  findNode(nodeId: string): MobileIRNode | null {
    if (!this.app) return null;
    for (const screen of this.app.screens) {
      const found = this.findNodeInTree(nodeId, screen.rootChildren);
      if (found) return found;
    }
    return null;
  }

  executeAction(body: string): Promise<void> {
    return this.actions.execute(body, {
      screenName: this.navigation.currentScreen(),
    });
  }

  setTheme(theme: SimulatorTheme): void {
    this.environment = { ...this.environment, theme };
    this._onDidChangeEnvironment.fire(this.environment);
  }

  setFontScale(fontScale: number): void {
    this.environment = { ...this.environment, fontScale: Math.max(0.5, Math.min(3, fontScale)) };
    this._onDidChangeEnvironment.fire(this.environment);
  }

  setReducedMotion(reducedMotion: boolean): void {
    this.environment = { ...this.environment, reducedMotion };
    this._onDidChangeEnvironment.fire(this.environment);
  }

  setHighContrast(highContrast: boolean): void {
    this.environment = { ...this.environment, highContrast };
    this._onDidChangeEnvironment.fire(this.environment);
  }

  setOrientation(orientation: SimulatorOrientation): void {
    this.environment = { ...this.environment, orientation };
    this._onDidChangeEnvironment.fire(this.environment);
  }

  setDeviceProfile(deviceProfile: import('../../shared/simulatorTypes').SimulatorDeviceProfile): void {
    this.environment = { ...this.environment, deviceProfile };
    this.environmentModel.set('device', deviceProfile);
    this._onDidChangeEnvironment.fire(this.environment);
  }

  setConnectivity(mode: ConnectivityMode): void {
    this.environment = { ...this.environment, connectivity: mode };
    this.capabilities.connectivity.setMode(mode);
    this._onDidChangeEnvironment.fire(this.environment);
  }

  getEnvironment(): SimulatorEnvironment {
    return this.environment;
  }

  reset(): void {
    this.stateStore.reset();
    this.storage.clearAll();
    this.permissions.resetAll();
    this.capabilities.reset();
    this.http.clearMocks();
    this.http.clearRecorded();
    this.diagnostics.clear();
    this.eventLog.clear();
    this.clock.reset();
    this.gestureEngine.reset();
    this.focusManager.reset();
    this.animationScheduler.cancelAll();
    this.perf.reset();
    this.networkInspector.clear();
    this.stateDebugger.reset();
    if (this.app) this.loadApp(this.app);
  }

  dispose(): void {
    this.stateStore.dispose();
    this.navigation.dispose();
    this.actions.dispose();
    this.permissions.dispose();
    this.capabilities.dispose();
    this.storage.dispose();
    this.http.dispose();
    this.diagnostics.dispose();
    this.eventLog.dispose();
    this.clock.dispose();
    this.gestureEngine.dispose();
    this.focusManager.dispose();
    this.animationScheduler.dispose();
    this.perf.dispose();
    this.networkInspector.dispose();
    this.stateDebugger.dispose();
    this._onDidLoadApp.dispose();
    this._onDidChangeScreen.dispose();
    this._onDidChangeEnvironment.dispose();
    this._onDidReload.dispose();
    this._onToast.dispose();
  }

  private initScreenState(screen: MobileIRScreen): void {
    this.stateStore.initScreen(screen.name, screen.states);
  }

  private findNodeInTree(nodeId: string, nodes: MobileIRNode[]): MobileIRNode | null {
    for (const node of nodes) {
      if (node.id === nodeId) return node;
      const found = this.findNodeInTree(nodeId, node.children);
      if (found) return found;
    }
    return null;
  }

  private validateApp(app: MobileIRApp): void {
    if (!app.screens.length) {
      this.diagnostics.error('application_error', 'Application has no screens');
    }
    if (!app.screens.some((s) => s.name === app.startScreen)) {
      this.diagnostics.error('navigation_error', `Start screen '${app.startScreen}' does not exist`);
    }
    for (const screen of app.screens) {
      this.validateNodes(screen.rootChildren);
    }
  }

  private validateNodes(nodes: MobileIRNode[]): void {
    for (const node of nodes) {
      if (!SUPPORTED_KINDS.has(node.kind)) {
        this.diagnostics.unsupportedIR(node.kind, node.id);
      }
      this.validateNodes(node.children);
    }
  }

  private classifyChange(oldApp: MobileIRApp, newApp: MobileIRApp): ChangeClassification {
    if (oldApp.screens.length !== newApp.screens.length) return 'ApplicationStructure';

    const oldNames = new Set(oldApp.screens.map((s) => s.name));
    const newNames = new Set(newApp.screens.map((s) => s.name));
    if (oldNames.size !== newNames.size || [...oldNames].some((n) => !newNames.has(n))) return 'Navigation';

    if (oldApp.startScreen !== newApp.startScreen) return 'Navigation';

    if (JSON.stringify(oldApp.capabilities) !== JSON.stringify(newApp.capabilities)) return 'Capability';
    if (JSON.stringify(oldApp.permissions) !== JSON.stringify(newApp.permissions)) return 'Capability';

    let hasStateChange = false;
    let hasLayoutChange = false;
    let hasContentChange = false;

    for (const newScreen of newApp.screens) {
      const oldScreen = oldApp.screens.find((s) => s.name === newScreen.name);
      if (!oldScreen) return 'ApplicationStructure';

      if (JSON.stringify(oldScreen.states) !== JSON.stringify(newScreen.states)) hasStateChange = true;

      const classification = this.classifyNodeChanges(oldScreen.rootChildren, newScreen.rootChildren);
      if (classification === 'Layout') hasLayoutChange = true;
      else if (classification === 'Content') hasContentChange = true;
      else if (classification !== 'StyleOnly' && classification !== null) return classification;
    }

    if (hasStateChange) return 'StateShape';
    if (hasLayoutChange) return 'Layout';
    if (hasContentChange) return 'Content';
    return 'StyleOnly';
  }

  private classifyNodeChanges(
    oldNodes: MobileIRNode[],
    newNodes: MobileIRNode[],
  ): ChangeClassification | null {
    if (oldNodes.length !== newNodes.length) return 'Layout';
    for (let i = 0; i < oldNodes.length; i++) {
      const oldNode = oldNodes[i];
      const newNode = newNodes[i];
      if (oldNode.kind !== newNode.kind) return 'Layout';
      if (oldNode.events.length !== newNode.events.length) return 'Content';

      const oldProps = oldNode.properties;
      const newProps = newNode.properties;
      const allKeys = new Set([...Object.keys(oldProps), ...Object.keys(newProps)]);
      for (const key of allKeys) {
        if (oldProps[key] !== newProps[key]) {
          if (STYLE_ONLY_KEYS.has(key)) continue;
          if (CONTENT_KEYS.has(key)) return 'Content';
          return 'Layout';
        }
      }

      const childClassification = this.classifyNodeChanges(oldNode.children, newNode.children);
      if (childClassification && childClassification !== 'StyleOnly') return childClassification;
    }
    return null;
  }
}

const STYLE_ONLY_KEYS = new Set([
  'color', 'backgroundColor', 'borderColor', 'borderWidth', 'cornerRadius',
  'elevation', 'opacity', 'rotation', 'fontSize', 'fontWeight', 'lineHeight',
  'letterSpacing', 'textAlign', 'tintColor', 'containerColor', 'contentColor',
  'checkColor', 'labelColor', 'trackColor', 'thumbColor', 'activeColor',
  'indicatorColor', 'chipStyle', 'barStyle', 'weight', 'size',
]);

const CONTENT_KEYS = new Set([
  'content', 'label', 'placeholder', 'title', 'message', 'items', 'source',
  'alt', 'name', 'supportingText', 'confirmLabel', 'cancelLabel', 'action',
  'iconName', 'binding',
]);

const SUPPORTED_KINDS = new Set([
  'text', 'button', 'image', 'icon', 'input', 'checkbox', 'switch', 'slider',
  'dropdown', 'column', 'row', 'stack', 'grid', 'spacer', 'divider',
  'scrollview', 'navbar', 'bottomnav', 'tabs', 'fab', 'card', 'list',
  'chip', 'badge', 'progress', 'snackbar', 'dialog',
]);
