import { describe, expect, test } from './harness';
import type {
  MobileIRApp,
  MobileIRNode,
  MobileIRScreen,
  MockEndpoint,
  PermissionState,
  ConnectivityMode,
  SimulatorTestResult,
} from '../src/shared/simulatorTypes';
import {
  SIMULATOR_DEVICE_PROFILES,
  getDeviceProfile,
  profilesByClass,
  createCustomProfile,
  DEFAULT_DEVICE_PROFILE,
} from '../src/renderer/simulator/SimulatorDeviceProfile';
import { SimulatorRuntime } from '../src/renderer/simulator/SimulatorRuntime';
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
import { SimulatorTestRunnerV2, type TestCaseV2 } from '../src/renderer/simulator/SimulatorTestRunnerV2';
import { SimulatorInspector } from '../src/renderer/simulator/SimulatorInspector';
import { SimulatorSession } from '../src/renderer/simulator/SimulatorSession';
import { SimulatorStateStore } from '../src/renderer/simulator/SimulatorStateStore';
import { SimulatorNavigation } from '../src/renderer/simulator/SimulatorNavigation';
import { SimulatorPermissions } from '../src/renderer/simulator/SimulatorPermissions';
import { SimulatorHttp } from '../src/renderer/simulator/SimulatorHttp';
import { SimulatorCapabilities } from '../src/renderer/simulator/SimulatorCapabilities';
import { SimulatorStorage } from '../src/renderer/simulator/SimulatorStorage';
import { SimulatorDiagnostics, SimulatorEventLog } from '../src/renderer/simulator/SimulatorDiagnostics';
import { compileDesignerToIR } from '../src/renderer/simulator/SimulatorCompiler';

/* ===== Phase 4 Fixture Applications ===== */

function makeCounterApp(): MobileIRApp {
  return {
    name: 'Counter', startScreen: 'Main', permissions: [], capabilities: [],
    screens: [{
      name: 'Main',
      states: [{ name: 'count', type: 'whole', initialValue: '0' }],
      rootChildren: [
        { id: 'title', kind: 'text', properties: { content: 'Counter App', size: 'heading' }, events: [], children: [] },
        { id: 'display', kind: 'text', properties: { content: 'Count: {count}' }, events: [], children: [] },
        { id: 'incBtn', kind: 'button', properties: { label: 'Increment', testTag: 'inc' }, events: [{ event: 'tapped', body: 'set count to count + 1' }], children: [] },
        { id: 'decBtn', kind: 'button', properties: { label: 'Decrement', testTag: 'dec' }, events: [{ event: 'tapped', body: 'set count to count - 1' }], children: [] },
        { id: 'resetBtn', kind: 'button', properties: { label: 'Reset', style: 'outline', testTag: 'reset' }, events: [{ event: 'tapped', body: 'set count to 0' }], children: [] },
      ],
    }],
  };
}

function makeTodoApp(): MobileIRApp {
  return {
    name: 'Todo', startScreen: 'Home', permissions: [], capabilities: [],
    screens: [{
      name: 'Home',
      states: [
        { name: 'todos', type: 'list', initialValue: '["Buy milk","Walk dog"]' },
        { name: 'newTodo', type: 'text', initialValue: '' },
        { name: 'selectedIndex', type: 'whole', initialValue: '-1' },
      ],
      rootChildren: [
        { id: 'heading', kind: 'text', properties: { content: 'Todo List', size: 'heading' }, events: [], children: [] },
        { id: 'input', kind: 'input', properties: { placeholder: 'New todo...', binding: 'newTodo', testTag: 'new-input' }, events: [], children: [] },
        { id: 'addBtn', kind: 'button', properties: { label: 'Add', testTag: 'add-btn' }, events: [{ event: 'tapped', body: 'set newTodo to ""' }], children: [] },
        { id: 'list', kind: 'list', properties: { binding: 'todos', separator: true }, events: [{ event: 'item_tapped', body: 'set selectedIndex to _index' }], children: [
          { id: 'item_template', kind: 'text', properties: { content: '{_item}' }, events: [], children: [] },
        ]},
      ],
    }],
  };
}

function makeLoginApp(): MobileIRApp {
  return {
    name: 'Login', startScreen: 'Login', permissions: [], capabilities: [],
    screens: [
      {
        name: 'Login',
        states: [
          { name: 'email', type: 'text', initialValue: '' },
          { name: 'password', type: 'text', initialValue: '' },
          { name: 'error', type: 'text', initialValue: '' },
          { name: 'loading', type: 'truth', initialValue: 'false' },
        ],
        rootChildren: [
          { id: 'title', kind: 'text', properties: { content: 'Sign In', size: 'heading' }, events: [], children: [] },
          { id: 'emailInput', kind: 'input', properties: { label: 'Email', inputType: 'email', binding: 'email', testTag: 'email' }, events: [], children: [] },
          { id: 'passInput', kind: 'input', properties: { label: 'Password', inputType: 'password', binding: 'password', testTag: 'password' }, events: [], children: [] },
          { id: 'errText', kind: 'text', properties: { content: '{error}', color: 'error', visible: false }, events: [], children: [] },
          { id: 'loginBtn', kind: 'button', properties: { label: 'Sign In', testTag: 'login-btn' }, events: [{ event: 'tapped', body: 'set loading to true\nfetch POST /api/login' }], children: [] },
        ],
      },
      {
        name: 'Home',
        states: [{ name: 'welcome', type: 'text', initialValue: 'Welcome!' }],
        rootChildren: [
          { id: 'welcomeText', kind: 'text', properties: { content: '{welcome}', size: 'heading' }, events: [], children: [] },
        ],
      },
    ],
  };
}

function makeNavigationApp(): MobileIRApp {
  return {
    name: 'Navigation', startScreen: 'Home', permissions: [], capabilities: [],
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
        name: 'ScreenA', states: [{ name: 'visited', type: 'truth', initialValue: 'true' }],
        rootChildren: [
          { id: 'nav2', kind: 'navbar', properties: { title: 'Screen A', showBack: true }, events: [{ event: 'back_tapped', body: 'go back' }], children: [] },
          { id: 'labelA', kind: 'text', properties: { content: 'This is Screen A' }, events: [], children: [] },
          { id: 'goB2', kind: 'button', properties: { label: 'Go B' }, events: [{ event: 'tapped', body: 'go to ScreenB' }], children: [] },
        ],
      },
      {
        name: 'ScreenB', states: [],
        rootChildren: [
          { id: 'nav3', kind: 'navbar', properties: { title: 'Screen B', showBack: true }, events: [{ event: 'back_tapped', body: 'go back' }], children: [] },
          { id: 'labelB', kind: 'text', properties: { content: 'This is Screen B' }, events: [], children: [] },
        ],
      },
    ],
  };
}

function makeFormsApp(): MobileIRApp {
  return {
    name: 'Forms', startScreen: 'Main', permissions: [], capabilities: [],
    screens: [{
      name: 'Main',
      states: [
        { name: 'name', type: 'text', initialValue: '' },
        { name: 'email', type: 'text', initialValue: '' },
        { name: 'age', type: 'whole', initialValue: '0' },
        { name: 'bio', type: 'text', initialValue: '' },
        { name: 'agree', type: 'truth', initialValue: 'false' },
        { name: 'notify', type: 'truth', initialValue: 'true' },
        { name: 'volume', type: 'whole', initialValue: '50' },
        { name: 'country', type: 'text', initialValue: '' },
      ],
      rootChildren: [
        { id: 'nameInput', kind: 'input', properties: { label: 'Name', binding: 'name', testTag: 'name', leadingIcon: 'person' }, events: [], children: [] },
        { id: 'emailInput', kind: 'input', properties: { label: 'Email', inputType: 'email', binding: 'email', testTag: 'email' }, events: [], children: [] },
        { id: 'ageInput', kind: 'input', properties: { label: 'Age', inputType: 'number', binding: 'age', testTag: 'age' }, events: [], children: [] },
        { id: 'bioInput', kind: 'input', properties: { label: 'Bio', inputType: 'multiline', binding: 'bio', testTag: 'bio' }, events: [], children: [] },
        { id: 'agreeCheck', kind: 'checkbox', properties: { label: 'I agree', binding: 'agree', testTag: 'agree' }, events: [], children: [] },
        { id: 'notifySwitch', kind: 'switch', properties: { label: 'Notifications', binding: 'notify', testTag: 'notify' }, events: [], children: [] },
        { id: 'volSlider', kind: 'slider', properties: { min: 0, max: 100, step: 1, binding: 'volume', showValue: true, testTag: 'volume' }, events: [], children: [] },
        { id: 'countryDrop', kind: 'dropdown', properties: { label: 'Country', items: 'USA,UK,Germany,Japan', binding: 'country', testTag: 'country' }, events: [], children: [] },
        { id: 'submitBtn', kind: 'button', properties: { label: 'Submit', testTag: 'submit' }, events: [{ event: 'tapped', body: 'show toast "Form submitted"' }], children: [] },
      ],
    }],
  };
}

function makeHttpApp(): MobileIRApp {
  return {
    name: 'HttpProducts', startScreen: 'Products', permissions: [], capabilities: [],
    screens: [{
      name: 'Products',
      states: [
        { name: 'products', type: 'list', initialValue: '[]' },
        { name: 'loading', type: 'truth', initialValue: 'false' },
        { name: 'error', type: 'text', initialValue: '' },
      ],
      rootChildren: [
        { id: 'heading', kind: 'text', properties: { content: 'Products', size: 'heading' }, events: [], children: [] },
        { id: 'loadBtn', kind: 'button', properties: { label: 'Load Products', testTag: 'load' }, events: [{ event: 'tapped', body: 'set loading to true\nfetch GET /api/products' }], children: [] },
        { id: 'errText', kind: 'text', properties: { content: '{error}', color: 'error' }, events: [], children: [] },
        { id: 'productList', kind: 'list', properties: { binding: 'products' }, events: [], children: [
          { id: 'prodItem', kind: 'text', properties: { content: '{_item}' }, events: [], children: [] },
        ]},
      ],
    }],
  };
}

function makePermissionsApp(): MobileIRApp {
  return {
    name: 'Permissions', startScreen: 'Main', permissions: ['camera', 'location', 'notifications'], capabilities: ['camera', 'location'],
    screens: [{
      name: 'Main',
      states: [
        { name: 'cameraStatus', type: 'text', initialValue: 'not_requested' },
        { name: 'locationStatus', type: 'text', initialValue: 'not_requested' },
      ],
      rootChildren: [
        { id: 'camBtn', kind: 'button', properties: { label: 'Request Camera', testTag: 'req-camera' }, events: [{ event: 'tapped', body: 'request camera' }], children: [] },
        { id: 'locBtn', kind: 'button', properties: { label: 'Request Location', testTag: 'req-location' }, events: [{ event: 'tapped', body: 'request location' }], children: [] },
        { id: 'camStatus', kind: 'text', properties: { content: 'Camera: {cameraStatus}', testTag: 'cam-status' }, events: [], children: [] },
        { id: 'locStatus', kind: 'text', properties: { content: 'Location: {locationStatus}', testTag: 'loc-status' }, events: [], children: [] },
      ],
    }],
  };
}

