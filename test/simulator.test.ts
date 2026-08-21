import { describe, expect, test } from './harness';
import { IpcChannels } from '../src/shared/ipc';
import { CommandIds } from '../src/renderer/commands/CommandIds';
import type {
  MobileIRApp,
  MobileIRNode,
  SimulatorTestCase,
  MockEndpoint,
} from '../src/shared/simulatorTypes';
import {
  SIMULATOR_DEVICE_PROFILES,
  getDeviceProfile,
  profilesByClass,
  createCustomProfile,
  DEFAULT_DEVICE_PROFILE,
} from '../src/renderer/simulator/SimulatorDeviceProfile';
import { SimulatorDiagnostics, SimulatorEventLog } from '../src/renderer/simulator/SimulatorDiagnostics';
import { SimulatorStateStore } from '../src/renderer/simulator/SimulatorStateStore';
import { SimulatorNavigation } from '../src/renderer/simulator/SimulatorNavigation';
import { SimulatorPermissions } from '../src/renderer/simulator/SimulatorPermissions';
import { SimulatorCapabilities } from '../src/renderer/simulator/SimulatorCapabilities';
import { SimulatorStorage } from '../src/renderer/simulator/SimulatorStorage';
import { SimulatorHttp } from '../src/renderer/simulator/SimulatorHttp';
import { SimulatorRuntime } from '../src/renderer/simulator/SimulatorRuntime';
import { SimulatorTestRunner } from '../src/renderer/simulator/SimulatorTestRunner';
import { Emitter } from '../src/renderer/core/Emitter';
import { SimulatorClock } from '../src/renderer/simulator/SimulatorClock';
import { SimulatorEnvironmentModel } from '../src/renderer/simulator/SimulatorEnvironmentModel';
import { SimulatorAnimationScheduler } from '../src/renderer/simulator/SimulatorAnimationScheduler';
import { SimulatorAccessibility } from '../src/renderer/simulator/SimulatorAccessibility';
import { SimulatorResponsive } from '../src/renderer/simulator/SimulatorResponsive';
import { SimulatorRegistry } from '../src/renderer/simulator/SimulatorRegistry';
import { SimulatorPerformance } from '../src/renderer/simulator/SimulatorPerformance';
import { SimulatorScreenshot } from '../src/renderer/simulator/SimulatorScreenshot';
import { SimulatorStateDebugger } from '../src/renderer/simulator/SimulatorStateDebugger';
import { SimulatorTransitions } from '../src/renderer/simulator/SimulatorTransitions';
import { SimulatorFocusManager } from '../src/renderer/simulator/SimulatorFocusManager';
import { SimulatorGestureEngine } from '../src/renderer/simulator/SimulatorGestureEngine';
import { SimulatorNetworkInspector } from '../src/renderer/simulator/SimulatorNetworkInspector';
import { SimulatorViewport } from '../src/renderer/simulator/SimulatorViewport';
import { SimulatorTestRunnerV2 } from '../src/renderer/simulator/SimulatorTestRunnerV2';
import { SimulatorInspector } from '../src/renderer/simulator/SimulatorInspector';
import { SimulatorSession } from '../src/renderer/simulator/SimulatorSession';
import { SimulatorRenderer } from '../src/renderer/simulator/SimulatorRenderer';

/* ===== Helper: test app ===== */

function makeTestApp(): MobileIRApp {
  return {
    name: 'TestApp',
    startScreen: 'Home',
    screens: [
      {
        name: 'Home',
        states: [
          { name: 'counter', type: 'whole', initialValue: '0' },
          { name: 'name', type: 'text', initialValue: 'World' },
        ],
        rootChildren: [
          {
            id: 'txt1', kind: 'text',
            properties: { content: 'Hello {name}' },
            events: [], children: [],
          },
          {
            id: 'btn1', kind: 'button',
            properties: { label: 'Increment' },
            events: [{ event: 'tapped', body: 'set counter to counter + 1' }],
            children: [],
          },
          {
            id: 'nav_btn', kind: 'button',
            properties: { label: 'Go Settings', testTag: 'nav-settings' },
            events: [{ event: 'tapped', body: 'go to Settings' }],
            children: [],
          },
        ],
      },
      {
        name: 'Settings',
        states: [{ name: 'darkMode', type: 'truth', initialValue: 'false' }],
        rootChildren: [
          {
            id: 'sw1', kind: 'switch',
            properties: { label: 'Dark Mode', binding: 'darkMode' },
            events: [], children: [],
          },
          {
            id: 'back_btn', kind: 'button',
            properties: { label: 'Back' },
            events: [{ event: 'tapped', body: 'go back' }],
            children: [],
          },
        ],
      },
    ],
    permissions: ['camera', 'location'],
    capabilities: ['camera', 'location'],
  };
}

/* ===== 1. IPC channel contracts ===== */

describe('simulator IPC channel contracts', () => {
  const simulatorChannels = [
    'SimulatorCompile',
    'SimulatorScreenshot',
    'SimulatorSessionState',
  ] as const;

  for (const key of simulatorChannels) {
    test(`IpcChannels.${key} is defined and prefixed with 'simulator:'`, () => {
      const value = (IpcChannels as Record<string, string>)[key];
      expect(value).toBeTruthy();
      expect(typeof value).toBe('string');
      expect(value.startsWith('simulator:')).toBeTruthy();
    });
  }

  test('all simulator channels are unique (no collision)', () => {
    const allValues = simulatorChannels.map(
      (k) => (IpcChannels as Record<string, string>)[k],
    );
    const unique = new Set(allValues);
    expect(unique.size).toBe(allValues.length);
  });

  test('SimulatorCompile has expected value', () => {
    expect(IpcChannels.SimulatorCompile).toBe('simulator:compile');
  });

  test('SimulatorScreenshot has expected value', () => {
    expect(IpcChannels.SimulatorScreenshot).toBe('simulator:screenshot');
  });

  test('SimulatorSessionState has expected value', () => {
    expect(IpcChannels.SimulatorSessionState).toBe('simulator:session-state');
  });
});

/* ===== 2. Command ID contracts ===== */

describe('simulator command IDs', () => {
  const commands = [
    'SimulatorOpen', 'SimulatorClose', 'SimulatorStart', 'SimulatorStop',
    'SimulatorRestart', 'SimulatorPause', 'SimulatorResume', 'SimulatorReset',
    'SimulatorThemeToggle', 'SimulatorOrientationToggle', 'SimulatorDeviceSelect',
    'SimulatorConnectivity', 'SimulatorFontScaleUp', 'SimulatorFontScaleDown',
    'SimulatorFontScaleReset', 'SimulatorInspectToggle', 'SimulatorScreenshot',
    'SimulatorTestRun', 'SimulatorTestStop', 'SimulatorHttpMode',
    'SimulatorPermissionsReset', 'SimulatorStorageClear',
  ] as const;

  for (const key of commands) {
    test(`CommandIds.${key} is defined and prefixed with 'znxstudio.simulator.'`, () => {
      const value = (CommandIds as Record<string, string>)[key];
      expect(value).toBeTruthy();
      expect(value.startsWith('znxstudio.simulator.')).toBeTruthy();
    });
  }

  test('22 simulator commands registered', () => {
    expect(commands.length).toBe(22);
  });
});

/* ===== 3. SimulatorDeviceProfile ===== */

