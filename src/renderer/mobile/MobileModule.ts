import {
  ServiceKeys,
  type OutputService,
  type StatusService,
  type WorkspaceService,
} from '../core/Contracts';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import type { AndroidDevice, AndroidEmulator, MobileDoctorResult } from '../../shared/types';

/**
 * Mobile development module for Android. Surfaces device management, doctor
 * checks, run/stop and log streaming in a dedicated Activity Bar sidebar.
 * Only visible when the workspace is detected as `zornux-mobile`.
 */
export class MobileModule implements IModule {
  readonly id = 'znxstudio.mobile';
  readonly displayName = 'Android';

  private context!: ModuleContext;
  private devices: AndroidDevice[] = [];
  private emulators: AndroidEmulator[] = [];
  private selectedDeviceId: string | null = null;
  private doctorResult: MobileDoctorResult | null = null;
  private logsUnsubscribe: (() => void) | null = null;
  private sideBarEl: HTMLDivElement | null = null;
  private logOutputEl: HTMLPreElement | null = null;
  private activityItemRegistered = false;

  activate(context: ModuleContext): void {
    this.context = context;

    // Register commands.
    context.commands.register(CommandIds.MobileShow, () => this.revealSideBar(), 'Mobile: Show Android Panel');
    context.commands.register(CommandIds.MobileDoctor, () => this.runDoctor(), 'Mobile: Run Doctor');
    context.commands.register(CommandIds.MobileRunStart, () => this.runStart(), 'Mobile: Run on Device');
    context.commands.register(CommandIds.MobileRunStop, () => this.runStop(), 'Mobile: Stop');
    context.commands.register(CommandIds.MobileRefreshDevices, () => this.refreshDevices(), 'Mobile: Refresh Devices');

    // Enablement: mobile commands only make sense for mobile workspaces.
    const workspace = context.services.get<WorkspaceService>(ServiceKeys.Workspace);
    context.subscriptions.push(
      context.commands.addEnablementRule((id) => {
        if (
          id === CommandIds.MobileShow ||
          id === CommandIds.MobileDoctor ||
          id === CommandIds.MobileRunStart ||
          id === CommandIds.MobileRunStop ||
          id === CommandIds.MobileRefreshDevices
        ) {
          return this.isMobileWorkspace();
        }
        return undefined;
      }),
    );
    workspace.onDidChangeFolders(() => {
      context.commands.notifyEnablementChanged();
      this.ensureActivityItem();
    });

    // Register the Activity Bar item immediately if this is already a mobile workspace.
    this.ensureActivityItem();

    // Subscribe to mobile log events for streaming output.
    this.logsUnsubscribe = window.znxstudio.mobile.onLogs((event) => {
      this.appendLog(event.line);
    });
    context.subscriptions.push({ dispose: () => this.logsUnsubscribe?.() });
  }

  /** Add the Android Activity Bar item on first detection of a mobile workspace. */
  private ensureActivityItem(): void {
    if (this.activityItemRegistered) return;
    if (!this.isMobileWorkspace()) return;
    this.activityItemRegistered = true;
    this.context.layout.addActivityItem({
      id: 'android',
      label: 'Android',
      icon: 'phone',
      onSelect: () => this.revealSideBar(),
    });
  }

  private isMobileWorkspace(): boolean {
    const workspace = this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    const info = workspace?.currentWorkspace();
    return info?.detectedType === 'zornux-mobile';
  }

  /* ----- Sidebar UI ----- */