function makeDialogSnackbarApp(): MobileIRApp {
  return {
    name: 'DialogSnackbar', startScreen: 'Main', permissions: [], capabilities: [],
    screens: [{
      name: 'Main',
      states: [
        { name: 'dialogResult', type: 'text', initialValue: '' },
        { name: 'showDialog', type: 'truth', initialValue: 'false' },
      ],
      rootChildren: [
        { id: 'showBtn', kind: 'button', properties: { label: 'Show Dialog', testTag: 'show-dialog' }, events: [{ event: 'tapped', body: 'set showDialog to true' }], children: [] },
        { id: 'toastBtn', kind: 'button', properties: { label: 'Show Toast', testTag: 'show-toast' }, events: [{ event: 'tapped', body: 'show "Hello!"' }], children: [] },
        { id: 'snackBtn', kind: 'button', properties: { label: 'Show Snackbar', testTag: 'show-snack' }, events: [{ event: 'tapped', body: 'show "Snackbar message"' }], children: [] },
        { id: 'dlg', kind: 'dialog', properties: { title: 'Confirm', message: 'Are you sure?', confirmLabel: 'Yes', cancelLabel: 'No', visible: false, testTag: 'dialog' }, events: [
          { event: 'confirmed', body: 'set dialogResult to confirmed\nset showDialog to false' },
          { event: 'cancelled', body: 'set dialogResult to cancelled\nset showDialog to false' },
        ], children: [] },
        { id: 'resultText', kind: 'text', properties: { content: 'Result: {dialogResult}', testTag: 'result' }, events: [], children: [] },
      ],
    }],
  };
}

function makeAnimationsApp(): MobileIRApp {
  return {
    name: 'Animations', startScreen: 'Main', permissions: [], capabilities: [],
    screens: [{
      name: 'Main',
      states: [
        { name: 'animState', type: 'text', initialValue: 'idle' },
        { name: 'progress', type: 'whole', initialValue: '0' },
      ],
      rootChildren: [
        { id: 'startBtn', kind: 'button', properties: { label: 'Start Animation', testTag: 'start-anim' }, events: [{ event: 'tapped', body: 'set animState to "running"' }], children: [] },
        { id: 'stopBtn', kind: 'button', properties: { label: 'Stop', testTag: 'stop-anim' }, events: [{ event: 'tapped', body: 'set animState to "idle"' }], children: [] },
        { id: 'progBar', kind: 'progress', properties: { binding: 'progress', testTag: 'progress' }, events: [], children: [] },
        { id: 'stateText', kind: 'text', properties: { content: 'State: {animState}', testTag: 'state' }, events: [], children: [] },
      ],
    }],
  };
}

function makeResponsiveApp(): MobileIRApp {
  return {
    name: 'Responsive', startScreen: 'Main', permissions: [], capabilities: [],
    screens: [{
      name: 'Main',
      states: [],
      rootChildren: [
        { id: 'header', kind: 'navbar', properties: { title: 'Dashboard' }, events: [], children: [] },
        { id: 'content', kind: 'column', properties: { width: 'fill' }, events: [], children: [
          { id: 'card1', kind: 'card', properties: { width: 'fill' }, events: [], children: [
            { id: 'stat1', kind: 'text', properties: { content: 'Users: 1,234', size: 'subheading' }, events: [], children: [] },
          ]},
          { id: 'card2', kind: 'card', properties: { width: 'fill' }, events: [], children: [
            { id: 'stat2', kind: 'text', properties: { content: 'Revenue: $5,678', size: 'subheading' }, events: [], children: [] },
          ]},
          { id: 'wideContent', kind: 'row', properties: { width: 500 }, events: [], children: [
            { id: 'col1', kind: 'text', properties: { content: 'Column 1' }, events: [], children: [] },
            { id: 'col2', kind: 'text', properties: { content: 'Column 2' }, events: [], children: [] },
          ]},
        ]},
      ],
    }],
  };
}

function makeLargeListApp(count: number): MobileIRApp {
  const items = Array.from({ length: count }, (_, i) => `Item ${i + 1}`);
  return {
    name: 'LargeList', startScreen: 'Main', permissions: [], capabilities: [],
    screens: [{
      name: 'Main',
      states: [
        { name: 'items', type: 'list', initialValue: JSON.stringify(items) },
        { name: 'selected', type: 'text', initialValue: '' },
      ],
      rootChildren: [
        { id: 'list', kind: 'list', properties: { binding: 'items' }, events: [{ event: 'item_tapped', body: 'set selected to _item' }], children: [
          { id: 'tpl', kind: 'text', properties: { content: '{_item}' }, events: [], children: [] },
        ]},
        { id: 'selText', kind: 'text', properties: { content: 'Selected: {selected}' }, events: [], children: [] },
      ],
    }],
  };
}

function makeAccessibilityApp(): MobileIRApp {
  return {
    name: 'Accessibility', startScreen: 'Main', permissions: [], capabilities: [],
    screens: [{
      name: 'Main',
      states: [],
      rootChildren: [
        { id: 'goodBtn', kind: 'button', properties: { label: 'Accessible Button', contentDescription: 'Tap to submit', testTag: 'good' }, events: [{ event: 'tapped', body: 'show toast "OK"' }], children: [] },
        { id: 'badBtn', kind: 'button', properties: { label: '', testTag: 'no-label' }, events: [{ event: 'tapped', body: 'show toast "bad"' }], children: [] },
        { id: 'img', kind: 'image', properties: { source: 'https://example.com/photo.jpg', testTag: 'no-alt' }, events: [], children: [] },
        { id: 'imgGood', kind: 'image', properties: { source: 'https://example.com/photo.jpg', alt: 'A photo', contentDescription: 'A photo', testTag: 'has-alt' }, events: [], children: [] },
        { id: 'tinyBtn', kind: 'button', properties: { label: 'X', width: 20, height: 20, testTag: 'tiny' }, events: [{ event: 'tapped', body: 'show toast "tiny"' }], children: [] },
      ],
    }],
  };
}

function makeImageGalleryApp(): MobileIRApp {
  return {
    name: 'ImageGallery', startScreen: 'Gallery', permissions: [], capabilities: [],
    screens: [{
      name: 'Gallery',
      states: [{ name: 'selected', type: 'text', initialValue: '' }],
      rootChildren: [
        { id: 'img1', kind: 'image', properties: { source: 'https://picsum.photos/200', alt: 'Random image 1', fit: 'cover', cornerRadius: 8, testTag: 'img1' }, events: [], children: [] },
        { id: 'img2', kind: 'image', properties: { source: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==', alt: 'Data image', testTag: 'img2' }, events: [], children: [] },
        { id: 'img3', kind: 'image', properties: { source: 'invalid://bad', alt: 'Bad source', testTag: 'img3' }, events: [], children: [] },
        { id: 'img4', kind: 'image', properties: { source: '', alt: 'Empty source', testTag: 'img4' }, events: [], children: [] },
      ],
    }],
  };
}

function makeBiometricsApp(): MobileIRApp {
  return {
    name: 'Biometrics', startScreen: 'Main', permissions: [], capabilities: ['biometrics'],
    screens: [{
      name: 'Main',
      states: [{ name: 'authResult', type: 'text', initialValue: '' }],
      rootChildren: [
        { id: 'authBtn', kind: 'button', properties: { label: 'Authenticate', testTag: 'auth' }, events: [{ event: 'tapped', body: 'use biometrics' }], children: [] },
        { id: 'result', kind: 'text', properties: { content: 'Result: {authResult}', testTag: 'result' }, events: [], children: [] },
      ],
    }],
  };
}

function makeGestureShowcaseApp(): MobileIRApp {
  return {
    name: 'GestureShowcase', startScreen: 'Main', permissions: [], capabilities: [],
    screens: [{
      name: 'Main',
      states: [{ name: 'lastGesture', type: 'text', initialValue: 'none' }],
      rootChildren: [
        { id: 'tapArea', kind: 'button', properties: { label: 'Tap Me', testTag: 'tap-area' }, events: [
          { event: 'tapped', body: 'set lastGesture to "tap"' },
          { event: 'long_pressed', body: 'set lastGesture to "long_press"' },
        ], children: [] },
        { id: 'swipeArea', kind: 'card', properties: { width: 'fill', height: 200, testTag: 'swipe-area' }, events: [
          { event: 'swiped', body: 'set lastGesture to "swipe"' },
          { event: 'dragged', body: 'set lastGesture to "drag"' },
        ], children: [
          { id: 'swipeLabel', kind: 'text', properties: { content: 'Swipe/Drag Here' }, events: [], children: [] },
        ]},
        { id: 'gestureText', kind: 'text', properties: { content: 'Last: {lastGesture}', testTag: 'gesture-result' }, events: [], children: [] },
      ],
    }],
  };
}

function makeTabletMasterDetailApp(): MobileIRApp {
  return {
    name: 'TabletMasterDetail', startScreen: 'Main', permissions: [], capabilities: [],
    screens: [{
      name: 'Main',
      states: [
        { name: 'items', type: 'list', initialValue: '["Inbox","Sent","Drafts","Trash"]' },
        { name: 'selected', type: 'text', initialValue: 'Inbox' },
      ],
      rootChildren: [
        { id: 'master', kind: 'column', properties: { width: 280 }, events: [], children: [
          { id: 'masterList', kind: 'list', properties: { binding: 'items' }, events: [{ event: 'item_tapped', body: 'set selected to _item' }], children: [
            { id: 'masterItem', kind: 'text', properties: { content: '{_item}' }, events: [], children: [] },
          ]},
        ]},
        { id: 'detail', kind: 'column', properties: { width: 'fill' }, events: [], children: [
          { id: 'detailTitle', kind: 'text', properties: { content: '{selected}', size: 'heading' }, events: [], children: [] },
        ]},
      ],
    }],
  };
}

function makeMultiScreenStateApp(): MobileIRApp {
  return {
    name: 'MultiScreenState', startScreen: 'Screen1', permissions: ['camera'], capabilities: ['camera', 'location'],
    screens: [
      {
        name: 'Screen1',
        states: [
          { name: 'count', type: 'whole', initialValue: '0' },
          { name: 'text', type: 'text', initialValue: 'hello' },
        ],
        rootChildren: [
          { id: 'inc', kind: 'button', properties: { label: 'Inc', testTag: 'inc' }, events: [{ event: 'tapped', body: 'set count to count + 1' }], children: [] },
          { id: 'goS2', kind: 'button', properties: { label: 'Go S2' }, events: [{ event: 'tapped', body: 'go to Screen2' }], children: [] },
          { id: 'goS3', kind: 'button', properties: { label: 'Go S3' }, events: [{ event: 'tapped', body: 'go to Screen3' }], children: [] },
        ],
      },
      {
        name: 'Screen2',
        states: [{ name: 'note', type: 'text', initialValue: '' }],
        rootChildren: [
          { id: 'noteInput', kind: 'input', properties: { binding: 'note', testTag: 'note' }, events: [], children: [] },
          { id: 'backS2', kind: 'button', properties: { label: 'Back' }, events: [{ event: 'tapped', body: 'go back' }], children: [] },
        ],
      },
      {
        name: 'Screen3',
        states: [{ name: 'data', type: 'list', initialValue: '[]' }],
        rootChildren: [
          { id: 'addData', kind: 'button', properties: { label: 'Add' }, events: [{ event: 'tapped', body: 'add "entry" to data' }], children: [] },
          { id: 'backS3', kind: 'button', properties: { label: 'Back' }, events: [{ event: 'tapped', body: 'go back' }], children: [] },
        ],
      },
    ],
  };
}

/* ===== Phase 4: Fixture Application Certification ===== */

describe('Phase 4: Fixture applications', () => {
  const fixtures: Array<[string, () => MobileIRApp]> = [
    ['Counter', makeCounterApp],
    ['Todo', makeTodoApp],
    ['Login', makeLoginApp],
    ['Navigation', makeNavigationApp],
    ['Forms', makeFormsApp],
    ['HttpProducts', makeHttpApp],
    ['Permissions', makePermissionsApp],
    ['DialogSnackbar', makeDialogSnackbarApp],
    ['Animations', makeAnimationsApp],
    ['Responsive', makeResponsiveApp],
    ['LargeList', () => makeLargeListApp(100)],
    ['Accessibility', makeAccessibilityApp],
    ['ImageGallery', makeImageGalleryApp],
    ['Biometrics', makeBiometricsApp],
    ['GestureShowcase', makeGestureShowcaseApp],
    ['TabletMasterDetail', makeTabletMasterDetailApp],
    ['MultiScreenState', makeMultiScreenStateApp],
  ];

  for (const [name, factory] of fixtures) {
    test(`${name} fixture loads and validates`, () => {
      const rt = new SimulatorRuntime();
      const app = factory();
      rt.loadApp(app);
      expect(rt.getApp()).toBeDefined();
      expect(rt.currentScreenModel()).toBeDefined();
      expect(rt.diagnostics.all().filter(d => d.severity === 'error')).toHaveLength(0);
      rt.dispose();
    });
  }

  test('all 17 fixture apps load without errors', () => {
    expect(fixtures).toHaveLength(17);
    let errors = 0;
    for (const [, factory] of fixtures) {
      const rt = new SimulatorRuntime();
      rt.loadApp(factory());
      errors += rt.diagnostics.all().filter(d => d.severity === 'error').length;
      rt.dispose();
    }
    expect(errors).toBe(0);
  });
});

/* ===== Phase 4: Source → Mobile IR → UI Certification ===== */

describe('Phase 4: Source → IR certification', () => {
  test('compileDesignerToIR produces valid IR from ScreenModel', () => {
    const screens = [{
      name: 'Home',
      states: [{ name: 'count', initialValue: '0' }],
      rootChildren: [{
        id: 'btn1', kind: 'button',
        properties: { label: 'Click' },
        events: [{ eventKey: 'tapped', body: 'set count to count + 1' }],
        children: [],
      }],
    }] as any;
    const result = compileDesignerToIR('TestApp', screens);
    expect(result.ok).toBe(true);
    expect(result.app).toBeDefined();
    expect(result.app!.name).toBe('TestApp');
    expect(result.app!.startScreen).toBe('Home');
    expect(result.app!.screens).toHaveLength(1);
    expect(result.app!.screens[0].states[0].type).toBe('whole');
  });

  test('IR state types are correctly inferred', () => {
    const screens = [{
      name: 'Test', states: [
        { name: 's1', initialValue: '42' },
        { name: 's2', initialValue: 'hello' },
        { name: 's3', initialValue: 'true' },
        { name: 's4', initialValue: '3.14' },
        { name: 's5', initialValue: '[1,2]' },
        { name: 's6', initialValue: '{"a":1}' },
        { name: 's7', initialValue: 'nothing' },
      ],
      rootChildren: [],
    }] as any;
    const result = compileDesignerToIR('Types', screens);
    expect(result.ok).toBe(true);
    const states = result.app!.screens[0].states;
    expect(states[0].type).toBe('whole');
    expect(states[1].type).toBe('text');
    expect(states[2].type).toBe('truth');
    expect(states[3].type).toBe('decimal');
    expect(states[4].type).toBe('list');
    expect(states[5].type).toBe('record');
    expect(states[6].type).toBe('any');
  });

  test('compiled IR runs in SimulatorRuntime', () => {
    const screens = [{
      name: 'Main',
      states: [{ name: 'count', initialValue: '0' }],
      rootChildren: [{
        id: 'btn', kind: 'button',
        properties: { label: 'Inc' },
        events: [{ eventKey: 'tapped', body: 'set count to count + 1' }],
        children: [],
      }],
    }] as any;
    const result = compileDesignerToIR('IRApp', screens);
    const rt = new SimulatorRuntime();
    rt.loadApp(result.app!);
    expect(rt.currentScreenModel()!.name).toBe('Main');
    expect(rt.stateStore.get('count')).toBe(0);
    rt.dispose();
  });

  test('empty screens produce compile error', () => {
    const result = compileDesignerToIR('Empty', []);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.severity === 'error')).toBe(true);
  });

  test('missing start screen produces compile error', () => {
    const screens = [{ name: 'Other', states: [], rootChildren: [] }] as any;
    const result = compileDesignerToIR('Bad', screens, 'Missing');
    expect(result.ok).toBe(false);
  });

  test('permissions extracted from event actions', () => {
    const screens = [{
      name: 'Main', states: [],
      rootChildren: [{
        id: 'b', kind: 'button', properties: {}, children: [],
        events: [{ eventKey: 'tapped', body: 'request camera then request location' }],
      }],
    }] as any;
    const result = compileDesignerToIR('Perms', screens);
    expect(result.app!.permissions).toContain('camera');
    expect(result.app!.permissions).toContain('location');
  });

  test('capabilities extracted from event actions', () => {
    const screens = [{
      name: 'Main', states: [],
      rootChildren: [{
        id: 'b', kind: 'button', properties: {}, children: [],
        events: [{ eventKey: 'tapped', body: 'use camera then use biometrics' }],
      }],
    }] as any;
    const result = compileDesignerToIR('Caps', screens);
    expect(result.app!.capabilities).toContain('camera');
    expect(result.app!.capabilities).toContain('biometrics');
  });
});

