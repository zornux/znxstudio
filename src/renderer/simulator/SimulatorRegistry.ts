import type { SimulatorSupport } from '../../shared/simulatorTypes';

export interface CapabilityRegistryEntry {
  name: string;
  support: SimulatorSupport;
  description: string;
  simulatorBehavior: string;
  androidBehavior: string;
}

export interface ComponentRegistryEntry {
  kind: string;
  support: SimulatorSupport;
  properties: string[];
  events: string[];
  bindings: string[];
  accessibilityRoles: string[];
}

const CAPABILITY_REGISTRY: CapabilityRegistryEntry[] = [
  { name: 'camera', support: 'SimulatorPartial', description: 'Camera capture', simulatorBehavior: 'Returns sample/test image', androidBehavior: 'Real camera hardware' },
  { name: 'location', support: 'SimulatorSupported', description: 'Geolocation', simulatorBehavior: 'Fixed/route simulation', androidBehavior: 'GPS/network location' },
  { name: 'biometrics', support: 'SimulatorSupported', description: 'Biometric auth', simulatorBehavior: 'Configurable result', androidBehavior: 'Fingerprint/face' },
  { name: 'notifications', support: 'SimulatorPartial', description: 'Push notifications', simulatorBehavior: 'Local simulation, no FCM', androidBehavior: 'FCM + local' },
  { name: 'files', support: 'SimulatorPartial', description: 'File picker', simulatorBehavior: 'Returns null/sample', androidBehavior: 'System file picker' },
  { name: 'sharing', support: 'SimulatorSupported', description: 'Share sheet', simulatorBehavior: 'Configurable result', androidBehavior: 'System share' },
  { name: 'connectivity', support: 'SimulatorSupported', description: 'Network state', simulatorBehavior: 'Online/offline/slow/intermittent', androidBehavior: 'Real connectivity' },
  { name: 'storage_local', support: 'SimulatorSupported', description: 'Local storage', simulatorBehavior: 'In-memory store', androidBehavior: 'SharedPreferences' },
  { name: 'storage_secure', support: 'SimulatorSupported', description: 'Secure storage', simulatorBehavior: 'In-memory (not encrypted)', androidBehavior: 'Keystore-backed' },
  { name: 'nfc', support: 'AndroidOnly', description: 'NFC', simulatorBehavior: 'Not available', androidBehavior: 'NFC hardware' },
  { name: 'bluetooth', support: 'AndroidOnly', description: 'Bluetooth', simulatorBehavior: 'Not available', androidBehavior: 'Bluetooth hardware' },
  { name: 'sensors', support: 'AndroidOnly', description: 'Device sensors', simulatorBehavior: 'Not available', androidBehavior: 'Accelerometer/gyroscope' },
  { name: 'background_services', support: 'AndroidOnly', description: 'Background services', simulatorBehavior: 'Not available', androidBehavior: 'Android services' },
  { name: 'push_delivery', support: 'AndroidOnly', description: 'Real push delivery', simulatorBehavior: 'Not available', androidBehavior: 'FCM delivery' },
];