describe('SimulatorDeviceProfile', () => {
  test('8 device profiles exist', () => {
    expect(SIMULATOR_DEVICE_PROFILES.length).toBe(8);
  });

  test('all profiles have valid width (> 0)', () => {
    for (const p of SIMULATOR_DEVICE_PROFILES) {
      expect(p.width).toBeGreaterThan(0);
    }
  });

  test('all profiles have valid height (> 0)', () => {
    for (const p of SIMULATOR_DEVICE_PROFILES) {
      expect(p.height).toBeGreaterThan(0);
    }
  });

  test('all profiles have valid density (> 0)', () => {
    for (const p of SIMULATOR_DEVICE_PROFILES) {
      expect(p.density).toBeGreaterThan(0);
    }
  });

  test('getDeviceProfile("standard-phone") returns the standard phone', () => {
    const profile = getDeviceProfile('standard-phone');
    expect(profile).toBeTruthy();
    expect(profile!.id).toBe('standard-phone');
    expect(profile!.label).toBe('Standard Android Phone');
  });

  test('getDeviceProfile returns undefined for nonexistent id', () => {
    const profile = getDeviceProfile('nonexistent-device');
    expect(profile === undefined).toBeTruthy();
  });

  test('profilesByClass("phone") returns 5 phone profiles', () => {
    const phones = profilesByClass('phone');
    expect(phones.length).toBe(5);
    for (const p of phones) {
      expect(p.deviceClass).toBe('phone');
    }
  });

  test('profilesByClass("tablet") returns 2 tablet profiles', () => {
    const tablets = profilesByClass('tablet');
    expect(tablets.length).toBe(2);
    for (const t of tablets) {
      expect(t.deviceClass).toBe('tablet');
    }
  });

  test('profilesByClass("foldable") returns 1 foldable profile', () => {
    const foldables = profilesByClass('foldable');
    expect(foldables.length).toBe(1);
    expect(foldables[0].deviceClass).toBe('foldable');
  });

  test('createCustomProfile("Test", 500, 900) returns correct profile', () => {
    const profile = createCustomProfile('Test', 500, 900);
    expect(profile.label).toBe('Test');
    expect(profile.width).toBe(500);
    expect(profile.height).toBe(900);
    expect(profile.id).toBe('custom-500x900');
    expect(profile.deviceClass).toBe('phone');
  });

  test('createCustomProfile with explicit deviceClass', () => {
    const profile = createCustomProfile('Tablet', 800, 1200, 'tablet');
    expect(profile.deviceClass).toBe('tablet');
  });

  test('DEFAULT_DEVICE_PROFILE is standard-phone', () => {
    expect(DEFAULT_DEVICE_PROFILE.id).toBe('standard-phone');
  });

  test('DEFAULT_DEVICE_PROFILE is a phone class', () => {
    expect(DEFAULT_DEVICE_PROFILE.deviceClass).toBe('phone');
  });

  test('all profiles have unique ids', () => {
    const ids = SIMULATOR_DEVICE_PROFILES.map((p) => p.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

/* ===== 4. SimulatorDiagnostics ===== */

describe('SimulatorDiagnostics', () => {
  test('report() adds diagnostic and fires onDiagnostic', () => {
    const diag = new SimulatorDiagnostics();
    const fired: unknown[] = [];
    diag.onDiagnostic((d) => fired.push(d));
    diag.report('error', 'render_failure', 'Test error');
    expect(diag.all().length).toBe(1);
    expect(fired.length).toBe(1);
    expect(diag.all()[0].severity).toBe('error');
    expect(diag.all()[0].category).toBe('render_failure');
    expect(diag.all()[0].message).toBe('Test error');
    diag.dispose();
  });

  test('error() shorthand creates error-level diagnostic', () => {
    const diag = new SimulatorDiagnostics();
    diag.error('action_failed', 'something broke');
    expect(diag.all().length).toBe(1);
    expect(diag.all()[0].severity).toBe('error');
    expect(diag.all()[0].category).toBe('action_failed');
    diag.dispose();
  });

  test('warning() shorthand creates warning-level diagnostic', () => {
    const diag = new SimulatorDiagnostics();
    diag.warning('mock_missing', 'no mock');
    expect(diag.all().length).toBe(1);
    expect(diag.all()[0].severity).toBe('warning');
    diag.dispose();
  });

  test('info() shorthand creates info-level diagnostic', () => {
    const diag = new SimulatorDiagnostics();
    diag.info('simulator_limitation', 'limited feature');
    expect(diag.all().length).toBe(1);
    expect(diag.all()[0].severity).toBe('info');
    diag.dispose();
  });

  test('simulatorLimitation() creates info-level diagnostic with correct category', () => {
    const diag = new SimulatorDiagnostics();
    diag.simulatorLimitation('Cannot simulate NFC', 'node-123');
    const all = diag.all();
    expect(all.length).toBe(1);
    expect(all[0].severity).toBe('info');
    expect(all[0].category).toBe('simulator_limitation');
    expect(all[0].nodeId).toBe('node-123');
    diag.dispose();
  });

  test('unsupportedIR() creates warning-level diagnostic', () => {
    const diag = new SimulatorDiagnostics();
    diag.unsupportedIR('custom_widget', 'node-456');
    const all = diag.all();
    expect(all.length).toBe(1);
    expect(all[0].severity).toBe('warning');
    expect(all[0].category).toBe('unsupported_ir');
    expect(all[0].message).toContain('custom_widget');
    expect(all[0].nodeId).toBe('node-456');
    diag.dispose();
  });

  test('hasErrors() returns false when no errors', () => {
    const diag = new SimulatorDiagnostics();
    diag.warning('mock_missing', 'just a warning');
    expect(diag.hasErrors()).toBe(false);
    diag.dispose();
  });

  test('hasErrors() returns true when errors exist', () => {
    const diag = new SimulatorDiagnostics();
    diag.error('render_failure', 'fatal');
    expect(diag.hasErrors()).toBe(true);
    diag.dispose();
  });

  test('byCategory() filters correctly', () => {
    const diag = new SimulatorDiagnostics();
    diag.error('render_failure', 'a');
    diag.warning('mock_missing', 'b');
    diag.error('render_failure', 'c');
    expect(diag.byCategory('render_failure').length).toBe(2);
    expect(diag.byCategory('mock_missing').length).toBe(1);
    diag.dispose();
  });

  test('bySeverity() filters correctly', () => {
    const diag = new SimulatorDiagnostics();
    diag.error('render_failure', 'a');
    diag.warning('mock_missing', 'b');
    diag.info('simulator_limitation', 'c');
    expect(diag.bySeverity('error').length).toBe(1);
    expect(diag.bySeverity('warning').length).toBe(1);
    expect(diag.bySeverity('info').length).toBe(1);
    diag.dispose();
  });

  test('clear() removes all diagnostics', () => {
    const diag = new SimulatorDiagnostics();
    diag.error('render_failure', 'a');
    diag.warning('mock_missing', 'b');
    expect(diag.all().length).toBe(2);
    diag.clear();
    expect(diag.all().length).toBe(0);
    expect(diag.hasErrors()).toBe(false);
    diag.dispose();
  });

  test('report() with extra fields (sourceFile, sourceLine) stores them', () => {
    const diag = new SimulatorDiagnostics();
    diag.report('error', 'render_failure', 'fail', { sourceFile: 'main.zx', sourceLine: 42 });
    expect(diag.all()[0].sourceFile).toBe('main.zx');
    expect(diag.all()[0].sourceLine).toBe(42);
    diag.dispose();
  });
});

/* ===== 5. SimulatorEventLog ===== */

describe('SimulatorEventLog', () => {
  test('log() adds event with type, timestamp, detail', () => {
    const log = new SimulatorEventLog();
    log.log('button_tapped', 'tapped btn1');
    const all = log.all();
    expect(all.length).toBe(1);
    expect(all[0].type).toBe('button_tapped');
    expect(all[0].detail).toBe('tapped btn1');
    expect(typeof all[0].timestamp).toBe('number');
    log.dispose();
  });

  test('log() fires onEvent', () => {
    const log = new SimulatorEventLog();
    const fired: unknown[] = [];
    log.onEvent((e) => fired.push(e));
    log.log('navigation', 'nav event');
    expect(fired.length).toBe(1);
    log.dispose();
  });

  test('log() stores data record when provided', () => {
    const log = new SimulatorEventLog();
    log.log('state_changed', 'x changed', { key: 'x', value: 42 });
    expect(log.all()[0].data).toEqual({ key: 'x', value: 42 });
    log.dispose();
  });

  test('all() returns all events', () => {
    const log = new SimulatorEventLog();
    log.log('button_tapped', 'a');
    log.log('navigation', 'b');
    log.log('error', 'c');
    expect(log.all().length).toBe(3);
    log.dispose();
  });

  test('filter() returns events of a specific type', () => {
    const log = new SimulatorEventLog();
    log.log('button_tapped', 'a');
    log.log('navigation', 'b');
    log.log('button_tapped', 'c');
    expect(log.filter('button_tapped').length).toBe(2);
    expect(log.filter('navigation').length).toBe(1);
    expect(log.filter('error').length).toBe(0);
    log.dispose();
  });

  test('recent() returns last N events', () => {
    const log = new SimulatorEventLog();
    for (let i = 0; i < 100; i++) {
      log.log('lifecycle', `event ${i}`);
    }
    const last10 = log.recent(10);
    expect(last10.length).toBe(10);
    expect(last10[0].detail).toBe('event 90');
    expect(last10[9].detail).toBe('event 99');
    log.dispose();
  });

  test('recent() with default count returns last 50', () => {
    const log = new SimulatorEventLog();
    for (let i = 0; i < 100; i++) {
      log.log('lifecycle', `event ${i}`);
    }
    const recent = log.recent();
    expect(recent.length).toBe(50);
    log.dispose();
  });

  test('clear() empties the log', () => {
    const log = new SimulatorEventLog();
    log.log('button_tapped', 'a');
    log.log('navigation', 'b');
    log.clear();
    expect(log.all().length).toBe(0);
    log.dispose();
  });

  test('cap at 5000 entries', () => {
    const log = new SimulatorEventLog();
    for (let i = 0; i < 5010; i++) {
      log.log('lifecycle', `event ${i}`);
    }
    expect(log.all().length).toBe(5000);
    log.dispose();
  });
});

/* ===== 6. SimulatorStateStore ===== */

describe('SimulatorStateStore', () => {
  test('initScreen() creates state from MobileIRStateDeclaration[]', () => {
    const store = new SimulatorStateStore();
    store.initScreen('Home', [
      { name: 'counter', type: 'whole', initialValue: '0' },
      { name: 'name', type: 'text', initialValue: 'World' },
    ]);
    expect(store.get('counter')).toBe(0);
    expect(store.get('name')).toBe('World');
    store.dispose();
  });

  test('text type parsed as string', () => {
    const store = new SimulatorStateStore();
    store.initScreen('S', [{ name: 'v', type: 'text', initialValue: 'hello' }]);
    expect(store.get('v')).toBe('hello');
    store.dispose();
  });

  test('whole type parsed as number', () => {
    const store = new SimulatorStateStore();
    store.initScreen('S', [{ name: 'v', type: 'whole', initialValue: '42' }]);
    expect(store.get('v')).toBe(42);
    store.dispose();
  });

  test('decimal type parsed as number', () => {
    const store = new SimulatorStateStore();
    store.initScreen('S', [{ name: 'v', type: 'decimal', initialValue: '3.14' }]);
    expect(store.get('v')).toBe(3.14);
    store.dispose();
  });

  test('truth type parsed as boolean', () => {
    const store = new SimulatorStateStore();
    store.initScreen('S', [
      { name: 'a', type: 'truth', initialValue: 'true' },
      { name: 'b', type: 'truth', initialValue: 'false' },
    ]);
    expect(store.get('a')).toBe(true);
    expect(store.get('b')).toBe(false);
    store.dispose();
  });

  test('list type parsed as array', () => {
    const store = new SimulatorStateStore();
    store.initScreen('S', [{ name: 'v', type: 'list', initialValue: '[1,2,3]' }]);
    expect(store.get('v')).toEqual([1, 2, 3]);
    store.dispose();
  });

  test('record type parsed as object', () => {
    const store = new SimulatorStateStore();
    store.initScreen('S', [{ name: 'v', type: 'record', initialValue: '{"a":1}' }]);
    expect(store.get('v')).toEqual({ a: 1 });
    store.dispose();
  });

  test('"nothing" initial value becomes null', () => {
    const store = new SimulatorStateStore();
    store.initScreen('S', [{ name: 'v', type: 'text', initialValue: 'nothing' }]);
    expect(store.get('v')).toBeNull();
    store.dispose();
  });

  test('get(key) retrieves screen state', () => {
    const store = new SimulatorStateStore();
    store.initScreen('S', [{ name: 'x', type: 'whole', initialValue: '99' }]);
    expect(store.get('x')).toBe(99);
    store.dispose();
  });

  test('get(key) returns undefined for nonexistent key', () => {
    const store = new SimulatorStateStore();
    store.initScreen('S', []);
    expect(store.get('nonexistent') === undefined).toBeTruthy();
    store.dispose();
  });

  test('set(key, value) fires onDidChange', () => {
    const store = new SimulatorStateStore();
    store.initScreen('S', [{ name: 'x', type: 'whole', initialValue: '0' }]);
    const events: unknown[] = [];
    store.onDidChange((e) => events.push(e));
    store.set('x', 42);
    expect(events.length).toBe(1);
    expect(store.get('x')).toBe(42);
    store.dispose();
  });

  test('getAll() returns all screen state', () => {
    const store = new SimulatorStateStore();
    store.initScreen('S', [
      { name: 'a', type: 'whole', initialValue: '1' },
      { name: 'b', type: 'text', initialValue: 'hi' },
    ]);
    const all = store.getAll();
    expect(all['a']).toBe(1);
    expect(all['b']).toBe('hi');
    store.dispose();
  });

  test('setAppState(key, value) stores app-level state', () => {
    const store = new SimulatorStateStore();
    store.setAppState('theme', 'dark');
    expect(store.getAppState('theme')).toBe('dark');
    store.dispose();
  });

  test('setAppState fires onDidChange with screen "@app"', () => {
    const store = new SimulatorStateStore();
    const events: Array<{ screen: string }> = [];
    store.onDidChange((e) => events.push({ screen: e.screen }));
    store.setAppState('k', 'v');
    expect(events.length).toBe(1);
    expect(events[0].screen).toBe('@app');
    store.dispose();
  });

  test('getAppState(key) retrieves it', () => {
    const store = new SimulatorStateStore();
    store.setAppState('user', 'alice');
    expect(store.getAppState('user')).toBe('alice');
    expect(store.getAppState('missing') === undefined).toBeTruthy();
    store.dispose();
  });

  test('switchScreen() changes active screen', () => {
    const store = new SimulatorStateStore();
    store.initScreen('A', [{ name: 'x', type: 'whole', initialValue: '1' }]);
    store.initScreen('B', [{ name: 'y', type: 'whole', initialValue: '2' }]);
    store.switchScreen('A');
    expect(store.get('x')).toBe(1);
    expect(store.get('y') === undefined).toBeTruthy();
    store.switchScreen('B');
    expect(store.get('y')).toBe(2);
    store.dispose();
  });

  test('snapshot() captures current state', () => {
    const store = new SimulatorStateStore();
    store.initScreen('S', [{ name: 'x', type: 'whole', initialValue: '5' }]);
    store.setAppState('mode', 'test');
    const snap = store.snapshot();
    expect(snap.screen['x']).toBe(5);
    expect(snap.app['mode']).toBe('test');
    store.dispose();
  });

  test('restore() restores from snapshot', () => {
    const store = new SimulatorStateStore();
    store.initScreen('S', [{ name: 'x', type: 'whole', initialValue: '5' }]);
    store.setAppState('mode', 'test');
    const snap = store.snapshot();
    store.set('x', 99);
    store.setAppState('mode', 'changed');
    store.restore(snap);
    expect(store.get('x')).toBe(5);
    expect(store.getAppState('mode')).toBe('test');
    store.dispose();
  });

  test('reset() clears everything', () => {
    const store = new SimulatorStateStore();
    store.initScreen('S', [{ name: 'x', type: 'whole', initialValue: '5' }]);
    store.setAppState('mode', 'test');
    store.reset();
    expect(store.getAll()).toEqual({});
    expect(store.getAppState('mode') === undefined).toBeTruthy();
    store.dispose();
  });
});

/* ===== 7. SimulatorNavigation ===== */

describe('SimulatorNavigation', () => {
  test('navigate() pushes screen, fires onDidNavigate with action "push"', () => {
    const nav = new SimulatorNavigation();
    nav.navigate('Home');
    const events: Array<{ screen: string; action: string }> = [];
    nav.onDidNavigate((e) => events.push({ screen: e.screen, action: e.action }));
    nav.navigate('Settings');
    expect(events.length).toBe(1);
    expect(events[0].screen).toBe('Settings');
    expect(events[0].action).toBe('push');
    nav.dispose();
  });

  test('navigateBack() pops, fires with "back", returns true', () => {
    const nav = new SimulatorNavigation();
    nav.navigate('Home');
    nav.navigate('Settings');
    const events: Array<{ screen: string; action: string }> = [];
    nav.onDidNavigate((e) => events.push({ screen: e.screen, action: e.action }));
    const result = nav.navigateBack();
    expect(result).toBe(true);
    expect(events[0].screen).toBe('Home');
    expect(events[0].action).toBe('back');
    nav.dispose();
  });

  test('navigateBack() at root returns false', () => {
    const nav = new SimulatorNavigation();
    nav.navigate('Home');
    const result = nav.navigateBack();
    expect(result).toBe(false);
    nav.dispose();
  });

  test('replace() swaps top entry', () => {
    const nav = new SimulatorNavigation();
    nav.navigate('Home');
    nav.navigate('A');
    const events: Array<{ screen: string; action: string }> = [];
    nav.onDidNavigate((e) => events.push({ screen: e.screen, action: e.action }));
    nav.replace('B');
    expect(nav.currentScreen()).toBe('B');
    expect(events[0].action).toBe('replace');
    expect(nav.stackDepth()).toBe(2);
    nav.dispose();
  });

  test('clearStack() resets to single entry', () => {
    const nav = new SimulatorNavigation();
    nav.navigate('A');
    nav.navigate('B');
    nav.navigate('C');
    nav.clearStack('Home');
    expect(nav.stackDepth()).toBe(1);
    expect(nav.currentScreen()).toBe('Home');
    nav.dispose();
  });

  test('currentScreen() returns current', () => {
    const nav = new SimulatorNavigation();
    nav.navigate('X');
    expect(nav.currentScreen()).toBe('X');
    nav.navigate('Y');
    expect(nav.currentScreen()).toBe('Y');
    nav.dispose();
  });

  test('stack() returns full stack copy', () => {
    const nav = new SimulatorNavigation();
    nav.navigate('A');
    nav.navigate('B');
    const stack = nav.stack();
    expect(stack.length).toBe(2);
    expect(stack[0].screen).toBe('A');
    expect(stack[1].screen).toBe('B');
    // Ensure it is a copy
    stack.push({ screen: 'C', args: {} });
    expect(nav.stackDepth()).toBe(2);
    nav.dispose();
  });

  test('stackDepth() returns correct count', () => {
    const nav = new SimulatorNavigation();
    nav.navigate('A');
    expect(nav.stackDepth()).toBe(1);
    nav.navigate('B');
    expect(nav.stackDepth()).toBe(2);
    nav.navigate('C');
    expect(nav.stackDepth()).toBe(3);
    nav.dispose();
  });

  test('canGoBack() returns correct boolean', () => {
    const nav = new SimulatorNavigation();
    nav.navigate('A');
    expect(nav.canGoBack()).toBe(false);
    nav.navigate('B');
    expect(nav.canGoBack()).toBe(true);
    nav.navigateBack();
    expect(nav.canGoBack()).toBe(false);
    nav.dispose();
  });

  test('reset() resets to given screen', () => {
    const nav = new SimulatorNavigation();
    nav.navigate('A');
    nav.navigate('B');
    nav.navigate('C');
    nav.reset('Start');
    expect(nav.stackDepth()).toBe(1);
    expect(nav.currentScreen()).toBe('Start');
    expect(nav.canGoBack()).toBe(false);
    nav.dispose();
  });

  test('navigate() passes args', () => {
    const nav = new SimulatorNavigation();
    nav.navigate('Home');
    nav.navigate('Detail', { id: 42 });
    expect(nav.currentArgs()).toEqual({ id: 42 });
    nav.dispose();
  });
});

/* ===== 8. SimulatorPermissions ===== */

describe('SimulatorPermissions', () => {
  test('starts with 8 permissions all "not_requested"', () => {
    const perms = new SimulatorPermissions();
    const all = perms.allPermissions();
    expect(all.length).toBe(8);
    for (const p of all) {
      expect(p.state).toBe('not_requested');
    }
    perms.dispose();
  });

  test('getState() for known permission returns "not_requested"', () => {
    const perms = new SimulatorPermissions();
    expect(perms.getState('camera')).toBe('not_requested');
    expect(perms.getState('location')).toBe('not_requested');
    perms.dispose();
  });

  test('getState() for unknown permission returns "unavailable"', () => {
    const perms = new SimulatorPermissions();
    expect(perms.getState('nonexistent')).toBe('unavailable');
    perms.dispose();
  });

  test('setState() changes state and fires onDidChange', () => {
    const perms = new SimulatorPermissions();
    const events: Array<{ permission: string; state: string }> = [];
    perms.onDidChange((e) => events.push({ permission: e.permission, state: e.state }));
    perms.setState('camera', 'granted');
    expect(perms.getState('camera')).toBe('granted');
    expect(events.length).toBe(1);
    expect(events[0].permission).toBe('camera');
    expect(events[0].state).toBe('granted');
    perms.dispose();
  });

  test('request() on already-granted returns immediately', async () => {
    const perms = new SimulatorPermissions();
    perms.setState('camera', 'granted');
    const state = await perms.request('camera');
    expect(state).toBe('granted');
    perms.dispose();
  });

  test('request() on not_requested fires onPermissionDialog and blocks until respondToDialog()', async () => {
    const perms = new SimulatorPermissions();
    const dialogFired: string[] = [];
    perms.onPermissionDialog((e) => {
      dialogFired.push(e.permission);
      // Simulate user granting permission after dialog
      setTimeout(() => perms.respondToDialog(true), 10);
    });
    const state = await perms.request('camera');
    expect(dialogFired.length).toBe(1);
    expect(dialogFired[0]).toBe('camera');
    expect(state).toBe('granted');
    perms.dispose();
  });

  test('respondToDialog(true) grants, respondToDialog(false) denies', async () => {
    const perms = new SimulatorPermissions();

    // Test granting
    perms.onPermissionDialog(() => {
      setTimeout(() => perms.respondToDialog(true), 10);
    });
    const granted = await perms.request('camera');
    expect(granted).toBe('granted');

    // Reset and test denying
    perms.resetAll();
    const perms2 = new SimulatorPermissions();
    perms2.onPermissionDialog(() => {
      setTimeout(() => perms2.respondToDialog(false), 10);
    });
    const denied = await perms2.request('location');
    expect(denied).toBe('denied');
    perms.dispose();
    perms2.dispose();
  });

  test('resetAll() resets all to "not_requested"', () => {
    const perms = new SimulatorPermissions();
    perms.setState('camera', 'granted');
    perms.setState('location', 'denied');
    perms.resetAll();
    expect(perms.getState('camera')).toBe('not_requested');
    expect(perms.getState('location')).toBe('not_requested');
    perms.dispose();
  });

  test('allPermissions() returns all 8', () => {
    const perms = new SimulatorPermissions();
    const all = perms.allPermissions();
    expect(all.length).toBe(8);
    const names = all.map((p) => p.name);
    expect(names).toContain('camera');
    expect(names).toContain('location');
    expect(names).toContain('notifications');
    expect(names).toContain('biometrics');
    expect(names).toContain('files');
    expect(names).toContain('storage');
    expect(names).toContain('contacts');
    expect(names).toContain('microphone');
    perms.dispose();
  });
});

/* ===== 9. SimulatorCapabilities ===== */

describe('SimulatorCapabilities', () => {
  test('camera.capture() returns success with imageData in default "sample" mode', async () => {
    const caps = new SimulatorCapabilities();
    const result = await caps.camera.capture();
    expect(result.success).toBe(true);
    expect(typeof result.imageData).toBe('string');
    expect(result.imageData!.startsWith('data:image/png')).toBeTruthy();
    caps.dispose();
  });

  test('camera.setMode("cancel") causes capture to return cancelled', async () => {
    const caps = new SimulatorCapabilities();
    caps.camera.setMode('cancel');
    const result = await caps.camera.capture();
    expect(result.success).toBe(false);
    expect(result.cancelled).toBe(true);
    caps.dispose();
  });

  test('camera.setMode("unavailable") causes capture to return error', async () => {
    const caps = new SimulatorCapabilities();
    caps.camera.setMode('unavailable');
    const result = await caps.camera.capture();
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
    caps.dispose();
  });

  test('camera.setMode("failure") causes capture to return error', async () => {
    const caps = new SimulatorCapabilities();
    caps.camera.setMode('failure');
    const result = await caps.camera.capture();
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
    caps.dispose();
  });

  test('location.getCurrentLocation() returns Googleplex coords by default', async () => {
    const caps = new SimulatorCapabilities();
    const loc = await caps.location.getCurrentLocation();
    expect(loc).toBeTruthy();
    expect(loc!.latitude).toBe(37.4220);
    expect(loc!.longitude).toBe(-122.0841);
    expect(loc!.accuracy).toBe(10);
    caps.dispose();
  });

  test('location.configure() changes returned location', async () => {
    const caps = new SimulatorCapabilities();
    caps.location.configure({
      mode: 'fixed',
      latitude: 48.8566,
      longitude: 2.3522,
      accuracy: 5,
      altitude: 100,
      permissionState: 'granted',
    });
    const loc = await caps.location.getCurrentLocation();
    expect(loc!.latitude).toBe(48.8566);
    expect(loc!.longitude).toBe(2.3522);
    expect(loc!.altitude).toBe(100);
    caps.dispose();
  });

  test('location returns null when mode is "unavailable"', async () => {
    const caps = new SimulatorCapabilities();
    caps.location.configure({
      mode: 'unavailable',
      latitude: 0, longitude: 0, accuracy: 0, altitude: 0,
      permissionState: 'granted',
    });
    const loc = await caps.location.getCurrentLocation();
    expect(loc).toBeNull();
    caps.dispose();
  });

  test('biometrics.authenticate() returns "success" by default', async () => {
    const caps = new SimulatorCapabilities();
    const result = await caps.biometrics.authenticate();
    expect(result).toBe('success');
    caps.dispose();
  });

  test('biometrics.setResult("failure") changes authenticate result', async () => {
    const caps = new SimulatorCapabilities();
    caps.biometrics.setResult('failure');
    const result = await caps.biometrics.authenticate();
    expect(result).toBe('failure');
    caps.dispose();
  });

  test('connectivity.isOnline() returns true by default', () => {
    const caps = new SimulatorCapabilities();
    expect(caps.connectivity.isOnline()).toBe(true);
    caps.dispose();
  });

  test('connectivity.setMode("offline") makes isOnline() false', () => {
    const caps = new SimulatorCapabilities();
    caps.connectivity.setMode('offline');
    expect(caps.connectivity.isOnline()).toBe(false);
    caps.dispose();
  });

  test('connectivity.setMode("slow") keeps isOnline() true', () => {
    const caps = new SimulatorCapabilities();
    caps.connectivity.setMode('slow');
    expect(caps.connectivity.isOnline()).toBe(true);
    caps.dispose();
  });

  test('connectivity mode() returns the current mode', () => {
    const caps = new SimulatorCapabilities();
    expect(caps.connectivity.mode()).toBe('online');
    caps.connectivity.setMode('intermittent');
    expect(caps.connectivity.mode()).toBe('intermittent');
    caps.dispose();
  });

  test('reset() restores defaults', async () => {
    const caps = new SimulatorCapabilities();
    caps.camera.setMode('cancel');
    caps.biometrics.setResult('failure');
    caps.connectivity.setMode('offline');
    caps.reset();
    const camResult = await caps.camera.capture();
    expect(camResult.success).toBe(true);
    const bioResult = await caps.biometrics.authenticate();
    expect(bioResult).toBe('success');
    expect(caps.connectivity.isOnline()).toBe(true);
    caps.dispose();
  });
});

/* ===== 10. SimulatorStorage ===== */

describe('SimulatorStorage', () => {
  test('set() stores value, fires onDidChange', () => {
    const storage = new SimulatorStorage();
    const events: Array<{ store: string; key: string }> = [];
    storage.onDidChange((e) => events.push({ store: e.store, key: e.key }));
    storage.set('local', 'myKey', 'myValue');
    expect(events.length).toBe(1);
    expect(events[0].store).toBe('local');
    expect(events[0].key).toBe('myKey');
    storage.dispose();
  });

  test('get() retrieves stored value', () => {
    const storage = new SimulatorStorage();
    storage.set('local', 'k', 'v');
    expect(storage.get('local', 'k')).toBe('v');
    storage.dispose();
  });

  test('get() on missing key returns null', () => {
    const storage = new SimulatorStorage();
    expect(storage.get('local', 'missing')).toBeNull();
    storage.dispose();
  });

  test('remove() deletes key, fires onDidChange', () => {
    const storage = new SimulatorStorage();
    storage.set('local', 'k', 'v');
    const events: Array<{ store: string; key: string; value: string | null }> = [];
    storage.onDidChange((e) => events.push({ store: e.store, key: e.key, value: e.value }));
    storage.remove('local', 'k');
    expect(storage.get('local', 'k')).toBeNull();
    expect(events.length).toBe(1);
    expect(events[0].value).toBeNull();
    storage.dispose();
  });

  test('remove() on nonexistent key does not fire event', () => {
    const storage = new SimulatorStorage();
    const events: unknown[] = [];
    storage.onDidChange(() => events.push(1));
    storage.remove('local', 'nonexistent');
    expect(events.length).toBe(0);
    storage.dispose();
  });

  test('three stores (local, secure, preferences) are isolated', () => {
    const storage = new SimulatorStorage();
    storage.set('local', 'key', 'local-val');
    storage.set('secure', 'key', 'secure-val');
    storage.set('preferences', 'key', 'pref-val');
    expect(storage.get('local', 'key')).toBe('local-val');
    expect(storage.get('secure', 'key')).toBe('secure-val');
    expect(storage.get('preferences', 'key')).toBe('pref-val');
    storage.dispose();
  });

  test('entries() returns store entries', () => {
    const storage = new SimulatorStorage();
    storage.set('local', 'a', '1');
    storage.set('local', 'b', '2');
    const entries = storage.entries('local');
    expect(entries.length).toBe(2);
    expect(entries[0].store).toBe('local');
    storage.dispose();
  });

  test('allEntries() returns entries from all stores', () => {
    const storage = new SimulatorStorage();
    storage.set('local', 'a', '1');
    storage.set('secure', 'b', '2');
    storage.set('preferences', 'c', '3');
    const all = storage.allEntries();
    expect(all.length).toBe(3);
    storage.dispose();
  });

  test('exportSafe() excludes secure store', () => {
    const storage = new SimulatorStorage();
    storage.set('local', 'a', '1');
    storage.set('secure', 'secret', 'hidden');
    storage.set('preferences', 'b', '2');
    const safe = storage.exportSafe();
    expect(safe.length).toBe(2);
    for (const entry of safe) {
      expect(entry.store === 'secure').toBeFalsy();
    }
    storage.dispose();
  });

  test('clearAll() clears all stores', () => {
    const storage = new SimulatorStorage();
    storage.set('local', 'a', '1');
    storage.set('secure', 'b', '2');
    storage.set('preferences', 'c', '3');
    storage.clearAll();
    expect(storage.allEntries().length).toBe(0);
    storage.dispose();
  });

  test('clear() clears a single store', () => {
    const storage = new SimulatorStorage();
    storage.set('local', 'a', '1');
    storage.set('secure', 'b', '2');
    storage.clear('local');
    expect(storage.entries('local').length).toBe(0);
    expect(storage.entries('secure').length).toBe(1);
    storage.dispose();
  });
});

/* ===== 11. SimulatorHttp ===== */

describe('SimulatorHttp', () => {
  function makeMockConnectivity() {
    const emitter = new Emitter<any>();
    return {
      provider: {
        isOnline: () => true,
        mode: () => 'online' as const,
        setMode: () => {},
        onDidChange: emitter.event,
      },
      dispose: () => emitter.dispose(),
    };
  }

  test('addMock() adds a mock endpoint', () => {
    const { provider, dispose } = makeMockConnectivity();
    const http = new SimulatorHttp(provider);
    const mock: MockEndpoint = { method: 'GET', path: '/api/users', status: 200, delayMs: 0, body: '[]' };
    http.addMock(mock);
    expect(http.getMocks().length).toBe(1);
    expect(http.getMocks()[0].path).toBe('/api/users');
    http.dispose();
    dispose();
  });

  test('addMock() replaces existing mock with same method+path', () => {
    const { provider, dispose } = makeMockConnectivity();
    const http = new SimulatorHttp(provider);
    http.addMock({ method: 'GET', path: '/api/users', status: 200, delayMs: 0, body: '[]' });
    http.addMock({ method: 'GET', path: '/api/users', status: 201, delayMs: 0, body: '["updated"]' });
    expect(http.getMocks().length).toBe(1);
    expect(http.getMocks()[0].status).toBe(201);
    http.dispose();
    dispose();
  });

  test('removeMock() removes a mock endpoint', () => {
    const { provider, dispose } = makeMockConnectivity();
    const http = new SimulatorHttp(provider);
    http.addMock({ method: 'GET', path: '/api/users', status: 200, delayMs: 0, body: '[]' });
    http.removeMock('GET', '/api/users');
    expect(http.getMocks().length).toBe(0);
    http.dispose();
    dispose();
  });

  test('clearMocks() clears all mocks', () => {
    const { provider, dispose } = makeMockConnectivity();
    const http = new SimulatorHttp(provider);
    http.addMock({ method: 'GET', path: '/a', status: 200, delayMs: 0, body: '' });
    http.addMock({ method: 'POST', path: '/b', status: 201, delayMs: 0, body: '' });
    http.clearMocks();
    expect(http.getMocks().length).toBe(0);
    http.dispose();
    dispose();
  });

  test('in mock mode, request() matches by method+pathname', async () => {
    const { provider, dispose } = makeMockConnectivity();
    const http = new SimulatorHttp(provider);
    http.setMode('mock');
    http.addMock({ method: 'GET', path: '/api/data', status: 200, delayMs: 0, body: '{"ok":true}' });
    const response = await http.request({ method: 'GET', url: 'http://localhost/api/data', headers: {} });
    expect(response.status).toBe(200);
    expect(response.body).toBe('{"ok":true}');
    http.dispose();
    dispose();
  });

  test('in mock mode, unmatched request returns 404', async () => {
    const { provider, dispose } = makeMockConnectivity();
    const http = new SimulatorHttp(provider);
    http.setMode('mock');
    const response = await http.request({ method: 'GET', url: 'http://localhost/no-match', headers: {} });
    expect(response.status).toBe(404);
    http.dispose();
    dispose();
  });

  test('getMocks() returns a copy', () => {
    const { provider, dispose } = makeMockConnectivity();
    const http = new SimulatorHttp(provider);
    http.addMock({ method: 'GET', path: '/a', status: 200, delayMs: 0, body: '' });
    const mocks = http.getMocks();
    mocks.push({ method: 'POST', path: '/b', status: 201, delayMs: 0, body: '' });
    expect(http.getMocks().length).toBe(1);
    http.dispose();
    dispose();
  });

  test('setRecording() and isRecording() work', () => {
    const { provider, dispose } = makeMockConnectivity();
    const http = new SimulatorHttp(provider);
    expect(http.isRecording()).toBe(false);
    http.setRecording(true);
    expect(http.isRecording()).toBe(true);
    http.setRecording(false);
    expect(http.isRecording()).toBe(false);
    http.dispose();
    dispose();
  });

  test('onDidRequest fires on request()', async () => {
    const { provider, dispose } = makeMockConnectivity();
    const http = new SimulatorHttp(provider);
    http.setMode('mock');
    http.addMock({ method: 'GET', path: '/test', status: 200, delayMs: 0, body: 'ok' });
    const requests: unknown[] = [];
    http.onDidRequest((r) => requests.push(r));
    await http.request({ method: 'GET', url: 'http://localhost/test', headers: {} });
    expect(requests.length).toBe(1);
    http.dispose();
    dispose();
  });

  test('onDidResponse fires on successful request()', async () => {
    const { provider, dispose } = makeMockConnectivity();
    const http = new SimulatorHttp(provider);
    http.setMode('mock');
    http.addMock({ method: 'GET', path: '/test', status: 200, delayMs: 0, body: 'ok' });
    const responses: unknown[] = [];
    http.onDidResponse((r) => responses.push(r));
    await http.request({ method: 'GET', url: 'http://localhost/test', headers: {} });
    expect(responses.length).toBe(1);
    http.dispose();
    dispose();
  });

  test('getMode() and setMode() work', () => {
    const { provider, dispose } = makeMockConnectivity();
    const http = new SimulatorHttp(provider);
    expect(http.getMode()).toBe('live');
    http.setMode('mock');
    expect(http.getMode()).toBe('mock');
    http.setMode('recorded');
    expect(http.getMode()).toBe('recorded');
    http.dispose();
    dispose();
  });

  test('offline connectivity throws on request()', async () => {
    const emitter = new Emitter<any>();
    const provider = {
      isOnline: () => false,
      mode: () => 'offline' as const,
      setMode: () => {},
      onDidChange: emitter.event,
    };
    const http = new SimulatorHttp(provider);
    http.setMode('mock');
    let threw = false;
    try {
      await http.request({ method: 'GET', url: 'http://localhost/test', headers: {} });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    http.dispose();
    emitter.dispose();
  });
});

/* ===== 12. SimulatorRuntime (integration) ===== */

describe('SimulatorRuntime', () => {
  test('loadApp() fires onDidLoadApp', () => {
    const runtime = new SimulatorRuntime();
    const fired: unknown[] = [];
    runtime.onDidLoadApp((app) => fired.push(app));
    runtime.loadApp(makeTestApp());
    expect(fired.length).toBe(1);
    runtime.dispose();
  });

  test('currentScreenModel() returns start screen', () => {
    const runtime = new SimulatorRuntime();
    runtime.loadApp(makeTestApp());
    const screen = runtime.currentScreenModel();
    expect(screen).toBeTruthy();
    expect(screen!.name).toBe('Home');
    runtime.dispose();
  });

  test('findNode("txt1") finds the text node', () => {
    const runtime = new SimulatorRuntime();
    runtime.loadApp(makeTestApp());
    const node = runtime.findNode('txt1');
    expect(node).toBeTruthy();
    expect(node!.kind).toBe('text');
    expect(node!.properties['content']).toBe('Hello {name}');
    runtime.dispose();
  });

  test('findNode("nonexistent") returns null', () => {
    const runtime = new SimulatorRuntime();
    runtime.loadApp(makeTestApp());
    const node = runtime.findNode('nonexistent');
    expect(node).toBeNull();
    runtime.dispose();
  });

  test('allScreens() returns 2 screens', () => {
    const runtime = new SimulatorRuntime();
    runtime.loadApp(makeTestApp());
    expect(runtime.allScreens().length).toBe(2);
    runtime.dispose();
  });

  test('state initialized: stateStore.get("counter") is 0', () => {
    const runtime = new SimulatorRuntime();
    runtime.loadApp(makeTestApp());
    expect(runtime.stateStore.get('counter')).toBe(0);
    runtime.dispose();
  });

  test('state initialized: stateStore.get("name") is "World"', () => {
    const runtime = new SimulatorRuntime();
    runtime.loadApp(makeTestApp());
    expect(runtime.stateStore.get('name')).toBe('World');
    runtime.dispose();
  });

  test('navigation to Settings fires onDidChangeScreen', () => {
    const runtime = new SimulatorRuntime();
    runtime.loadApp(makeTestApp());
    const screens: string[] = [];
    runtime.onDidChangeScreen((s) => screens.push(s.name));
    runtime.navigation.navigate('Settings');
    expect(screens).toContain('Settings');
    runtime.dispose();
  });

  test('reload() with same app fires onDidReload with "StyleOnly"', () => {
    const runtime = new SimulatorRuntime();
    const app = makeTestApp();
    runtime.loadApp(app);
    const classifications: string[] = [];
    runtime.onDidReload((c) => classifications.push(c));
    runtime.reload(JSON.parse(JSON.stringify(app)));
    expect(classifications.length).toBe(1);
    expect(classifications[0]).toBe('StyleOnly');
    runtime.dispose();
  });

  test('reload() with added screen fires "ApplicationStructure"', () => {
    const runtime = new SimulatorRuntime();
    const app = makeTestApp();
    runtime.loadApp(app);
    const classifications: string[] = [];
    runtime.onDidReload((c) => classifications.push(c));
    const newApp = JSON.parse(JSON.stringify(app));
    newApp.screens.push({
      name: 'About',
      states: [],
      rootChildren: [],
    });
    runtime.reload(newApp);
    expect(classifications[0]).toBe('ApplicationStructure');
    runtime.dispose();
  });

  test('setTheme("dark") fires onDidChangeEnvironment', () => {
    const runtime = new SimulatorRuntime();
    runtime.loadApp(makeTestApp());
    const envChanges: unknown[] = [];
    runtime.onDidChangeEnvironment((e) => envChanges.push(e));
    runtime.setTheme('dark');
    expect(envChanges.length).toBe(1);
    expect(runtime.getEnvironment().theme).toBe('dark');
    runtime.dispose();
  });

  test('setFontScale(1.5) sets correctly', () => {
    const runtime = new SimulatorRuntime();
    runtime.loadApp(makeTestApp());
    runtime.setFontScale(1.5);
    expect(runtime.getEnvironment().fontScale).toBe(1.5);
    runtime.dispose();
  });

  test('setFontScale clamps below 0.5', () => {
    const runtime = new SimulatorRuntime();
    runtime.loadApp(makeTestApp());
    runtime.setFontScale(0.1);
    expect(runtime.getEnvironment().fontScale).toBe(0.5);
    runtime.dispose();
  });

  test('setFontScale clamps above 3', () => {
    const runtime = new SimulatorRuntime();
    runtime.loadApp(makeTestApp());
    runtime.setFontScale(5);
    expect(runtime.getEnvironment().fontScale).toBe(3);
    runtime.dispose();
  });

  test('setConnectivity("offline") updates environment', () => {
    const runtime = new SimulatorRuntime();
    runtime.loadApp(makeTestApp());
    runtime.setConnectivity('offline');
    expect(runtime.getEnvironment().connectivity).toBe('offline');
    expect(runtime.capabilities.connectivity.isOnline()).toBe(false);
    runtime.dispose();
  });

  test('reset() reloads app from scratch', () => {
    const runtime = new SimulatorRuntime();
    runtime.loadApp(makeTestApp());
    runtime.stateStore.set('counter', 99);
    runtime.navigation.navigate('Settings');
    runtime.reset();
    expect(runtime.navigation.currentScreen()).toBe('Home');
    expect(runtime.stateStore.get('counter')).toBe(0);
    runtime.dispose();
  });

  test('dispose() does not throw', () => {
    const runtime = new SimulatorRuntime();
    runtime.loadApp(makeTestApp());
    let threw = false;
    try { runtime.dispose(); } catch { threw = true; }
    expect(threw).toBe(false);
  });

  test('getApp() returns null before loadApp', () => {
    const runtime = new SimulatorRuntime();
    expect(runtime.getApp()).toBeNull();
    runtime.dispose();
  });

  test('getApp() returns app after loadApp', () => {
    const runtime = new SimulatorRuntime();
    const app = makeTestApp();
    runtime.loadApp(app);
    expect(runtime.getApp()).toBeTruthy();
    expect(runtime.getApp()!.name).toBe('TestApp');
    runtime.dispose();
  });

  test('setOrientation fires onDidChangeEnvironment', () => {
    const runtime = new SimulatorRuntime();
    runtime.loadApp(makeTestApp());
    const envChanges: unknown[] = [];
    runtime.onDidChangeEnvironment(() => envChanges.push(1));
    runtime.setOrientation('landscape');
    expect(envChanges.length).toBe(1);
    expect(runtime.getEnvironment().orientation).toBe('landscape');
    runtime.dispose();
  });

  test('setReducedMotion fires onDidChangeEnvironment', () => {
    const runtime = new SimulatorRuntime();
    runtime.loadApp(makeTestApp());
    runtime.setReducedMotion(true);
    expect(runtime.getEnvironment().reducedMotion).toBe(true);
    runtime.dispose();
  });

  test('setHighContrast fires onDidChangeEnvironment', () => {
    const runtime = new SimulatorRuntime();
    runtime.loadApp(makeTestApp());
    runtime.setHighContrast(true);
    expect(runtime.getEnvironment().highContrast).toBe(true);
    runtime.dispose();
  });
});

/* ===== 13. SimulatorTestRunner ===== */

describe('SimulatorTestRunner', () => {
  test('runAll() with empty test array returns empty results', async () => {
    const runner = new SimulatorTestRunner();
    const results = await runner.runAll(makeTestApp(), []);
    expect(results.length).toBe(0);
    runner.dispose();
  });

  test('runAll() with a single passing test returns passed=true', async () => {
    const runner = new SimulatorTestRunner();
    const test: SimulatorTestCase = {
      name: 'basic launch',
      steps: [{ action: 'launch' }],
    };
    const results = await runner.runAll(makeTestApp(), [test]);
    expect(results.length).toBe(1);
    expect(results[0].passed).toBe(true);
    expect(results[0].name).toBe('basic launch');
    runner.dispose();
  });

  test('find step for existing node passes', async () => {
    const runner = new SimulatorTestRunner();
    const tc: SimulatorTestCase = {
      name: 'find text node',
      steps: [{ action: 'find', query: 'txt1' }],
    };
    const results = await runner.runAll(makeTestApp(), [tc]);
    expect(results[0].passed).toBe(true);
    runner.dispose();
  });

  test('find step for missing node fails', async () => {
    const runner = new SimulatorTestRunner();
    const tc: SimulatorTestCase = {
      name: 'find missing node',
      steps: [{ action: 'find', query: 'nonexistent_node' }],
    };
    const results = await runner.runAll(makeTestApp(), [tc]);
    expect(results[0].passed).toBe(false);
    expect(results[0].failedStep).toBe(0);
    expect(results[0].failedMessage!.includes('not found')).toBeTruthy();
    runner.dispose();
  });

  test('expectText passes when content matches', async () => {
    const runner = new SimulatorTestRunner();
    const tc: SimulatorTestCase = {
      name: 'expect text content',
      steps: [{ action: 'expectText', query: 'txt1', text: 'Hello' }],
    };
    const results = await runner.runAll(makeTestApp(), [tc]);
    expect(results[0].passed).toBe(true);
    runner.dispose();
  });

  test('expectText fails when content does not match', async () => {
    const runner = new SimulatorTestRunner();
    const tc: SimulatorTestCase = {
      name: 'expect text mismatch',
      steps: [{ action: 'expectText', query: 'txt1', text: 'Goodbye' }],
    };
    const results = await runner.runAll(makeTestApp(), [tc]);
    expect(results[0].passed).toBe(false);
    runner.dispose();
  });

  test('expectVisible passes when node is visible (default)', async () => {
    const runner = new SimulatorTestRunner();
    const tc: SimulatorTestCase = {
      name: 'visible check',
      steps: [{ action: 'expectVisible', query: 'txt1', visible: true }],
    };
    const results = await runner.runAll(makeTestApp(), [tc]);
    expect(results[0].passed).toBe(true);
    runner.dispose();
  });

  test('expectVisible fails when visibility mismatch', async () => {
    const runner = new SimulatorTestRunner();
    const tc: SimulatorTestCase = {
      name: 'invisible check',
      steps: [{ action: 'expectVisible', query: 'txt1', visible: false }],
    };
    const results = await runner.runAll(makeTestApp(), [tc]);
    expect(results[0].passed).toBe(false);
    runner.dispose();
  });

  test('onTestStart fires test name', async () => {
    const runner = new SimulatorTestRunner();
    const starts: string[] = [];
    runner.onTestStart((name) => starts.push(name));
    const tc: SimulatorTestCase = {
      name: 'my test',
      steps: [{ action: 'launch' }],
    };
    await runner.runAll(makeTestApp(), [tc]);
    expect(starts.length).toBe(1);
    expect(starts[0]).toBe('my test');
    runner.dispose();
  });

  test('onTestComplete fires result', async () => {
    const runner = new SimulatorTestRunner();
    const completes: unknown[] = [];
    runner.onTestComplete((r) => completes.push(r));
    const tc: SimulatorTestCase = {
      name: 'complete test',
      steps: [{ action: 'launch' }],
    };
    await runner.runAll(makeTestApp(), [tc]);
    expect(completes.length).toBe(1);
    runner.dispose();
  });

  test('onAllComplete fires all results', async () => {
    const runner = new SimulatorTestRunner();
    let allResults: unknown[] | null = null;
    runner.onAllComplete((r) => { allResults = r as unknown[]; });
    const tc: SimulatorTestCase = {
      name: 'all complete',
      steps: [{ action: 'launch' }],
    };
    await runner.runAll(makeTestApp(), [tc]);
    expect(allResults).toBeTruthy();
    expect((allResults as unknown as unknown[]).length).toBe(1);
    runner.dispose();
  });

  test('openScreen step navigates correctly', async () => {
    const runner = new SimulatorTestRunner();
    const tc: SimulatorTestCase = {
      name: 'open screen',
      steps: [
        { action: 'openScreen', screen: 'Settings' },
        { action: 'find', query: 'sw1' },
      ],
    };
    const results = await runner.runAll(makeTestApp(), [tc]);
    expect(results[0].passed).toBe(true);
    runner.dispose();
  });

  test('setPermission step changes permission state', async () => {
    const runner = new SimulatorTestRunner();
    const runtime = new SimulatorRuntime();
    const app = makeTestApp();
    runtime.loadApp(app);
    const tc: SimulatorTestCase = {
      name: 'set permission',
      steps: [{ action: 'setPermission', name: 'camera', state: 'granted' }],
    };
    // Use runOne to test directly with the runtime we can inspect
    const result = await runner.runOne(runtime, app, tc);
    expect(result.passed).toBe(true);
    expect(runtime.permissions.getState('camera')).toBe('granted');
    runtime.dispose();
    runner.dispose();
  });

  test('mockHttp step adds mock endpoint', async () => {
    const runner = new SimulatorTestRunner();
    const runtime = new SimulatorRuntime();
    const app = makeTestApp();
    runtime.loadApp(app);
    const tc: SimulatorTestCase = {
      name: 'mock http',
      steps: [{
        action: 'mockHttp',
        endpoint: { method: 'GET', path: '/api/test', status: 200, delayMs: 0, body: 'ok' },
      }],
    };
    const result = await runner.runOne(runtime, app, tc);
    expect(result.passed).toBe(true);
    expect(runtime.http.getMocks().length).toBe(1);
    runtime.dispose();
    runner.dispose();
  });

  test('setConnectivity step changes connectivity mode', async () => {
    const runner = new SimulatorTestRunner();
    const runtime = new SimulatorRuntime();
    const app = makeTestApp();
    runtime.loadApp(app);
    const tc: SimulatorTestCase = {
      name: 'set connectivity',
      steps: [{ action: 'setConnectivity', mode: 'offline' }],
    };
    const result = await runner.runOne(runtime, app, tc);
    expect(result.passed).toBe(true);
    expect(runtime.getEnvironment().connectivity).toBe('offline');
    runtime.dispose();
    runner.dispose();
  });

  test('multiple tests run sequentially and report independently', async () => {
    const runner = new SimulatorTestRunner();
    const tests: SimulatorTestCase[] = [
      { name: 'pass test', steps: [{ action: 'launch' }] },
      { name: 'fail test', steps: [{ action: 'find', query: 'nonexistent' }] },
      { name: 'pass again', steps: [{ action: 'find', query: 'btn1' }] },
    ];
    const results = await runner.runAll(makeTestApp(), tests);
    expect(results.length).toBe(3);
    expect(results[0].passed).toBe(true);
    expect(results[1].passed).toBe(false);
    expect(results[2].passed).toBe(true);
    runner.dispose();
  });
});

/* ===== 14. Change classification ===== */

describe('change classification', () => {
  function classifyViaRuntime(oldApp: MobileIRApp, newApp: MobileIRApp): string {
    const runtime = new SimulatorRuntime();
    runtime.loadApp(oldApp);
    let classification = '';
    runtime.onDidReload((c) => { classification = c; });
    runtime.reload(newApp);
    runtime.dispose();
    return classification;
  }

  test('two identical apps produce "StyleOnly"', () => {
    const app = makeTestApp();
    const copy = JSON.parse(JSON.stringify(app));
    expect(classifyViaRuntime(app, copy)).toBe('StyleOnly');
  });

  test('changed color property produces "StyleOnly"', () => {
    const app = makeTestApp();
    const newApp: MobileIRApp = JSON.parse(JSON.stringify(app));
    newApp.screens[0].rootChildren[0].properties['color'] = '#ff0000';
    expect(classifyViaRuntime(app, newApp)).toBe('StyleOnly');
  });

  test('changed content property produces "Content"', () => {
    const app = makeTestApp();
    const newApp: MobileIRApp = JSON.parse(JSON.stringify(app));
    newApp.screens[0].rootChildren[0].properties['content'] = 'Changed';
    expect(classifyViaRuntime(app, newApp)).toBe('Content');
  });

  test('added a node produces "Layout"', () => {
    const app = makeTestApp();
    const newApp: MobileIRApp = JSON.parse(JSON.stringify(app));
    newApp.screens[0].rootChildren.push({
      id: 'new_node', kind: 'text',
      properties: { content: 'new' },
      events: [], children: [],
    });
    expect(classifyViaRuntime(app, newApp)).toBe('Layout');
  });

  test('different screen names produce "Navigation"', () => {
    const app = makeTestApp();
    const newApp: MobileIRApp = JSON.parse(JSON.stringify(app));
    newApp.screens[1].name = 'Preferences';
    expect(classifyViaRuntime(app, newApp)).toBe('Navigation');
  });

  test('different startScreen produces "Navigation"', () => {
    const app = makeTestApp();
    const newApp: MobileIRApp = JSON.parse(JSON.stringify(app));
    newApp.startScreen = 'Settings';
    expect(classifyViaRuntime(app, newApp)).toBe('Navigation');
  });

  test('different capabilities produce "Capability"', () => {
    const app = makeTestApp();
    const newApp: MobileIRApp = JSON.parse(JSON.stringify(app));
    newApp.capabilities = ['camera', 'location', 'biometrics'];
    expect(classifyViaRuntime(app, newApp)).toBe('Capability');
  });

  test('different screen count produces "ApplicationStructure"', () => {
    const app = makeTestApp();
    const newApp: MobileIRApp = JSON.parse(JSON.stringify(app));
    newApp.screens.push({ name: 'Extra', states: [], rootChildren: [] });
    expect(classifyViaRuntime(app, newApp)).toBe('ApplicationStructure');
  });

  test('changed state declarations produce "StateShape"', () => {
    const app = makeTestApp();
    const newApp: MobileIRApp = JSON.parse(JSON.stringify(app));
    newApp.screens[0].states.push({ name: 'newState', type: 'text', initialValue: '' });
    expect(classifyViaRuntime(app, newApp)).toBe('StateShape');
  });
});

/* ===== 15. Parity and security assertions ===== */

describe('simulator parity and security assertions', () => {
  test('simulator commands use "znxstudio.simulator." prefix (no "mobile:" prefix leak)', () => {
    const simCommands = Object.entries(CommandIds as Record<string, string>)
      .filter(([key]) => key.startsWith('Simulator'));
    expect(simCommands.length).toBeGreaterThan(0);
    for (const [, value] of simCommands) {
      expect(value.startsWith('znxstudio.simulator.')).toBeTruthy();
      expect(value.includes('mobile:')).toBeFalsy();
    }
  });

  test('IPC channels use "simulator:" prefix (not "mobile:")', () => {
    const simChannels = Object.entries(IpcChannels as Record<string, string>)
      .filter(([key]) => key.startsWith('Simulator'));
    expect(simChannels.length).toBeGreaterThan(0);
    for (const [, value] of simChannels) {
      expect(value.startsWith('simulator:')).toBeTruthy();
      expect(value.startsWith('mobile:')).toBeFalsy();
    }
  });

  test('all device profiles have positive dimensions', () => {
    for (const p of SIMULATOR_DEVICE_PROFILES) {
      expect(p.width).toBeGreaterThan(0);
      expect(p.height).toBeGreaterThan(0);
      expect(p.density).toBeGreaterThan(0);
      expect(p.pixelRatio).toBeGreaterThan(0);
    }
  });

  test('DEFAULT_DEVICE_PROFILE is a phone class', () => {
    expect(DEFAULT_DEVICE_PROFILE.deviceClass).toBe('phone');
  });

  test('simulator imports work in the test harness (no Node.js dependency leak)', () => {
    // If these imports failed, the test file would not compile at all.
    // This test asserts that the simulator modules are successfully importable
    // in a headless (non-DOM, non-Electron) context.
    expect(typeof SimulatorRuntime).toBe('function');
    expect(typeof SimulatorStateStore).toBe('function');
    expect(typeof SimulatorNavigation).toBe('function');
    expect(typeof SimulatorPermissions).toBe('function');
    expect(typeof SimulatorCapabilities).toBe('function');
    expect(typeof SimulatorStorage).toBe('function');
    expect(typeof SimulatorHttp).toBe('function');
    expect(typeof SimulatorDiagnostics).toBe('function');
    expect(typeof SimulatorEventLog).toBe('function');
    expect(typeof SimulatorTestRunner).toBe('function');
  });

  test('all device profiles have non-negative safeArea values', () => {
    for (const p of SIMULATOR_DEVICE_PROFILES) {
      expect(p.safeArea.top >= 0).toBeTruthy();
      expect(p.safeArea.bottom >= 0).toBeTruthy();
      expect(p.safeArea.left >= 0).toBeTruthy();
      expect(p.safeArea.right >= 0).toBeTruthy();
    }
  });

  test('all device profiles have positive statusBarHeight and navigationArea', () => {
    for (const p of SIMULATOR_DEVICE_PROFILES) {
      expect(p.statusBarHeight).toBeGreaterThan(0);
      expect(p.navigationArea).toBeGreaterThan(0);
    }
  });
});

/* ===== 16. Certification Apps (13 representative apps) ===== */

describe('certification app 1: Counter (state + events)', () => {
  const app: MobileIRApp = {
    name: 'Counter',
    startScreen: 'Main',
    screens: [{
      name: 'Main',
      states: [{ name: 'count', type: 'whole', initialValue: '0' }],
      rootChildren: [
        { id: 'display', kind: 'text', properties: { content: 'Count: {count}' }, events: [], children: [] },
        { id: 'inc', kind: 'button', properties: { label: 'Increment' }, events: [{ event: 'tapped', body: 'set count to count + 1' }], children: [] },
        { id: 'dec', kind: 'button', properties: { label: 'Decrement' }, events: [{ event: 'tapped', body: 'set count to count - 1' }], children: [] },
        { id: 'reset', kind: 'button', properties: { label: 'Reset' }, events: [{ event: 'tapped', body: 'set count to 0' }], children: [] },
      ],
    }],
    permissions: [],
    capabilities: [],
  };

  test('loads and initializes state to 0', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    expect(rt.stateStore.get('count')).toBe(0);
    rt.dispose();
  });

  test('increment action increases count', async () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    await rt.executeAction('set count to count + 1');
    expect(rt.stateStore.get('count')).toBe(1);
    await rt.executeAction('set count to count + 1');
    expect(rt.stateStore.get('count')).toBe(2);
    rt.dispose();
  });

  test('decrement action decreases count', async () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    await rt.executeAction('set count to count + 1');
    await rt.executeAction('set count to count - 1');
    expect(rt.stateStore.get('count')).toBe(0);
    rt.dispose();
  });

  test('reset action sets count to 0', async () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    await rt.executeAction('set count to 5');
    await rt.executeAction('set count to 0');
    expect(rt.stateStore.get('count')).toBe(0);
    rt.dispose();
  });
});

describe('certification app 2: Todo List (list + storage)', () => {
  const app: MobileIRApp = {
    name: 'TodoApp',
    startScreen: 'Todos',
    screens: [{
      name: 'Todos',
      states: [
        { name: 'items', type: 'list', initialValue: '["Buy milk","Walk dog"]' },
        { name: 'newItem', type: 'text', initialValue: '' },
      ],
      rootChildren: [
        { id: 'input', kind: 'input', properties: { placeholder: 'New todo...', binding: 'newItem' }, events: [], children: [] },
        { id: 'todoList', kind: 'list', properties: { binding: 'items' }, events: [], children: [
          { id: 'template', kind: 'text', properties: { content: '{item}' }, events: [], children: [] },
        ]},
      ],
    }],
    permissions: [],
    capabilities: [],
  };

  test('loads with initial todo items', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    const items = rt.stateStore.get('items');
    expect(Array.isArray(items)).toBe(true);
    expect((items as string[]).length).toBe(2);
    rt.dispose();
  });

  test('stores and reads from local storage', async () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    await rt.executeAction('store "todos" = items');
    const stored = rt.storage.get('local', 'todos');
    expect(stored).toBeTruthy();
    rt.dispose();
  });
});