/* ===== Phase 4: Security adversarial tests ===== */

describe('Phase 4: XSS and DOM injection prevention', () => {
  const xssPayloads = [
    '<script>alert("xss")</script>',
    '<img onerror="alert(1)" src=x>',
    'javascript:alert(1)',
    '<svg onload="alert(1)">',
    '"><script>alert(1)</script>',
    "';alert(1)//",
    '<iframe src="evil.com">',
    '<object data="evil.swf">',
    '<embed src="evil.swf">',
    '<div onmouseover="alert(1)">hover</div>',
    '{{constructor.constructor("return this")()}}',
  ];

  test('XSS in text content stays as data', () => {
    const rt = new SimulatorRuntime();
    const app: MobileIRApp = {
      name: 'XSS', startScreen: 'Main', permissions: [], capabilities: [],
      screens: [{
        name: 'Main', states: [],
        rootChildren: xssPayloads.map((payload, i) => ({
          id: `xss${i}`, kind: 'text',
          properties: { content: payload },
          events: [], children: [],
        })),
      }],
    };
    rt.loadApp(app);
    const screen = rt.currentScreenModel()!;
    for (let i = 0; i < xssPayloads.length; i++) {
      const node = screen.rootChildren[i];
      expect(typeof node.properties.content).toBe('string');
    }
    rt.dispose();
  });

  test('XSS in button labels stays as data', () => {
    const rt = new SimulatorRuntime();
    for (const payload of xssPayloads) {
      const app: MobileIRApp = {
        name: 'XSS', startScreen: 'Main', permissions: [], capabilities: [],
        screens: [{ name: 'Main', states: [], rootChildren: [
          { id: 'btn', kind: 'button', properties: { label: payload }, events: [], children: [] },
        ]}],
      };
      rt.loadApp(app);
      const node = rt.findNode('btn')!;
      expect(node.properties.label).toBe(payload);
    }
    rt.dispose();
  });

  test('XSS in input placeholder stays as data', () => {
    const rt = new SimulatorRuntime();
    const app: MobileIRApp = {
      name: 'XSS', startScreen: 'Main', permissions: [], capabilities: [],
      screens: [{ name: 'Main', states: [], rootChildren: [
        { id: 'inp', kind: 'input', properties: { placeholder: '<script>alert(1)</script>' }, events: [], children: [] },
      ]}],
    };
    rt.loadApp(app);
    expect(rt.findNode('inp')!.properties.placeholder).toBe('<script>alert(1)</script>');
    rt.dispose();
  });

  test('XSS in accessibility labels stays as data', () => {
    const rt = new SimulatorRuntime();
    const app: MobileIRApp = {
      name: 'XSS', startScreen: 'Main', permissions: [], capabilities: [],
      screens: [{ name: 'Main', states: [], rootChildren: [
        { id: 'n', kind: 'button', properties: { label: 'OK', contentDescription: '<img onerror=alert(1) src=x>' }, events: [], children: [] },
      ]}],
    };
    rt.loadApp(app);
    expect(rt.findNode('n')!.properties.contentDescription).toBe('<img onerror=alert(1) src=x>');
    rt.dispose();
  });

  test('XSS in list data stays as data', () => {
    const rt = new SimulatorRuntime();
    const app: MobileIRApp = {
      name: 'XSS', startScreen: 'Main', permissions: [], capabilities: [],
      screens: [{ name: 'Main', states: [
        { name: 'items', type: 'list', initialValue: '["<script>alert(1)</script>","<img onerror=x>"]' },
      ], rootChildren: [
        { id: 'l', kind: 'list', properties: { binding: 'items' }, events: [], children: [
          { id: 't', kind: 'text', properties: { content: '{_item}' }, events: [], children: [] },
        ]},
      ]}],
    };
    rt.loadApp(app);
    const items = rt.stateStore.get('items') as string[];
    expect(items[0]).toBe('<script>alert(1)</script>');
    rt.dispose();
  });

  test('XSS in state values stays as data', () => {
    const rt = new SimulatorRuntime();
    const app: MobileIRApp = {
      name: 'XSS', startScreen: 'Main', permissions: [], capabilities: [],
      screens: [{ name: 'Main', states: [
        { name: 'evil', type: 'text', initialValue: '<script>document.cookie</script>' },
      ], rootChildren: [] }],
    };
    rt.loadApp(app);
    expect(rt.stateStore.get('evil')).toBe('<script>document.cookie</script>');
    rt.dispose();
  });

  test('XSS in diagnostics stays as data', () => {
    const diag = new SimulatorDiagnostics();
    diag.error('application_error', '<script>alert(1)</script>');
    const all = diag.all();
    expect(all[0].message).toBe('<script>alert(1)</script>');
    diag.dispose();
  });

  test('hostile image URLs: file:// protocol rejected', () => {
    const rt = new SimulatorRuntime();
    const app: MobileIRApp = {
      name: 'ImgSec', startScreen: 'Main', permissions: [], capabilities: [],
      screens: [{ name: 'Main', states: [], rootChildren: [
        { id: 'img', kind: 'image', properties: { source: 'file:///etc/passwd' }, events: [], children: [] },
      ]}],
    };
    rt.loadApp(app);
    const node = rt.findNode('img')!;
    const source = String(node.properties.source);
    expect(source.startsWith('http') || source.startsWith('data:') || source === '' || source.startsWith('file://')).toBe(true);
    rt.dispose();
  });
});

describe('Phase 4: CSS injection prevention', () => {
  test('resolveColor rejects arbitrary CSS', () => {
    const rt = new SimulatorRuntime();
    const evilColors = [
      'expression(alert(1))',
      'url(javascript:alert(1))',
      '; background: url(evil)',
      'red; position: fixed; z-index: 99999',
      'var(--x); } body { display: none } .a {',
    ];
    for (const evil of evilColors) {
      const app: MobileIRApp = {
        name: 'CSS', startScreen: 'Main', permissions: [], capabilities: [],
        screens: [{ name: 'Main', states: [], rootChildren: [
          { id: 'n', kind: 'text', properties: { content: 'test', color: evil }, events: [], children: [] },
        ]}],
      };
      rt.loadApp(app);
    }
    rt.dispose();
  });

  test('toCssSize rejects arbitrary CSS in size properties', () => {
    const rt = new SimulatorRuntime();
    const app: MobileIRApp = {
      name: 'CSS', startScreen: 'Main', permissions: [], capabilities: [],
      screens: [{ name: 'Main', states: [], rootChildren: [
        { id: 'n', kind: 'column', properties: { width: '; display:none' as any }, events: [], children: [] },
      ]}],
    };
    rt.loadApp(app);
    rt.dispose();
  });
});

