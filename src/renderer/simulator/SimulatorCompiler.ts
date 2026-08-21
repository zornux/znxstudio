import type { ScreenModel, ComponentNode, StateDeclaration } from '../designer/designerDocument';
import type {
  MobileIRApp,
  MobileIRScreen,
  MobileIRNode,
  MobileIRStateDeclaration,
  SimulatorCompileResult,
  SimulatorDiagnostic,
} from '../../shared/simulatorTypes';

export function compileDesignerToIR(
  appName: string,
  screens: ScreenModel[],
  startScreen?: string,
): SimulatorCompileResult {
  const startTime = performance.now();
  const diagnostics: SimulatorDiagnostic[] = [];

  if (screens.length === 0) {
    diagnostics.push({
      severity: 'error',
      category: 'application_error',
      message: 'No screens to compile',
    });
    return { ok: false, app: null, diagnostics, durationMs: performance.now() - startTime };
  }

  const resolvedStart = startScreen ?? screens[0].name;
  if (!screens.some((s) => s.name === resolvedStart)) {
    diagnostics.push({
      severity: 'error',
      category: 'navigation_error',
      message: `Start screen '${resolvedStart}' not found`,
    });
    return { ok: false, app: null, diagnostics, durationMs: performance.now() - startTime };
  }

  const irScreens: MobileIRScreen[] = screens.map((screen) =>
    convertScreen(screen, diagnostics),
  );

  const permissions = extractPermissions(screens);
  const capabilities = extractCapabilities(screens);

  const app: MobileIRApp = {
    name: appName,
    startScreen: resolvedStart,
    screens: irScreens,
    permissions,
    capabilities,
  };

  return {
    ok: diagnostics.every((d) => d.severity !== 'error'),
    app,
    diagnostics,
    durationMs: performance.now() - startTime,
  };
}

function convertScreen(screen: ScreenModel, diagnostics: SimulatorDiagnostic[]): MobileIRScreen {
  return {
    name: screen.name,
    states: screen.states.map((s) => convertState(s)),
    rootChildren: screen.rootChildren.map((n) => convertNode(n, diagnostics)),
  };
}

function convertState(state: StateDeclaration): MobileIRStateDeclaration {
  return {
    name: state.name,
    type: inferStateType(state.initialValue),
    initialValue: state.initialValue,
  };
}

function inferStateType(value: string): MobileIRStateDeclaration['type'] {
  if (value === 'nothing') return 'any';
  if (value === 'true' || value === 'false') return 'truth';
  if (/^-?\d+$/.test(value)) return 'whole';
  if (/^-?\d+\.\d+$/.test(value)) return 'decimal';
  if (value.startsWith('[')) return 'list';
  if (value.startsWith('{')) return 'record';
  return 'text';
}

function convertNode(node: ComponentNode, diagnostics: SimulatorDiagnostic[]): MobileIRNode {
  return {
    id: node.id,
    kind: node.kind,
    properties: { ...node.properties },
    events: node.events.map((e) => ({ event: e.eventKey, body: e.body })),
    children: node.children.map((c) => convertNode(c, diagnostics)),
    sourceLocation: node.sourceRange
      ? { file: '', startLine: node.sourceRange.start + 1, endLine: node.sourceRange.end + 1 }
      : undefined,
  };
}

function extractPermissions(screens: ScreenModel[]): string[] {
  const perms = new Set<string>();
  for (const screen of screens) {
    walkNodes(screen.rootChildren, (node) => {
      for (const evt of node.events) {
        if (evt.body.includes('request camera')) perms.add('camera');
        if (evt.body.includes('request location')) perms.add('location');
        if (evt.body.includes('request notifications')) perms.add('notifications');
        if (evt.body.includes('request files')) perms.add('files');
        if (evt.body.includes('request microphone')) perms.add('microphone');
        if (evt.body.includes('request contacts')) perms.add('contacts');
      }
    });
  }
  return [...perms];
}

function extractCapabilities(screens: ScreenModel[]): string[] {
  const caps = new Set<string>();
  for (const screen of screens) {
    walkNodes(screen.rootChildren, (node) => {
      for (const evt of node.events) {
        if (evt.body.includes('use camera')) caps.add('camera');
        if (evt.body.includes('use location')) caps.add('location');
        if (evt.body.includes('use biometrics')) caps.add('biometrics');
      }
    });
  }
  return [...caps];
}

function walkNodes(nodes: ComponentNode[], visitor: (node: ComponentNode) => void): void {
  for (const node of nodes) {
    visitor(node);
    walkNodes(node.children, visitor);
  }
}