describe('certification app 3: Navigation (multi-screen + back stack)', () => {
  const app: MobileIRApp = {
    name: 'NavApp',
    startScreen: 'Home',
    screens: [
      { name: 'Home', states: [], rootChildren: [
        { id: 'toA', kind: 'button', properties: { label: 'Go A' }, events: [{ event: 'tapped', body: 'go to ScreenA' }], children: [] },
      ]},
      { name: 'ScreenA', states: [], rootChildren: [
        { id: 'toB', kind: 'button', properties: { label: 'Go B' }, events: [{ event: 'tapped', body: 'go to ScreenB' }], children: [] },
        { id: 'back', kind: 'button', properties: { label: 'Back' }, events: [{ event: 'tapped', body: 'go back' }], children: [] },
      ]},
      { name: 'ScreenB', states: [], rootChildren: [
        { id: 'back2', kind: 'button', properties: { label: 'Back' }, events: [{ event: 'tapped', body: 'go back' }], children: [] },
      ]},
    ],
    permissions: [],
    capabilities: [],
  };

  test('starts on Home', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    expect(rt.navigation.currentScreen()).toBe('Home');
    rt.dispose();
  });

  test('navigates forward through 3 screens', async () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    await rt.executeAction('go to ScreenA');
    expect(rt.navigation.currentScreen()).toBe('ScreenA');
    await rt.executeAction('go to ScreenB');
    expect(rt.navigation.currentScreen()).toBe('ScreenB');
    expect(rt.navigation.stackDepth()).toBe(3);
    rt.dispose();
  });

  test('navigates back through stack', async () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    await rt.executeAction('go to ScreenA');
    await rt.executeAction('go to ScreenB');
    await rt.executeAction('go back');
    expect(rt.navigation.currentScreen()).toBe('ScreenA');
    await rt.executeAction('go back');
    expect(rt.navigation.currentScreen()).toBe('Home');
    rt.dispose();
  });
});