const COMPONENT_REGISTRY: ComponentRegistryEntry[] = [
  { kind: 'text', support: 'SimulatorSupported', properties: ['content', 'color', 'fontSize', 'lineHeight', 'letterSpacing', 'textAlign', 'maxLines', 'size', 'weight'], events: ['tapped'], bindings: [], accessibilityRoles: ['text'] },
  { kind: 'button', support: 'SimulatorSupported', properties: ['label', 'style', 'enabled', 'loading', 'iconName', 'containerColor', 'contentColor'], events: ['tapped'], bindings: [], accessibilityRoles: ['button'] },
  { kind: 'input', support: 'SimulatorSupported', properties: ['label', 'placeholder', 'inputType', 'maxLength', 'required', 'readOnly', 'leadingIcon', 'trailingIcon', 'supportingText', 'isError', 'binding'], events: ['changed', 'submitted'], bindings: ['binding'], accessibilityRoles: ['textbox'] },
  { kind: 'image', support: 'SimulatorSupported', properties: ['source', 'alt', 'fit', 'cornerRadius', 'tintColor'], events: ['tapped'], bindings: [], accessibilityRoles: ['img'] },
  { kind: 'icon', support: 'SimulatorSupported', properties: ['name', 'iconSize', 'color', 'tintColor'], events: ['tapped'], bindings: [], accessibilityRoles: ['img'] },
  { kind: 'checkbox', support: 'SimulatorSupported', properties: ['label', 'checked', 'enabled', 'checkColor', 'labelColor', 'binding'], events: ['toggled'], bindings: ['binding'], accessibilityRoles: ['checkbox'] },
  { kind: 'switch', support: 'SimulatorSupported', properties: ['label', 'checked', 'enabled', 'trackColor', 'thumbColor', 'binding'], events: ['toggled'], bindings: ['binding'], accessibilityRoles: ['switch'] },
  { kind: 'slider', support: 'SimulatorSupported', properties: ['min', 'max', 'step', 'value', 'enabled', 'activeColor', 'showValue', 'binding'], events: ['changed'], bindings: ['binding'], accessibilityRoles: ['slider'] },
  { kind: 'dropdown', support: 'SimulatorSupported', properties: ['items', 'label', 'enabled', 'binding'], events: ['changed'], bindings: ['binding'], accessibilityRoles: ['listbox'] },
  { kind: 'progress', support: 'SimulatorSupported', properties: ['progressStyle', 'indeterminate', 'indicatorColor', 'trackColor', 'binding'], events: [], bindings: ['binding'], accessibilityRoles: ['progressbar'] },
  { kind: 'card', support: 'SimulatorSupported', properties: ['contentColor', 'elevation'], events: ['tapped'], bindings: [], accessibilityRoles: ['group'] },
  { kind: 'list', support: 'SimulatorSupported', properties: ['separator', 'binding'], events: ['item_tapped'], bindings: ['binding'], accessibilityRoles: ['list'] },
  { kind: 'navbar', support: 'SimulatorSupported', properties: ['title', 'showBack', 'barStyle'], events: ['back_tapped'], bindings: [], accessibilityRoles: ['navigation'] },
  { kind: 'bottomnav', support: 'SimulatorSupported', properties: ['items', 'icons', 'binding'], events: ['changed'], bindings: ['binding'], accessibilityRoles: ['tablist'] },
  { kind: 'tabs', support: 'SimulatorSupported', properties: ['items', 'binding'], events: ['changed'], bindings: ['binding'], accessibilityRoles: ['tablist'] },
  { kind: 'fab', support: 'SimulatorSupported', properties: ['iconName', 'label', 'fabSize'], events: ['tapped'], bindings: [], accessibilityRoles: ['button'] },
  { kind: 'chip', support: 'SimulatorSupported', properties: ['label', 'chipStyle', 'selected'], events: ['tapped'], bindings: [], accessibilityRoles: ['option'] },
  { kind: 'badge', support: 'SimulatorSupported', properties: ['content', 'color'], events: [], bindings: [], accessibilityRoles: ['status'] },
  { kind: 'divider', support: 'SimulatorSupported', properties: ['color', 'thickness'], events: [], bindings: [], accessibilityRoles: ['separator'] },
  { kind: 'spacer', support: 'SimulatorSupported', properties: ['size'], events: [], bindings: [], accessibilityRoles: [] },
  { kind: 'snackbar', support: 'SimulatorSupported', properties: ['message', 'action', 'duration'], events: ['action_tapped', 'dismissed'], bindings: [], accessibilityRoles: ['alert'] },
  { kind: 'dialog', support: 'SimulatorSupported', properties: ['title', 'confirmLabel', 'cancelLabel', 'dismissible'], events: ['confirmed', 'cancelled'], bindings: [], accessibilityRoles: ['dialog'] },
  { kind: 'column', support: 'SimulatorSupported', properties: ['scrollable', 'spacing', 'mainAlignment', 'crossAlignment'], events: [], bindings: [], accessibilityRoles: ['group'] },
  { kind: 'row', support: 'SimulatorSupported', properties: ['spacing', 'mainAlignment', 'crossAlignment'], events: [], bindings: [], accessibilityRoles: ['group'] },
  { kind: 'stack', support: 'SimulatorSupported', properties: ['contentAlignment'], events: [], bindings: [], accessibilityRoles: ['group'] },
  { kind: 'grid', support: 'SimulatorSupported', properties: ['columns', 'spacing'], events: [], bindings: [], accessibilityRoles: ['grid'] },
  { kind: 'scrollview', support: 'SimulatorSupported', properties: ['direction'], events: [], bindings: [], accessibilityRoles: ['region'] },
];

export class SimulatorRegistry {
  getCapability(name: string): CapabilityRegistryEntry | undefined {
    return CAPABILITY_REGISTRY.find(c => c.name === name);
  }

  allCapabilities(): readonly CapabilityRegistryEntry[] {
    return CAPABILITY_REGISTRY;
  }

  getComponent(kind: string): ComponentRegistryEntry | undefined {
    return COMPONENT_REGISTRY.find(c => c.kind === kind);
  }

  allComponents(): readonly ComponentRegistryEntry[] {
    return COMPONENT_REGISTRY;
  }

  supportedCapabilities(): CapabilityRegistryEntry[] {
    return CAPABILITY_REGISTRY.filter(c => c.support === 'SimulatorSupported');
  }

  partialCapabilities(): CapabilityRegistryEntry[] {
    return CAPABILITY_REGISTRY.filter(c => c.support === 'SimulatorPartial');
  }

  androidOnlyCapabilities(): CapabilityRegistryEntry[] {
    return CAPABILITY_REGISTRY.filter(c => c.support === 'AndroidOnly');
  }

  supportedComponents(): ComponentRegistryEntry[] {
    return COMPONENT_REGISTRY.filter(c => c.support === 'SimulatorSupported');
  }

  counts(): { supported: number; partial: number; androidOnly: number } {
    return {
      supported: CAPABILITY_REGISTRY.filter(c => c.support === 'SimulatorSupported').length + COMPONENT_REGISTRY.filter(c => c.support === 'SimulatorSupported').length,
      partial: CAPABILITY_REGISTRY.filter(c => c.support === 'SimulatorPartial').length,
      androidOnly: CAPABILITY_REGISTRY.filter(c => c.support === 'AndroidOnly').length,
    };
  }
}