  private revealSideBar(): void {
    const view = document.createElement('div');
    view.className = 'znxstudio-mobile';
    this.sideBarEl = view;

    // Section: Doctor Status
    const doctorSection = this.createSection('Environment', view);
    const doctorBtn = this.createButton('Run Doctor', () => this.runDoctor());
    doctorSection.appendChild(doctorBtn);
    const doctorStatus = document.createElement('div');
    doctorStatus.className = 'znxstudio-mobile-doctor-status';
    doctorStatus.setAttribute('data-role', 'doctor-status');
    doctorSection.appendChild(doctorStatus);

    // Section: Devices
    const deviceSection = this.createSection('Devices', view);
    const refreshBtn = this.createButton('Refresh', () => this.refreshDevices());
    deviceSection.appendChild(refreshBtn);
    const deviceList = document.createElement('div');
    deviceList.className = 'znxstudio-mobile-device-list';
    deviceList.setAttribute('data-role', 'device-list');
    deviceSection.appendChild(deviceList);

    // Section: Emulators
    const emulatorSection = this.createSection('Emulators', view);
    const emulatorList = document.createElement('div');
    emulatorList.className = 'znxstudio-mobile-emulator-list';
    emulatorList.setAttribute('data-role', 'emulator-list');
    emulatorSection.appendChild(emulatorList);

    // Section: Run / Stop
    const runSection = this.createSection('Run', view);
    const runBtn = this.createButton('Run on Device', () => this.runStart());
    const stopBtn = this.createButton('Stop', () => this.runStop());
    runSection.appendChild(runBtn);
    runSection.appendChild(stopBtn);

    // Section: Logs
    const logSection = this.createSection('Logs', view);
    const logOutput = document.createElement('pre');
    logOutput.className = 'znxstudio-mobile-logs';
    logOutput.setAttribute('data-role', 'log-output');
    logOutput.style.maxHeight = '300px';
    logOutput.style.overflow = 'auto';
    logOutput.style.fontSize = '12px';
    logOutput.style.whiteSpace = 'pre-wrap';
    logOutput.style.wordBreak = 'break-all';
    this.logOutputEl = logOutput;
    logSection.appendChild(logOutput);

    this.context.layout.setSideBar('Android', view);
    this.context.layout.focusSideBar();

    // Populate device/emulator lists immediately.
    void this.refreshDevices();
    void this.refreshEmulators();
    this.renderDoctorStatus();
  }

  private createSection(title: string, parent: HTMLElement): HTMLDivElement {
    const section = document.createElement('div');
    section.className = 'znxstudio-mobile-section';
    const heading = document.createElement('h3');
    heading.textContent = title;
    heading.style.margin = '8px 0 4px';
    heading.style.fontSize = '11px';
    heading.style.textTransform = 'uppercase';
    heading.style.opacity = '0.7';
    section.appendChild(heading);
    parent.appendChild(section);
    return section;
  }