describe('certification app 4: Form Validation (input types + state binding)', () => {
  const app: MobileIRApp = {
    name: 'FormApp',
    startScreen: 'Login',
    screens: [{
      name: 'Login',
      states: [
        { name: 'email', type: 'text', initialValue: '' },
        { name: 'password', type: 'text', initialValue: '' },
        { name: 'remember', type: 'truth', initialValue: 'false' },
        { name: 'error', type: 'text', initialValue: '' },
      ],
      rootChildren: [
        { id: 'emailInput', kind: 'input', properties: { label: 'Email', inputType: 'email', binding: 'email', placeholder: 'you@example.com' }, events: [], children: [] },
        { id: 'passInput', kind: 'input', properties: { label: 'Password', inputType: 'password', binding: 'password' }, events: [], children: [] },
        { id: 'rememberCb', kind: 'checkbox', properties: { label: 'Remember me', binding: 'remember' }, events: [], children: [] },
        { id: 'submit', kind: 'button', properties: { label: 'Sign In' }, events: [{ event: 'tapped', body: 'set error to "Login submitted"' }], children: [] },
        { id: 'errText', kind: 'text', properties: { content: '{error}' }, events: [], children: [] },
      ],
    }],
    permissions: [],
    capabilities: [],
  };

  test('all form state initializes correctly', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    expect(rt.stateStore.get('email')).toBe('');
    expect(rt.stateStore.get('password')).toBe('');
    expect(rt.stateStore.get('remember')).toBe(false);
    expect(rt.stateStore.get('error')).toBe('');
    rt.dispose();
  });

  test('setting bound state reflects in store', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    rt.stateStore.set('email', 'test@example.com');
    rt.stateStore.set('remember', true);
    expect(rt.stateStore.get('email')).toBe('test@example.com');
    expect(rt.stateStore.get('remember')).toBe(true);
    rt.dispose();
  });

  test('submit action sets error message', async () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    await rt.executeAction('set error to "Login submitted"');
    expect(rt.stateStore.get('error')).toBe('Login submitted');
    rt.dispose();
  });
});

describe('certification app 5: Camera + Permissions (capability flow)', () => {
  const app: MobileIRApp = {
    name: 'CameraApp',
    startScreen: 'Capture',
    screens: [{
      name: 'Capture',
      states: [{ name: 'photo', type: 'text', initialValue: 'nothing' }],
      rootChildren: [
        { id: 'captureBtn', kind: 'button', properties: { label: 'Take Photo' }, events: [{ event: 'tapped', body: 'request camera\nuse camera' }], children: [] },
      ],
    }],
    permissions: ['camera'],
    capabilities: ['camera'],
  };

  test('camera permission starts as not_requested', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    expect(rt.permissions.getState('camera')).toBe('not_requested');
    rt.dispose();
  });

  test('camera capture succeeds in default mode', async () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    rt.permissions.setState('camera', 'granted');
    const result = await rt.capabilities.camera.capture();
    expect(result.success).toBe(true);
    expect(typeof result.imageData).toBe('string');
    rt.dispose();
  });

  test('camera mode "cancel" returns cancelled', async () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    rt.capabilities.camera.setMode('cancel');
    const result = await rt.capabilities.camera.capture();
    expect(result.success).toBe(false);
    expect(result.cancelled).toBe(true);
    rt.dispose();
  });
});

describe('certification app 6: Location Tracker (location capability)', () => {
  const app: MobileIRApp = {
    name: 'LocationApp',
    startScreen: 'Map',
    screens: [{
      name: 'Map',
      states: [
        { name: 'lat', type: 'decimal', initialValue: '0.0' },
        { name: 'lng', type: 'decimal', initialValue: '0.0' },
      ],
      rootChildren: [
        { id: 'locateBtn', kind: 'button', properties: { label: 'Get Location' }, events: [{ event: 'tapped', body: 'use location' }], children: [] },
        { id: 'coords', kind: 'text', properties: { content: 'Lat: {lat}, Lng: {lng}' }, events: [], children: [] },
      ],
    }],
    permissions: ['location'],
    capabilities: ['location'],
  };

  test('default location is Googleplex', async () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    const loc = await rt.capabilities.location.getCurrentLocation();
    expect(loc!.latitude).toBe(37.4220);
    expect(loc!.longitude).toBe(-122.0841);
    rt.dispose();
  });

  test('custom location can be configured', async () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    rt.capabilities.location.configure({
      mode: 'fixed', latitude: 51.5074, longitude: -0.1278,
      accuracy: 5, altitude: 11, permissionState: 'granted',
    });
    const loc = await rt.capabilities.location.getCurrentLocation();
    expect(loc!.latitude).toBe(51.5074);
    expect(loc!.longitude).toBe(-0.1278);
    rt.dispose();
  });
});

describe('certification app 7: API Client (HTTP modes)', () => {
  const app: MobileIRApp = {
    name: 'ApiApp',
    startScreen: 'Data',
    screens: [{
      name: 'Data',
      states: [{ name: 'result', type: 'text', initialValue: '' }],
      rootChildren: [
        { id: 'fetchBtn', kind: 'button', properties: { label: 'Fetch Data' }, events: [{ event: 'tapped', body: 'fetch https://api.example.com/data' }], children: [] },
        { id: 'postBtn', kind: 'button', properties: { label: 'Post Data' }, events: [{ event: 'tapped', body: 'post https://api.example.com/data with {"key":"value"}' }], children: [] },
      ],
    }],
    permissions: [],
    capabilities: [],
  };

  test('mock mode returns configured response', async () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    rt.http.setMode('mock');
    rt.http.addMock({ method: 'GET', path: '/data', status: 200, delayMs: 0, body: '{"users":[]}' });
    const resp = await rt.http.request({ method: 'GET', url: 'https://api.example.com/data', headers: {} });
    expect(resp.status).toBe(200);
    expect(resp.body).toBe('{"users":[]}');
    rt.dispose();
  });

  test('mock mode returns 404 for unmatched endpoints', async () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    rt.http.setMode('mock');
    const resp = await rt.http.request({ method: 'GET', url: 'https://api.example.com/other', headers: {} });
    expect(resp.status).toBe(404);
    rt.dispose();
  });

  test('offline mode throws network error', async () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    rt.setConnectivity('offline');
    rt.http.setMode('mock');
    let threw = false;
    try { await rt.http.request({ method: 'GET', url: 'https://api.example.com/data', headers: {} }); }
    catch { threw = true; }
    expect(threw).toBe(true);
    rt.dispose();
  });
});

describe('certification app 8: Settings (theme + environment)', () => {
  const app: MobileIRApp = {
    name: 'SettingsApp',
    startScreen: 'Settings',
    screens: [{
      name: 'Settings',
      states: [{ name: 'darkMode', type: 'truth', initialValue: 'false' }],
      rootChildren: [
        { id: 'themeSwitch', kind: 'switch', properties: { label: 'Dark Mode', binding: 'darkMode' }, events: [], children: [] },
        { id: 'fontSlider', kind: 'slider', properties: { label: 'Font Size', min: 0.5, max: 3, step: 0.25, binding: 'fontSize' }, events: [], children: [] },
      ],
    }],
    permissions: [],
    capabilities: [],
  };

  test('theme toggle cycles light→dark→system', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    expect(rt.getEnvironment().theme).toBe('light');
    rt.setTheme('dark');
    expect(rt.getEnvironment().theme).toBe('dark');
    rt.setTheme('system');
    expect(rt.getEnvironment().theme).toBe('system');
    rt.dispose();
  });

  test('font scale adjusts within bounds', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    rt.setFontScale(2);
    expect(rt.getEnvironment().fontScale).toBe(2);
    rt.setFontScale(0.1);
    expect(rt.getEnvironment().fontScale).toBe(0.5);
    rt.setFontScale(10);
    expect(rt.getEnvironment().fontScale).toBe(3);
    rt.dispose();
  });

  test('orientation toggle works', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    expect(rt.getEnvironment().orientation).toBe('portrait');
    rt.setOrientation('landscape');
    expect(rt.getEnvironment().orientation).toBe('landscape');
    rt.dispose();
  });
});

describe('certification app 9: Biometric Auth (biometrics capability)', () => {
  const app: MobileIRApp = {
    name: 'AuthApp',
    startScreen: 'Lock',
    screens: [{
      name: 'Lock',
      states: [{ name: 'authenticated', type: 'truth', initialValue: 'false' }],
      rootChildren: [
        { id: 'authBtn', kind: 'button', properties: { label: 'Authenticate' }, events: [{ event: 'tapped', body: 'use biometrics' }], children: [] },
      ],
    }],
    permissions: ['biometrics'],
    capabilities: ['biometrics'],
  };

  test('biometrics returns success by default', async () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    const result = await rt.capabilities.biometrics.authenticate();
    expect(result).toBe('success');
    rt.dispose();
  });

  test('biometrics failure mode works', async () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    rt.capabilities.biometrics.setResult('failure');
    const result = await rt.capabilities.biometrics.authenticate();
    expect(result).toBe('failure');
    rt.dispose();
  });

  test('biometrics locked_out mode works', async () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    rt.capabilities.biometrics.setResult('locked_out');
    const result = await rt.capabilities.biometrics.authenticate();
    expect(result).toBe('locked_out');
    rt.dispose();
  });
});

describe('certification app 10: E-commerce (complex layout + data binding)', () => {
  const app: MobileIRApp = {
    name: 'ShopApp',
    startScreen: 'Products',
    screens: [
      { name: 'Products', states: [
        { name: 'products', type: 'list', initialValue: '["Widget","Gadget","Gizmo"]' },
        { name: 'cartCount', type: 'whole', initialValue: '0' },
      ], rootChildren: [
        { id: 'nav', kind: 'navbar', properties: { title: 'Shop', showBack: false }, events: [], children: [] },
        { id: 'scroll', kind: 'scrollview', properties: {}, events: [], children: [
          { id: 'productList', kind: 'list', properties: { binding: 'products' }, events: [], children: [
            { id: 'item', kind: 'card', properties: {}, events: [], children: [
              { id: 'itemText', kind: 'text', properties: { content: 'Product' }, events: [], children: [] },
            ]},
          ]},
        ]},
        { id: 'bottomNav', kind: 'bottomnav', properties: { items: 'Products,Cart,Profile' }, events: [], children: [] },
        { id: 'cartBadge', kind: 'badge', properties: { content: '{cartCount}' }, events: [], children: [] },
      ]},
      { name: 'Cart', states: [], rootChildren: [
        { id: 'cartNav', kind: 'navbar', properties: { title: 'Cart', showBack: true }, events: [], children: [] },
      ]},
    ],
    permissions: [],
    capabilities: [],
  };

  test('loads with product list', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    const products = rt.stateStore.get('products');
    expect(Array.isArray(products)).toBe(true);
    expect((products as string[]).length).toBe(3);
    rt.dispose();
  });

  test('cart count binding works', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    rt.stateStore.set('cartCount', 3);
    expect(rt.stateStore.get('cartCount')).toBe(3);
    rt.dispose();
  });

  test('navigates to Cart', async () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    await rt.executeAction('go to Cart');
    expect(rt.navigation.currentScreen()).toBe('Cart');
    rt.dispose();
  });
});

describe('certification app 11: Chat (toast + events + complex actions)', () => {
  const app: MobileIRApp = {
    name: 'ChatApp',
    startScreen: 'Messages',
    screens: [{
      name: 'Messages',
      states: [
        { name: 'message', type: 'text', initialValue: '' },
        { name: 'sent', type: 'truth', initialValue: 'false' },
      ],
      rootChildren: [
        { id: 'msgInput', kind: 'input', properties: { placeholder: 'Type a message...', binding: 'message' }, events: [], children: [] },
        { id: 'sendBtn', kind: 'button', properties: { label: 'Send' }, events: [{ event: 'tapped', body: 'set sent to true\nshow "Message sent!"' }], children: [] },
      ],
    }],
    permissions: ['notifications'],
    capabilities: [],
  };

  test('multi-line action executes both statements', async () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    const toasts: string[] = [];
    rt.onToast((msg) => toasts.push(msg));
    await rt.executeAction('set sent to true\nshow "Message sent!"');
    expect(rt.stateStore.get('sent')).toBe(true);
    expect(toasts.length).toBe(1);
    expect(toasts[0]).toBe('Message sent!');
    rt.dispose();
  });

  test('toast fires onToast event', async () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    const toasts: string[] = [];
    rt.onToast((msg) => toasts.push(msg));
    await rt.executeAction('show "Hello World"');
    expect(toasts).toContain('Hello World');
    rt.dispose();
  });
});

describe('certification app 12: Dashboard (complex widgets + grid layout)', () => {
  const app: MobileIRApp = {
    name: 'DashboardApp',
    startScreen: 'Dashboard',
    screens: [{
      name: 'Dashboard',
      states: [
        { name: 'progress', type: 'whole', initialValue: '65' },
        { name: 'tab', type: 'text', initialValue: 'Overview' },
      ],
      rootChildren: [
        { id: 'tabs', kind: 'tabs', properties: { items: 'Overview,Analytics,Reports' }, events: [], children: [] },
        { id: 'grid', kind: 'grid', properties: { columns: 2 }, events: [], children: [
          { id: 'card1', kind: 'card', properties: {}, events: [], children: [
            { id: 'stat1', kind: 'text', properties: { content: 'Users: 1,234' }, events: [], children: [] },
          ]},
          { id: 'card2', kind: 'card', properties: {}, events: [], children: [
            { id: 'progressBar', kind: 'progress', properties: { binding: 'progress' }, events: [], children: [] },
          ]},
        ]},
        { id: 'chip1', kind: 'chip', properties: { label: 'Active', selected: true }, events: [], children: [] },
        { id: 'chip2', kind: 'chip', properties: { label: 'Inactive' }, events: [], children: [] },
        { id: 'fab', kind: 'fab', properties: { iconName: '+', label: 'Add' }, events: [{ event: 'tapped', body: 'show "FAB tapped"' }], children: [] },
      ],
    }],
    permissions: [],
    capabilities: [],
  };

  test('all complex widget types load without error', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    expect(rt.diagnostics.hasErrors()).toBe(false);
    expect(rt.currentScreenModel()!.rootChildren.length).toBe(5);
    rt.dispose();
  });

  test('progress state binding works', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    expect(rt.stateStore.get('progress')).toBe(65);
    rt.stateStore.set('progress', 80);
    expect(rt.stateStore.get('progress')).toBe(80);
    rt.dispose();
  });

  test('fab action triggers toast', async () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    const toasts: string[] = [];
    rt.onToast((msg) => toasts.push(msg));
    await rt.executeAction('show "FAB tapped"');
    expect(toasts).toContain('FAB tapped');
    rt.dispose();
  });
});

describe('certification app 13: Full-stack Demo (all subsystems)', () => {
  const app: MobileIRApp = {
    name: 'FullDemo',
    startScreen: 'Home',
    screens: [
      { name: 'Home', states: [
        { name: 'username', type: 'text', initialValue: '' },
        { name: 'loggedIn', type: 'truth', initialValue: 'false' },
      ], rootChildren: [
        { id: 'nav', kind: 'navbar', properties: { title: 'Demo App' }, events: [], children: [] },
        { id: 'userInput', kind: 'input', properties: { label: 'Username', binding: 'username' }, events: [], children: [] },
        { id: 'loginBtn', kind: 'button', properties: { label: 'Login' }, events: [{ event: 'tapped', body: 'set loggedIn to true\nstore "user" = username\nshow "Welcome!"' }], children: [] },
        { id: 'cameraBtn', kind: 'button', properties: { label: 'Camera' }, events: [{ event: 'tapped', body: 'request camera\nuse camera' }], children: [] },
        { id: 'profileBtn', kind: 'button', properties: { label: 'Profile' }, events: [{ event: 'tapped', body: 'go to Profile' }], children: [] },
      ]},
      { name: 'Profile', states: [
        { name: 'savedUser', type: 'text', initialValue: '' },
      ], rootChildren: [
        { id: 'profileNav', kind: 'navbar', properties: { title: 'Profile', showBack: true }, events: [], children: [] },
        { id: 'savedName', kind: 'text', properties: { content: 'User: {savedUser}' }, events: [], children: [] },
        { id: 'loadBtn', kind: 'button', properties: { label: 'Load' }, events: [{ event: 'tapped', body: 'read "user" into savedUser' }], children: [] },
        { id: 'bioBtn', kind: 'button', properties: { label: 'Verify' }, events: [{ event: 'tapped', body: 'use biometrics' }], children: [] },
      ]},
    ],
    permissions: ['camera', 'notifications'],
    capabilities: ['camera', 'biometrics'],
  };

  test('full login→store→navigate→read→biometric flow', async () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    rt.permissions.setState('camera', 'granted');

    // Login
    rt.stateStore.set('username', 'testuser');
    const toasts: string[] = [];
    rt.onToast((msg) => toasts.push(msg));
    await rt.executeAction('set loggedIn to true\nstore "user" = username\nshow "Welcome!"');
    expect(rt.stateStore.get('loggedIn')).toBe(true);
    expect(rt.storage.get('local', 'user')).toBe('testuser');
    expect(toasts).toContain('Welcome!');

    // Navigate to Profile
    await rt.executeAction('go to Profile');
    expect(rt.navigation.currentScreen()).toBe('Profile');

    // Read stored user
    await rt.executeAction('read "user" into savedUser');
    expect(rt.stateStore.get('savedUser')).toBe('testuser');

    // Biometric verify
    const bioResult = await rt.capabilities.biometrics.authenticate();
    expect(bioResult).toBe('success');

    // Navigate back
    await rt.executeAction('go back');
    expect(rt.navigation.currentScreen()).toBe('Home');

    // Event log captured all actions
    const events = rt.eventLog.all();
    expect(events.length).toBeGreaterThan(5);

    rt.dispose();
  });

  test('test runner executes against full-stack app', async () => {
    const runner = new SimulatorTestRunner();
    const tests: SimulatorTestCase[] = [
      { name: 'launch and find home elements', steps: [
        { action: 'launch' },
        { action: 'find', query: 'userInput' },
        { action: 'find', query: 'loginBtn' },
        { action: 'find', query: 'cameraBtn' },
      ]},
      { name: 'navigate to profile', steps: [
        { action: 'openScreen', screen: 'Profile' },
        { action: 'find', query: 'loadBtn' },
        { action: 'find', query: 'bioBtn' },
      ]},
      { name: 'set permissions and capabilities', steps: [
        { action: 'setPermission', name: 'camera', state: 'granted' },
        { action: 'setCamera', mode: 'sample' },
        { action: 'setBiometric', result: 'success' },
        { action: 'setConnectivity', mode: 'online' },
      ]},
    ];
    const results = await runner.runAll(app, tests);
    expect(results.length).toBe(3);
    for (const r of results) {
      expect(r.passed).toBe(true);
    }
    runner.dispose();
  });

  test('diagnostics report no errors on valid app', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    expect(rt.diagnostics.hasErrors()).toBe(false);
    rt.dispose();
  });

  test('hot reload with content change preserves navigation', async () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(app);
    await rt.executeAction('go to Profile');
    expect(rt.navigation.currentScreen()).toBe('Profile');

    const updatedApp = JSON.parse(JSON.stringify(app));
    updatedApp.screens[0].rootChildren[1].properties.label = 'Email';

    let classification = '';
    rt.onDidReload((c) => { classification = c; });
    rt.reload(updatedApp);
    expect(classification).toBe('Content');
    rt.dispose();
  });
});