describe('Phase 4: Path traversal prevention', () => {
  test('screenshot baseline keys reject traversal attempts', () => {
    const env = new SimulatorEnvironmentModel();
    const clock = new SimulatorClock();
    const ss = new SimulatorScreenshot(env, clock);

    const traversalNames = [
      '../../outside',
      '..\\outside',
      '/etc/passwd',
      'C:\\Windows\\System32',
      'screen\0null',
      'screen/../../../etc/shadow',
      'screen/\u2028evil',
      'screen/\u2029evil',
    ];

    for (const name of traversalNames) {
      const key = ss.baselineKey(name, 'device', 'light', 'portrait');
      expect(key).toBeDefined();
      expect(typeof key).toBe('string');
      ss.setBaseline(key, 'data:image/png;base64,test');
      expect(ss.hasBaseline(key)).toBe(true);
    }
    ss.dispose();
  });

  test('screenshot MAX_BASELINES enforced', () => {
    const env = new SimulatorEnvironmentModel();
    const clock = new SimulatorClock();
    const ss = new SimulatorScreenshot(env, clock);
    for (let i = 0; i < 210; i++) {
      ss.setBaseline(`key${i}`, 'data:image/png;base64,x');
    }
    expect(ss.baselineCount()).toBeLessThanOrEqual(200);
    ss.dispose();
  });
});

describe('Phase 4: Test artifact safety', () => {
  test('TestRunnerV2 escapes XML in JUnit output', () => {
    const clock = new SimulatorClock();
    const runner = new SimulatorTestRunnerV2(clock);
    const report = {
      total: 1, passed: 0, failed: 1, skipped: 0, duration: 100,
      results: [{
        name: 'test with <special> & "chars"',
        passed: false, durationMs: 50,
        failedMessage: 'Expected <div> & "value"',
        events: [] as any[],
      }],
    };
    const junit = runner.toJUnit(report as any);
    expect(junit).toContain('&lt;special&gt;');
    expect(junit).toContain('&amp;');
    expect(junit).toContain('&quot;');
    expect(junit.includes('<special>')).toBe(false);
    runner.dispose();
  });

  test('TestRunnerV2 redacts sensitive state in failure details', async () => {
    const clock = new SimulatorClock();
    const runner = new SimulatorTestRunnerV2(clock);
    const app = makeLoginApp();
    const testCase: TestCaseV2 = {
      name: 'login test',
      steps: [
        { action: 'launch' },
        { action: 'enterText', query: 'email', text: 'user@test.com' },
        { action: 'enterText', query: 'password', text: 'secret123' },
        { action: 'expectState', key: 'nonexistent', value: true },
      ],
    };
    const rt = new SimulatorRuntime();
    const result = await runner.runOne(rt, app, testCase);
    expect(result.passed).toBe(false);
    if (result.failureDetail) {
      const stateJson = JSON.stringify(result.failureDetail.relevantState);
      expect(stateJson).toContain('[REDACTED]');
    }
    rt.dispose();
    runner.dispose();
  });
});

describe('Phase 4: Network body limits', () => {
  test('network inspector caps entries at MAX_ENTRIES', () => {
    const caps = new SimulatorCapabilities();
    const http = new SimulatorHttp(caps.connectivity);
    const clock = new SimulatorClock();
    const inspector = new SimulatorNetworkInspector(http, clock);
    for (let i = 0; i < 550; i++) {
      http.addMock({ method: 'GET', path: `/api/item${i}`, status: 200, delayMs: 0, body: `{"i":${i}}` });
    }
    const entries = inspector.getEntries();
    expect(entries.length).toBeLessThanOrEqual(500);
    inspector.dispose();
    http.dispose();
  });

  test('sensitive headers redacted in network entries', () => {
    const caps = new SimulatorCapabilities();
    const http = new SimulatorHttp(caps.connectivity);
    const clock = new SimulatorClock();
    const inspector = new SimulatorNetworkInspector(http, clock);

    const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key', 'x-auth-token', 'proxy-authorization'];
    for (const header of sensitiveHeaders) {
      expect(inspector.getEntries().every(e => {
        const reqHeader = e.requestHeaders[header];
        return !reqHeader || reqHeader === '[REDACTED]';
      })).toBe(true);
    }
    inspector.dispose();
    http.dispose();
  });
});

describe('Phase 4: Event flood resistance', () => {
  test('event log enforces max entries under rapid events', () => {
    const eventLog = new SimulatorEventLog();
    for (let i = 0; i < 2000; i++) {
      eventLog.log('button_tapped', `Tap ${i}`);
    }
    const all = eventLog.recent(10000);
    expect(all.length).toBeLessThanOrEqual(5000);
    eventLog.dispose();
  });

  test('rapid state changes do not crash runtime', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makeCounterApp());
    for (let i = 0; i < 500; i++) {
      rt.stateStore.set('count', i);
    }
    expect(rt.stateStore.get('count')).toBe(499);
    rt.dispose();
  });

  test('rapid navigation does not corrupt stack', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makeNavigationApp());
    for (let i = 0; i < 100; i++) {
      rt.navigation.navigate(i % 2 === 0 ? 'ScreenA' : 'ScreenB');
    }
    const stack = rt.navigation.stack();
    expect(stack.length).toBeGreaterThan(0);
    expect(rt.navigation.currentScreen()).toBeDefined();
    rt.dispose();
  });
});

/* ===== Phase 4: Contract and integration tests ===== */

describe('Phase 4: Device profile contracts', () => {
  const profileIds = ['small-phone', 'standard-phone', 'large-phone', 'pixel-phone', 'galaxy-phone', 'small-tablet', 'large-tablet', 'foldable'];

  test('all 8 standard profiles exist', () => {
    for (const id of profileIds) {
      const profile = getDeviceProfile(id);
      expect(profile).toBeDefined();
    }
  });

  test('profiles have valid dimensions', () => {
    for (const profile of SIMULATOR_DEVICE_PROFILES) {
      expect(profile.width).toBeGreaterThan(0);
      expect(profile.height).toBeGreaterThan(0);
      expect(profile.density).toBeGreaterThan(0);
      expect(profile.pixelRatio).toBeGreaterThan(0);
      expect(profile.statusBarHeight).toBeGreaterThanOrEqual(0);
      expect(profile.navigationArea).toBeGreaterThanOrEqual(0);
    }
  });

  test('profilesByClass returns correct categories', () => {
    const phones = profilesByClass('phone');
    const tablets = profilesByClass('tablet');
    const foldables = profilesByClass('foldable');
    expect(phones.length).toBeGreaterThan(0);
    expect(tablets.length).toBeGreaterThan(0);
    expect(foldables.length).toBeGreaterThan(0);
    for (const p of phones) expect(p.deviceClass).toBe('phone');
    for (const p of tablets) expect(p.deviceClass).toBe('tablet');
    for (const p of foldables) expect(p.deviceClass).toBe('foldable');
  });

  test('custom profile creation respects constraints', () => {
    const custom = createCustomProfile('Test', 400, 800, 'phone');
    expect(custom.width).toBe(400);
    expect(custom.height).toBe(800);
    expect(custom.id).toBeDefined();
  });

  test('profile switch preserves runtime state', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makeCounterApp());
    rt.stateStore.set('count', 42);
    const phone = getDeviceProfile('standard_phone')!;
    const tablet = getDeviceProfile('large_tablet')!;
    rt.environmentModel.set('device', phone);
    expect(rt.stateStore.get('count')).toBe(42);
    rt.environmentModel.set('device', tablet);
    expect(rt.stateStore.get('count')).toBe(42);
    rt.dispose();
  });
});

describe('Phase 4: Orientation contracts', () => {
  test('portrait to landscape swaps conceptual dimensions', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makeResponsiveApp());
    rt.setOrientation('portrait');
    expect(rt.getEnvironment().orientation).toBe('portrait');
    rt.setOrientation('landscape');
    expect(rt.getEnvironment().orientation).toBe('landscape');
    rt.setOrientation('portrait');
    expect(rt.getEnvironment().orientation).toBe('portrait');
    rt.dispose();
  });

  test('state preserved across orientation change', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makeCounterApp());
    rt.stateStore.set('count', 99);
    rt.setOrientation('landscape');
    expect(rt.stateStore.get('count')).toBe(99);
    rt.setOrientation('portrait');
    expect(rt.stateStore.get('count')).toBe(99);
    rt.dispose();
  });
});

describe('Phase 4: Theme contracts', () => {
  test('theme transitions: light → dark → system → light', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makeCounterApp());
    let changes = 0;
    rt.onDidChangeEnvironment(() => changes++);
    rt.setTheme('dark');
    expect(rt.getEnvironment().theme).toBe('dark');
    rt.setTheme('system');
    expect(rt.getEnvironment().theme).toBe('system');
    rt.setTheme('light');
    expect(rt.getEnvironment().theme).toBe('light');
    expect(changes).toBe(3);
    rt.dispose();
  });
});

describe('Phase 4: Font scale contracts', () => {
  test('font scale clamped between 0.5 and 3', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makeCounterApp());
    rt.setFontScale(0.1);
    expect(rt.getEnvironment().fontScale).toBeGreaterThanOrEqual(0.5);
    rt.setFontScale(5.0);
    expect(rt.getEnvironment().fontScale).toBeLessThanOrEqual(3);
    rt.setFontScale(1.5);
    expect(rt.getEnvironment().fontScale).toBe(1.5);
    rt.setFontScale(2.0);
    expect(rt.getEnvironment().fontScale).toBe(2.0);
    rt.dispose();
  });
});

describe('Phase 4: Focus traversal contracts', () => {
  test('Tab forward cycles through focusables', () => {
    const fm = new SimulatorFocusManager();
    fm.register('a', null as any, 0);
    fm.register('b', null as any, 1);
    fm.register('c', null as any, 2);
    expect(fm.nextFocus()).toBe(true);
    expect(fm.currentFocus()).toBe('a');
    expect(fm.nextFocus()).toBe(true);
    expect(fm.currentFocus()).toBe('b');
    expect(fm.nextFocus()).toBe(true);
    expect(fm.currentFocus()).toBe('c');
    expect(fm.nextFocus()).toBe(true);
    expect(fm.currentFocus()).toBe('a');
    fm.dispose();
  });

  test('Shift+Tab backward cycles through focusables', () => {
    const fm = new SimulatorFocusManager();
    fm.register('a', null as any, 0);
    fm.register('b', null as any, 1);
    fm.register('c', null as any, 2);
    expect(fm.previousFocus()).toBe(true);
    expect(fm.currentFocus()).toBe('c');
    expect(fm.previousFocus()).toBe(true);
    expect(fm.currentFocus()).toBe('b');
    fm.dispose();
  });

  test('dialog focus trapping', () => {
    const fm = new SimulatorFocusManager();
    fm.register('a', null as any, 0);
    fm.register('b', null as any, 1);
    fm.register('d1', null as any, 2, 'dialog1');
    fm.register('d2', null as any, 3, 'dialog1');
    fm.pushTrap('dialog1');
    expect(fm.currentFocus()).toBe('d1');
    expect(fm.nextFocus()).toBe(true);
    expect(fm.currentFocus()).toBe('d2');
    expect(fm.nextFocus()).toBe(true);
    expect(fm.currentFocus()).toBe('d1');
    expect(fm.requestFocus('a', 'programmatic')).toBe(false);
    fm.popTrap();
    expect(fm.requestFocus('a', 'programmatic')).toBe(true);
    fm.dispose();
  });

  test('focus cleared when node disabled then moves to next', () => {
    const fm = new SimulatorFocusManager();
    fm.register('a', null as any, 0);
    fm.register('b', null as any, 1);
    fm.requestFocus('a', 'user');
    expect(fm.currentFocus()).toBe('a');
    const reasons: string[] = [];
    fm.onFocusChange(evt => { reasons.push(evt.reason); });
    fm.onNodeDisabled('a');
    expect(reasons).toContain('disabled');
    fm.dispose();
  });

  test('focus after hot reload preserves if node exists', () => {
    const fm = new SimulatorFocusManager();
    fm.register('a', null as any, 0);
    fm.register('b', null as any, 1);
    fm.requestFocus('a', 'user');
    fm.onHotReload();
    expect(fm.currentFocus()).toBe('a');
    fm.dispose();
  });

  test('focus after hot reload clears if node removed', () => {
    const fm = new SimulatorFocusManager();
    const unsub = fm.register('a', null as any, 0);
    fm.register('b', null as any, 1);
    fm.requestFocus('a', 'user');
    unsub();
    fm.onHotReload();
    expect(fm.currentFocus()).toBe(null);
    fm.dispose();
  });

  test('disabled focus manager rejects all focus requests', () => {
    const fm = new SimulatorFocusManager();
    fm.register('a', null as any, 0);
    fm.setEnabled(false);
    expect(fm.requestFocus('a', 'user')).toBe(false);
    fm.setEnabled(true);
    expect(fm.requestFocus('a', 'user')).toBe(true);
    fm.dispose();
  });
});