  private createButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'znxstudio-btn-small';
    btn.textContent = label;
    btn.style.margin = '2px 4px 2px 0';
    btn.addEventListener('click', onClick);
    return btn;
  }

  /* ----- Device management ----- */

  private async refreshDevices(): Promise<void> {
    try {
      this.devices = await window.znxstudio.mobile.devices();
    } catch {
      this.devices = [];
    }
    this.renderDeviceList();
  }

  private async refreshEmulators(): Promise<void> {
    try {
      this.emulators = await window.znxstudio.mobile.emulators();
    } catch {
      this.emulators = [];
    }
    this.renderEmulatorList();
  }

  private renderDeviceList(): void {
    const container = this.sideBarEl?.querySelector('[data-role="device-list"]');
    if (!container) return;
    container.innerHTML = '';

    if (this.devices.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No devices connected.';
      empty.style.opacity = '0.6';
      empty.style.fontSize = '12px';
      empty.style.padding = '4px 0';
      container.appendChild(empty);
      return;
    }

    for (const device of this.devices) {
      const row = document.createElement('div');
      row.style.padding = '2px 0';
      row.style.cursor = 'pointer';
      row.style.fontSize = '12px';
      const selected = device.id === this.selectedDeviceId;
      row.textContent = `${selected ? '> ' : '  '}${device.name} (${device.type}) [${device.status}]`;
      row.addEventListener('click', () => {
        this.selectedDeviceId = device.id;
        void window.znxstudio.mobile.selectDevice(device.id);
        this.renderDeviceList();
      });
      container.appendChild(row);
    }
  }

  private renderEmulatorList(): void {
    const container = this.sideBarEl?.querySelector('[data-role="emulator-list"]');
    if (!container) return;
    container.innerHTML = '';

    if (this.emulators.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No emulators found.';
      empty.style.opacity = '0.6';
      empty.style.fontSize = '12px';
      empty.style.padding = '4px 0';
      container.appendChild(empty);
      return;
    }

    for (const emu of this.emulators) {
      const row = document.createElement('div');
      row.style.padding = '2px 0';
      row.style.fontSize = '12px';
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '6px';

      const label = document.createElement('span');
      label.textContent = `${emu.name}${emu.apiLevel ? ` (API ${emu.apiLevel})` : ''}`;
      row.appendChild(label);

      const startBtn = this.createButton('Start', () => {
        void window.znxstudio.mobile.startEmulator(emu.name);
        this.context.layout.showToast(`Starting emulator: ${emu.name}`, 'info');
      });
      startBtn.style.fontSize = '11px';
      row.appendChild(startBtn);

      container.appendChild(row);
    }
  }

  /* ----- Doctor ----- */

  private async runDoctor(): Promise<void> {
    this.context.layout.showToast('Running mobile doctor...', 'info');
    try {
      this.doctorResult = await window.znxstudio.mobile.doctor('android');
    } catch (error) {
      this.doctorResult = {
        ok: false,
        checks: [{ name: 'doctor', passed: false, detail: (error as Error).message }],
      };
    }
    this.renderDoctorStatus();
    const output = this.context.services.tryGet<OutputService>(ServiceKeys.Output);
    if (output && this.doctorResult) {
      output.show();
      output.appendLine('--- Mobile Doctor (Android) ---');
      for (const check of this.doctorResult.checks) {
        output.appendLine(`  ${check.passed ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}`);
      }
      output.appendLine(this.doctorResult.ok ? 'All checks passed.' : 'Some checks failed.');
    }
  }

  private renderDoctorStatus(): void {
    const container = this.sideBarEl?.querySelector('[data-role="doctor-status"]');
    if (!container) return;
    container.innerHTML = '';

    if (!this.doctorResult) {
      const hint = document.createElement('div');
      hint.textContent = 'Run Doctor to check your environment.';
      hint.style.opacity = '0.6';
      hint.style.fontSize = '12px';
      hint.style.padding = '4px 0';
      container.appendChild(hint);
      return;
    }

    for (const check of this.doctorResult.checks) {
      const row = document.createElement('div');
      row.style.fontSize = '12px';
      row.style.padding = '1px 0';
      row.textContent = `${check.passed ? 'OK' : 'FAIL'} ${check.name}`;
      row.title = check.detail;
      container.appendChild(row);
    }
  }

  /* ----- Run / Stop ----- */

  private async runStart(): Promise<void> {
    const workspace = this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    const info = workspace?.currentWorkspace();
    if (!info) {
      this.context.layout.showToast('Open a mobile project first.', 'error');
      return;
    }

    const status = await window.znxstudio.mobile.status();
    if (status.running) {
      this.context.layout.showToast('Mobile app is already running. Stop it first.', 'info');
      return;
    }

    // Pick a device.
    let deviceId = this.selectedDeviceId;
    if (!deviceId) {
      await this.refreshDevices();
      const available = this.devices.filter((d) => d.status === 'device');
      if (available.length === 0) {
        this.context.layout.showToast('No connected Android devices. Connect one or start an emulator.', 'error');
        return;
      }
      deviceId = available[0].id;
      this.selectedDeviceId = deviceId;
    }

    if (this.logOutputEl) this.logOutputEl.textContent = '';
    this.status()?.setItem('mobile.status', { text: 'mobile: running', side: 'right', priority: 29 });

    try {
      await window.znxstudio.mobile.runStart(deviceId, info.root);
    } catch (error) {
      this.context.layout.showToast(`Mobile run failed: ${(error as Error).message}`, 'error');
      this.status()?.setItem('mobile.status', { text: 'mobile: error', side: 'right', priority: 29, autoHideMs: 4000 });
    }
  }

  private async runStop(): Promise<void> {
    try {
      await window.znxstudio.mobile.runStop();
      this.status()?.setItem('mobile.status', { text: 'mobile: stopped', side: 'right', priority: 29, autoHideMs: 4000 });
    } catch (error) {
      this.context.layout.showToast(`Failed to stop mobile run: ${(error as Error).message}`, 'error');
    }
  }

  /* ----- Log streaming ----- */

  private appendLog(line: string): void {
    if (!this.logOutputEl) return;
    this.logOutputEl.textContent += `${line}\n`;
    this.logOutputEl.scrollTop = this.logOutputEl.scrollHeight;
  }

  /* ----- helpers ----- */

  private status(): StatusService | undefined {
    return this.context.services.tryGet<StatusService>(ServiceKeys.Status);
  }
}