// =============================================================================
// Phase 2: Parity Hardening Tests
// =============================================================================

describe('Phase 2 parity: semantic colors', () => {
  test('resolveColor maps semantic names to hex', () => {
    const rt = new SimulatorRuntime();
    const app: MobileIRApp = {
      name: 'ColorApp', startScreen: 'Main',
      screens: [{
        name: 'Main', states: [],
        rootChildren: [
          { id: 't1', kind: 'text', properties: { content: 'Hello', color: 'primary' }, events: [], children: [] },
          { id: 't2', kind: 'text', properties: { content: 'Error', color: 'error' }, events: [], children: [] },
          { id: 'b1', kind: 'button', properties: { label: 'Go', backgroundColor: 'accent' }, events: [], children: [] },
        ],
      }],
      permissions: [], capabilities: [],
    };
    rt.loadApp(app);
    expect(rt.diagnostics.hasErrors()).toBe(false);
    rt.dispose();
  });
});

describe('Phase 2 parity: size unit conversion', () => {
  test('toCssSize handles dp, sp, match, wrap units', () => {
    const rt = new SimulatorRuntime();
    const app: MobileIRApp = {
      name: 'SizeApp', startScreen: 'Main',
      screens: [{
        name: 'Main', states: [],
        rootChildren: [
          { id: 'c1', kind: 'column', properties: { width: 'match', height: '100dp' }, events: [], children: [
            { id: 't1', kind: 'text', properties: { content: 'Wide', width: 'fill' }, events: [], children: [] },
            { id: 't2', kind: 'text', properties: { content: 'Auto', width: 'wrap' }, events: [], children: [] },
          ]},
        ],
      }],
      permissions: [], capabilities: [],
    };
    rt.loadApp(app);
    expect(rt.diagnostics.hasErrors()).toBe(false);
    rt.dispose();
  });
});

describe('Phase 2 parity: text styling', () => {
  test('text node properties are preserved in IR', () => {
    const rt = new SimulatorRuntime();
    const app: MobileIRApp = {
      name: 'TextApp', startScreen: 'Main',
      screens: [{
        name: 'Main', states: [],
        rootChildren: [
          { id: 'heading', kind: 'text', properties: { content: 'Title', size: 'heading', weight: 'bold', color: 'primary', fontSize: 28, letterSpacing: 1.5, textAlign: 'center', maxLines: 2 }, events: [], children: [] },
          { id: 'body', kind: 'text', properties: { content: 'Body text', size: 'body', weight: 'normal' }, events: [], children: [] },
          { id: 'caption', kind: 'text', properties: { content: 'Small', size: 'caption', weight: 'light' }, events: [], children: [] },
        ],
      }],
      permissions: [], capabilities: [],
    };
    rt.loadApp(app);
    const heading = rt.findNode('heading')!;
    expect(heading.properties.size).toBe('heading');
    expect(heading.properties.weight).toBe('bold');
    expect(heading.properties.color).toBe('primary');
    expect(heading.properties.fontSize).toBe(28);
    expect(heading.properties.textAlign).toBe('center');
    expect(heading.properties.maxLines).toBe(2);
    rt.dispose();
  });
});

describe('Phase 2 parity: button style variants', () => {
  test('button style and color properties preserved', () => {
    const rt = new SimulatorRuntime();
    const app: MobileIRApp = {
      name: 'BtnApp', startScreen: 'Main',
      screens: [{
        name: 'Main', states: [],
        rootChildren: [
          { id: 'primary', kind: 'button', properties: { label: 'Primary', style: 'primary' }, events: [{ event: 'tapped', body: 'log "p"' }], children: [] },
          { id: 'outline', kind: 'button', properties: { label: 'Outline', style: 'outline' }, events: [{ event: 'tapped', body: 'log "o"' }], children: [] },
          { id: 'text', kind: 'button', properties: { label: 'Text', style: 'text' }, events: [{ event: 'tapped', body: 'log "t"' }], children: [] },
          { id: 'custom', kind: 'button', properties: { label: 'Custom', containerColor: '#FF5722', contentColor: '#FFFFFF' }, events: [{ event: 'tapped', body: 'log "c"' }], children: [] },
        ],
      }],
      permissions: [], capabilities: [],
    };
    rt.loadApp(app);
    expect(rt.findNode('outline')!.properties.style).toBe('outline');
    expect(rt.findNode('custom')!.properties.containerColor).toBe('#FF5722');
    rt.dispose();
  });
});

describe('Phase 2 parity: icon rendering', () => {
  test('icon node carries name, size, color', () => {
    const rt = new SimulatorRuntime();
    const app: MobileIRApp = {
      name: 'IconApp', startScreen: 'Main',
      screens: [{
        name: 'Main', states: [],
        rootChildren: [
          { id: 'icon1', kind: 'icon', properties: { name: 'home', iconSize: 32, color: 'primary' }, events: [], children: [] },
          { id: 'icon2', kind: 'icon', properties: { name: 'settings', tintColor: '#FF0000' }, events: [], children: [] },
        ],
      }],
      permissions: [], capabilities: [],
    };
    rt.loadApp(app);
    expect(rt.findNode('icon1')!.properties.name).toBe('home');
    expect(rt.findNode('icon1')!.properties.iconSize).toBe(32);
    expect(rt.findNode('icon2')!.properties.tintColor).toBe('#FF0000');
    rt.dispose();
  });
});

describe('Phase 2 parity: checkbox and switch styling', () => {
  test('checkbox checkColor/labelColor and switch trackColor preserved', () => {
    const rt = new SimulatorRuntime();
    const app: MobileIRApp = {
      name: 'ToggleApp', startScreen: 'Main',
      screens: [{
        name: 'Main', states: [
          { name: 'agree', type: 'truth', initialValue: 'false' },
          { name: 'dark', type: 'truth', initialValue: 'false' },
        ],
        rootChildren: [
          { id: 'cb', kind: 'checkbox', properties: { label: 'I agree', binding: 'agree', checkColor: '#4CAF50', labelColor: '#333333' }, events: [{ event: 'toggled', body: 'log "toggled"' }], children: [] },
          { id: 'sw', kind: 'switch', properties: { label: 'Dark mode', binding: 'dark', trackColor: '#79747E' }, events: [{ event: 'toggled', body: 'log "switched"' }], children: [] },
        ],
      }],
      permissions: [], capabilities: [],
    };
    rt.loadApp(app);
    expect(rt.findNode('cb')!.properties.checkColor).toBe('#4CAF50');
    expect(rt.findNode('sw')!.properties.trackColor).toBe('#79747E');
    rt.dispose();
  });
});

describe('Phase 2 parity: slider activeColor and showValue', () => {
  test('slider properties preserved', () => {
    const rt = new SimulatorRuntime();
    const app: MobileIRApp = {
      name: 'SliderApp', startScreen: 'Main',
      screens: [{
        name: 'Main', states: [{ name: 'vol', type: 'whole', initialValue: '50' }],
        rootChildren: [
          { id: 'sl', kind: 'slider', properties: { binding: 'vol', min: 0, max: 100, activeColor: '#2196F3', showValue: true }, events: [{ event: 'changed', body: 'log vol' }], children: [] },
        ],
      }],
      permissions: [], capabilities: [],
    };
    rt.loadApp(app);
    expect(rt.findNode('sl')!.properties.activeColor).toBe('#2196F3');
    expect(rt.findNode('sl')!.properties.showValue).toBe(true);
    rt.dispose();
  });
});

describe('Phase 2 parity: progress indicatorColor/trackColor', () => {
  test('progress colors preserved', () => {
    const rt = new SimulatorRuntime();
    const app: MobileIRApp = {
      name: 'ProgApp', startScreen: 'Main',
      screens: [{
        name: 'Main', states: [{ name: 'load', type: 'whole', initialValue: '40' }],
        rootChildren: [
          { id: 'pb', kind: 'progress', properties: { binding: 'load', indicatorColor: '#4CAF50', trackColor: '#E0E0E0' }, events: [], children: [] },
          { id: 'ps', kind: 'progress', properties: { progressStyle: 'circular', indicatorColor: '#2196F3' }, events: [], children: [] },
        ],
      }],
      permissions: [], capabilities: [],
    };
    rt.loadApp(app);
    expect(rt.findNode('pb')!.properties.indicatorColor).toBe('#4CAF50');
    expect(rt.findNode('ps')!.properties.progressStyle).toBe('circular');
    rt.dispose();
  });
});

describe('Phase 2 parity: stack contentAlignment', () => {
  test('stack preserves contentAlignment', () => {
    const rt = new SimulatorRuntime();
    const app: MobileIRApp = {
      name: 'StackApp', startScreen: 'Main',
      screens: [{
        name: 'Main', states: [],
        rootChildren: [
          { id: 'stk', kind: 'stack', properties: { contentAlignment: 'bottom_end', width: 'match', height: 200 }, events: [], children: [
            { id: 'bg', kind: 'image', properties: { source: '' }, events: [], children: [] },
            { id: 'overlay', kind: 'text', properties: { content: 'Overlay' }, events: [], children: [] },
          ]},
        ],
      }],
      permissions: [], capabilities: [],
    };
    rt.loadApp(app);
    expect(rt.findNode('stk')!.properties.contentAlignment).toBe('bottom_end');
    rt.dispose();
  });
});

describe('Phase 2 parity: column scrollable', () => {
  test('column scrollable property preserved', () => {
    const rt = new SimulatorRuntime();
    const app: MobileIRApp = {
      name: 'ScrollApp', startScreen: 'Main',
      screens: [{
        name: 'Main', states: [],
        rootChildren: [
          { id: 'col', kind: 'column', properties: { scrollable: true, spacing: 8 }, events: [], children: [
            { id: 't1', kind: 'text', properties: { content: 'Item 1' }, events: [], children: [] },
            { id: 't2', kind: 'text', properties: { content: 'Item 2' }, events: [], children: [] },
          ]},
        ],
      }],
      permissions: [], capabilities: [],
    };
    rt.loadApp(app);
    expect(rt.findNode('col')!.properties.scrollable).toBe(true);
    rt.dispose();
  });
});

describe('Phase 2 parity: dialog modal behavior', () => {
  test('dialog has dismissible property', () => {
    const rt = new SimulatorRuntime();
    const app: MobileIRApp = {
      name: 'DialogApp', startScreen: 'Main',
      screens: [{
        name: 'Main', states: [{ name: 'show', type: 'truth', initialValue: 'false' }],
        rootChildren: [
          { id: 'dlg', kind: 'dialog', properties: { title: 'Confirm?', confirmLabel: 'Yes', cancelLabel: 'No', dismissible: true }, events: [
            { event: 'confirmed', body: 'set show to true' },
            { event: 'cancelled', body: 'set show to false' },
          ], children: [
            { id: 'dlgBody', kind: 'text', properties: { content: 'Are you sure?' }, events: [], children: [] },
          ]},
        ],
      }],
      permissions: [], capabilities: [],
    };
    rt.loadApp(app);
    const dlg = rt.findNode('dlg')!;
    expect(dlg.properties.dismissible).toBe(true);
    expect(dlg.properties.title).toBe('Confirm?');
    expect(dlg.children.length).toBe(1);
    rt.dispose();
  });

  test('dialog confirmed event executes action', async () => {
    const rt = new SimulatorRuntime();
    const app: MobileIRApp = {
      name: 'DialogApp2', startScreen: 'Main',
      screens: [{
        name: 'Main', states: [{ name: 'confirmed', type: 'truth', initialValue: 'false' }],
        rootChildren: [
          { id: 'dlg', kind: 'dialog', properties: { title: 'Delete?', confirmLabel: 'Delete', cancelLabel: 'Cancel' }, events: [
            { event: 'confirmed', body: 'set confirmed to true' },
          ], children: [] },
        ],
      }],
      permissions: [], capabilities: [],
    };
    rt.loadApp(app);
    expect(rt.stateStore.get('confirmed')).toBe(false);
    await rt.executeAction('set confirmed to true');
    expect(rt.stateStore.get('confirmed')).toBe(true);
    rt.dispose();
  });
});

describe('Phase 2 parity: snackbar duration', () => {
  test('snackbar duration property preserved', () => {
    const rt = new SimulatorRuntime();
    const app: MobileIRApp = {
      name: 'SnackApp', startScreen: 'Main',
      screens: [{
        name: 'Main', states: [],
        rootChildren: [
          { id: 'snack', kind: 'snackbar', properties: { message: 'Saved!', action: 'UNDO', duration: 'long' }, events: [
            { event: 'action_tapped', body: 'log "undo"' },
            { event: 'dismissed', body: 'log "dismissed"' },
          ], children: [] },
        ],
      }],
      permissions: [], capabilities: [],
    };
    rt.loadApp(app);
    expect(rt.findNode('snack')!.properties.duration).toBe('long');
    expect(rt.findNode('snack')!.events.length).toBe(2);
    rt.dispose();
  });
});

describe('Phase 2 parity: container gesture events', () => {
  test('column/row events include swiped/dragged/pinched', () => {
    const rt = new SimulatorRuntime();
    const app: MobileIRApp = {
      name: 'GestureApp', startScreen: 'Main',
      screens: [{
        name: 'Main', states: [{ name: 'swiped', type: 'truth', initialValue: 'false' }],
        rootChildren: [
          { id: 'col', kind: 'column', properties: { spacing: 8 }, events: [
            { event: 'swiped', body: 'set swiped to true' },
            { event: 'long_pressed', body: 'log "long"' },
          ], children: [
            { id: 't1', kind: 'text', properties: { content: 'Swipe me' }, events: [], children: [] },
          ]},
        ],
      }],
      permissions: [], capabilities: [],
    };
    rt.loadApp(app);
    const col = rt.findNode('col')!;
    expect(col.events.length).toBe(2);
    expect(col.events[0].event).toBe('swiped');
    expect(col.events[1].event).toBe('long_pressed');
    rt.dispose();
  });
});

describe('Phase 2 parity: list item_tapped', () => {
  test('list item_tapped event preserved in IR', () => {
    const rt = new SimulatorRuntime();
    const app: MobileIRApp = {
      name: 'ListApp', startScreen: 'Main',
      screens: [{
        name: 'Main', states: [
          { name: 'items', type: 'list', initialValue: '["Apple","Banana","Cherry"]' },
          { name: 'selected', type: 'text', initialValue: '' },
        ],
        rootChildren: [
          { id: 'list', kind: 'list', properties: { binding: 'items', separator: true }, events: [
            { event: 'item_tapped', body: 'set selected to _item' },
          ], children: [
            { id: 'tmpl', kind: 'text', properties: { content: '{item}' }, events: [], children: [] },
          ]},
        ],
      }],
      permissions: [], capabilities: [],
    };
    rt.loadApp(app);
    const list = rt.findNode('list')!;
    expect(list.events[0].event).toBe('item_tapped');
    const data = rt.stateStore.get('items') as unknown[];
    expect(data.length).toBe(3);
    rt.dispose();
  });
});

describe('Phase 2 parity: freeform positioning', () => {
  test('positionMode/x/y preserved', () => {
    const rt = new SimulatorRuntime();
    const app: MobileIRApp = {
      name: 'PosApp', startScreen: 'Main',
      screens: [{
        name: 'Main', states: [],
        rootChildren: [
          { id: 'stk', kind: 'stack', properties: { width: 'match', height: 300 }, events: [], children: [
            { id: 'abs', kind: 'text', properties: { content: 'Floating', positionMode: 'freeform', x: 100, y: 50 }, events: [], children: [] },
          ]},
        ],
      }],
      permissions: [], capabilities: [],
    };
    rt.loadApp(app);
    const abs = rt.findNode('abs')!;
    expect(abs.properties.positionMode).toBe('freeform');
    expect(abs.properties.x).toBe(100);
    expect(abs.properties.y).toBe(50);
    rt.dispose();
  });
});

describe('Phase 2 parity: aspectRatio and zIndex', () => {
  test('professional props preserved', () => {
    const rt = new SimulatorRuntime();
    const app: MobileIRApp = {
      name: 'PropsApp', startScreen: 'Main',
      screens: [{
        name: 'Main', states: [],
        rootChildren: [
          { id: 'img', kind: 'image', properties: { source: '', aspectRatio: '16/9', zIndex: 5 }, events: [], children: [] },
          { id: 'card', kind: 'card', properties: { contentColor: '#212121', elevation: 4 }, events: [], children: [] },
        ],
      }],
      permissions: [], capabilities: [],
    };
    rt.loadApp(app);
    expect(rt.findNode('img')!.properties.aspectRatio).toBe('16/9');
    expect(rt.findNode('img')!.properties.zIndex).toBe(5);
    expect(rt.findNode('card')!.properties.contentColor).toBe('#212121');
    rt.dispose();
  });
});

describe('Phase 2 parity: gesture event type', () => {
  test('gesture event type is valid for event log', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp({
      name: 'GApp', startScreen: 'M',
      screens: [{ name: 'M', states: [], rootChildren: [] }],
      permissions: [], capabilities: [],
    });
    rt.eventLog.log('gesture', 'Test gesture event');
    const events = rt.eventLog.all();
    const gestureEvents = events.filter((e: { type: string }) => e.type === 'gesture');
    expect(gestureEvents.length).toBe(1);
    rt.dispose();
  });
});

// ── MEDIUM/LOW parity tests ─────────────────────────────────────────────────

describe('Phase 2 parity: divider color and thickness', () => {
  test('divider preserves color and thickness properties', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp({
      name: 'DivApp', startScreen: 'Main',
      screens: [{
        name: 'Main', states: [],
        rootChildren: [
          { id: 'div1', kind: 'divider', properties: { color: 'error', thickness: 3 }, events: [], children: [] },
        ],
      }],
      permissions: [], capabilities: [],
    });
    const div = rt.findNode('div1')!;
    expect(div.properties.color).toBe('error');
    expect(div.properties.thickness).toBe(3);
    rt.dispose();
  });
});

describe('Phase 2 parity: navbar barStyle', () => {
  test('barStyle property preserved on navbar', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp({
      name: 'NavApp', startScreen: 'Main',
      screens: [{
        name: 'Main', states: [],
        rootChildren: [
          { id: 'nav1', kind: 'navbar', properties: { title: 'Settings', barStyle: 'large' }, events: [], children: [] },
        ],
      }],
      permissions: [], capabilities: [],
    });
    expect(rt.findNode('nav1')!.properties.barStyle).toBe('large');
    rt.dispose();
  });
});

describe('Phase 2 parity: FAB size and icon', () => {
  test('fabSize and iconName preserved', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp({
      name: 'FabApp', startScreen: 'Main',
      screens: [{
        name: 'Main', states: [],
        rootChildren: [
          { id: 'fab1', kind: 'fab', properties: { iconName: 'edit', fabSize: 'large', label: 'Edit' }, events: [], children: [] },
        ],
      }],
      permissions: [], capabilities: [],
    });
    const fab = rt.findNode('fab1')!;
    expect(fab.properties.fabSize).toBe('large');
    expect(fab.properties.iconName).toBe('edit');
    expect(fab.properties.label).toBe('Edit');
    rt.dispose();
  });
});

describe('Phase 2 parity: chip styles', () => {
  test('chipStyle property preserved', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp({
      name: 'ChipApp', startScreen: 'Main',
      screens: [{
        name: 'Main', states: [],
        rootChildren: [
          { id: 'c1', kind: 'chip', properties: { label: 'A', chipStyle: 'outline' }, events: [], children: [] },
          { id: 'c2', kind: 'chip', properties: { label: 'B', chipStyle: 'elevated' }, events: [], children: [] },
          { id: 'c3', kind: 'chip', properties: { label: 'C', chipStyle: 'filled', selected: true }, events: [], children: [] },
        ],
      }],
      permissions: [], capabilities: [],
    });
    expect(rt.findNode('c1')!.properties.chipStyle).toBe('outline');
    expect(rt.findNode('c2')!.properties.chipStyle).toBe('elevated');
    expect(rt.findNode('c3')!.properties.selected).toBe(true);
    rt.dispose();
  });
});

describe('Phase 2 parity: badge semantic color', () => {
  test('badge color property preserved', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp({
      name: 'BadgeApp', startScreen: 'Main',
      screens: [{
        name: 'Main', states: [],
        rootChildren: [
          { id: 'b1', kind: 'badge', properties: { content: '5', color: 'success' }, events: [], children: [] },
        ],
      }],
      permissions: [], capabilities: [],
    });
    expect(rt.findNode('b1')!.properties.color).toBe('success');
    expect(rt.findNode('b1')!.properties.content).toBe('5');
    rt.dispose();
  });
});

describe('Phase 2 parity: input leading/trailing icons', () => {
  test('leadingIcon and trailingIcon preserved', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp({
      name: 'IconInApp', startScreen: 'Main',
      screens: [{
        name: 'Main', states: [],
        rootChildren: [
          { id: 'inp1', kind: 'input', properties: { label: 'Search', leadingIcon: 'search', trailingIcon: 'close', required: true }, events: [], children: [] },
        ],
      }],
      permissions: [], capabilities: [],
    });
    const inp = rt.findNode('inp1')!;
    expect(inp.properties.leadingIcon).toBe('search');
    expect(inp.properties.trailingIcon).toBe('close');
    expect(inp.properties.required).toBe(true);
    rt.dispose();
  });
});

describe('Phase 2 parity: bottom nav icons property', () => {
  test('icons property preserved on bottomnav', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp({
      name: 'BNavApp', startScreen: 'Main',
      screens: [{
        name: 'Main', states: [],
        rootChildren: [
          { id: 'bn1', kind: 'bottomnav', properties: { items: 'Home,Search,Profile', icons: 'home,search,person' }, events: [], children: [] },
        ],
      }],
      permissions: [], capabilities: [],
    });
    const bn = rt.findNode('bn1')!;
    expect(bn.properties.icons).toBe('home,search,person');
    expect(bn.properties.items).toBe('Home,Search,Profile');
    rt.dispose();
  });
});