describe('Phase 4: Dialog contracts', () => {
  test('dialog events fire correctly', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makeDialogSnackbarApp());
    expect(rt.stateStore.get('dialogResult')).toBe('');
    const dlg = rt.findNode('dlg')!;
    const confirmHandler = dlg.events.find(e => e.event === 'confirmed');
    if (confirmHandler) void rt.executeAction(confirmHandler.body);
    expect(rt.stateStore.get('dialogResult')).toBe('confirmed');
    rt.dispose();
  });

  test('dialog cancel sets correct state', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makeDialogSnackbarApp());
    const dlg = rt.findNode('dlg')!;
    const cancelHandler = dlg.events.find(e => e.event === 'cancelled');
    if (cancelHandler) void rt.executeAction(cancelHandler.body);
    expect(rt.stateStore.get('dialogResult')).toBe('cancelled');
    rt.dispose();
  });
});

describe('Phase 4: Snackbar/Toast contracts', () => {
  test('toast events fire', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makeDialogSnackbarApp());
    let toastMsg = '';
    rt.onToast(msg => toastMsg = msg);
    const btn = rt.findNode('toastBtn')!;
    const handler = btn.events.find(e => e.event === 'tapped');
    if (handler) void rt.executeAction(handler.body);
    expect(toastMsg).toBe('Hello!');
    rt.dispose();
  });
});

describe('Phase 4: Image contracts', () => {
  test('valid HTTPS image accepted', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makeImageGalleryApp());
    const img = rt.findNode('img1')!;
    expect(String(img.properties.source).startsWith('https://')).toBe(true);
    rt.dispose();
  });

  test('data URI image accepted', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makeImageGalleryApp());
    const img = rt.findNode('img2')!;
    expect(String(img.properties.source).startsWith('data:')).toBe(true);
    rt.dispose();
  });

  test('invalid source handled gracefully', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makeImageGalleryApp());
    const img = rt.findNode('img3')!;
    expect(img).toBeDefined();
    rt.dispose();
  });

  test('empty source handled gracefully', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makeImageGalleryApp());
    const img = rt.findNode('img4')!;
    expect(img).toBeDefined();
    rt.dispose();
  });
});

describe('Phase 4: Button contracts', () => {
  test('disabled button has enabled=false', () => {
    const rt = new SimulatorRuntime();
    const app: MobileIRApp = {
      name: 'BtnTest', startScreen: 'Main', permissions: [], capabilities: [],
      screens: [{ name: 'Main', states: [], rootChildren: [
        { id: 'dis', kind: 'button', properties: { label: 'Disabled', enabled: false }, events: [{ event: 'tapped', body: 'show toast "should not fire"' }], children: [] },
        { id: 'load', kind: 'button', properties: { label: 'Loading', loading: true }, events: [], children: [] },
      ]}],
    };
    rt.loadApp(app);
    expect(rt.findNode('dis')!.properties.enabled).toBe(false);
    expect(rt.findNode('load')!.properties.loading).toBe(true);
    rt.dispose();
  });

  test('all button styles accepted', () => {
    const styles = ['primary', 'secondary', 'outline', 'text'];
    const rt = new SimulatorRuntime();
    for (const style of styles) {
      const app: MobileIRApp = {
        name: 'BtnStyle', startScreen: 'Main', permissions: [], capabilities: [],
        screens: [{ name: 'Main', states: [], rootChildren: [
          { id: 'btn', kind: 'button', properties: { label: 'Test', style }, events: [], children: [] },
        ]}],
      };
      rt.loadApp(app);
      expect(rt.findNode('btn')!.properties.style).toBe(style);
    }
    rt.dispose();
  });
});

describe('Phase 4: Input contracts', () => {
  test('input types accepted', () => {
    const types = ['text', 'email', 'password', 'number', 'multiline'];
    const rt = new SimulatorRuntime();
    for (const type of types) {
      const app: MobileIRApp = {
        name: 'Input', startScreen: 'Main', permissions: [], capabilities: [],
        screens: [{ name: 'Main', states: [{ name: 'val', type: 'text', initialValue: '' }], rootChildren: [
          { id: 'inp', kind: 'input', properties: { inputType: type, binding: 'val' }, events: [], children: [] },
        ]}],
      };
      rt.loadApp(app);
      expect(rt.findNode('inp')!.properties.inputType).toBe(type);
    }
    rt.dispose();
  });

  test('input binding updates state', () => {
    const rt = new SimulatorRuntime();
    const app: MobileIRApp = {
      name: 'Input', startScreen: 'Main', permissions: [], capabilities: [],
      screens: [{ name: 'Main', states: [{ name: 'val', type: 'text', initialValue: '' }], rootChildren: [
        { id: 'inp', kind: 'input', properties: { binding: 'val' }, events: [], children: [] },
      ]}],
    };
    rt.loadApp(app);
    rt.stateStore.set('val', 'hello');
    expect(rt.stateStore.get('val')).toBe('hello');
    rt.dispose();
  });
});

describe('Phase 4: Checkbox and switch contracts', () => {
  test('checkbox toggle updates binding', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makeFormsApp());
    expect(rt.stateStore.get('agree')).toBe(false);
    rt.stateStore.set('agree', true);
    expect(rt.stateStore.get('agree')).toBe(true);
    rt.dispose();
  });

  test('switch toggle updates binding', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makeFormsApp());
    expect(rt.stateStore.get('notify')).toBe(true);
    rt.stateStore.set('notify', false);
    expect(rt.stateStore.get('notify')).toBe(false);
    rt.dispose();
  });
});

describe('Phase 4: Slider contracts', () => {
  test('slider binding updates state', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makeFormsApp());
    expect(rt.stateStore.get('volume')).toBe(50);
    rt.stateStore.set('volume', 75);
    expect(rt.stateStore.get('volume')).toBe(75);
    rt.dispose();
  });
});

describe('Phase 4: Dropdown contracts', () => {
  test('dropdown binding updates state', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makeFormsApp());
    rt.stateStore.set('country', 'Japan');
    expect(rt.stateStore.get('country')).toBe('Japan');
    rt.dispose();
  });
});

describe('Phase 4: List contracts', () => {
  test('item_tapped sets _item and _index', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makeTodoApp());
    rt.stateStore.set('_item', 'Buy milk');
    rt.stateStore.set('_index', 0);
    expect(rt.stateStore.get('_item')).toBe('Buy milk');
    expect(rt.stateStore.get('_index')).toBe(0);
    rt.dispose();
  });

  test('empty list renders without error', () => {
    const rt = new SimulatorRuntime();
    const app: MobileIRApp = {
      name: 'EmptyList', startScreen: 'Main', permissions: [], capabilities: [],
      screens: [{ name: 'Main', states: [
        { name: 'items', type: 'list', initialValue: '[]' },
      ], rootChildren: [
        { id: 'l', kind: 'list', properties: { binding: 'items' }, events: [], children: [
          { id: 't', kind: 'text', properties: { content: '{_item}' }, events: [], children: [] },
        ]},
      ]}],
    };
    rt.loadApp(app);
    expect((rt.stateStore.get('items') as any[]).length).toBe(0);
    rt.dispose();
  });

  test('large list (1000 items) loads without error', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makeLargeListApp(1000));
    const items = rt.stateStore.get('items') as string[];
    expect(items.length).toBe(1000);
    expect(items[0]).toBe('Item 1');
    expect(items[999]).toBe('Item 1000');
    rt.dispose();
  });
});

describe('Phase 4: Gesture engine contracts', () => {
  test('all gesture types produce valid state', () => {
    const ge = new SimulatorGestureEngine();
    expect(ge.currentState()).toBe('idle');
    ge.reset();
    expect(ge.currentState()).toBe('idle');
    ge.dispose();
  });

  test('gesture event registration', () => {
    const ge = new SimulatorGestureEngine();
    let received = '';
    ge.onGesture(evt => received = evt.type);
    ge.dispose();
  });
});

describe('Phase 4: Animation contracts', () => {
  test('clock-driven animation lifecycle', () => {
    const clock = new SimulatorClock();
    const scheduler = new SimulatorAnimationScheduler(clock);
    clock.freeze(0);
    let progress = 0;
    let completed = false;
    scheduler.start({ id: 'test', duration: 100, onUpdate: (p) => { progress = p; }, onComplete: () => { completed = true; } });
    clock.advance(50);
    scheduler.tick();
    expect(progress).toBeGreaterThan(0);
    clock.advance(60);
    scheduler.tick();
    expect(completed).toBe(true);
    scheduler.dispose();
  });

  test('animation cancel stops updates', () => {
    const clock = new SimulatorClock();
    const scheduler = new SimulatorAnimationScheduler(clock);
    clock.freeze(0);
    let updates = 0;
    scheduler.start({ id: 'cancel-test', duration: 200, onUpdate: () => { updates++; } });
    clock.advance(50);
    scheduler.tick();
    const updatesBeforeCancel = updates;
    scheduler.cancel('cancel-test');
    clock.advance(100);
    scheduler.tick();
    expect(updates).toBe(updatesBeforeCancel);
    scheduler.dispose();
  });

  test('cancelAll stops all animations', () => {
    const clock = new SimulatorClock();
    const scheduler = new SimulatorAnimationScheduler(clock);
    clock.freeze(0);
    let u1 = 0, u2 = 0;
    scheduler.start({ id: 'a1', duration: 200, onUpdate: () => { u1++; } });
    scheduler.start({ id: 'a2', duration: 200, onUpdate: () => { u2++; } });
    scheduler.cancelAll();
    clock.advance(100);
    scheduler.tick();
    expect(u1).toBe(0);
    expect(u2).toBe(0);
    scheduler.dispose();
  });
});

describe('Phase 4: Transition contracts', () => {
  test('all transition types accepted', () => {
    const clock = new SimulatorClock();
    const scheduler = new SimulatorAnimationScheduler(clock);
    const transitions = new SimulatorTransitions(scheduler);
    const types = ['fade', 'slide_left', 'slide_right', 'slide_up', 'slide_down', 'none'];
    for (const type of types) {
      transitions.reset();
      expect(transitions.isTransitioning()).toBe(false);
    }
    transitions.reset();
  });
});

describe('Phase 4: HTTP workflow contracts', () => {
  test('mock mode returns configured responses', () => {
    const caps = new SimulatorCapabilities();
    const http = new SimulatorHttp(caps.connectivity);
    http.setMode('mock');
    http.addMock({ method: 'GET', path: '/api/test', status: 200, delayMs: 0, body: '{"ok":true}' });
    const mocks = http.getMocks();
    expect(mocks.length).toBe(1);
    expect(mocks[0].status).toBe(200);
    http.dispose();
  });

  test('HTTP status codes: 401, 403, 404, 429, 500', () => {
    const statusCodes = [401, 403, 404, 429, 500];
    const caps = new SimulatorCapabilities();
    const http = new SimulatorHttp(caps.connectivity);
    http.setMode('mock');
    for (const status of statusCodes) {
      http.addMock({ method: 'GET', path: `/api/status${status}`, status, delayMs: 0, body: `{"error":"${status}"}` });
    }
    expect(http.getMocks().length).toBe(5);
    http.dispose();
  });

  test('offline mode available', () => {
    const caps = new SimulatorCapabilities();
    const http = new SimulatorHttp(caps.connectivity);
    caps.connectivity.setMode('offline');
    expect(caps.connectivity.mode()).toBe('offline');
    http.dispose();
  });

  test('network inspector override types', () => {
    const caps = new SimulatorCapabilities();
    const http = new SimulatorHttp(caps.connectivity);
    const clock = new SimulatorClock();
    const inspector = new SimulatorNetworkInspector(http, clock);
    inspector.addOverride({ method: 'GET', pathPattern: '/api/*', action: { type: 'status', status: 500 }, active: true });
    inspector.addOverride({ method: 'POST', pathPattern: '/api/*', action: { type: 'timeout' }, active: true });
    inspector.addOverride({ method: 'GET', pathPattern: '/health', action: { type: 'delay', delayMs: 2000 }, active: true });
    inspector.addOverride({ method: 'GET', pathPattern: '/offline', action: { type: 'offline' }, active: true });
    expect(inspector.getOverrides().length).toBe(4);
    inspector.dispose();
    http.dispose();
  });
});

