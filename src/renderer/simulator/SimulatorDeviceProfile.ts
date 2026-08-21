import type { SimulatorDeviceProfile, DeviceClass } from '../../shared/simulatorTypes';

export const SIMULATOR_DEVICE_PROFILES: readonly SimulatorDeviceProfile[] = [
  {
    id: 'small-phone', label: 'Small Android Phone',
    width: 320, height: 568, density: 2, pixelRatio: 2,
    safeArea: { top: 24, bottom: 0, left: 0, right: 0 },
    statusBarHeight: 24, navigationArea: 48, deviceClass: 'phone',
  },
  {
    id: 'standard-phone', label: 'Standard Android Phone',
    width: 393, height: 852, density: 2.75, pixelRatio: 2.75,
    safeArea: { top: 24, bottom: 0, left: 0, right: 0 },
    statusBarHeight: 24, navigationArea: 48, deviceClass: 'phone',
  },
  {
    id: 'large-phone', label: 'Large Android Phone',
    width: 430, height: 932, density: 3, pixelRatio: 3,
    safeArea: { top: 24, bottom: 0, left: 0, right: 0 },
    statusBarHeight: 24, navigationArea: 48, deviceClass: 'phone',
  },
  {
    id: 'pixel-phone', label: 'Pixel-class Phone',
    width: 412, height: 915, density: 2.625, pixelRatio: 2.625,
    safeArea: { top: 24, bottom: 0, left: 0, right: 0 },
    statusBarHeight: 24, navigationArea: 48, deviceClass: 'phone',
  },
  {
    id: 'galaxy-phone', label: 'Galaxy-class Phone',
    width: 360, height: 780, density: 3, pixelRatio: 3,
    safeArea: { top: 24, bottom: 0, left: 0, right: 0 },
    statusBarHeight: 24, navigationArea: 48, deviceClass: 'phone',
  },
  {
    id: 'small-tablet', label: 'Small Tablet',
    width: 600, height: 1024, density: 1.5, pixelRatio: 1.5,
    safeArea: { top: 24, bottom: 0, left: 0, right: 0 },
    statusBarHeight: 24, navigationArea: 48, deviceClass: 'tablet',
  },
  {
    id: 'large-tablet', label: 'Large Tablet',
    width: 800, height: 1280, density: 1.5, pixelRatio: 1.5,
    safeArea: { top: 24, bottom: 0, left: 0, right: 0 },
    statusBarHeight: 24, navigationArea: 48, deviceClass: 'tablet',
  },
  {
    id: 'foldable', label: 'Foldable',
    width: 841, height: 701, density: 2.5, pixelRatio: 2.5,
    safeArea: { top: 24, bottom: 0, left: 0, right: 0 },
    statusBarHeight: 24, navigationArea: 48, deviceClass: 'foldable',
  },
];

const profilesById = new Map(SIMULATOR_DEVICE_PROFILES.map((p) => [p.id, p]));

export function getDeviceProfile(id: string): SimulatorDeviceProfile | undefined {
  return profilesById.get(id);
}

export function profilesByClass(deviceClass: DeviceClass): SimulatorDeviceProfile[] {
  return SIMULATOR_DEVICE_PROFILES.filter((p) => p.deviceClass === deviceClass);
}

export function createCustomProfile(
  label: string,
  width: number,
  height: number,
  deviceClass: DeviceClass = 'phone',
): SimulatorDeviceProfile {
  return {
    id: `custom-${width}x${height}`,
    label,
    width,
    height,
    density: 2,
    pixelRatio: 2,
    safeArea: { top: 24, bottom: 0, left: 0, right: 0 },
    statusBarHeight: 24,
    navigationArea: 48,
    deviceClass,
  };
}

export const DEFAULT_DEVICE_PROFILE = SIMULATOR_DEVICE_PROFILES[1];