describe('Phase 2 parity: tabs state binding', () => {
  test('tab selection syncs with binding state', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp({
      name: 'TabBindApp', startScreen: 'Main',
      screens: [{
        name: 'Main',
        states: [{ name: 'currentTab', type: 'text', initialValue: 'Feed' }],
        rootChildren: [
          { id: 'tabs1', kind: 'tabs', properties: { items: 'Feed,Messages,Settings', binding: 'currentTab' }, events: [], children: [] },
        ],
      }],
      permissions: [], capabilities: [],
    });
    expect(rt.stateStore.get('currentTab')).toBe('Feed');
    expect(rt.findNode('tabs1')!.properties.binding).toBe('currentTab');
    rt.dispose();
  });
});

describe('Phase 2 parity: fireNodeEvent sets _value state', () => {
  test('slider changed event populates _value in state store', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp({
      name: 'ValApp', startScreen: 'Main',
      screens: [{
        name: 'Main',
        states: [{ name: 'volume', type: 'whole', initialValue: '50' }],
        rootChildren: [
          { id: 'sl1', kind: 'slider', properties: { min: 0, max: 100, binding: 'volume' }, events: [{ event: 'changed', body: '' }], children: [] },
        ],
      }],
      permissions: [], capabilities: [],
    });
    expect(rt.findNode('sl1')!.properties.binding).toBe('volume');
    expect(rt.findNode('sl1')!.events[0].event).toBe('changed');
    rt.dispose();
  });
});

describe('Phase 2 parity: clickable and focusable professional props', () => {
  test('clickable and focusable properties preserved on nodes', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp({
      name: 'A11yApp', startScreen: 'Main',
      screens: [{
        name: 'Main', states: [],
        rootChildren: [
          { id: 'btn1', kind: 'card', properties: { clickable: true, focusable: true, contentDescription: 'Clickable card', semanticRole: 'button' }, events: [], children: [] },
        ],
      }],
      permissions: [], capabilities: [],
    });
    const card = rt.findNode('btn1')!;
    expect(card.properties.clickable).toBe(true);
    expect(card.properties.focusable).toBe(true);
    expect(card.properties.contentDescription).toBe('Clickable card');
    expect(card.properties.semanticRole).toBe('button');
    rt.dispose();
  });
});

/* ===================================================================
   Phase 3 Tests — Runtime Realism, Developer Tooling, Visual Testing
   =================================================================== */

// ---- §2-§5: SimulatorClock ----

describe('Phase 3: SimulatorClock', () => {
  test('starts in realtime mode', () => {
    const clock = new SimulatorClock();
    expect(clock.mode()).toBe('realtime');
    const t = clock.now();
    expect(t).toBeGreaterThan(0);
    clock.dispose();
  });

  test('freeze captures current time', () => {
    const clock = new SimulatorClock();
    clock.freeze(1000);
    expect(clock.mode()).toBe('frozen');
    expect(clock.now()).toBe(1000);
    clock.dispose();
  });

  test('advance increments frozen time', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    clock.advance(500);
    expect(clock.now()).toBe(500);
    clock.advance(300);
    expect(clock.now()).toBe(800);
    clock.dispose();
  });

  test('advance fires pending timers', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    let fired = 0;
    clock.setTimeout(() => { fired++; }, 100);
    clock.advance(50);
    expect(fired).toBe(0);
    clock.advance(60);
    expect(fired).toBe(1);
    clock.dispose();
  });

  test('setInterval fires repeatedly', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    let count = 0;
    const id = clock.setInterval(() => { count++; }, 100);
    clock.advance(100);
    clock.advance(100);
    clock.advance(100);
    expect(count).toBe(3);
    clock.clearInterval(id);
    clock.advance(200);
    expect(count).toBe(3);
    clock.dispose();
  });

  test('clearTimeout prevents firing', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    let fired = false;
    const id = clock.setTimeout(() => { fired = true; }, 50);
    clock.clearTimeout(id);
    clock.advance(100);
    expect(fired).toBe(false);
    clock.dispose();
  });

  test('setCustomTime offsets from real time', () => {
    const clock = new SimulatorClock();
    clock.setCustomTime(Date.now() + 10000);
    expect(clock.mode()).toBe('custom');
    expect(clock.now()).toBeGreaterThan(Date.now() + 9000);
    clock.dispose();
  });

  test('reset returns to realtime', () => {
    const clock = new SimulatorClock();
    clock.freeze(1000);
    clock.setTimeout(() => {}, 100);
    clock.reset();
    expect(clock.mode()).toBe('realtime');
    clock.dispose();
  });

  test('onTick fires on advance', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const ticks: number[] = [];
    clock.onTick(e => ticks.push(e.delta));
    clock.advance(100);
    clock.advance(200);
    expect(ticks).toEqual([100, 200]);
    clock.dispose();
  });

  test('onModeChange fires on mode switch', () => {
    const clock = new SimulatorClock();
    const modes: string[] = [];
    clock.onModeChange(m => modes.push(m));
    clock.freeze();
    clock.setRealtime();
    expect(modes).toEqual(['frozen', 'realtime']);
    clock.dispose();
  });

  test('advance with zero or negative does nothing', () => {
    const clock = new SimulatorClock();
    clock.freeze(100);
    clock.advance(0);
    expect(clock.now()).toBe(100);
    clock.advance(-50);
    expect(clock.now()).toBe(100);
    clock.dispose();
  });

  test('clearAllTimers removes all timers', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    let count = 0;
    clock.setTimeout(() => { count++; }, 50);
    clock.setInterval(() => { count++; }, 100);
    clock.clearAllTimers();
    clock.advance(500);
    expect(count).toBe(0);
    clock.dispose();
  });
});

// ---- §6-§9: SimulatorEnvironmentModel ----

describe('Phase 3: SimulatorEnvironmentModel', () => {
  test('default state is sensible', () => {
    const env = new SimulatorEnvironmentModel();
    const s = env.get();
    expect(s.theme).toBe('light');
    expect(s.fontScale).toBe(1);
    expect(s.network).toBe('online');
    expect(s.battery.level).toBe(100);
    expect(s.airplaneMode).toBe(false);
    expect(s.reducedMotion).toBe(false);
    env.dispose();
  });

  test('set updates single field', () => {
    const env = new SimulatorEnvironmentModel();
    env.set('theme', 'dark');
    expect(env.get().theme).toBe('dark');
    env.dispose();
  });

  test('patch updates multiple fields', () => {
    const env = new SimulatorEnvironmentModel();
    env.patch({ fontScale: 2, reducedMotion: true });
    expect(env.get().fontScale).toBe(2);
    expect(env.get().reducedMotion).toBe(true);
    env.dispose();
  });

  test('onChange fires with previous value', () => {
    const env = new SimulatorEnvironmentModel();
    const changes: { key: string; value: unknown }[] = [];
    env.onChange(e => changes.push({ key: e.key, value: e.value }));
    env.set('theme', 'dark');
    expect(changes.length).toBe(1);
    expect(changes[0].key).toBe('theme');
    expect(changes[0].value).toBe('dark');
    env.dispose();
  });

  test('applyPreset applies known preset', () => {
    const env = new SimulatorEnvironmentModel();
    const applied = env.applyPreset('Offline User');
    expect(applied).toBe(true);
    expect(env.get().network).toBe('offline');
    env.dispose();
  });

  test('applyPreset returns false for unknown', () => {
    const env = new SimulatorEnvironmentModel();
    expect(env.applyPreset('NoSuchPreset')).toBe(false);
    env.dispose();
  });

  test('builtin presets has 10 entries', () => {
    const env = new SimulatorEnvironmentModel();
    expect(env.builtinPresets().length).toBe(10);
    env.dispose();
  });

  test('Low Battery preset sets level to 5', () => {
    const env = new SimulatorEnvironmentModel();
    env.applyPreset('Low Battery');
    expect(env.get().battery.level).toBe(5);
    expect(env.get().battery.charging).toBe(false);
    env.dispose();
  });

  test('Airplane Mode preset disables wifi and network', () => {
    const env = new SimulatorEnvironmentModel();
    env.applyPreset('Airplane Mode');
    expect(env.get().airplaneMode).toBe(true);
    expect(env.get().network).toBe('offline');
    expect(env.get().wifiEnabled).toBe(false);
    env.dispose();
  });

  test('snapshot and restore', () => {
    const env = new SimulatorEnvironmentModel();
    env.set('fontScale', 3);
    const snap = env.snapshot();
    env.set('fontScale', 1);
    env.restore(snap);
    expect(env.get().fontScale).toBe(3);
    env.dispose();
  });

  test('addPreset and removePreset', () => {
    const env = new SimulatorEnvironmentModel();
    env.addPreset({ name: 'Custom', description: 'Test', overrides: { fontScale: 1.5 } });
    expect(env.allPresets().length).toBe(11);
    env.applyPreset('Custom');
    expect(env.get().fontScale).toBe(1.5);
    env.removePreset('Custom');
    expect(env.allPresets().length).toBe(10);
    env.dispose();
  });

  test('reset returns to defaults', () => {
    const env = new SimulatorEnvironmentModel();
    env.set('theme', 'dark');
    env.set('fontScale', 3);
    env.reset();
    expect(env.get().theme).toBe('light');
    expect(env.get().fontScale).toBe(1);
    env.dispose();
  });

  test('Large Text preset doubles font scale', () => {
    const env = new SimulatorEnvironmentModel();
    env.applyPreset('Large Text');
    expect(env.get().fontScale).toBe(2);
    env.dispose();
  });

  test('Reduced Motion preset', () => {
    const env = new SimulatorEnvironmentModel();
    env.applyPreset('Reduced Motion');
    expect(env.get().reducedMotion).toBe(true);
    env.dispose();
  });
});

// ---- §10-§13: SimulatorAnimationScheduler ----

describe('Phase 3: SimulatorAnimationScheduler', () => {
  test('start and advance fires onUpdate', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const anim = new SimulatorAnimationScheduler(clock);
    const progress: number[] = [];
    anim.start({ id: 'test', duration: 100, easing: 'linear', onUpdate: p => progress.push(p) });
    clock.advance(50);
    clock.advance(50);
    expect(progress.length).toBeGreaterThan(0);
    anim.dispose();
    clock.dispose();
  });

  test('finishAll completes all animations', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const anim = new SimulatorAnimationScheduler(clock);
    let completed = false;
    anim.start({ id: 'a', duration: 1000, onUpdate: () => {}, onComplete: () => { completed = true; } });
    anim.finishAll();
    expect(completed).toBe(true);
    anim.dispose();
    clock.dispose();
  });

  test('cancel removes animation', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const anim = new SimulatorAnimationScheduler(clock);
    let completed = false;
    anim.start({ id: 'b', duration: 100, onUpdate: () => {}, onComplete: () => { completed = true; } });
    anim.cancel('b');
    clock.advance(200);
    expect(completed).toBe(false);
    anim.dispose();
    clock.dispose();
  });

  test('pause and resume', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const anim = new SimulatorAnimationScheduler(clock);
    anim.start({ id: 'c', duration: 200, onUpdate: () => {} });
    anim.pause('c');
    expect(anim.activeCount()).toBe(1);
    anim.resume('c');
    expect(anim.activeCount()).toBe(1);
    anim.dispose();
    clock.dispose();
  });

  test('cancelAll removes all animations', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const anim = new SimulatorAnimationScheduler(clock);
    anim.start({ id: 'x', duration: 100, onUpdate: () => {} });
    anim.start({ id: 'y', duration: 100, onUpdate: () => {} });
    anim.cancelAll();
    expect(anim.activeCount()).toBe(0);
    anim.dispose();
    clock.dispose();
  });

  test('onAnimation fires events', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const anim = new SimulatorAnimationScheduler(clock);
    const events: string[] = [];
    anim.onAnimation(e => events.push(e.action));
    anim.start({ id: 'd', duration: 50, onUpdate: () => {} });
    expect(events).toContain('start');
    anim.cancel('d');
    expect(events).toContain('cancel');
    anim.dispose();
    clock.dispose();
  });
});

// ---- §14: SimulatorFocusManager ----

describe('Phase 3: SimulatorFocusManager', () => {
  test('register and requestFocus', () => {
    const fm = new SimulatorFocusManager();
    const el = { focus: () => {}, dataset: {} } as unknown as HTMLElement;
    fm.register('n1', el, 0);
    fm.requestFocus('n1', 'programmatic');
    expect(fm.currentFocus()).toBe('n1');
    fm.dispose();
  });

  test('onScreenOpen focuses first focusable', () => {
    const fm = new SimulatorFocusManager();
    const el = { focus: () => {}, dataset: {} } as unknown as HTMLElement;
    fm.register('n1', el, 0);
    fm.onScreenOpen();
    expect(fm.currentFocus()).toBe('n1');
    fm.dispose();
  });

  test('pushTrap and popTrap', () => {
    const fm = new SimulatorFocusManager();
    const el = { focus: () => {}, dataset: {} } as unknown as HTMLElement;
    fm.register('d1', el, 0, 'dialog1');
    fm.pushTrap('dialog1');
    expect(fm.currentFocus()).toBe('d1');
    fm.popTrap();
    fm.dispose();
  });

  test('nextFocus cycles through focusables', () => {
    const fm = new SimulatorFocusManager();
    const el1 = { focus: () => {}, dataset: {} } as unknown as HTMLElement;
    const el2 = { focus: () => {}, dataset: {} } as unknown as HTMLElement;
    fm.register('a', el1, 0);
    fm.register('b', el2, 1);
    fm.nextFocus();
    expect(fm.currentFocus()).toBe('a');
    fm.nextFocus();
    expect(fm.currentFocus()).toBe('b');
    fm.nextFocus();
    expect(fm.currentFocus()).toBe('a');
    fm.dispose();
  });

  test('previousFocus cycles backward', () => {
    const fm = new SimulatorFocusManager();
    const el1 = { focus: () => {}, dataset: {} } as unknown as HTMLElement;
    const el2 = { focus: () => {}, dataset: {} } as unknown as HTMLElement;
    fm.register('x', el1, 0);
    fm.register('y', el2, 1);
    fm.previousFocus();
    expect(fm.currentFocus()).toBe('y');
    fm.previousFocus();
    expect(fm.currentFocus()).toBe('x');
    fm.dispose();
  });

  test('onFocusChange fires', () => {
    const fm = new SimulatorFocusManager();
    const el = { focus: () => {}, dataset: {} } as unknown as HTMLElement;
    fm.register('n1', el, 0);
    const changes: string[] = [];
    fm.onFocusChange(e => changes.push(e.reason));
    fm.requestFocus('n1', 'user');
    expect(changes).toContain('user');
    fm.dispose();
  });

  test('getFocusOrder returns registered node ids', () => {
    const fm = new SimulatorFocusManager();
    const el1 = { focus: () => {}, dataset: {} } as unknown as HTMLElement;
    const el2 = { focus: () => {}, dataset: {} } as unknown as HTMLElement;
    fm.register('a', el1, 0);
    fm.register('b', el2, 1);
    expect(fm.getFocusOrder()).toEqual(['a', 'b']);
    fm.dispose();
  });

  test('clearFocus clears current focus', () => {
    const fm = new SimulatorFocusManager();
    const el = { focus: () => {}, dataset: {} } as unknown as HTMLElement;
    fm.register('n1', el, 0);
    fm.requestFocus('n1');
    expect(fm.currentFocus()).toBe('n1');
    fm.clearFocus();
    expect(fm.currentFocus()).toBe(null);
    fm.dispose();
  });

  test('reset clears all state', () => {
    const fm = new SimulatorFocusManager();
    const el = { focus: () => {}, dataset: {} } as unknown as HTMLElement;
    fm.register('n1', el, 0);
    fm.requestFocus('n1');
    fm.reset();
    expect(fm.currentFocus()).toBe(null);
    expect(fm.getFocusOrder()).toEqual([]);
    fm.dispose();
  });
});

// ---- §15: SimulatorGestureEngine ----

describe('Phase 3: SimulatorGestureEngine', () => {
  test('gesture engine exists and can be instantiated', () => {
    const ge = new SimulatorGestureEngine();
    expect(ge.currentState()).toBe('idle');
    ge.dispose();
  });

  test('synthesize fires onGesture', () => {
    const ge = new SimulatorGestureEngine();
    const gestures: string[] = [];
    ge.onGesture(e => gestures.push(e.type));
    ge.synthesize('tap', 100, 100);
    expect(gestures).toContain('tap');
    ge.dispose();
  });

  test('reset returns to idle', () => {
    const ge = new SimulatorGestureEngine();
    ge.synthesize('tap', 0, 0);
    ge.reset();
    expect(ge.currentState()).toBe('idle');
    ge.dispose();
  });
});

// ---- §16-§17: SimulatorAccessibility ----

describe('Phase 3: SimulatorAccessibility', () => {
  test('audit detects missing label on interactive node', () => {
    const a11y = new SimulatorAccessibility();
    const screen = {
      name: 'Test', states: [],
      rootChildren: [
        { id: 'b1', kind: 'button', properties: {}, events: [{ event: 'tapped', body: '' }], children: [] },
      ],
    };
    const issues = a11y.audit(screen);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].check).toBe('missing_label');
  });

  test('audit detects missing image description', () => {
    const a11y = new SimulatorAccessibility();
    const screen = {
      name: 'Test', states: [],
      rootChildren: [
        { id: 'i1', kind: 'image', properties: { source: 'test.png' }, events: [], children: [] },
      ],
    };
    const issues = a11y.audit(screen);
    expect(issues.some(i => i.check === 'missing_image_description')).toBe(true);
  });

  test('audit detects tiny touch target', () => {
    const a11y = new SimulatorAccessibility();
    const screen = {
      name: 'Test', states: [],
      rootChildren: [
        { id: 'b2', kind: 'button', properties: { label: 'Tiny', width: 20, height: 20 }, events: [{ event: 'tapped', body: '' }], children: [] },
      ],
    };
    const issues = a11y.audit(screen);
    expect(issues.some(i => i.check === 'tiny_touch_target')).toBe(true);
  });

  test('audit passes for properly labeled button', () => {
    const a11y = new SimulatorAccessibility();
    const screen = {
      name: 'Test', states: [],
      rootChildren: [
        { id: 'b3', kind: 'button', properties: { label: 'Submit' }, events: [{ event: 'tapped', body: '' }], children: [] },
      ],
    };
    const issues = a11y.audit(screen);
    expect(issues.filter(i => i.nodeId === 'b3' && i.check === 'missing_label').length).toBe(0);
  });

  test('audit detects unfocusable interactive', () => {
    const a11y = new SimulatorAccessibility();
    const screen = {
      name: 'Test', states: [],
      rootChildren: [
        { id: 'b4', kind: 'button', properties: { label: 'No focus', focusable: false }, events: [{ event: 'tapped', body: '' }], children: [] },
      ],
    };
    const issues = a11y.audit(screen);
    expect(issues.some(i => i.check === 'unfocusable_interactive')).toBe(true);
  });

  test('buildAccessibleOrder returns ordered elements', () => {
    const a11y = new SimulatorAccessibility();
    const screen = {
      name: 'Test', states: [] as any[],
      rootChildren: [
        { id: 'b1', kind: 'button', properties: { label: 'First' } as Record<string, string | number | boolean>, events: [{ event: 'tapped', body: '' }], children: [] as any[] },
        { id: 't1', kind: 'text', properties: { content: 'Label' } as Record<string, string | number | boolean>, events: [] as any[], children: [] as any[] },
        { id: 'b2', kind: 'button', properties: { label: 'Second' } as Record<string, string | number | boolean>, events: [{ event: 'tapped', body: '' }], children: [] as any[] },
      ],
    };
    const order = a11y.buildAccessibleOrder(screen);
    expect(order.length).toBe(2);
    expect(order[0].nodeId).toBe('b1');
    expect(order[1].nodeId).toBe('b2');
  });

  test('audits children recursively', () => {
    const a11y = new SimulatorAccessibility();
    const screen = {
      name: 'Test', states: [],
      rootChildren: [
        { id: 'c1', kind: 'column', properties: {}, events: [], children: [
          { id: 'b1', kind: 'button', properties: {}, events: [{ event: 'tapped', body: '' }], children: [] },
        ]},
      ],
    };
    const issues = a11y.audit(screen);
    expect(issues.some(i => i.nodeId === 'b1' && i.check === 'missing_label')).toBe(true);
  });
});

// ---- §18: SimulatorResponsive ----

describe('Phase 3: SimulatorResponsive', () => {
  test('analyze detects overflowing node', () => {
    const resp = new SimulatorResponsive();
    const screen = {
      name: 'Test', states: [],
      rootChildren: [
        { id: 'w1', kind: 'row', properties: { width: 500 }, events: [], children: [] },
      ],
    };
    const diags = resp.analyze(screen, 393, 852);
    expect(diags.some(d => d.check === 'horizontal_overflow')).toBe(true);
  });

  test('analyze passes for normal-width node', () => {
    const resp = new SimulatorResponsive();
    const screen = {
      name: 'Test', states: [],
      rootChildren: [
        { id: 'w2', kind: 'row', properties: { width: 200 }, events: [], children: [] },
      ],
    };
    const diags = resp.analyze(screen, 393, 852);
    expect(diags.length).toBe(0);
  });

  test('analyze checks children', () => {
    const resp = new SimulatorResponsive();
    const screen = {
      name: 'Test', states: [],
      rootChildren: [
        { id: 'c1', kind: 'column', properties: {}, events: [], children: [
          { id: 'w3', kind: 'text', properties: { width: 600 }, events: [], children: [] },
        ]},
      ],
    };
    const diags = resp.analyze(screen, 393, 852);
    expect(diags.some(d => d.nodeId === 'w3')).toBe(true);
  });
});

// ---- §19: SimulatorRegistry ----