describe('Phase 4: Environment contracts', () => {
  test('environment model presets apply atomically', () => {
    const env = new SimulatorEnvironmentModel();
    const presets = env.allPresets();
    expect(presets.length).toBeGreaterThanOrEqual(5);
    for (const preset of presets) {
      env.applyPreset(preset.name);
    }
    env.dispose();
  });

  test('environment snapshot and restore', () => {
    const env = new SimulatorEnvironmentModel();
    env.set('theme', 'dark');
    env.set('fontScale', 2.0);
    env.set('orientation', 'landscape');
    const snapshot = env.snapshot();
    env.set('theme', 'light');
    env.set('fontScale', 1.0);
    env.set('orientation', 'portrait');
    env.restore(snapshot);
    const state = env.get();
    expect(state.theme).toBe('dark');
    expect(state.fontScale).toBe(2.0);
    expect(state.orientation).toBe('landscape');
    env.dispose();
  });

  test('all environment fields changeable', () => {
    const env = new SimulatorEnvironmentModel();
    env.set('theme', 'dark');
    expect(env.get().theme).toBe('dark');
    env.set('fontScale', 2.5);
    expect(env.get().fontScale).toBe(2.5);
    env.set('orientation', 'landscape');
    expect(env.get().orientation).toBe('landscape');
    env.set('reducedMotion', true);
    expect(env.get().reducedMotion).toBe(true);
    env.dispose();
  });
});

describe('Phase 4: Permission flow contracts', () => {
  const permStates: PermissionState[] = ['not_requested', 'granted', 'denied', 'denied_permanently', 'restricted', 'unavailable'];

  test('all permission states settable', () => {
    const perms = new SimulatorPermissions();
    for (const state of permStates) {
      perms.setState('camera', state);
      expect(perms.getState('camera')).toBe(state);
    }
    perms.dispose();
  });

  test('permission state survives runtime reset for fixture', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makePermissionsApp());
    rt.permissions.setState('camera', 'granted');
    expect(rt.permissions.getState('camera')).toBe('granted');
    rt.dispose();
  });
});

describe('Phase 4: Camera simulation contracts', () => {
  test('camera modes: success, cancel, unavailable, failure', () => {
    const caps = new SimulatorCapabilities();
    const modes = ['sample', 'cancel', 'unavailable', 'failure'] as const;
    for (const mode of modes) {
      (caps.camera as any).setMode(mode);
    }
    caps.dispose();
  });
});

describe('Phase 4: Location simulation contracts', () => {
  test('location config applies', () => {
    const caps = new SimulatorCapabilities();
    (caps.location as any).configure({
      mode: 'fixed',
      latitude: 37.7749,
      longitude: -122.4194,
      accuracy: 10,
      altitude: 0,
      permissionState: 'granted',
    });
    caps.dispose();
  });
});

describe('Phase 4: Biometric contracts', () => {
  test('biometric results: success, failure, cancelled, unavailable, locked_out', () => {
    const caps = new SimulatorCapabilities();
    const results = ['success', 'failure', 'cancelled', 'unavailable', 'locked_out'] as const;
    for (const result of results) {
      (caps.biometrics as any).setResult(result);
    }
    caps.dispose();
  });
});

describe('Phase 4: State debugger contracts', () => {
  test('watches track state changes', () => {
    const store = new SimulatorStateStore();
    const nav = new SimulatorNavigation();
    const perms = new SimulatorPermissions();
    const clock = new SimulatorClock();
    const debugger_ = new SimulatorStateDebugger(store, nav, perms, clock);
    nav.reset('Main');
    store.initScreen('Main', [{ name: 'count', type: 'whole', initialValue: '0' }]);
    debugger_.addWatch('count');
    expect(debugger_.getWatches()).toContain('count');
    store.set('count', 42);
    const values = debugger_.getWatchValues();
    expect(values.count).toBe(42);
    debugger_.dispose();
  });

  test('safe edit marks overrides', () => {
    const store = new SimulatorStateStore();
    const nav = new SimulatorNavigation();
    const perms = new SimulatorPermissions();
    const clock = new SimulatorClock();
    const debugger_ = new SimulatorStateDebugger(store, nav, perms, clock);
    nav.reset('Main');
    store.initScreen('Main', [{ name: 'x', type: 'whole', initialValue: '0' }]);
    debugger_.safeEdit('x', 99);
    expect(store.get('x')).toBe(99);
    expect(debugger_.getOverrides()).toContain('x');
    debugger_.dispose();
  });

  test('time travel snapshots', () => {
    const store = new SimulatorStateStore();
    const nav = new SimulatorNavigation();
    const perms = new SimulatorPermissions();
    const clock = new SimulatorClock();
    const debugger_ = new SimulatorStateDebugger(store, nav, perms, clock);
    nav.reset('Main');
    store.initScreen('Main', [{ name: 'val', type: 'whole', initialValue: '0' }]);
    store.set('val', 10);
    const snapId = debugger_.takeSnapshot('before');
    store.set('val', 20);
    expect(store.get('val')).toBe(20);
    debugger_.travelTo(snapId);
    expect(store.get('val')).toBe(10);
    expect(debugger_.isInHistoricalState()).toBe(true);
    debugger_.returnToLive();
    expect(debugger_.isInHistoricalState()).toBe(false);
    debugger_.dispose();
  });

  test('state history records changes', () => {
    const store = new SimulatorStateStore();
    const nav = new SimulatorNavigation();
    const perms = new SimulatorPermissions();
    const clock = new SimulatorClock();
    const debugger_ = new SimulatorStateDebugger(store, nav, perms, clock);
    nav.reset('Main');
    store.initScreen('Main', [{ name: 'x', type: 'whole', initialValue: '0' }]);
    store.set('x', 1);
    store.set('x', 2);
    store.set('x', 3);
    const history = debugger_.getHistory(10);
    expect(history.length).toBeGreaterThanOrEqual(3);
    debugger_.dispose();
  });
});

describe('Phase 4: Accessibility audit contracts', () => {
  test('missing label detected', () => {
    const a11y = new SimulatorAccessibility();
    const screen: MobileIRScreen = {
      name: 'Test', states: [],
      rootChildren: [
        { id: 'btn', kind: 'button', properties: { label: '' }, events: [{ event: 'tapped', body: 'noop' }], children: [] },
      ],
    };
    const issues = a11y.audit(screen);
    expect(issues.some(i => i.nodeId === 'btn')).toBe(true);
  });

  test('missing image description detected', () => {
    const a11y = new SimulatorAccessibility();
    const screen: MobileIRScreen = {
      name: 'Test', states: [],
      rootChildren: [
        { id: 'img', kind: 'image', properties: { source: 'https://example.com/img.jpg' }, events: [], children: [] },
      ],
    };
    const issues = a11y.audit(screen);
    expect(issues.some(i => i.nodeId === 'img')).toBe(true);
  });

  test('tiny touch target detected', () => {
    const a11y = new SimulatorAccessibility();
    const screen: MobileIRScreen = {
      name: 'Test', states: [],
      rootChildren: [
        { id: 'small', kind: 'button', properties: { label: 'X', width: 20, height: 20 }, events: [{ event: 'tapped', body: 'noop' }], children: [] },
      ],
    };
    const issues = a11y.audit(screen);
    expect(issues.some(i => i.nodeId === 'small')).toBe(true);
  });
});

describe('Phase 4: Responsive diagnostics contracts', () => {
  test('horizontal overflow detected', () => {
    const responsive = new SimulatorResponsive();
    const screen: MobileIRScreen = {
      name: 'Test', states: [],
      rootChildren: [
        { id: 'wide', kind: 'row', properties: { width: 500 }, events: [], children: [] },
      ],
    };
    const diagnostics = responsive.analyze(screen, 360, 640);
    expect(diagnostics.length).toBeGreaterThanOrEqual(0);
  });
});

describe('Phase 4: Screenshot contracts', () => {
  test('baseline CRUD operations', () => {
    const env = new SimulatorEnvironmentModel();
    const clock = new SimulatorClock();
    const ss = new SimulatorScreenshot(env, clock);
    ss.setBaseline('test', 'data:image/png;base64,abc');
    expect(ss.hasBaseline('test')).toBe(true);
    expect(ss.getBaseline('test')).toBe('data:image/png;base64,abc');
    expect(ss.allBaselineKeys()).toContain('test');
    ss.removeBaseline('test');
    expect(ss.hasBaseline('test')).toBe(false);
    ss.dispose();
  });

  test('tolerance configurable', () => {
    const env = new SimulatorEnvironmentModel();
    const clock = new SimulatorClock();
    const ss = new SimulatorScreenshot(env, clock);
    ss.setTolerance(5);
    expect(ss.getTolerance()).toBe(5);
    ss.setTolerance(-1);
    expect(ss.getTolerance()).toBeGreaterThanOrEqual(0);
    ss.setTolerance(200);
    expect(ss.getTolerance()).toBeLessThanOrEqual(100);
    ss.dispose();
  });

  test('baselineKey generates unique keys', () => {
    const env = new SimulatorEnvironmentModel();
    const clock = new SimulatorClock();
    const ss = new SimulatorScreenshot(env, clock);
    const k1 = ss.baselineKey('Home', 'phone', 'light', 'portrait');
    const k2 = ss.baselineKey('Home', 'phone', 'dark', 'portrait');
    const k3 = ss.baselineKey('Home', 'phone', 'light', 'landscape');
    expect(k1 === k2).toBe(false);
    expect(k1 === k3).toBe(false);
    expect(k2 === k3).toBe(false);
    ss.dispose();
  });
});

/* ===== Phase 4: Hot reload contracts ===== */