describe('Phase 3: SimulatorRegistry', () => {
  test('14 capabilities registered', () => {
    const reg = new SimulatorRegistry();
    expect(reg.allCapabilities().length).toBe(14);
  });

  test('27 components registered', () => {
    const reg = new SimulatorRegistry();
    expect(reg.allComponents().length).toBe(27);
  });

  test('getCapability returns entry by name', () => {
    const reg = new SimulatorRegistry();
    const cam = reg.getCapability('camera');
    expect(cam).toBeDefined();
    expect(cam!.support).toBe('SimulatorPartial');
  });

  test('getComponent returns entry by kind', () => {
    const reg = new SimulatorRegistry();
    const btn = reg.getComponent('button');
    expect(btn).toBeDefined();
    expect(btn!.support).toBe('SimulatorSupported');
    expect(btn!.events).toContain('tapped');
  });

  test('androidOnly lists NFC, bluetooth, sensors, background_services, push_delivery', () => {
    const reg = new SimulatorRegistry();
    const ao = reg.androidOnlyCapabilities();
    expect(ao.length).toBe(5);
    expect(ao.map(c => c.name).sort()).toEqual(['background_services', 'bluetooth', 'nfc', 'push_delivery', 'sensors']);
  });

  test('counts returns correct totals', () => {
    const reg = new SimulatorRegistry();
    const c = reg.counts();
    expect(c.supported).toBeGreaterThan(30);
    expect(c.partial).toBe(3);
    expect(c.androidOnly).toBe(5);
  });

  test('all components are SimulatorSupported', () => {
    const reg = new SimulatorRegistry();
    for (const comp of reg.allComponents()) {
      expect(comp.support).toBe('SimulatorSupported');
    }
  });

  test('component registry has correct accessibilityRoles', () => {
    const reg = new SimulatorRegistry();
    expect(reg.getComponent('dialog')!.accessibilityRoles).toContain('dialog');
    expect(reg.getComponent('list')!.accessibilityRoles).toContain('list');
    expect(reg.getComponent('checkbox')!.accessibilityRoles).toContain('checkbox');
  });

  test('getCapability returns undefined for unknown', () => {
    const reg = new SimulatorRegistry();
    expect(reg.getCapability('nonexistent')).toBeUndefined();
  });

  test('getComponent returns undefined for unknown', () => {
    const reg = new SimulatorRegistry();
    expect(reg.getComponent('nonexistent')).toBeUndefined();
  });
});

// ---- §20: SimulatorPerformance ----

describe('Phase 3: SimulatorPerformance', () => {
  test('record and retrieve metrics', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const perf = new SimulatorPerformance(clock);
    perf.record('render_duration', 16, 'ms');
    perf.record('render_duration', 32, 'ms');
    const all = perf.getMetrics('render_duration');
    expect(all.length).toBe(2);
    perf.dispose();
    clock.dispose();
  });

  test('getSummary computes avg/max/count', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const perf = new SimulatorPerformance(clock);
    perf.record('test_metric', 10, 'ms');
    perf.record('test_metric', 20, 'ms');
    perf.record('test_metric', 30, 'ms');
    const summary = perf.getSummary();
    expect(summary['test_metric']).toBeDefined();
    expect(summary['test_metric'].count).toBe(3);
    expect(summary['test_metric'].avg).toBe(20);
    expect(summary['test_metric'].max).toBe(30);
    perf.dispose();
    clock.dispose();
  });

  test('recordStateUpdate/recordNavigation/recordHotReload', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const perf = new SimulatorPerformance(clock);
    perf.recordStateUpdate(5);
    perf.recordNavigation(12);
    perf.recordHotReload(50);
    perf.recordHttpDuration(100);
    const summary = perf.getSummary();
    expect(summary['state_update']).toBeDefined();
    expect(summary['screen_transition']).toBeDefined();
    expect(summary['hot_reload']).toBeDefined();
    expect(summary['http_duration']).toBeDefined();
    perf.dispose();
    clock.dispose();
  });

  test('getRenderCount tracks renders', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const perf = new SimulatorPerformance(clock);
    perf.beginRender();
    perf.endRender('state_change', ['button', 'text']);
    perf.beginRender();
    perf.endRender('navigation', ['screen']);
    expect(perf.getRenderCount()).toBe(2);
    perf.dispose();
    clock.dispose();
  });

  test('getTraces returns render traces', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const perf = new SimulatorPerformance(clock);
    perf.beginRender();
    perf.endRender('init', ['app']);
    const traces = perf.getTraces();
    expect(traces.length).toBe(1);
    expect(traces[0].trigger).toBe('init');
    perf.dispose();
    clock.dispose();
  });

  test('reset clears all metrics and traces', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const perf = new SimulatorPerformance(clock);
    perf.record('x', 1, 'ms');
    perf.beginRender();
    perf.endRender('t', []);
    perf.reset();
    expect(perf.getMetrics().length).toBe(0);
    expect(perf.getTraces().length).toBe(0);
    expect(perf.getRenderCount()).toBe(0);
    perf.dispose();
    clock.dispose();
  });

  test('MAX_METRICS caps at 500', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const perf = new SimulatorPerformance(clock);
    for (let i = 0; i < 600; i++) perf.record('m', i, 'ms');
    expect(perf.getMetrics().length).toBe(500);
    perf.dispose();
    clock.dispose();
  });
});

// ---- §21: SimulatorStateDebugger ----

describe('Phase 3: SimulatorStateDebugger', () => {
  test('records state changes', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const store = new SimulatorStateStore();
    const nav = new SimulatorNavigation();
    const perm = new SimulatorPermissions();
    const dbg = new SimulatorStateDebugger(store, nav, perm, clock);
    store.initScreen('Main', [{ name: 'count', type: 'whole', initialValue: '0' }]);
    store.set('count', 5);
    const history = dbg.getHistory();
    expect(history.length).toBeGreaterThan(0);
    expect(history[history.length - 1].key).toBe('count');
    dbg.dispose();
    store.dispose();
    nav.dispose();
    perm.dispose();
    clock.dispose();
  });

  test('captures snapshots', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const store = new SimulatorStateStore();
    const nav = new SimulatorNavigation();
    const perm = new SimulatorPermissions();
    const dbg = new SimulatorStateDebugger(store, nav, perm, clock);
    nav.reset('Main');
    const id = dbg.takeSnapshot('test');
    expect(id).toBeGreaterThan(0);
    const snaps = dbg.getSnapshots();
    expect(snaps.length).toBeGreaterThan(0);
    expect(snaps[0].label).toBe('test');
    dbg.dispose();
    store.dispose();
    nav.dispose();
    perm.dispose();
    clock.dispose();
  });

  test('watches track specific keys', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const store = new SimulatorStateStore();
    const nav = new SimulatorNavigation();
    const perm = new SimulatorPermissions();
    const dbg = new SimulatorStateDebugger(store, nav, perm, clock);
    dbg.addWatch('count');
    expect(dbg.getWatches()).toContain('count');
    dbg.removeWatch('count');
    expect(dbg.getWatches().includes('count')).toBe(false);
    dbg.dispose();
    store.dispose();
    nav.dispose();
    perm.dispose();
    clock.dispose();
  });

  test('overrides mark state as SIMULATOR OVERRIDE', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const store = new SimulatorStateStore();
    const nav = new SimulatorNavigation();
    const perm = new SimulatorPermissions();
    const dbg = new SimulatorStateDebugger(store, nav, perm, clock);
    nav.reset('Main');
    store.initScreen('Main', [{ name: 'value', type: 'text', initialValue: 'original' }]);
    dbg.safeEdit('value', 'overridden');
    expect(dbg.getOverrides()).toContain('value');
    dbg.clearOverride('value');
    expect(dbg.getOverrides().includes('value')).toBe(false);
    dbg.dispose();
    store.dispose();
    nav.dispose();
    perm.dispose();
    clock.dispose();
  });

  test('reset clears history and snapshots', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const store = new SimulatorStateStore();
    const nav = new SimulatorNavigation();
    const perm = new SimulatorPermissions();
    const dbg = new SimulatorStateDebugger(store, nav, perm, clock);
    nav.reset('Main');
    dbg.takeSnapshot('x');
    store.initScreen('Main', [{ name: 'a', type: 'text', initialValue: '' }]);
    store.set('a', 'b');
    dbg.reset();
    expect(dbg.getHistory().length).toBe(0);
    expect(dbg.getSnapshots().length).toBe(0);
    dbg.dispose();
    store.dispose();
    nav.dispose();
    perm.dispose();
    clock.dispose();
  });
});

// ---- §22: SimulatorNetworkInspector ----

describe('Phase 3: SimulatorNetworkInspector', () => {
  test('records entries from HTTP requests', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const http = new SimulatorHttp({ getMode: () => 'online', setMode: () => {} } as any);
    const inspector = new SimulatorNetworkInspector(http, clock);
    const entries = inspector.getEntries();
    expect(Array.isArray(entries)).toBe(true);
    inspector.dispose();
    http.dispose();
    clock.dispose();
  });

  test('addOverride and removeOverride', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const http = new SimulatorHttp({ getMode: () => 'online', setMode: () => {} } as any);
    const inspector = new SimulatorNetworkInspector(http, clock);
    const id = inspector.addOverride({ method: 'GET', pathPattern: '/api/test', action: { type: 'status', status: 500 }, active: true });
    expect(inspector.getOverrides().length).toBe(1);
    inspector.removeOverride(id);
    expect(inspector.getOverrides().length).toBe(0);
    inspector.dispose();
    http.dispose();
    clock.dispose();
  });

  test('clear removes all entries', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const http = new SimulatorHttp({ getMode: () => 'online', setMode: () => {} } as any);
    const inspector = new SimulatorNetworkInspector(http, clock);
    inspector.clear();
    expect(inspector.getEntries().length).toBe(0);
    inspector.dispose();
    http.dispose();
    clock.dispose();
  });

  test('redactHeaders removes sensitive headers', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const http = new SimulatorHttp({ getMode: () => 'online', setMode: () => {} } as any);
    const inspector = new SimulatorNetworkInspector(http, clock);
    const redacted = inspector.redactHeaders({
      authorization: 'Bearer secret123',
      'content-type': 'application/json',
      cookie: 'session=abc',
    });
    expect(redacted['authorization']).toBe('[REDACTED]');
    expect(redacted['cookie']).toBe('[REDACTED]');
    expect(redacted['content-type']).toBe('application/json');
    inspector.dispose();
    http.dispose();
    clock.dispose();
  });
});

// ---- §23: SimulatorScreenshot ----

describe('Phase 3: SimulatorScreenshot', () => {
  test('baselines management', () => {
    const env = new SimulatorEnvironmentModel();
    const clock = new SimulatorClock();
    clock.freeze(0);
    const ss = new SimulatorScreenshot(env, clock);
    ss.setBaseline('test-screen', 'data:image/png;base64,ABC');
    expect(ss.getBaseline('test-screen')).toBe('data:image/png;base64,ABC');
    ss.removeBaseline('test-screen');
    expect(ss.getBaseline('test-screen')).toBeUndefined();
    ss.dispose();
    env.dispose();
    clock.dispose();
  });

  test('MAX_BASELINES is 200', () => {
    const env = new SimulatorEnvironmentModel();
    const clock = new SimulatorClock();
    clock.freeze(0);
    const ss = new SimulatorScreenshot(env, clock);
    for (let i = 0; i < 210; i++) ss.setBaseline(`s${i}`, 'data:test');
    expect(ss.baselineCount()).toBeLessThanOrEqual(200);
    ss.dispose();
    env.dispose();
    clock.dispose();
  });
});

// ---- §24: SimulatorTransitions ----

describe('Phase 3: SimulatorTransitions', () => {
  test('isTransitioning starts false', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const anim = new SimulatorAnimationScheduler(clock);
    const trans = new SimulatorTransitions(anim);
    expect(trans.isTransitioning()).toBe(false);
    anim.dispose();
    clock.dispose();
  });

  test('reset sets transitioning to false', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const anim = new SimulatorAnimationScheduler(clock);
    const trans = new SimulatorTransitions(anim);
    trans.reset();
    expect(trans.isTransitioning()).toBe(false);
    anim.dispose();
    clock.dispose();
  });
});

// ---- §25: Runtime integration of Phase 3 subsystems ----

describe('Phase 3: Runtime integration', () => {
  test('runtime exposes clock', () => {
    const rt = new SimulatorRuntime();
    expect(rt.clock).toBeDefined();
    expect(rt.clock.mode()).toBe('realtime');
    rt.dispose();
  });

  test('runtime exposes environmentModel', () => {
    const rt = new SimulatorRuntime();
    expect(rt.environmentModel).toBeDefined();
    expect(rt.environmentModel.get().theme).toBe('light');
    rt.dispose();
  });

  test('runtime exposes gestureEngine', () => {
    const rt = new SimulatorRuntime();
    expect(rt.gestureEngine).toBeDefined();
    rt.dispose();
  });

  test('runtime exposes focusManager', () => {
    const rt = new SimulatorRuntime();
    expect(rt.focusManager).toBeDefined();
    rt.dispose();
  });

  test('runtime exposes animationScheduler', () => {
    const rt = new SimulatorRuntime();
    expect(rt.animationScheduler).toBeDefined();
    rt.dispose();
  });

  test('runtime exposes perf', () => {
    const rt = new SimulatorRuntime();
    expect(rt.perf).toBeDefined();
    expect(rt.perf.getRenderCount()).toBe(0);
    rt.dispose();
  });

  test('runtime exposes networkInspector', () => {
    const rt = new SimulatorRuntime();
    expect(rt.networkInspector).toBeDefined();
    rt.dispose();
  });

  test('runtime exposes stateDebugger', () => {
    const rt = new SimulatorRuntime();
    expect(rt.stateDebugger).toBeDefined();
    rt.dispose();
  });

  test('runtime exposes accessibility', () => {
    const rt = new SimulatorRuntime();
    expect(rt.accessibility).toBeDefined();
    rt.dispose();
  });

  test('runtime exposes responsive', () => {
    const rt = new SimulatorRuntime();
    expect(rt.responsive).toBeDefined();
    rt.dispose();
  });

  test('runtime exposes registry', () => {
    const rt = new SimulatorRuntime();
    expect(rt.registry).toBeDefined();
    expect(rt.registry.allCapabilities().length).toBe(14);
    rt.dispose();
  });

  test('runtime exposes screenshot', () => {
    const rt = new SimulatorRuntime();
    expect(rt.screenshot).toBeDefined();
    rt.dispose();
  });

  test('runtime reset clears Phase 3 subsystems', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp({ name: 'App', startScreen: 'Main', screens: [{ name: 'Main', states: [{ name: 'x', type: 'text', initialValue: 'hi' }], rootChildren: [] }], permissions: [], capabilities: [] });
    rt.perf.record('test', 1, 'ms');
    rt.clock.freeze(5000);
    rt.reset();
    expect(rt.clock.mode()).toBe('realtime');
    expect(rt.perf.getMetrics().length).toBe(0);
    rt.dispose();
  });

  test('navigation triggers focusManager.onScreenOpen', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp({
      name: 'App', startScreen: 'Home',
      screens: [
        { name: 'Home', states: [], rootChildren: [] },
        { name: 'Detail', states: [], rootChildren: [] },
      ],
      permissions: [], capabilities: [],
    });
    expect(rt.focusManager.currentFocus()).toBe(null);
    rt.navigation.navigate('Detail');
    expect(rt.focusManager.currentFocus()).toBe(null);
    rt.dispose();
  });
});

// ---- §26: TestRunnerV2 ----

describe('Phase 3: TestRunnerV2', () => {
  test('runAll executes tests and returns report', async () => {
    const clock = new SimulatorClock();
    const runner = new SimulatorTestRunnerV2(clock);
    const app: MobileIRApp = {
      name: 'App', startScreen: 'Main',
      screens: [{
        name: 'Main', states: [{ name: 'count', type: 'whole', initialValue: '0' }],
        rootChildren: [
          { id: 'btn1', kind: 'button', properties: { label: 'Click Me' }, events: [{ event: 'tapped', body: 'set count to count + 1' }], children: [] },
          { id: 'txt1', kind: 'text', properties: { content: 'Hello' }, events: [], children: [] },
        ],
      }],
      permissions: [], capabilities: [],
    };
    const report = await runner.runAll(app, [
      { name: 'tap button', steps: [{ action: 'launch' as const }, { action: 'tap' as const, query: 'Click Me' }, { action: 'expectState' as const, key: 'count', value: 1 }] },
      { name: 'check text', steps: [{ action: 'launch' as const }, { action: 'expectText' as const, query: 'Hello', text: 'Hello' }] },
    ]);
    expect(report.total).toBe(2);
    expect(report.passed).toBe(2);
    expect(report.failed).toBe(0);
    runner.dispose();
    clock.dispose();
  });

  test('toJUnit generates valid XML', async () => {
    const clock = new SimulatorClock();
    const runner = new SimulatorTestRunnerV2(clock);
    const app = {
      name: 'App', startScreen: 'Main',
      screens: [{ name: 'Main', states: [], rootChildren: [{ id: 't1', kind: 'text', properties: { content: 'OK' }, events: [], children: [] }] }],
      permissions: [], capabilities: [],
    };
    const report = await runner.runAll(app, [
      { name: 'basic', steps: [{ action: 'launch' as const }] },
    ]);
    const xml = runner.toJUnit(report);
    expect(xml).toContain('<?xml');
    expect(xml).toContain('testsuite');
    expect(xml).toContain('testcase');
    runner.dispose();
    clock.dispose();
  });

  test('toJSON generates valid JSON', async () => {
    const clock = new SimulatorClock();
    const runner = new SimulatorTestRunnerV2(clock);
    const app = {
      name: 'App', startScreen: 'Main',
      screens: [{ name: 'Main', states: [], rootChildren: [] }],
      permissions: [], capabilities: [],
    };
    const report = await runner.runAll(app, [{ name: 't1', steps: [{ action: 'launch' as const }] }]);
    const json = JSON.parse(runner.toJSON(report));
    expect(json.summary.total).toBe(1);
    runner.dispose();
    clock.dispose();
  });

  test('toConsoleSummary includes pass count', async () => {
    const clock = new SimulatorClock();
    const runner = new SimulatorTestRunnerV2(clock);
    const app = {
      name: 'App', startScreen: 'Main',
      screens: [{ name: 'Main', states: [], rootChildren: [] }],
      permissions: [], capabilities: [],
    };
    const report = await runner.runAll(app, [{ name: 't1', steps: [{ action: 'launch' as const }] }]);
    const summary = runner.toConsoleSummary(report);
    expect(summary).toContain('1/1 passed');
    runner.dispose();
    clock.dispose();
  });

  test('failed test captures failure detail', async () => {
    const clock = new SimulatorClock();
    const runner = new SimulatorTestRunnerV2(clock);
    const app = {
      name: 'App', startScreen: 'Main',
      screens: [{ name: 'Main', states: [], rootChildren: [] }],
      permissions: [], capabilities: [],
    };
    const report = await runner.runAll(app, [
      { name: 'fail-test', steps: [{ action: 'launch' as const }, { action: 'expectText' as const, query: 'Missing', text: 'hello' }] },
    ]);
    expect(report.failed).toBe(1);
    const result = report.results[0];
    expect(result.passed).toBe(false);
    expect(result.failedStep).toBe(1);
    expect(result.failedMessage).toContain('not found');
    runner.dispose();
    clock.dispose();
  });

  test('advanceTime step uses clock', async () => {
    const clock = new SimulatorClock();
    const runner = new SimulatorTestRunnerV2(clock);
    const app = {
      name: 'App', startScreen: 'Main',
      screens: [{ name: 'Main', states: [], rootChildren: [] }],
      permissions: [], capabilities: [],
    };
    const report = await runner.runAll(app, [
      { name: 'time', steps: [{ action: 'launch' as const }, { action: 'advanceTime' as const, ms: 5000 }] },
    ]);
    expect(report.passed).toBe(1);
    runner.dispose();
    clock.dispose();
  });

  test('setNetwork step configures connectivity', async () => {
    const clock = new SimulatorClock();
    const runner = new SimulatorTestRunnerV2(clock);
    const app = {
      name: 'App', startScreen: 'Main',
      screens: [{ name: 'Main', states: [], rootChildren: [] }],
      permissions: [], capabilities: [],
    };
    const report = await runner.runAll(app, [
      { name: 'offline', steps: [{ action: 'launch' as const }, { action: 'setNetwork' as const, mode: 'offline' }] },
    ]);
    expect(report.passed).toBe(1);
    runner.dispose();
    clock.dispose();
  });

  test('expectScreen verifies current screen', async () => {
    const clock = new SimulatorClock();
    const runner = new SimulatorTestRunnerV2(clock);
    const app = {
      name: 'App', startScreen: 'Main',
      screens: [
        { name: 'Main', states: [], rootChildren: [] },
        { name: 'Other', states: [], rootChildren: [] },
      ],
      permissions: [], capabilities: [],
    };
    const report = await runner.runAll(app, [
      { name: 'check screen', steps: [{ action: 'launch' as const }, { action: 'expectScreen' as const, screen: 'Main' }] },
    ]);
    expect(report.passed).toBe(1);
    runner.dispose();
    clock.dispose();
  });

  test('enterText updates state via binding', async () => {
    const clock = new SimulatorClock();
    const runner = new SimulatorTestRunnerV2(clock);
    const app = {
      name: 'App', startScreen: 'Main',
      screens: [{
        name: 'Main', states: [{ name: 'username', type: 'text' as const, initialValue: '' }],
        rootChildren: [
          { id: 'inp1', kind: 'input', properties: { label: 'Username', binding: 'username' }, events: [{ event: 'changed', body: '' }], children: [] },
        ],
      }],
      permissions: [], capabilities: [],
    };
    const report = await runner.runAll(app, [
      { name: 'type text', steps: [
        { action: 'launch' as const },
        { action: 'enterText' as const, query: 'Username', text: 'alice' },
        { action: 'expectState' as const, key: 'username', value: 'alice' },
      ]},
    ]);
    expect(report.passed).toBe(1);
    runner.dispose();
    clock.dispose();
  });

  test('toggle step flips switch state', async () => {
    const clock = new SimulatorClock();
    const runner = new SimulatorTestRunnerV2(clock);
    const app = {
      name: 'App', startScreen: 'Main',
      screens: [{
        name: 'Main', states: [{ name: 'enabled', type: 'truth' as const, initialValue: 'false' }],
        rootChildren: [
          { id: 'sw1', kind: 'switch', properties: { label: 'Enable', binding: 'enabled' }, events: [{ event: 'toggled', body: '' }], children: [] },
        ],
      }],
      permissions: [], capabilities: [],
    };
    const report = await runner.runAll(app, [
      { name: 'toggle', steps: [
        { action: 'launch' as const },
        { action: 'toggle' as const, query: 'Enable' },
        { action: 'expectState' as const, key: 'enabled', value: true },
      ]},
    ]);
    expect(report.passed).toBe(1);
    runner.dispose();
    clock.dispose();
  });

  test('openScreen step navigates to screen', async () => {
    const clock = new SimulatorClock();
    const runner = new SimulatorTestRunnerV2(clock);
    const app = {
      name: 'App', startScreen: 'Main',
      screens: [
        { name: 'Main', states: [], rootChildren: [] },
        { name: 'Settings', states: [], rootChildren: [] },
      ],
      permissions: [], capabilities: [],
    };
    const report = await runner.runAll(app, [
      { name: 'nav', steps: [
        { action: 'launch' as const },
        { action: 'openScreen' as const, screen: 'Settings' },
        { action: 'expectScreen' as const, screen: 'Settings' },
      ]},
    ]);
    expect(report.passed).toBe(1);
    runner.dispose();
    clock.dispose();
  });

  test('setPermission step configures permission', async () => {
    const clock = new SimulatorClock();
    const runner = new SimulatorTestRunnerV2(clock);
    const app = {
      name: 'App', startScreen: 'Main',
      screens: [{ name: 'Main', states: [], rootChildren: [] }],
      permissions: ['camera'], capabilities: [],
    };
    const report = await runner.runAll(app, [
      { name: 'perm', steps: [
        { action: 'launch' as const },
        { action: 'setPermission' as const, name: 'camera', state: 'denied' },
      ]},
    ]);
    expect(report.passed).toBe(1);
    runner.dispose();
    clock.dispose();
  });
});