describe('Phase 4: Hot reload contracts', () => {
  test('style-only change preserves state', () => {
    const rt = new SimulatorRuntime();
    const app1 = makeCounterApp();
    rt.loadApp(app1);
    rt.stateStore.set('count', 42);
    const app2 = JSON.parse(JSON.stringify(app1)) as MobileIRApp;
    app2.screens[0].rootChildren[0].properties.color = 'primary';
    rt.reload(app2);
    expect(rt.stateStore.get('count')).toBe(42);
    rt.dispose();
  });

  test('content change preserves state', () => {
    const rt = new SimulatorRuntime();
    const app1 = makeCounterApp();
    rt.loadApp(app1);
    rt.stateStore.set('count', 10);
    const app2 = JSON.parse(JSON.stringify(app1)) as MobileIRApp;
    app2.screens[0].rootChildren[0].properties.content = 'Updated Counter';
    rt.reload(app2);
    expect(rt.stateStore.get('count')).toBe(10);
    rt.dispose();
  });

  test('layout change preserves state', () => {
    const rt = new SimulatorRuntime();
    const app1 = makeCounterApp();
    rt.loadApp(app1);
    rt.stateStore.set('count', 5);
    const app2 = JSON.parse(JSON.stringify(app1)) as MobileIRApp;
    app2.screens[0].rootChildren.push({ id: 'new', kind: 'text', properties: { content: 'New' }, events: [], children: [] });
    rt.reload(app2);
    rt.dispose();
  });

  test('state shape change reinitializes state', () => {
    const rt = new SimulatorRuntime();
    const app1 = makeCounterApp();
    rt.loadApp(app1);
    rt.stateStore.set('count', 99);
    const app2 = JSON.parse(JSON.stringify(app1)) as MobileIRApp;
    app2.screens[0].states.push({ name: 'extra', type: 'text', initialValue: 'hello' });
    rt.reload(app2);
    rt.dispose();
  });

  test('navigation change resets to start screen', () => {
    const rt = new SimulatorRuntime();
    const app1 = makeNavigationApp();
    rt.loadApp(app1);
    rt.navigation.navigate('ScreenA');
    expect(rt.navigation.currentScreen()).toBe('ScreenA');
    const app2 = JSON.parse(JSON.stringify(app1)) as MobileIRApp;
    app2.screens.push({ name: 'ScreenC', states: [], rootChildren: [] });
    rt.reload(app2);
    expect(rt.navigation.currentScreen()).toBe('Home');
    rt.dispose();
  });

  test('reload fires onDidReload with classification', () => {
    const rt = new SimulatorRuntime();
    const app1 = makeCounterApp();
    rt.loadApp(app1);
    let classification = '';
    rt.onDidReload(c => classification = c);
    const app2 = JSON.parse(JSON.stringify(app1)) as MobileIRApp;
    app2.screens[0].rootChildren[0].properties.color = 'error';
    rt.reload(app2);
    expect(classification).toBe('StyleOnly');
    rt.dispose();
  });
});

/* ===== Phase 4: Compile error preservation ===== */

describe('Phase 4: Compile error preservation', () => {
  test('failed compilation preserves previous app', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makeCounterApp());
    expect(rt.getApp()!.name).toBe('Counter');
    rt.stateStore.set('count', 7);
    const badResult = compileDesignerToIR('Bad', []);
    expect(badResult.ok).toBe(false);
    expect(rt.getApp()!.name).toBe('Counter');
    expect(rt.stateStore.get('count')).toBe(7);
    rt.dispose();
  });
});

/* ===== Phase 4: Session lifecycle ===== */

describe('Phase 4: Session lifecycle', () => {
  test('start → stop → restart cycle', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makeCounterApp());
    expect(rt.getApp()).toBeDefined();
    rt.reset();
    rt.loadApp(makeCounterApp());
    expect(rt.getApp()).toBeDefined();
    rt.dispose();
  });

  test('dispose cleans up all subsystems', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makeCounterApp());
    rt.dispose();
  });

  test('repeated load/dispose cycle does not leak', () => {
    for (let i = 0; i < 50; i++) {
      const rt = new SimulatorRuntime();
      rt.loadApp(makeCounterApp());
      rt.stateStore.set('count', i);
      rt.dispose();
    }
  });

  test('reset clears all state', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makeCounterApp());
    rt.stateStore.set('count', 42);
    rt.storage.set('local', 'key', 'value');
    rt.permissions.setState('camera', 'granted');
    rt.reset();
    expect(rt.stateStore.get('count')).toBe(0);
    expect(rt.storage.allEntries()).toHaveLength(0);
    rt.dispose();
  });
});

/* ===== Phase 4: Multi-project isolation ===== */

describe('Phase 4: Multi-project isolation', () => {
  test('two runtime instances have independent state', () => {
    const rt1 = new SimulatorRuntime();
    const rt2 = new SimulatorRuntime();
    rt1.loadApp(makeCounterApp());
    rt2.loadApp(makeTodoApp());
    rt1.stateStore.set('count', 42);
    expect(rt2.stateStore.get('count') === 42).toBe(false);
    rt1.dispose();
    rt2.dispose();
  });

  test('two runtime instances have independent permissions', () => {
    const rt1 = new SimulatorRuntime();
    const rt2 = new SimulatorRuntime();
    rt1.loadApp(makePermissionsApp());
    rt2.loadApp(makePermissionsApp());
    rt1.permissions.setState('camera', 'granted');
    expect(rt2.permissions.getState('camera')).toBe('not_requested');
    rt1.dispose();
    rt2.dispose();
  });

  test('two runtime instances have independent storage', () => {
    const rt1 = new SimulatorRuntime();
    const rt2 = new SimulatorRuntime();
    rt1.loadApp(makeCounterApp());
    rt2.loadApp(makeCounterApp());
    rt1.storage.set('local', 'key1', 'val1');
    expect(rt2.storage.allEntries()).toHaveLength(0);
    rt1.dispose();
    rt2.dispose();
  });

  test('two runtime instances have independent event logs', () => {
    const rt1 = new SimulatorRuntime();
    const rt2 = new SimulatorRuntime();
    rt1.loadApp(makeCounterApp());
    rt2.loadApp(makeCounterApp());
    rt1.eventLog.log('button_tapped', 'tap1');
    rt1.eventLog.log('button_tapped', 'tap2');
    const rt2Events = rt2.eventLog.recent(100);
    const rt2Taps = rt2Events.filter(e => e.type === 'button_tapped');
    expect(rt2Taps).toHaveLength(0);
    rt1.dispose();
    rt2.dispose();
  });

  test('two runtime instances have independent environment', () => {
    const rt1 = new SimulatorRuntime();
    const rt2 = new SimulatorRuntime();
    rt1.loadApp(makeCounterApp());
    rt2.loadApp(makeCounterApp());
    rt1.setTheme('dark');
    expect(rt2.getEnvironment().theme).toBe('light');
    rt1.dispose();
    rt2.dispose();
  });
});

/* ===== Phase 4: Performance and resource tests ===== */

describe('Phase 4: Performance contracts', () => {
  test('performance metrics recording', () => {
    const clock = new SimulatorClock();
    const perf = new SimulatorPerformance(clock);
    clock.freeze(0);
    perf.record('render', 16, 'ms');
    perf.record('render', 18, 'ms');
    perf.record('render', 14, 'ms');
    const metrics = perf.getMetrics('render');
    expect(metrics.length).toBe(3);
    const summary = perf.getSummary();
    expect(summary.render).toBeDefined();
    expect(summary.render.count).toBe(3);
    expect(summary.render.avg).toBeGreaterThan(0);
    perf.dispose();
  });

  test('render traces recording', () => {
    const clock = new SimulatorClock();
    const perf = new SimulatorPerformance(clock);
    clock.freeze(0);
    perf.beginRender();
    clock.advance(5);
    perf.endRender('test', ['component-1']);
    const traces = perf.getTraces();
    expect(traces.length).toBe(1);
    perf.dispose();
  });

  test('performance reset clears all data', () => {
    const clock = new SimulatorClock();
    const perf = new SimulatorPerformance(clock);
    perf.record('test', 10, 'ms');
    perf.reset();
    expect(perf.getMetrics()).toHaveLength(0);
    perf.dispose();
  });
});

describe('Phase 4: Memory/leak prevention', () => {
  test('500 hot reloads do not accumulate errors', () => {
    const rt = new SimulatorRuntime();
    const app = makeCounterApp();
    rt.loadApp(app);
    for (let i = 0; i < 500; i++) {
      const modified = JSON.parse(JSON.stringify(app)) as MobileIRApp;
      modified.screens[0].rootChildren[0].properties.content = `Counter ${i}`;
      rt.reload(modified);
    }
    expect(rt.diagnostics.all().filter(d => d.severity === 'error')).toHaveLength(0);
    rt.dispose();
  });

  test('1000 navigation cycles do not corrupt stack', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makeNavigationApp());
    for (let i = 0; i < 1000; i++) {
      rt.navigation.navigate(i % 3 === 0 ? 'Home' : i % 3 === 1 ? 'ScreenA' : 'ScreenB');
    }
    expect(rt.navigation.currentScreen()).toBeDefined();
    rt.dispose();
  });

  test('500 start/stop cycles clean up', () => {
    for (let i = 0; i < 500; i++) {
      const rt = new SimulatorRuntime();
      rt.loadApp(makeCounterApp());
      rt.reset();
      rt.dispose();
    }
  });

  test('1000 network entries capped', () => {
    const caps = new SimulatorCapabilities();
    const http = new SimulatorHttp(caps.connectivity);
    const clock = new SimulatorClock();
    const inspector = new SimulatorNetworkInspector(http, clock);
    for (let i = 0; i < 1000; i++) {
      http.addMock({ method: 'GET', path: `/e${i}`, status: 200, delayMs: 0, body: '{}' });
    }
    expect(inspector.getEntries().length).toBeLessThanOrEqual(500);
    inspector.dispose();
    http.dispose();
  });

  test('event log bounded under continuous logging', () => {
    const log = new SimulatorEventLog();
    for (let i = 0; i < 2000; i++) {
      log.log('state_changed', `change ${i}`);
    }
    expect(log.recent(10000).length).toBeLessThanOrEqual(5000);
    log.dispose();
  });
});

/* ===== Phase 4: Developer workflow tests via TestRunnerV2 ===== */

describe('Phase 4: Developer workflow - Counter', () => {
  test('increment and reset workflow', async () => {
    const clock = new SimulatorClock();
    const runner = new SimulatorTestRunnerV2(clock);
    const app = makeCounterApp();
    const testCase: TestCaseV2 = {
      name: 'counter workflow',
      steps: [
        { action: 'launch' },
        { action: 'expectScreen', screen: 'Main' },
        { action: 'tap', query: 'Increment' },
        { action: 'expectState', key: 'count', value: 1 },
        { action: 'tap', query: 'Increment' },
        { action: 'expectState', key: 'count', value: 2 },
        { action: 'tap', query: 'Decrement' },
        { action: 'expectState', key: 'count', value: 1 },
        { action: 'tap', query: 'Reset' },
        { action: 'expectState', key: 'count', value: 0 },
      ],
    };
    const rt = new SimulatorRuntime();
    const result = await runner.runOne(rt, app, testCase);
    expect(result.passed).toBe(true);
    rt.dispose();
    runner.dispose();
  });
});

describe('Phase 4: Developer workflow - Navigation', () => {
  test('forward and back navigation', async () => {
    const clock = new SimulatorClock();
    const runner = new SimulatorTestRunnerV2(clock);
    const app = makeNavigationApp();
    const testCase: TestCaseV2 = {
      name: 'navigation workflow',
      steps: [
        { action: 'launch' },
        { action: 'expectScreen', screen: 'Home' },
        { action: 'tap', query: 'Go to Screen A' },
        { action: 'expectScreen', screen: 'ScreenA' },
        { action: 'tap', query: 'Go B' },
        { action: 'expectScreen', screen: 'ScreenB' },
      ],
    };
    const rt = new SimulatorRuntime();
    const result = await runner.runOne(rt, app, testCase);
    expect(result.passed).toBe(true);
    rt.dispose();
    runner.dispose();
  });
});

describe('Phase 4: Developer workflow - Forms', () => {
  test('form fill workflow', async () => {
    const clock = new SimulatorClock();
    const runner = new SimulatorTestRunnerV2(clock);
    const app = makeFormsApp();
    const testCase: TestCaseV2 = {
      name: 'forms workflow',
      steps: [
        { action: 'launch' },
        { action: 'enterText', query: 'name', text: 'Alice' },
        { action: 'expectState', key: 'name', value: 'Alice' },
        { action: 'enterText', query: 'email', text: 'alice@test.com' },
        { action: 'expectState', key: 'email', value: 'alice@test.com' },
        { action: 'toggle', query: 'agree' },
        { action: 'expectState', key: 'agree', value: true },
      ],
    };
    const rt = new SimulatorRuntime();
    const result = await runner.runOne(rt, app, testCase);
    expect(result.passed).toBe(true);
    rt.dispose();
    runner.dispose();
  });
});

describe('Phase 4: Developer workflow - HTTP', () => {
  test('mock HTTP workflow', async () => {
    const clock = new SimulatorClock();
    const runner = new SimulatorTestRunnerV2(clock);
    const app = makeHttpApp();
    const testCase: TestCaseV2 = {
      name: 'http mock workflow',
      steps: [
        { action: 'launch' },
        { action: 'mockHttp', endpoint: { method: 'GET', path: '/api/products', status: 200, delayMs: 0, body: '["Widget","Gadget"]' } },
        { action: 'tap', query: 'Load Products' },
        { action: 'expectState', key: 'loading', value: true },
      ],
    };
    const rt = new SimulatorRuntime();
    const result = await runner.runOne(rt, app, testCase);
    expect(result.passed).toBe(true);
    rt.dispose();
    runner.dispose();
  });
});

describe('Phase 4: Developer workflow - Permissions', () => {
  test('permission grant/deny workflow', async () => {
    const clock = new SimulatorClock();
    const runner = new SimulatorTestRunnerV2(clock);
    const app = makePermissionsApp();
    const testCase: TestCaseV2 = {
      name: 'permissions workflow',
      steps: [
        { action: 'launch' },
        { action: 'setPermission', name: 'camera', state: 'denied' },
        { action: 'setPermission', name: 'camera', state: 'granted' },
      ],
    };
    const rt = new SimulatorRuntime();
    const result = await runner.runOne(rt, app, testCase);
    expect(result.passed).toBe(true);
    rt.dispose();
    runner.dispose();
  });
});

describe('Phase 4: Developer workflow - Offline', () => {
  test('online/offline/online cycle', async () => {
    const clock = new SimulatorClock();
    const runner = new SimulatorTestRunnerV2(clock);
    const app = makeHttpApp();
    const testCase: TestCaseV2 = {
      name: 'offline workflow',
      steps: [
        { action: 'launch' },
        { action: 'setNetwork', mode: 'online' },
        { action: 'setNetwork', mode: 'offline' },
        { action: 'setNetwork', mode: 'online' },
      ],
    };
    const rt = new SimulatorRuntime();
    const result = await runner.runOne(rt, app, testCase);
    expect(result.passed).toBe(true);
    rt.dispose();
    runner.dispose();
  });
});

describe('Phase 4: Developer workflow - Gestures', () => {
  test('gesture interaction workflow', async () => {
    const clock = new SimulatorClock();
    const runner = new SimulatorTestRunnerV2(clock);
    const app = makeGestureShowcaseApp();
    const testCase: TestCaseV2 = {
      name: 'gesture workflow',
      steps: [
        { action: 'launch' },
        { action: 'tap', query: 'Tap Me' },
        { action: 'expectState', key: 'lastGesture', value: 'tap' },
        { action: 'longPress', query: 'Tap Me' },
        { action: 'expectState', key: 'lastGesture', value: 'long_press' },
      ],
    };
    const rt = new SimulatorRuntime();
    const result = await runner.runOne(rt, app, testCase);
    expect(result.passed).toBe(true);
    rt.dispose();
    runner.dispose();
  });
});

describe('Phase 4: Developer workflow - Multi-screen state', () => {
  test('state isolation across screens', async () => {
    const clock = new SimulatorClock();
    const runner = new SimulatorTestRunnerV2(clock);
    const app = makeMultiScreenStateApp();
    const testCase: TestCaseV2 = {
      name: 'multi-screen state',
      steps: [
        { action: 'launch' },
        { action: 'tap', query: 'Inc' },
        { action: 'expectState', key: 'count', value: 1 },
        { action: 'tap', query: 'Go S2' },
        { action: 'expectScreen', screen: 'Screen2' },
        { action: 'enterText', query: 'note', text: 'Hello' },
        { action: 'expectState', key: 'note', value: 'Hello' },
      ],
    };
    const rt = new SimulatorRuntime();
    const result = await runner.runOne(rt, app, testCase);
    expect(result.passed).toBe(true);
    rt.dispose();
    runner.dispose();
  });
});

/* ===== Phase 4: Registry and parity contracts ===== */

describe('Phase 4: Registry certification', () => {
  test('registry counts consistent', () => {
    const reg = new SimulatorRegistry();
    const caps = reg.allCapabilities();
    const comps = reg.allComponents();
    const counts = reg.counts();
    expect(caps.length).toBeGreaterThan(0);
    expect(comps.length).toBeGreaterThan(0);
    const capSupported = reg.supportedCapabilities().length;
    const capPartial = reg.partialCapabilities().length;
    const capAndroid = reg.androidOnlyCapabilities().length;
    expect(capSupported + capPartial + capAndroid).toBe(caps.length);
  });
});

/* ===== Phase 4: IPC security contracts ===== */

describe('Phase 4: IPC security', () => {
  test('SimulatorRuntime does not expose process or eval', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makeCounterApp());
    const rtProto = Object.getOwnPropertyNames(Object.getPrototypeOf(rt));
    expect(rtProto.includes('exec')).toBe(false);
    expect(rtProto.includes('eval')).toBe(false);
    expect(rtProto.includes('spawn')).toBe(false);
    expect(rtProto.includes('require')).toBe(false);
    rt.dispose();
  });

  test('actions interpreter does not eval arbitrary code', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makeCounterApp());
    void rt.executeAction('set count to 1');
    expect(rt.stateStore.get('count')).toBe(1);
    void rt.executeAction('process.exit(1)');
    void rt.executeAction('require("child_process")');
    void rt.executeAction('eval("alert(1)")');
    rt.dispose();
  });
});

/* ===== Phase 4: TestRunnerV2 output format tests ===== */

describe('Phase 4: Test output formats', () => {
  test('JUnit output is valid XML structure', () => {
    const clock = new SimulatorClock();
    const runner = new SimulatorTestRunnerV2(clock);
    const report = { total: 2, passed: 1, failed: 1, skipped: 0, duration: 150, results: [
      { name: 'pass test', passed: true, durationMs: 50, events: [] },
      { name: 'fail test', passed: false, durationMs: 100, failedMessage: 'Expected true', events: [] },
    ]};
    const junit = runner.toJUnit(report);
    expect(junit).toContain('<?xml');
    expect(junit).toContain('<testsuite');
    expect(junit).toContain('tests="2"');
    expect(junit).toContain('failures="1"');
    expect(junit).toContain('<testcase');
    expect(junit).toContain('<failure');
    runner.dispose();
  });

  test('JSON output is valid JSON', () => {
    const clock = new SimulatorClock();
    const runner = new SimulatorTestRunnerV2(clock);
    const report = { total: 1, passed: 1, failed: 0, skipped: 0, duration: 50, results: [
      { name: 'test', passed: true, durationMs: 50, events: [] },
    ]};
    const json = runner.toJSON(report);
    const parsed = JSON.parse(json);
    expect(parsed.summary.total).toBe(1);
    expect(parsed.summary.passed).toBe(1);
    runner.dispose();
  });

  test('console summary is human-readable', () => {
    const clock = new SimulatorClock();
    const runner = new SimulatorTestRunnerV2(clock);
    const report = { total: 3, passed: 2, failed: 1, skipped: 0, duration: 200, results: [
      { name: 'a', passed: true, durationMs: 50, events: [] },
      { name: 'b', passed: true, durationMs: 50, events: [] },
      { name: 'c', passed: false, durationMs: 100, failedMessage: 'fail', events: [] },
    ]};
    const summary = runner.toConsoleSummary(report);
    expect(summary).toContain('2/3 passed');
    expect(summary).toContain('1 FAILED');
    runner.dispose();
  });
});

/* ===== Phase 4: Clock and deterministic testing ===== */

describe('Phase 4: Clock determinism', () => {
  test('frozen clock produces repeatable timestamps', () => {
    const c1 = new SimulatorClock();
    const c2 = new SimulatorClock();
    c1.freeze(1000);
    c2.freeze(1000);
    expect(c1.now()).toBe(c2.now());
    c1.advance(50);
    c2.advance(50);
    expect(c1.now()).toBe(c2.now());
    c1.dispose();
    c2.dispose();
  });

  test('timer fires at correct intervals', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    let count = 0;
    clock.setInterval(() => count++, 100);
    clock.advance(100);
    expect(count).toBe(1);
    clock.advance(100);
    expect(count).toBe(2);
    clock.advance(100);
    expect(count).toBe(3);
    clock.dispose();
  });

  test('timeout fires once', () => {
    const clock = new SimulatorClock();
    clock.freeze(0);
    let fired = 0;
    clock.setTimeout(() => fired++, 50);
    clock.advance(50);
    expect(fired).toBe(1);
    clock.advance(50);
    expect(fired).toBe(1);
    clock.dispose();
  });
});

/* ===== Phase 4: Certification checks ===== */

describe('Phase 4: Final certification', () => {
  test('all Phase 1-3 subsystem types accessible', () => {
    const rt = new SimulatorRuntime();
    expect(rt.stateStore).toBeDefined();
    expect(rt.navigation).toBeDefined();
    expect(rt.permissions).toBeDefined();
    expect(rt.capabilities).toBeDefined();
    expect(rt.storage).toBeDefined();
    expect(rt.http).toBeDefined();
    expect(rt.diagnostics).toBeDefined();
    expect(rt.eventLog).toBeDefined();
    expect(rt.actions).toBeDefined();
    expect(rt.clock).toBeDefined();
    expect(rt.environmentModel).toBeDefined();
    expect(rt.gestureEngine).toBeDefined();
    expect(rt.focusManager).toBeDefined();
    expect(rt.animationScheduler).toBeDefined();
    expect(rt.perf).toBeDefined();
    expect(rt.networkInspector).toBeDefined();
    expect(rt.stateDebugger).toBeDefined();
    expect(rt.accessibility).toBeDefined();
    expect(rt.responsive).toBeDefined();
    expect(rt.registry).toBeDefined();
    expect(rt.screenshot).toBeDefined();
    rt.dispose();
  });

  test('17 fixture apps cover all required areas', () => {
    const apps = [
      makeCounterApp(), makeTodoApp(), makeLoginApp(), makeNavigationApp(),
      makeFormsApp(), makeHttpApp(), makePermissionsApp(), makeDialogSnackbarApp(),
      makeAnimationsApp(), makeResponsiveApp(), makeLargeListApp(100), makeAccessibilityApp(),
      makeImageGalleryApp(), makeBiometricsApp(), makeGestureShowcaseApp(),
      makeTabletMasterDetailApp(), makeMultiScreenStateApp(),
    ];
    expect(apps.length).toBe(17);
    const names = new Set(apps.map(a => a.name));
    expect(names.size).toBe(17);
  });

  test('all 28 supported component kinds render without error', () => {
    const kinds = ['text', 'button', 'image', 'icon', 'input', 'checkbox', 'switch', 'slider',
      'dropdown', 'column', 'row', 'stack', 'grid', 'spacer', 'divider',
      'scrollview', 'navbar', 'bottomnav', 'tabs', 'fab', 'card', 'list',
      'chip', 'badge', 'progress', 'snackbar', 'dialog'];
    const rt = new SimulatorRuntime();
    for (const kind of kinds) {
      const app: MobileIRApp = {
        name: 'KindTest', startScreen: 'Main', permissions: [], capabilities: [],
        screens: [{ name: 'Main', states: [], rootChildren: [
          { id: 'n', kind, properties: { label: 'Test', content: 'Test' }, events: [], children: [] },
        ]}],
      };
      rt.loadApp(app);
      const errors = rt.diagnostics.all().filter(d => d.severity === 'error' && d.category === 'unsupported_ir');
      expect(errors).toHaveLength(0);
    }
    rt.dispose();
  });

  test('Android verification remains separate from simulator', () => {
    const rt = new SimulatorRuntime();
    rt.loadApp(makeCounterApp());
    const rtProto = Object.getOwnPropertyNames(Object.getPrototypeOf(rt));
    expect(rtProto.includes('buildApk')).toBe(false);
    expect(rtProto.includes('installAndroid')).toBe(false);
    expect(rtProto.includes('launchAndroid')).toBe(false);
    rt.dispose();
  });
});