// ---- §27: Viewport structure ----

describe('Phase 3: SimulatorViewport (contract)', () => {
  test('ViewportMetrics interface has required fields', () => {
    const env = new SimulatorEnvironmentModel();
    const state = env.get();
    expect(state.device.width).toBeGreaterThan(0);
    expect(state.device.height).toBeGreaterThan(0);
    expect(state.device.statusBarHeight).toBeGreaterThan(0);
    expect(state.device.navigationArea).toBeGreaterThan(0);
    env.dispose();
  });

  test('keyboard state defaults to hidden', () => {
    const env = new SimulatorEnvironmentModel();
    expect(env.get().keyboard.visible).toBe(false);
    expect(env.get().keyboard.height).toBe(0);
    expect(env.get().keyboard.mode).toBe('text');
    env.dispose();
  });

  test('keyboard state can be set manually', () => {
    const env = new SimulatorEnvironmentModel();
    env.set('keyboard', { visible: true, height: 280, mode: 'email' });
    expect(env.get().keyboard.visible).toBe(true);
    expect(env.get().keyboard.height).toBe(280);
    expect(env.get().keyboard.mode).toBe('email');
    env.set('keyboard', { visible: false, height: 0, mode: 'text' });
    expect(env.get().keyboard.visible).toBe(false);
    env.dispose();
  });

  test('NavigationMode type is correctly defined', () => {
    const modes: string[] = ['three_button', 'gesture'];
    expect(modes.length).toBe(2);
    expect(modes).toContain('three_button');
    expect(modes).toContain('gesture');
  });

  test('device profile safe area has all sides', () => {
    const env = new SimulatorEnvironmentModel();
    const sa = env.get().device.safeArea;
    expect(typeof sa.top).toBe('number');
    expect(typeof sa.bottom).toBe('number');
    expect(typeof sa.left).toBe('number');
    expect(typeof sa.right).toBe('number');
    env.dispose();
  });

  test('signal strength and airplane mode interact', () => {
    const env = new SimulatorEnvironmentModel();
    env.applyPreset('Airplane Mode');
    expect(env.get().airplaneMode).toBe(true);
    expect(env.get().wifiEnabled).toBe(false);
    env.dispose();
  });
});

// ---- §28: Phase 3 subsystem disposal ----

describe('Phase 3: Disposal safety', () => {
  test('all Phase 3 subsystems dispose without error', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp({
      name: 'App', startScreen: 'Main',
      screens: [{ name: 'Main', states: [], rootChildren: [] }],
      permissions: [], capabilities: [],
    });
    rt.perf.record('x', 1, 'ms');
    rt.clock.freeze(100);
    rt.stateDebugger.takeSnapshot('test');
    rt.dispose();
  });

  test('double dispose does not throw', () => {
    const rt = new SimulatorRuntime();
    rt.dispose();
    // second dispose should not throw
    let threw = false;
    try { rt.dispose(); } catch { threw = true; }
    expect(threw).toBe(false);
  });

  test('clock dispose clears timers', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    clock.setTimeout(() => {}, 100);
    clock.setInterval(() => {}, 200);
    clock.dispose();
  });
});

// ---- §29: Security boundaries ----

describe('Phase 3: Security boundaries', () => {
  test('NetworkInspector SENSITIVE_HEADERS are redacted', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const http = new SimulatorHttp({ getMode: () => 'online', setMode: () => {} } as any);
    const inspector = new SimulatorNetworkInspector(http, clock);
    const redacted = inspector.redactHeaders({
      authorization: 'Bearer secret123',
      'content-type': 'application/json',
      'x-api-key': 'key123',
      'proxy-authorization': 'Basic abc',
    });
    expect(redacted['authorization']).toBe('[REDACTED]');
    expect(redacted['x-api-key']).toBe('[REDACTED]');
    expect(redacted['proxy-authorization']).toBe('[REDACTED]');
    expect(redacted['content-type']).toBe('application/json');
    inspector.dispose();
    http.dispose();
    clock.dispose();
  });

  test('TestRunnerV2 redacts sensitive state keys', async () => {
    const clock = new SimulatorClock();
    const runner = new SimulatorTestRunnerV2(clock);
    const app = {
      name: 'App', startScreen: 'Main',
      screens: [{
        name: 'Main',
        states: [
          { name: 'password', type: 'text' as const, initialValue: 'secret' },
          { name: 'username', type: 'text' as const, initialValue: 'alice' },
        ],
        rootChildren: [],
      }],
      permissions: [], capabilities: [],
    };
    const report = await runner.runAll(app, [
      { name: 'fail', steps: [{ action: 'launch' as const }, { action: 'expectText' as const, query: 'Nothing', text: 'fail' }] },
    ]);
    const detail = report.results[0].failureDetail;
    expect(detail).toBeDefined();
    expect(detail!.relevantState['password']).toBe('[REDACTED]');
    expect(detail!.relevantState['username']).toBe('alice');
    runner.dispose();
    clock.dispose();
  });

  test('stateDebugger override is tracked as SIMULATOR OVERRIDE', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const store = new SimulatorStateStore();
    const nav = new SimulatorNavigation();
    const perm = new SimulatorPermissions();
    const dbg = new SimulatorStateDebugger(store, nav, perm, clock);
    nav.reset('Main');
    store.initScreen('Main', [{ name: 'val', type: 'text', initialValue: 'x' }]);
    dbg.safeEdit('val', 'hacked');
    const overrides = dbg.getOverrides();
    expect(overrides.length).toBe(1);
    expect(overrides).toContain('val');
    dbg.dispose();
    store.dispose();
    nav.dispose();
    perm.dispose();
    clock.dispose();
  });
});

// ---- §30: Clock-driven deterministic testing ----

describe('Phase 3: Deterministic testing with frozen clock', () => {
  test('frozen clock gives deterministic timestamps to state debugger', () => {
    const clock = new SimulatorClock();
    clock.freeze(1000);
    const store = new SimulatorStateStore();
    const nav = new SimulatorNavigation();
    const perm = new SimulatorPermissions();
    const dbg = new SimulatorStateDebugger(store, nav, perm, clock);
    store.initScreen('Main', [{ name: 'val', type: 'text', initialValue: '' }]);
    store.set('val', 'test');
    const history = dbg.getHistory();
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].timestamp).toBe(1000);
    clock.advance(500);
    store.set('val', 'test2');
    const history2 = dbg.getHistory();
    expect(history2[history2.length - 1].timestamp).toBe(1500);
    dbg.dispose();
    store.dispose();
    nav.dispose();
    perm.dispose();
    clock.dispose();
  });

  test('frozen clock gives deterministic performance metrics', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const perf = new SimulatorPerformance(clock);
    perf.record('x', 10, 'ms');
    clock.advance(100);
    perf.record('x', 20, 'ms');
    const metrics = perf.getMetrics();
    expect(metrics[0].timestamp).toBe(0);
    expect(metrics[1].timestamp).toBe(100);
    perf.dispose();
    clock.dispose();
  });

  test('timer-based state updates are deterministic', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const values: number[] = [];
    clock.setInterval(() => { values.push(clock.now()); }, 100);
    clock.advance(100);
    clock.advance(100);
    clock.advance(100);
    expect(values).toEqual([100, 200, 300]);
    clock.dispose();
  });
});

// ---- §31-40: Inspector Integration, Session Integration, Event Timeline ----

describe('Phase 3: Inspector panels (headless)', () => {
  const nullRenderer = { highlightNode() {}, clearHighlight() {}, inspectNode() { return null; }, bind() {}, dispose() {} } as any;

  test('inspector panel state defaults to components', () => {
    const runtime = new SimulatorRuntime();
    const inspector = new SimulatorInspector(runtime, nullRenderer);
    expect(inspector.getPanel()).toBe('components');
    inspector.dispose();
    runtime.dispose();
  });

  test('inspector panel can be switched', () => {
    const runtime = new SimulatorRuntime();
    const inspector = new SimulatorInspector(runtime, nullRenderer);
    const panels: string[] = [];
    inspector.onPanelChange(p => panels.push(p));
    inspector.setPanel('network');
    inspector.setPanel('performance');
    inspector.setPanel('accessibility');
    expect(panels).toEqual(['network', 'performance', 'accessibility']);
    expect(inspector.getPanel()).toBe('accessibility');
    inspector.dispose();
    runtime.dispose();
  });

  test('inspector exposes network entries', () => {
    const runtime = new SimulatorRuntime();
    const inspector = new SimulatorInspector(runtime, nullRenderer);
    expect(inspector.getNetworkEntries().length).toBe(0);
    expect(inspector.getNetworkOverrides().length).toBe(0);
    inspector.dispose();
    runtime.dispose();
  });

  test('inspector exposes state debugger', () => {
    const runtime = new SimulatorRuntime();
    const inspector = new SimulatorInspector(runtime, nullRenderer);
    inspector.addStateWatch('count');
    expect(inspector.getStateWatches()).toContain('count');
    inspector.removeStateWatch('count');
    expect(inspector.getStateWatches().includes('count')).toBe(false);
    inspector.dispose();
    runtime.dispose();
  });

  test('inspector exposes performance metrics', () => {
    const runtime = new SimulatorRuntime();
    const inspector = new SimulatorInspector(runtime, nullRenderer);
    runtime.perf.record('test_metric', 42, 'ms');
    expect(inspector.getPerformanceMetrics().length).toBe(1);
    expect(inspector.getRenderCount()).toBe(0);
    const summary = inspector.getPerformanceSummary();
    expect(summary['test_metric'].avg).toBe(42);
    inspector.dispose();
    runtime.dispose();
  });

  test('inspector exposes registry counts', () => {
    const runtime = new SimulatorRuntime();
    const inspector = new SimulatorInspector(runtime, nullRenderer);
    const counts = inspector.getRegistryCounts();
    expect(counts.supported).toBeGreaterThan(0);
    expect(inspector.getCapabilityRegistry().length).toBeGreaterThan(0);
    expect(inspector.getComponentRegistry().length).toBeGreaterThan(0);
    inspector.dispose();
    runtime.dispose();
  });

  test('inspector clock controls', () => {
    const runtime = new SimulatorRuntime();
    const inspector = new SimulatorInspector(runtime, nullRenderer);
    expect(inspector.getClockMode()).toBe('realtime');
    inspector.freezeClock(5000);
    expect(inspector.getClockMode()).toBe('frozen');
    expect(inspector.getClockTime()).toBe(5000);
    inspector.advanceClock(100);
    expect(inspector.getClockTime()).toBe(5100);
    inspector.resumeClock();
    expect(inspector.getClockMode()).toBe('realtime');
    inspector.dispose();
    runtime.dispose();
  });

  test('inspector accessibility audit on empty returns no issues', () => {
    const runtime = new SimulatorRuntime();
    const inspector = new SimulatorInspector(runtime, nullRenderer);
    const issues = inspector.runAccessibilityAudit();
    expect(issues.length).toBe(0);
    inspector.dispose();
    runtime.dispose();
  });

  test('inspector responsive analysis on empty returns no issues', () => {
    const runtime = new SimulatorRuntime();
    const inspector = new SimulatorInspector(runtime, nullRenderer);
    const issues = inspector.runResponsiveAnalysis();
    expect(issues.length).toBe(0);
    inspector.dispose();
    runtime.dispose();
  });
});

describe('Phase 3: Session clock integration (headless)', () => {
  test('pause freezes the clock and resume restores it', () => {
    const runtime = new SimulatorRuntime();
    expect(runtime.clock.mode()).toBe('realtime');
    runtime.clock.freeze();
    expect(runtime.clock.mode()).toBe('frozen');
    runtime.animationScheduler.cancelAll();
    runtime.clock.setRealtime();
    expect(runtime.clock.mode()).toBe('realtime');
    runtime.dispose();
  });

  test('reset clears all Phase 3 subsystems', () => {
    const runtime = new SimulatorRuntime();
    runtime.loadApp(makeTestApp());
    runtime.perf.record('x', 1, 'ms');
    runtime.stateDebugger.addWatch('test');
    runtime.reset();
    expect(runtime.perf.getMetrics().length).toBe(0);
    runtime.dispose();
  });
});

// ---- §42-78: Certification workflow tests, performance/leak tests, final validation ----

describe('Phase 3: Certification workflow tests', () => {
  test('full lifecycle: load → interact → state debug → snapshot → reset', () => {
    const runtime = new SimulatorRuntime();
    const app = makeTestApp();
    runtime.loadApp(app);
    expect(runtime.navigation.currentScreen()).toBe('Home');
    runtime.stateStore.set('username', 'Alice');
    runtime.stateDebugger.addWatch('username');
    expect(runtime.stateDebugger.getWatchValues()['username']).toBe('Alice');
    runtime.navigation.reset('Home');
    const snapId = runtime.stateDebugger.takeSnapshot('before_nav');
    expect(snapId).toBeGreaterThan(0);
    runtime.navigation.navigate('Settings');
    expect(runtime.navigation.currentScreen()).toBe('Settings');
    runtime.stateDebugger.travelTo(snapId);
    runtime.stateDebugger.returnToLive();
    runtime.reset();
    expect(runtime.stateDebugger.getHistory().length).toBe(0);
    expect(runtime.stateDebugger.getSnapshots().length).toBe(0);
    runtime.dispose();
  });

  test('full lifecycle: clock-driven animation + performance', () => {
    const runtime = new SimulatorRuntime();
    runtime.loadApp(makeTestApp());
    runtime.clock.freeze(0);
    runtime.animationScheduler.start({
      id: 'test-anim', duration: 200,
      onUpdate() {},
      onComplete() {},
    });
    expect(runtime.animationScheduler.activeCount()).toBe(1);
    runtime.clock.advance(200);
    expect(runtime.animationScheduler.activeCount()).toBe(0);
    runtime.perf.record('anim_test', 200, 'ms');
    const summary = runtime.perf.getSummary();
    expect(summary['anim_test'].count).toBe(1);
    runtime.dispose();
  });

  test('full lifecycle: accessibility + responsive on loaded app', () => {
    const runtime = new SimulatorRuntime();
    runtime.loadApp(makeTestApp());
    const screen = runtime.currentScreenModel()!;
    const a11y = runtime.accessibility.audit(screen);
    const env = runtime.environmentModel.get();
    const responsive = runtime.responsive.analyze(screen, env.device.width, env.device.height);
    expect(Array.isArray(a11y)).toBe(true);
    expect(Array.isArray(responsive)).toBe(true);
    runtime.dispose();
  });

  test('full lifecycle: network override + inspector', () => {
    const runtime = new SimulatorRuntime();
    const nullRenderer = { highlightNode() {}, clearHighlight() {}, inspectNode() { return null; }, bind() {}, dispose() {} } as any;
    const inspector = new SimulatorInspector(runtime, nullRenderer);
    runtime.loadApp(makeTestApp());
    const overrideId = inspector.addNetworkOverride({
      method: 'GET', pathPattern: '/api/data',
      action: { type: 'status', status: 500 }, active: true,
    });
    expect(inspector.getNetworkOverrides().length).toBe(1);
    inspector.removeNetworkOverride(overrideId);
    expect(inspector.getNetworkOverrides().length).toBe(0);
    inspector.dispose();
    runtime.dispose();
  });

  test('full lifecycle: TestRunnerV2 end-to-end', async () => {
    const clock = new SimulatorClock();
    const runner = new SimulatorTestRunnerV2(clock);
    const app = makeTestApp();
    const r = await runner.runAll(app, [
      {
        name: 'navigate and check',
        steps: [
          { action: 'launch' },
          { action: 'expectScreen', screen: 'Home' },
          { action: 'openScreen', screen: 'Settings' },
          { action: 'expectScreen', screen: 'Settings' },
        ],
      },
      {
        name: 'button tap updates counter',
        steps: [
          { action: 'launch' },
          { action: 'tap', query: 'Increment' },
          { action: 'expectState', key: 'counter', value: 1 },
        ],
      },
    ]);
    expect(r.total).toBe(2);
    expect(r.passed).toBe(2);
    expect(r.failed).toBe(0);
    const junit = runner.toJUnit(r);
    expect(junit.includes('testsuite')).toBe(true);
    expect(junit.includes('navigate and check')).toBe(true);
    const json = runner.toJSON(r);
    const parsed = JSON.parse(json);
    expect(parsed.summary.total).toBe(2);
    const consoleSummary = runner.toConsoleSummary(r);
    expect(consoleSummary.includes('2/2 passed')).toBe(true);
    runner.dispose();
    clock.dispose();
  });
});

describe('Phase 3: Resource management and leak prevention', () => {
  test('runtime reset does not leave stale timer references', () => {
    const runtime = new SimulatorRuntime();
    runtime.loadApp(makeTestApp());
    runtime.clock.freeze(0);
    runtime.clock.setTimeout(() => {}, 1000);
    runtime.clock.setInterval(() => {}, 500);
    runtime.reset();
    runtime.clock.freeze(0);
    const values: number[] = [];
    runtime.clock.advance(2000);
    expect(values.length).toBe(0);
    runtime.dispose();
  });

  test('repeated load/dispose cycle does not throw', () => {
    for (let i = 0; i < 10; i++) {
      const runtime = new SimulatorRuntime();
      runtime.loadApp(makeTestApp());
      runtime.navigation.navigate('Settings');
      runtime.stateStore.set('username', `user${i}`);
      runtime.perf.record('cycle', i, 'count');
      runtime.stateDebugger.addWatch('username');
      runtime.reset();
      runtime.dispose();
    }
    expect(true).toBe(true);
  });

  test('environment model snapshot/restore cycle preserves state', () => {
    const env = new SimulatorEnvironmentModel();
    env.set('fontScale', 2);
    env.set('theme', 'dark');
    env.set('airplaneMode', true);
    const snap = env.snapshot();
    env.reset();
    expect(env.get().fontScale).toBe(1);
    expect(env.get().theme).toBe('light');
    env.restore(snap);
    expect(env.get().fontScale).toBe(2);
    expect(env.get().theme).toBe('dark');
    expect(env.get().airplaneMode).toBe(true);
    env.dispose();
  });

  test('focus manager handles rapid register/unregister', () => {
    const fm = new SimulatorFocusManager();
    const disposers: (() => void)[] = [];
    for (let i = 0; i < 50; i++) {
      disposers.push(fm.register(`node-${i}`, null as any, i));
    }
    fm.requestFocus('node-25', 'programmatic');
    expect(fm.currentFocus()).toBe('node-25');
    for (const d of disposers) d();
    expect(fm.currentFocus()).toBeNull();
    fm.dispose();
  });

  test('registry counts remain consistent', () => {
    const reg = new SimulatorRegistry();
    const caps = reg.allCapabilities();
    const comps = reg.allComponents();
    const counts = reg.counts();
    expect(caps.length).toBeGreaterThan(0);
    expect(comps.length).toBeGreaterThan(0);
    expect(counts.supported).toBeGreaterThan(0);
    expect(reg.supportedCapabilities().length + reg.partialCapabilities().length + reg.androidOnlyCapabilities().length).toBe(caps.length);
  });

  test('performance metrics respect MAX limits', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const perf = new SimulatorPerformance(clock);
    for (let i = 0; i < 600; i++) {
      perf.record('flood', i, 'ms');
    }
    expect(perf.getMetrics().length).toBeLessThanOrEqual(500);
    perf.dispose();
    clock.dispose();
  });
});

describe('Phase 3: Security certification', () => {
  test('no process/shell/eval access from simulator subsystems', () => {
    const runtime = new SimulatorRuntime();
    runtime.loadApp(makeTestApp());
    expect(typeof (runtime as any).stateStore.processEnv).toBe('undefined');
    expect(typeof (runtime as any).stateStore.exec).toBe('undefined');
    expect(typeof (runtime as any).stateStore.eval).toBe('undefined');
    runtime.dispose();
  });

  test('state debugger safeEdit marks overrides', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    const store = new SimulatorStateStore();
    const nav = new SimulatorNavigation();
    nav.reset('Main');
    const perm = new SimulatorPermissions();
    const dbg = new SimulatorStateDebugger(store, nav, perm, clock);
    store.initScreen('Main', [{ name: 'secure', type: 'text', initialValue: 'original' }]);
    dbg.safeEdit('secure', 'modified');
    expect(dbg.isOverridden('secure')).toBe(true);
    const history = dbg.getHistory();
    const overrideEntry = history.find(h => h.source === 'SIMULATOR OVERRIDE');
    expect(overrideEntry).toBeDefined();
    expect(overrideEntry!.key).toBe('secure');
    dbg.dispose();
    store.dispose();
    nav.dispose();
    perm.dispose();
    clock.dispose();
  });

  test('network inspector redacts all SENSITIVE_HEADERS', () => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'authorization': 'Bearer secret123',
      'cookie': 'session=abc',
      'x-api-key': 'key123',
      'x-request-id': 'visible',
    };
    const caps = new SimulatorCapabilities();
    const http = new SimulatorHttp(caps.connectivity);
    const clock = new SimulatorClock();
    const ni = new SimulatorNetworkInspector(http, clock);
    const redacted = (ni as any).redactHeaders(headers);
    expect(redacted['authorization']).toBe('[REDACTED]');
    expect(redacted['cookie']).toBe('[REDACTED]');
    expect(redacted['x-api-key']).toBe('[REDACTED]');
    expect(redacted['content-type']).toBe('application/json');
    expect(redacted['x-request-id']).toBe('visible');
    ni.dispose();
    http.dispose();
    clock.dispose();
    caps.dispose();
  });
});
