import {
  ServiceKeys,
  type OutputService,
  type StatusService,
  type WorkspaceService,
  type QuickPickService,
  type EditorService,
} from '../core/Contracts';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import type {
  AndroidDevice,
  AndroidEmulator,
  AndroidProjectConfig,
  MobileBuildProgress,
  MobileBuildResult,
  MobileDebugEvent,
  MobileDoctorResult,
  MobileProfileEvent,
  MobileProfileReport,
  MobileReleaseCheckResult,
  MobileSessionState,
  MobileTestReport,
  ToolchainComponent,
  ToolchainStatus,
} from '../../shared/types';
import { ensureAndroidRunTarget } from './deviceTarget';

/**
 * Android IDE module — the primary development experience for Zornux Mobile.
 *
 * Orchestrates toolchain management, device/emulator selection, run/debug/test/
 * profile sessions, APK/AAB builds, and release validation through the canonical
 * Zornux Mobile CLI. ZnxStudio owns the UX; the compiler/toolchain owns correctness.
 *
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
  private toolchainStatus: ToolchainStatus | null = null;
  private sessionState: MobileSessionState = 'idle';
  private lastTestReport: MobileTestReport | null = null;
  private lastProfileReport: MobileProfileReport | null = null;
  private lastBuildResult: MobileBuildResult | null = null;
  private lastReleaseCheck: MobileReleaseCheckResult | null = null;
  private projectConfig: AndroidProjectConfig | null = null;

  // Unsubscribe handles
  private logsUnsubscribe: (() => void) | null = null;
  private debugEventUnsubscribe: (() => void) | null = null;
  private testResultUnsubscribe: (() => void) | null = null;
  private profileEventUnsubscribe: (() => void) | null = null;
  private buildProgressUnsubscribe: (() => void) | null = null;
  private sessionStateUnsubscribe: (() => void) | null = null;

  // DOM elements
  private sideBarEl: HTMLDivElement | null = null;
  private logOutputEl: HTMLPreElement | null = null;
  private debugStatusEl: HTMLDivElement | null = null;
  private testResultsEl: HTMLDivElement | null = null;
  private profileResultsEl: HTMLDivElement | null = null;
  private buildResultsEl: HTMLDivElement | null = null;
  private releaseResultsEl: HTMLDivElement | null = null;
  private toolchainStatusEl: HTMLDivElement | null = null;
  private deviceSelectorEl: HTMLDivElement | null = null;
  private runTargetEl: HTMLSelectElement | null = null;
  private sessionStatusEl: HTMLSpanElement | null = null;
  private runActionButtons: HTMLButtonElement[] = [];
  private stopActionButton: HTMLButtonElement | null = null;
  private projectSettingsEl: HTMLDivElement | null = null;
  private activityItemRegistered = false;
  private devicePollTimer: ReturnType<typeof setInterval> | null = null;

  activate(context: ModuleContext): void {
    this.context = context;

    // Register all commands.
    context.commands.register(CommandIds.MobileShow, () => this.revealSideBar(), 'Zornux: Show Android Panel');
    context.commands.register(CommandIds.MobileDoctor, () => this.runDoctor(), 'Zornux: Android Doctor');
    context.commands.register(CommandIds.MobileRunStart, () => this.runStart(), 'Zornux: Run Android');
    context.commands.register(CommandIds.MobileRunStop, () => this.runStop(), 'Zornux: Stop');
    context.commands.register(CommandIds.MobileRestart, () => this.restart(), 'Zornux: Restart Android');
    context.commands.register(CommandIds.MobileRefreshDevices, () => this.refreshDevices(), 'Zornux: Refresh Devices');
    context.commands.register(CommandIds.MobileDebugStart, () => this.debugStart(), 'Zornux: Debug Android');
    context.commands.register(CommandIds.MobileDebugStop, () => this.debugStop(), 'Zornux: Stop Debug');
    context.commands.register(CommandIds.MobileTestRun, () => this.testRun(), 'Zornux: Run Android Tests');
    context.commands.register(CommandIds.MobileTestStop, () => this.testStop(), 'Zornux: Stop Tests');
    context.commands.register(CommandIds.MobileSelectDevice, () => this.showDevicePicker(), 'Zornux: Select Android Device');
    context.commands.register(CommandIds.MobileStartEmulator, () => this.showEmulatorPicker(), 'Zornux: Start Emulator');
    context.commands.register(CommandIds.MobileProfileStart, () => this.profileStart(), 'Zornux: Profile Android');
    context.commands.register(CommandIds.MobileProfileStop, () => this.profileStop(), 'Zornux: Stop Profile');
    context.commands.register(CommandIds.MobileBuildApk, () => this.buildApk(), 'Zornux: Build APK');
    context.commands.register(CommandIds.MobileBuildAab, () => this.buildAab(), 'Zornux: Build App Bundle');
    context.commands.register(CommandIds.MobileReleaseCheck, () => this.releaseCheck(), 'Zornux: Check Android Release');
    context.commands.register(CommandIds.MobileClean, () => this.clean(), 'Zornux: Clean Android Build');
    context.commands.register(CommandIds.MobileToolchainSetup, () => this.toolchainSetup(), 'Zornux: Set Up Android Toolchain');
    context.commands.register(CommandIds.MobileSdkManager, () => this.showSdkManager(), 'Zornux: Android SDK Manager');
    context.commands.register(CommandIds.MobileViewGenerated, () => this.viewGenerated(), 'Zornux: View Generated Android');
    context.commands.register(CommandIds.MobileProjectSettings, () => this.showProjectSettings(), 'Zornux: Android Project Settings');

    // Enablement: mobile commands only for mobile workspaces.
    const mobileCommands = [
      CommandIds.MobileShow, CommandIds.MobileDoctor, CommandIds.MobileRunStart,
      CommandIds.MobileRunStop, CommandIds.MobileRestart, CommandIds.MobileRefreshDevices,
      CommandIds.MobileDebugStart, CommandIds.MobileDebugStop, CommandIds.MobileTestRun,
      CommandIds.MobileTestStop, CommandIds.MobileSelectDevice, CommandIds.MobileStartEmulator,
      CommandIds.MobileProfileStart, CommandIds.MobileProfileStop, CommandIds.MobileBuildApk,
      CommandIds.MobileBuildAab, CommandIds.MobileReleaseCheck, CommandIds.MobileClean,
      CommandIds.MobileToolchainSetup, CommandIds.MobileSdkManager, CommandIds.MobileViewGenerated,
      CommandIds.MobileProjectSettings,
    ];
    const workspace = context.services.get<WorkspaceService>(ServiceKeys.Workspace);
    context.subscriptions.push(
      context.commands.addEnablementRule((id) => {
        if (mobileCommands.includes(id as typeof mobileCommands[number])) {
          return this.isMobileWorkspace();
        }
        return undefined;
      }),
    );
    workspace.onDidChangeFolders(() => {
      context.commands.notifyEnablementChanged();
      if (this.isMobileWorkspace()) {
        this.ensureActivityItem();
      } else {
        this.stopDevicePolling();
        this.status()?.removeItem?.('android.device');
        this.status()?.removeItem?.('android.toolchain');
        this.status()?.removeItem?.('mobile.status');
        this.status()?.removeItem?.('mobile.debug');
        this.status()?.removeItem?.('mobile.test');
        this.status()?.removeItem?.('mobile.profile');
      }
    });

    this.ensureActivityItem();

    // Reconcile session state from main process on startup.
    void window.znxstudio.mobile.sessionState().then((state) => {
      this.sessionState = state;
      this.updateSessionStateUI();
    });

    // Subscribe to streaming events.
    this.logsUnsubscribe = window.znxstudio.mobile.onLogs((event) => this.appendLog(event.line));
    context.subscriptions.push({ dispose: () => this.logsUnsubscribe?.() });

    this.debugEventUnsubscribe = window.znxstudio.mobile.onDebugEvent((event) => this.handleDebugEvent(event));
    context.subscriptions.push({ dispose: () => this.debugEventUnsubscribe?.() });

    this.testResultUnsubscribe = window.znxstudio.mobile.onTestResult((report) => {
      this.lastTestReport = report;
      this.renderTestResults();
    });
    context.subscriptions.push({ dispose: () => this.testResultUnsubscribe?.() });

    this.profileEventUnsubscribe = window.znxstudio.mobile.onProfileEvent((event) => this.handleProfileEvent(event));
    context.subscriptions.push({ dispose: () => this.profileEventUnsubscribe?.() });

    this.buildProgressUnsubscribe = window.znxstudio.mobile.onBuildProgress((progress) => this.handleBuildProgress(progress));
    context.subscriptions.push({ dispose: () => this.buildProgressUnsubscribe?.() });

    this.sessionStateUnsubscribe = window.znxstudio.mobile.onSessionState((state) => {
      this.sessionState = state;
      this.updateSessionStateUI();
    });
    context.subscriptions.push({ dispose: () => this.sessionStateUnsubscribe?.() });
  }

  deactivate(): void {
    this.stopDevicePolling();
  }

  /* ===== Activity bar + workspace detection ===== */

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
    this.setDeviceStatusBar();
    void this.checkToolchainOnOpen();
  }

  private isMobileWorkspace(): boolean {
    const workspace = this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    const info = workspace?.currentWorkspace();
    return info?.detectedType === 'zornux-mobile';
  }

  private async checkToolchainOnOpen(): Promise<void> {
    try {
      this.toolchainStatus = await window.znxstudio.androidToolchain.status();
      if (!this.toolchainStatus.ready) {
        this.status()?.setItem('android.toolchain', {
          text: 'Android: Toolchain missing',
          side: 'right',
          priority: 25,
        });
      }
    } catch {
      // Toolchain check failed silently — doctor will surface this.
    }
  }

  /* ===== Sidebar UI ===== */

  private revealSideBar(): void {
    const view = document.createElement('div');
    view.className = 'znxstudio-mobile';
    this.sideBarEl = view;

    // Primary deployment controls stay visible at the top, like Android
    // Studio's run configuration / target / action toolbar.
    const deployment = document.createElement('div');
    deployment.className = 'znxstudio-mobile-deploy';
    const deploymentTitle = document.createElement('div');
    deploymentTitle.className = 'znxstudio-mobile-deploy-title';
    deploymentTitle.innerHTML = '<strong>app</strong><span data-role="session-status">Idle</span>';
    this.sessionStatusEl = deploymentTitle.querySelector('[data-role="session-status"]');
    deployment.appendChild(deploymentTitle);

    const targetRow = document.createElement('div');
    targetRow.className = 'znxstudio-mobile-target-row';
    const target = document.createElement('select');
    target.className = 'znxstudio-mobile-target';
    target.title = 'Deployment target';
    target.setAttribute('aria-label', 'Android deployment target');
    target.addEventListener('change', () => {
      const id = target.value || null;
      if (!id) return;
      this.selectedDeviceId = id;
      void window.znxstudio.mobile.selectDevice(id);
      this.renderDeviceList();
      this.setDeviceStatusBar();
    });
    this.runTargetEl = target;
    targetRow.appendChild(target);
    const refreshTarget = this.createButton('↻', () => void this.refreshDevices());
    refreshTarget.classList.add('znxstudio-mobile-icon-button');
    refreshTarget.title = 'Refresh connected devices';
    refreshTarget.setAttribute('aria-label', 'Refresh connected Android devices');
    targetRow.appendChild(refreshTarget);
    deployment.appendChild(targetRow);

    const primaryActions = document.createElement('div');
    primaryActions.className = 'znxstudio-mobile-primary-actions';
    const runButton = this.createButton('▶ Run', () => void this.runStart());
    runButton.classList.add('is-primary');
    const debugButton = this.createButton('◆ Debug', () => void this.debugStart());
    const restartButton = this.createButton('↻ Restart', () => void this.restart());
    const stopButton = this.createButton('■ Stop', () => void this.runStop());
    this.runActionButtons = [runButton, debugButton, restartButton];
    this.stopActionButton = stopButton;
    primaryActions.append(runButton, debugButton, restartButton, stopButton);
    deployment.appendChild(primaryActions);
    view.appendChild(deployment);

    // Section: Toolchain / Environment
    const toolchainSection = this.createSection('Android Environment', view);
    const toolchainActions = document.createElement('div');
    toolchainActions.style.display = 'flex';
    toolchainActions.style.gap = '4px';
    toolchainActions.style.flexWrap = 'wrap';
    toolchainActions.appendChild(this.createButton('Doctor', () => this.runDoctor()));
    toolchainActions.appendChild(this.createButton('Set Up', () => this.toolchainSetup()));
    toolchainSection.appendChild(toolchainActions);
    const toolchainStatusEl = document.createElement('div');
    toolchainStatusEl.setAttribute('data-role', 'toolchain-status');
    this.toolchainStatusEl = toolchainStatusEl;
    toolchainSection.appendChild(toolchainStatusEl);

    // Section: Devices
    const deviceSection = this.createSection('Device Manager', view);
    const deviceActions = document.createElement('div');
    deviceActions.style.display = 'flex';
    deviceActions.style.gap = '4px';
    deviceActions.appendChild(this.createButton('Refresh', () => this.refreshDevices()));
    deviceActions.appendChild(this.createButton('Start Virtual Device', () => this.showEmulatorPicker()));
    deviceSection.appendChild(deviceActions);
    const deviceList = document.createElement('div');
    deviceList.setAttribute('data-role', 'device-list');
    deviceSection.appendChild(deviceList);

    // Section: Available AVDs
    const emulatorSection = this.createSection('Emulators', view);
    const emulatorList = document.createElement('div');
    emulatorList.setAttribute('data-role', 'emulator-list');
    emulatorSection.appendChild(emulatorList);

    // Debug details are separate from the primary toolbar so break/termination
    // information remains visible without duplicating deployment actions.
    const runSection = this.createSection('Debug Session', view);
    const debugStatus = document.createElement('div');
    debugStatus.setAttribute('data-role', 'debug-status');
    this.debugStatusEl = debugStatus;
    runSection.appendChild(debugStatus);

    // Section: Tests
    const testSection = this.createSection('Tests', view);
    const testActions = document.createElement('div');
    testActions.style.display = 'flex';
    testActions.style.gap = '4px';
    testActions.appendChild(this.createButton('Run Tests', () => this.testRun()));
    testActions.appendChild(this.createButton('Stop', () => this.testStop()));
    testSection.appendChild(testActions);
    const testResults = document.createElement('div');
    testResults.setAttribute('data-role', 'test-results');
    this.testResultsEl = testResults;
    testSection.appendChild(testResults);

    // Section: Profile
    const profileSection = this.createSection('Profile', view);
    const profileActions = document.createElement('div');
    profileActions.style.display = 'flex';
    profileActions.style.gap = '4px';
    profileActions.appendChild(this.createButton('Profile', () => this.profileStart()));
    profileActions.appendChild(this.createButton('Stop', () => this.profileStop()));
    profileSection.appendChild(profileActions);
    const profileResults = document.createElement('div');
    profileResults.setAttribute('data-role', 'profile-results');
    this.profileResultsEl = profileResults;
    profileSection.appendChild(profileResults);

    // Section: Build
    const buildSection = this.createSection('Build & Release', view);
    const buildActions = document.createElement('div');
    buildActions.style.display = 'flex';
    buildActions.style.gap = '4px';
    buildActions.style.flexWrap = 'wrap';
    buildActions.appendChild(this.createButton('Build APK', () => this.buildApk()));
    buildActions.appendChild(this.createButton('Build AAB', () => this.buildAab()));
    buildActions.appendChild(this.createButton('Check Release', () => this.releaseCheck()));
    buildActions.appendChild(this.createButton('Clean', () => this.clean()));
    buildSection.appendChild(buildActions);
    const buildResults = document.createElement('div');
    buildResults.setAttribute('data-role', 'build-results');
    this.buildResultsEl = buildResults;
    buildSection.appendChild(buildResults);
    const releaseResults = document.createElement('div');
    releaseResults.setAttribute('data-role', 'release-results');
    this.releaseResultsEl = releaseResults;
    buildSection.appendChild(releaseResults);

    // Section: Project Settings
    const settingsSection = this.createSection('Project', view);
    const settingsActions = document.createElement('div');
    settingsActions.style.display = 'flex';
    settingsActions.style.gap = '4px';
    settingsActions.appendChild(this.createButton('Settings', () => this.showProjectSettings()));
    settingsActions.appendChild(this.createButton('View Generated', () => this.viewGenerated()));
    settingsSection.appendChild(settingsActions);
    const projectSettings = document.createElement('div');
    projectSettings.setAttribute('data-role', 'project-settings');
    this.projectSettingsEl = projectSettings;
    settingsSection.appendChild(projectSettings);

    // Section: Logs
    const logSection = this.createSection('Application Logs', view);
    const logActions = document.createElement('div');
    logActions.style.display = 'flex';
    logActions.style.gap = '4px';
    logActions.appendChild(this.createButton('Clear', () => {
      if (this.logOutputEl) this.logOutputEl.textContent = '';
    }));
    logSection.appendChild(logActions);
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

    // Populate lists and check initial state; start polling for device changes.
    void this.refreshDevices();
    void this.refreshEmulators();
    this.startDevicePolling();
    void this.refreshToolchainStatus();
    void this.loadProjectConfig();
    this.renderDoctorStatus();
  }

  private createSection(title: string, parent: HTMLElement): HTMLDivElement {
    const section = document.createElement('div');
    section.className = 'znxstudio-mobile-section';
    section.style.marginBottom = '12px';
    const heading = document.createElement('h3');
    heading.textContent = title;
    heading.style.margin = '8px 0 4px';
    heading.style.fontSize = '11px';
    heading.style.textTransform = 'uppercase';
    heading.style.opacity = '0.7';
    heading.style.letterSpacing = '0.5px';
    section.appendChild(heading);
    parent.appendChild(section);
    return section;
  }

  private createButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'znxstudio-btn-small';
    btn.textContent = label;
    btn.style.margin = '2px 0';
    btn.addEventListener('click', onClick);
    return btn;
  }

  /* ===== Device management ===== */

  private startDevicePolling(): void {
    this.stopDevicePolling();
    this.devicePollTimer = setInterval(() => void this.pollDevices(), 3000);
  }

  private stopDevicePolling(): void {
    if (this.devicePollTimer !== null) {
      clearInterval(this.devicePollTimer);
      this.devicePollTimer = null;
    }
  }

  private async pollDevices(): Promise<void> {
    let next: AndroidDevice[];
    try {
      next = await window.znxstudio.mobile.devices();
    } catch {
      return;
    }

    const prevIds = new Set(this.devices.filter((d) => d.status === 'device').map((d) => d.id));
    const nextIds = new Set(next.filter((d) => d.status === 'device').map((d) => d.id));

    if (setsEqual(prevIds, nextIds)) return;

    // Notify on connects/disconnects.
    for (const d of next) {
      if (d.status === 'device' && !prevIds.has(d.id)) {
        this.context.layout.showToast(`Android device connected: ${d.name}`, 'info');
      }
    }
    for (const d of this.devices) {
      if (d.status === 'device' && !nextIds.has(d.id)) {
        this.context.layout.showToast(`Android device disconnected: ${d.name}`, 'info');
      }
    }

    this.devices = next;

    // Invalidate selection if the chosen device disappeared.
    if (this.selectedDeviceId && !nextIds.has(this.selectedDeviceId)) {
      this.selectedDeviceId = null;
    }

    // Auto-select when a device appears and nothing is selected.
    if (!this.selectedDeviceId && nextIds.size > 0) {
      this.selectedDeviceId = next.find((d) => d.status === 'device')?.id ?? null;
    }

    this.renderDeviceList();
    this.renderRunToolbar();
    this.setDeviceStatusBar();
  }

  private async refreshDevices(): Promise<void> {
    try {
      this.devices = await window.znxstudio.mobile.devices();
    } catch {
      this.devices = [];
    }

    // Auto-select when a device appears and nothing is selected.
    if (!this.selectedDeviceId) {
      const available = this.devices.find((d) => d.status === 'device');
      if (available) this.selectedDeviceId = available.id;
    }
    // Invalidate selection if the chosen device disappeared.
    if (this.selectedDeviceId && !this.devices.some((d) => d.id === this.selectedDeviceId && d.status === 'device')) {
      this.selectedDeviceId = null;
    }

    this.renderDeviceList();
    this.renderRunToolbar();
    this.setDeviceStatusBar();
  }

  private async refreshEmulators(): Promise<void> {
    try {
      this.emulators = await window.znxstudio.mobile.emulators();
    } catch {
      this.emulators = [];
    }
    this.renderEmulatorList();
    this.renderRunToolbar();
  }

  private setDeviceStatusBar(): void {
    const selected = this.devices.find((d) => d.id === this.selectedDeviceId);
    if (selected) {
      this.status()?.setItem('android.device', {
        text: `Android: ${selected.name}`,
        side: 'right',
        priority: 26,
      });
    } else if (this.isMobileWorkspace()) {
      this.status()?.setItem('android.device', {
        text: 'Android: No device',
        side: 'right',
        priority: 26,
      });
    }
  }

  private renderDeviceList(): void {
    const container = this.sideBarEl?.querySelector('[data-role="device-list"]');
    if (!container) return;
    container.innerHTML = '';

    if (this.devices.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'znxstudio-mobile-empty';
      empty.innerHTML = '<strong>No running devices</strong><span>Connect a phone with USB debugging, pair over ADB, or start a virtual device.</span>';
      const start = this.createButton('Start Virtual Device', () => void this.showEmulatorPicker());
      empty.appendChild(start);
      container.appendChild(empty);
      return;
    }

    const groups = groupAndroidDevices(this.devices);
    this.renderDeviceGroup(container, 'Physical', groups.physical);
    this.renderDeviceGroup(container, 'Running Virtual', groups.virtual);
  }

  private renderDeviceGroup(container: Element, title: string, devices: AndroidDevice[]): void {
    if (devices.length === 0) return;
    const heading = document.createElement('div');
    heading.className = 'znxstudio-mobile-device-group';
    heading.textContent = `${title} (${devices.length})`;
    container.appendChild(heading);

    for (const device of devices) {
      const row = document.createElement('div');
      row.className = 'znxstudio-mobile-device';

      const selected = device.id === this.selectedDeviceId;
      row.classList.toggle('is-selected', selected);
      row.classList.toggle('is-unavailable', device.status !== 'device');

      const icon = document.createElement('span');
      icon.textContent = device.type === 'emulator' ? '\u{1F4F1}' : '\u{1F4F2}';
      icon.style.fontSize = '14px';
      row.appendChild(icon);

      const info = document.createElement('div');
      info.style.flex = '1';
      const nameEl = document.createElement('div');
      nameEl.textContent = device.name;
      nameEl.style.fontWeight = selected ? 'bold' : 'normal';
      info.appendChild(nameEl);

      const detail = document.createElement('div');
      detail.style.fontSize = '11px';
      detail.style.opacity = '0.7';
      const parts: string[] = [device.type];
      if (device.apiLevel) parts.push(`API ${device.apiLevel}`);
      if (device.status !== 'device') parts.push(device.status);
      detail.textContent = parts.join(' · ');
      info.appendChild(detail);
      row.appendChild(info);

      const state = document.createElement('span');
      state.className = `znxstudio-mobile-device-state is-${device.status}`;
      state.textContent = device.status === 'device' ? 'Ready' : device.status;
      row.appendChild(state);

      row.addEventListener('click', () => {
        if (device.status !== 'device') {
          this.context.layout.showToast(device.status === 'unauthorized'
            ? 'Authorize USB debugging on the Android device, then refresh.'
            : 'This Android device is offline. Reconnect it, then refresh.', 'info');
          return;
        }
        this.selectedDeviceId = device.id;
        void window.znxstudio.mobile.selectDevice(device.id);
        this.renderDeviceList();
        this.renderRunToolbar();
        this.setDeviceStatusBar();
      });
      container.appendChild(row);
    }
  }

  private renderRunToolbar(): void {
    const target = this.runTargetEl;
    if (target) {
      target.innerHTML = '';
      const ready = this.devices.filter((device) => device.status === 'device');
      if (ready.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No devices available';
        target.appendChild(option);
      } else {
        for (const device of ready) {
          const option = document.createElement('option');
          option.value = device.id;
          option.textContent = `${device.name}${device.apiLevel ? ` · API ${device.apiLevel}` : ''}`;
          option.selected = device.id === this.selectedDeviceId;
          target.appendChild(option);
        }
      }
      target.disabled = ready.length === 0;
    }

    const controls = mobileSessionControls(this.sessionState, Boolean(this.selectedDeviceId) || this.emulators.length > 0);
    for (const button of this.runActionButtons) button.disabled = !controls.canLaunch;
    if (this.stopActionButton) this.stopActionButton.disabled = !controls.canStop;
    if (this.sessionStatusEl) {
      this.sessionStatusEl.textContent = controls.label;
      this.sessionStatusEl.className = `is-${this.sessionState}`;
    }
  }

  private renderEmulatorList(): void {
    const container = this.sideBarEl?.querySelector('[data-role="emulator-list"]');
    if (!container) return;
    container.innerHTML = '';

    if (this.emulators.length === 0) {
      this.renderEmpty(container, 'No emulators found.');
      return;
    }

    for (const emu of this.emulators) {
      const row = document.createElement('div');
      row.style.padding = '3px 4px';
      row.style.fontSize = '12px';
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '6px';

      const label = document.createElement('span');
      label.style.flex = '1';
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

  private async showDevicePicker(): Promise<void> {
    await this.refreshDevices();
    const quickPick = this.context.services.tryGet<QuickPickService>(ServiceKeys.QuickPick);
    if (!quickPick || this.devices.length === 0) {
      this.context.layout.showToast('No devices available.', 'info');
      return;
    }
    const items = this.devices.map((d) => ({
      label: d.name,
      description: `${d.type} ${d.apiLevel ? `API ${d.apiLevel}` : ''} [${d.status}]`,
      value: d.id,
    }));
    const result = await quickPick.pick(items, { placeholder: 'Select Android device' });
    if (result) {
      this.selectedDeviceId = result;
      void window.znxstudio.mobile.selectDevice(result);
      this.renderDeviceList();
      this.renderRunToolbar();
      this.setDeviceStatusBar();
    }
  }

  private async showEmulatorPicker(): Promise<void> {
    await this.refreshEmulators();
    const quickPick = this.context.services.tryGet<QuickPickService>(ServiceKeys.QuickPick);
    if (!quickPick || this.emulators.length === 0) {
      this.context.layout.showToast('No emulators available.', 'info');
      return;
    }
    const items = this.emulators.map((e) => ({
      label: e.name,
      description: e.apiLevel ? `API ${e.apiLevel}` : '',
      value: e.name,
    }));
    const result = await quickPick.pick(items, { placeholder: 'Start emulator' });
    if (result) {
      void window.znxstudio.mobile.startEmulator(result);
      this.context.layout.showToast(`Starting: ${result}`, 'info');
    }
  }

  /* ===== Toolchain ===== */

  private async refreshToolchainStatus(): Promise<void> {
    try {
      this.toolchainStatus = await window.znxstudio.androidToolchain.status();
    } catch {
      this.toolchainStatus = null;
    }
    this.renderToolchainStatus();
  }

  private renderToolchainStatus(): void {
    const container = this.toolchainStatusEl ?? this.sideBarEl?.querySelector('[data-role="toolchain-status"]');
    if (!container) return;
    container.innerHTML = '';

    if (!this.toolchainStatus) {
      this.renderEmpty(container, 'Run Doctor to check environment.');
      return;
    }

    for (const comp of this.toolchainStatus.components) {
      const row = document.createElement('div');
      row.style.fontSize = '12px';
      row.style.padding = '1px 0';
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '6px';

      const icon = document.createElement('span');
      icon.textContent = comp.installed ? '✓' : (comp.required ? '✗' : '!');
      icon.style.color = comp.installed ? 'var(--znxstudio-success, #4caf50)' : (comp.required ? 'var(--znxstudio-error, #f44336)' : 'var(--znxstudio-warning, #ff9800)');
      icon.style.fontWeight = 'bold';
      row.appendChild(icon);

      const label = document.createElement('span');
      label.textContent = comp.name;
      label.style.flex = '1';
      row.appendChild(label);

      if (comp.version) {
        const ver = document.createElement('span');
        ver.textContent = comp.version;
        ver.style.opacity = '0.6';
        ver.style.fontSize = '11px';
        row.appendChild(ver);
      }

      container.appendChild(row);
    }

    if (this.toolchainStatus.managedPath) {
      const managed = document.createElement('div');
      managed.style.fontSize = '11px';
      managed.style.opacity = '0.6';
      managed.style.marginTop = '4px';
      managed.textContent = `Managed by Zornux`;
      container.appendChild(managed);
    }
  }

  private async toolchainSetup(): Promise<void> {
    if (this.toolchainStatus?.ready) {
      this.context.layout.showToast('Android toolchain is already configured.', 'info');
      return;
    }

    this.context.layout.showToast('Setting up Android toolchain...', 'info');
    const output = this.output();
    output?.show();
    output?.appendLine('--- Android Toolchain Setup ---');

    const unsubscribe = window.znxstudio.androidToolchain.onSetupProgress((progress) => {
      output?.appendLine(`[${progress.progress}%] ${progress.step}`);
      if (progress.error) {
        output?.appendLine(`ERROR: ${progress.error}`);
        this.context.layout.showToast(`Setup failed: ${progress.error}`, 'error');
      }
      if (progress.complete && !progress.error) {
        output?.appendLine('Android toolchain setup complete.');
        this.context.layout.showToast('Android toolchain ready.', 'info');
        void this.refreshToolchainStatus();
      }
    });

    try {
      await window.znxstudio.androidToolchain.setup();
    } catch (error) {
      this.context.layout.showToast(`Setup failed: ${(error as Error).message}`, 'error');
    } finally {
      unsubscribe();
    }
  }

  private async showSdkManager(): Promise<void> {
    const output = this.output();
    output?.show();
    output?.appendLine('--- Android SDK Components ---');

    try {
      const components = await window.znxstudio.androidToolchain.sdkList();
      for (const comp of components) {
        const status = comp.installed ? 'Installed' : 'Missing';
        const ver = comp.version ? ` (${comp.version})` : '';
        const update = comp.updateAvailable ? ' [Update available]' : '';
        output?.appendLine(`  ${status}  ${comp.name}${ver}${update}`);
      }
    } catch (error) {
      output?.appendLine(`Error listing SDK: ${(error as Error).message}`);
    }
  }

  /* ===== Doctor ===== */

  private async runDoctor(): Promise<void> {
    this.context.layout.showToast('Running Android doctor...', 'info');
    try {
      this.doctorResult = await window.znxstudio.mobile.doctor('android');
      this.toolchainStatus = await window.znxstudio.androidToolchain.status();
    } catch (error) {
      this.doctorResult = {
        ok: false,
        checks: [{ name: 'doctor', passed: false, detail: (error as Error).message }],
      };
    }
    this.renderDoctorStatus();
    this.renderToolchainStatus();

    const output = this.output();
    if (output && this.doctorResult) {
      output.show();
      output.appendLine('--- Android Doctor ---');
      for (const check of this.doctorResult.checks) {
        output.appendLine(`  ${check.passed ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}`);
      }
      output.appendLine(this.doctorResult.ok ? 'All checks passed.' : 'Some checks failed.');
    }

    if (this.toolchainStatus && !this.toolchainStatus.ready) {
      this.status()?.setItem('android.toolchain', {
        text: 'Android: Toolchain missing',
        side: 'right',
        priority: 25,
      });
    } else {
      this.status()?.removeItem?.('android.toolchain');
    }
  }

  private renderDoctorStatus(): void {
    const container = this.toolchainStatusEl ?? this.sideBarEl?.querySelector('[data-role="toolchain-status"]');
    if (!container || !this.doctorResult) return;

    if (this.toolchainStatus) {
      this.renderToolchainStatus();
      return;
    }

    container.innerHTML = '';
    for (const check of this.doctorResult.checks) {
      const row = document.createElement('div');
      row.style.fontSize = '12px';
      row.style.padding = '1px 0';
      row.textContent = `${check.passed ? '✓' : '✗'} ${check.name}`;
      row.title = check.detail;
      container.appendChild(row);
    }
  }

  /* ===== Run / Stop / Restart ===== */

  private async pickDevice(): Promise<string | null> {
    const selected = this.devices.find(
      (device) => device.id === this.selectedDeviceId && device.status === 'device',
    );
    if (selected) return selected.id;

    const quickPick = this.context.services.tryGet<QuickPickService>(ServiceKeys.QuickPick);
    try {
      const deviceId = await ensureAndroidRunTarget({
        api: window.znxstudio.mobile,
        pickDevice: quickPick ? async (devices) => quickPick.pick(
          devices.map((device) => ({ label: device.name, description: `${device.type}${device.apiLevel ? ` · API ${device.apiLevel}` : ''}`, value: device.id })),
          { placeholder: 'Select Android deployment target' },
        ) : undefined,
        pickEmulator: quickPick ? async (emulators) => quickPick.pick(
          emulators.map((emulator) => ({ label: emulator.name, description: emulator.apiLevel ? `API ${emulator.apiLevel}` : 'Android virtual device', value: emulator.name })),
          { placeholder: 'No phone connected — start a virtual device' },
        ) : undefined,
        onProgress: (message) => {
          this.context.layout.showToast(message, 'info');
          if (this.sessionStatusEl) this.sessionStatusEl.textContent = message.includes('Waiting') ? 'Booting emulator…' : 'Starting emulator…';
        },
      });
      if (!deviceId) {
        this.context.layout.showToast('No Android target is available. Create or install a virtual device from Android SDK Manager.', 'error');
        return null;
      }
      this.selectedDeviceId = deviceId;
      await window.znxstudio.mobile.selectDevice(deviceId);
      await this.refreshDevices();
      return deviceId;
    } catch (error) {
      this.context.layout.showToast(`Emulator launch failed: ${(error as Error).message}`, 'error');
      return null;
    }
  }

  private getWorkspaceRoot(): string | null {
    const workspace = this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    const info = workspace?.currentWorkspace();
    if (!info) {
      this.context.layout.showToast('Open a mobile project first.', 'error');
      return null;
    }
    return info.root;
  }

  private async runStart(): Promise<void> {
    const root = this.getWorkspaceRoot();
    if (!root) return;

    const status = await window.znxstudio.mobile.status();
    if (status.running) {
      this.context.layout.showToast('App is already running. Stop it first.', 'info');
      return;
    }

    const deviceId = await this.pickDevice();
    if (!deviceId) return;

    if (this.logOutputEl) this.logOutputEl.textContent = '';
    this.status()?.setItem('mobile.status', { text: 'Android: Running', side: 'right', priority: 29 });

    try {
      await window.znxstudio.mobile.runStart(deviceId, root);
    } catch (error) {
      this.context.layout.showToast(`Run failed: ${(error as Error).message}`, 'error');
      this.status()?.setItem('mobile.status', { text: 'Android: Error', side: 'right', priority: 29, autoHideMs: 4000 });
    }
  }

  private async runStop(): Promise<void> {
    try {
      await window.znxstudio.mobile.runStop();
      this.status()?.setItem('mobile.status', { text: 'Android: Stopped', side: 'right', priority: 29, autoHideMs: 4000 });
    } catch (error) {
      this.context.layout.showToast(`Stop failed: ${(error as Error).message}`, 'error');
    }
  }

  private async restart(): Promise<void> {
    await this.runStop();
    await this.runStart();
  }

  /* ===== Debug ===== */

  private async debugStart(): Promise<void> {
    const root = this.getWorkspaceRoot();
    if (!root) return;

    const deviceId = await this.pickDevice();
    if (!deviceId) return;

    this.status()?.setItem('mobile.debug', { text: 'Android: Debug launching', side: 'right', priority: 30 });

    try {
      await window.znxstudio.mobile.debugStart({ deviceId, workspaceRoot: root });
    } catch (error) {
      this.context.layout.showToast(`Debug failed: ${(error as Error).message}`, 'error');
      this.status()?.setItem('mobile.debug', { text: 'Android: Debug error', side: 'right', priority: 30, autoHideMs: 4000 });
    }
  }

  private async debugStop(): Promise<void> {
    try {
      await window.znxstudio.mobile.debugStop();
      this.status()?.setItem('mobile.debug', { text: 'Android: Debug stopped', side: 'right', priority: 30, autoHideMs: 4000 });
    } catch (error) {
      this.context.layout.showToast(`Stop debug failed: ${(error as Error).message}`, 'error');
    }
  }

  private handleDebugEvent(event: MobileDebugEvent): void {
    const statusEl = this.debugStatusEl;

    switch (event.type) {
      case 'stopped':
        this.status()?.setItem('mobile.debug', { text: `Android: Paused ${event.file ?? ''}:${event.line ?? ''}`, side: 'right', priority: 30 });
        if (statusEl) statusEl.textContent = `Stopped at ${event.file ?? '?'}:${event.line ?? '?'} (${event.reason ?? 'breakpoint'})`;
        if (event.file) this.navigateToSource(event.file, event.line);
        break;
      case 'continued':
        this.status()?.setItem('mobile.debug', { text: 'Android: Debugging', side: 'right', priority: 30 });
        if (statusEl) statusEl.textContent = 'Running';
        break;
      case 'terminated':
        this.status()?.setItem('mobile.debug', { text: 'Android: Debug ended', side: 'right', priority: 30, autoHideMs: 4000 });
        if (statusEl) statusEl.textContent = 'Session ended';
        break;
      case 'output':
        this.appendLog(event.message ?? '');
        break;
    }
  }

  /* ===== Tests ===== */

  private async testRun(): Promise<void> {
    const root = this.getWorkspaceRoot();
    if (!root) return;

    this.status()?.setItem('mobile.test', { text: 'Android: Testing', side: 'right', priority: 28 });

    try {
      const report = await window.znxstudio.mobile.testRun({
        workspaceRoot: root,
        deviceId: this.selectedDeviceId ?? undefined,
      });
      this.lastTestReport = report;
      this.renderTestResults();

      const summary = `${report.passed} passed, ${report.failed} failed`;
      this.status()?.setItem('mobile.test', { text: `Android: ${summary}`, side: 'right', priority: 28, autoHideMs: 8000 });

      const output = this.output();
      if (output) {
        output.show();
        output.appendLine('--- Android Tests ---');
        for (const result of report.results) {
          const status = result.passed ? 'PASS' : 'FAIL';
          const dur = result.durationMs ? ` (${result.durationMs}ms)` : '';
          output.appendLine(`  ${status} ${result.name}${dur}${result.message ? `: ${result.message}` : ''}`);
        }
        output.appendLine(summary);
      }
    } catch (error) {
      this.context.layout.showToast(`Test failed: ${(error as Error).message}`, 'error');
      this.status()?.setItem('mobile.test', { text: 'Android: Test error', side: 'right', priority: 28, autoHideMs: 4000 });
    }
  }

  private async testStop(): Promise<void> {
    try {
      await window.znxstudio.mobile.testStop();
      this.status()?.setItem('mobile.test', { text: 'Android: Tests stopped', side: 'right', priority: 28, autoHideMs: 4000 });
    } catch (error) {
      this.context.layout.showToast(`Stop tests failed: ${(error as Error).message}`, 'error');
    }
  }

  private renderTestResults(): void {
    const container = this.testResultsEl ?? this.sideBarEl?.querySelector('[data-role="test-results"]');
    if (!container) return;
    container.innerHTML = '';

    if (!this.lastTestReport) {
      this.renderEmpty(container, 'Run tests to see results.');
      return;
    }

    const report = this.lastTestReport;
    const summary = document.createElement('div');
    summary.style.fontSize = '12px';
    summary.style.padding = '4px 0';
    summary.style.fontWeight = 'bold';
    summary.textContent = `${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped`;
    container.appendChild(summary);

    for (const result of report.results) {
      const row = document.createElement('div');
      row.style.fontSize = '12px';
      row.style.padding = '2px 0';
      row.style.cursor = result.file ? 'pointer' : 'default';
      row.style.display = 'flex';
      row.style.gap = '4px';

      const icon = document.createElement('span');
      icon.textContent = result.passed ? '✓' : '✗';
      icon.style.color = result.passed ? 'var(--znxstudio-success, #4caf50)' : 'var(--znxstudio-error, #f44336)';
      row.appendChild(icon);

      const name = document.createElement('span');
      name.textContent = result.name;
      name.style.flex = '1';
      row.appendChild(name);

      if (result.durationMs) {
        const dur = document.createElement('span');
        dur.textContent = `${result.durationMs}ms`;
        dur.style.opacity = '0.6';
        dur.style.fontSize = '11px';
        row.appendChild(dur);
      }

      if (result.file) {
        row.addEventListener('click', () => this.navigateToSource(result.file!, result.line));
      }
      if (result.message) row.title = result.message;
      container.appendChild(row);
    }
  }

  /* ===== Profile ===== */

  private async profileStart(): Promise<void> {
    const root = this.getWorkspaceRoot();
    if (!root) return;

    const deviceId = await this.pickDevice();
    if (!deviceId) return;

    this.status()?.setItem('mobile.profile', { text: 'Android: Profiling', side: 'right', priority: 27 });
    this.lastProfileReport = null;
    this.renderProfileResults();

    const output = this.output();
    output?.show();
    output?.appendLine('--- Android Profile ---');

    try {
      await window.znxstudio.mobile.profileStart({ workspaceRoot: root, deviceId });
    } catch (error) {
      this.context.layout.showToast(`Profile failed: ${(error as Error).message}`, 'error');
      this.status()?.setItem('mobile.profile', { text: 'Android: Profile error', side: 'right', priority: 27, autoHideMs: 4000 });
    }
  }

  private async profileStop(): Promise<void> {
    try {
      const report = await window.znxstudio.mobile.profileStop();
      this.lastProfileReport = report;
      this.renderProfileResults();
      this.status()?.setItem('mobile.profile', { text: 'Android: Profile complete', side: 'right', priority: 27, autoHideMs: 6000 });

      const output = this.output();
      if (output && report) {
        output.appendLine(`Duration: ${report.durationMs}ms`);
        for (const metric of report.metrics) {
          const budgetStr = metric.budget != null ? ` (budget: ${metric.budget}${metric.unit})` : '';
          output.appendLine(`  ${metric.name}: ${metric.value}${metric.unit}${budgetStr}`);
        }
        if (report.events.length > 0) {
          output.appendLine('Timeline:');
          for (const event of report.events) {
            const dur = event.durationMs ? ` (${event.durationMs}ms)` : '';
            output.appendLine(`  ${event.timestampMs}ms  ${event.name}${dur}`);
          }
        }
      }
    } catch (error) {
      this.context.layout.showToast(`Stop profile failed: ${(error as Error).message}`, 'error');
    }
  }

  private handleProfileEvent(event: MobileProfileEvent): void {
    const output = this.output();
    if (event.type === 'metric' && event.name) {
      output?.appendLine(`  ${event.name}: ${event.value ?? '?'}${event.unit ?? ''}`);
    } else if (event.type === 'error') {
      output?.appendLine(`Profile error: ${event.message ?? 'unknown'}`);
    }
  }

  private renderProfileResults(): void {
    const container = this.profileResultsEl ?? this.sideBarEl?.querySelector('[data-role="profile-results"]');
    if (!container) return;
    container.innerHTML = '';

    if (!this.lastProfileReport) {
      this.renderEmpty(container, 'Profile to see performance data.');
      return;
    }

    const report = this.lastProfileReport;
    const header = document.createElement('div');
    header.style.fontSize = '12px';
    header.style.fontWeight = 'bold';
    header.style.padding = '4px 0';
    header.textContent = `Duration: ${report.durationMs}ms`;
    container.appendChild(header);

    for (const metric of report.metrics) {
      const row = document.createElement('div');
      row.style.fontSize = '12px';
      row.style.padding = '2px 0';
      row.style.display = 'flex';
      row.style.gap = '4px';
      row.style.cursor = metric.file ? 'pointer' : 'default';

      const nameEl = document.createElement('span');
      nameEl.style.flex = '1';
      nameEl.textContent = metric.name;
      row.appendChild(nameEl);

      const valueEl = document.createElement('span');
      const overBudget = metric.budget != null && metric.value > metric.budget;
      valueEl.textContent = `${metric.value}${metric.unit}`;
      if (overBudget) valueEl.style.color = 'var(--znxstudio-error, #f44336)';
      row.appendChild(valueEl);

      if (metric.file) {
        row.addEventListener('click', () => this.navigateToSource(metric.file!, metric.line));
      }
      container.appendChild(row);
    }

    if (report.events.length > 0) {
      const timelineHeader = document.createElement('div');
      timelineHeader.style.fontSize = '11px';
      timelineHeader.style.textTransform = 'uppercase';
      timelineHeader.style.opacity = '0.7';
      timelineHeader.style.marginTop = '8px';
      timelineHeader.textContent = 'Timeline';
      container.appendChild(timelineHeader);

      for (const event of report.events.slice(0, 20)) {
        const row = document.createElement('div');
        row.style.fontSize = '11px';
        row.style.padding = '1px 0';
        row.style.display = 'flex';
        row.style.gap = '6px';

        const ts = document.createElement('span');
        ts.style.opacity = '0.6';
        ts.style.minWidth = '50px';
        ts.style.textAlign = 'right';
        ts.textContent = `${event.timestampMs}ms`;
        row.appendChild(ts);

        const name = document.createElement('span');
        name.style.flex = '1';
        name.textContent = event.name;
        row.appendChild(name);

        if (event.durationMs) {
          const dur = document.createElement('span');
          dur.style.opacity = '0.6';
          dur.textContent = `${event.durationMs}ms`;
          row.appendChild(dur);
        }
        container.appendChild(row);
      }
    }
  }

  /* ===== Build ===== */

  private async buildApk(): Promise<void> {
    const root = this.getWorkspaceRoot();
    if (!root) return;

    this.status()?.setItem('mobile.build', { text: 'Android: Building APK', side: 'right', priority: 27 });
    const output = this.output();
    output?.show();
    output?.appendLine('--- Build APK ---');

    try {
      const result = await window.znxstudio.mobile.buildApk({
        workspaceRoot: root,
        mode: 'debug',
        format: 'apk',
      });
      this.lastBuildResult = result;
      this.renderBuildResults();

      if (result.success) {
        const size = result.artifactSizeBytes ? ` (${formatBytes(result.artifactSizeBytes)})` : '';
        output?.appendLine(`Build successful: ${result.artifactPath ?? 'unknown'}${size}`);
        this.context.layout.showToast(`APK built${size}`, 'info');
        this.status()?.setItem('mobile.build', { text: 'Android: APK ready', side: 'right', priority: 27, autoHideMs: 6000 });
      } else {
        for (const diag of result.diagnostics) output?.appendLine(`  ${diag}`);
        this.context.layout.showToast('APK build failed.', 'error');
        this.status()?.setItem('mobile.build', { text: 'Android: Build failed', side: 'right', priority: 27, autoHideMs: 6000 });
      }
    } catch (error) {
      this.context.layout.showToast(`Build failed: ${(error as Error).message}`, 'error');
      this.status()?.setItem('mobile.build', { text: 'Android: Build error', side: 'right', priority: 27, autoHideMs: 4000 });
    }
  }

  private async buildAab(): Promise<void> {
    const root = this.getWorkspaceRoot();
    if (!root) return;

    this.status()?.setItem('mobile.build', { text: 'Android: Building AAB', side: 'right', priority: 27 });
    const output = this.output();
    output?.show();
    output?.appendLine('--- Build App Bundle ---');

    try {
      const result = await window.znxstudio.mobile.buildAab({
        workspaceRoot: root,
        mode: 'release',
        format: 'aab',
      });
      this.lastBuildResult = result;
      this.renderBuildResults();

      if (result.success) {
        const size = result.artifactSizeBytes ? ` (${formatBytes(result.artifactSizeBytes)})` : '';
        output?.appendLine(`Bundle successful: ${result.artifactPath ?? 'unknown'}${size}`);
        this.context.layout.showToast(`AAB built${size}`, 'info');
        this.status()?.setItem('mobile.build', { text: 'Android: AAB ready', side: 'right', priority: 27, autoHideMs: 6000 });
      } else {
        for (const diag of result.diagnostics) output?.appendLine(`  ${diag}`);
        this.context.layout.showToast('AAB build failed.', 'error');
        this.status()?.setItem('mobile.build', { text: 'Android: Build failed', side: 'right', priority: 27, autoHideMs: 6000 });
      }
    } catch (error) {
      this.context.layout.showToast(`Build failed: ${(error as Error).message}`, 'error');
      this.status()?.setItem('mobile.build', { text: 'Android: Build error', side: 'right', priority: 27, autoHideMs: 4000 });
    }
  }

  private handleBuildProgress(progress: MobileBuildProgress): void {
    const output = this.output();
    output?.appendLine(`[${progress.phase}] ${progress.message}`);
    this.status()?.setItem('mobile.build', { text: `Android: ${progress.phase}`, side: 'right', priority: 27 });
  }

  private renderBuildResults(): void {
    const container = this.buildResultsEl ?? this.sideBarEl?.querySelector('[data-role="build-results"]');
    if (!container) return;
    container.innerHTML = '';

    if (!this.lastBuildResult) return;

    const result = this.lastBuildResult;
    const row = document.createElement('div');
    row.style.fontSize = '12px';
    row.style.padding = '4px 0';

    if (result.success) {
      const size = result.artifactSizeBytes ? ` (${formatBytes(result.artifactSizeBytes)})` : '';
      row.textContent = `✓ ${result.artifactPath ?? 'Built'}${size}`;
      row.style.color = 'var(--znxstudio-success, #4caf50)';

      if (result.artifactPath) {
        row.style.cursor = 'pointer';
        row.title = 'Reveal in file manager';
        row.addEventListener('click', () => {
          void window.znxstudio.shell.showItemInFolder(result.artifactPath!);
        });
      }
    } else {
      row.textContent = `✗ Build failed`;
      row.style.color = 'var(--znxstudio-error, #f44336)';
    }
    container.appendChild(row);
  }

  /* ===== Release ===== */

  private async releaseCheck(): Promise<void> {
    const root = this.getWorkspaceRoot();
    if (!root) return;

    const output = this.output();
    output?.show();
    output?.appendLine('--- Release Check ---');

    try {
      const result = await window.znxstudio.mobile.releaseCheck(root);
      this.lastReleaseCheck = result;
      this.renderReleaseResults();

      output?.appendLine(`Application ID: ${result.applicationId ?? '?'}`);
      output?.appendLine(`Version: ${result.version ?? '?'} (code ${result.versionCode ?? '?'})`);
      output?.appendLine(`Signing: ${result.signing?.configured ? result.signing.detail : 'Not configured'}`);
      output?.appendLine(`Release ready: ${result.ready ? 'Yes' : 'No'}`);

      if (result.issues.length > 0) {
        output?.appendLine('Issues:');
        for (const issue of result.issues) {
          output?.appendLine(`  [${issue.severity}] ${issue.code}: ${issue.message}`);
        }
      }

      this.context.layout.showToast(
        result.ready ? 'Release checks passed.' : `${result.issues.length} release issue(s) found.`,
        result.ready ? 'info' : 'error',
      );
    } catch (error) {
      this.context.layout.showToast(`Release check failed: ${(error as Error).message}`, 'error');
    }
  }

  private renderReleaseResults(): void {
    const container = this.releaseResultsEl ?? this.sideBarEl?.querySelector('[data-role="release-results"]');
    if (!container) return;
    container.innerHTML = '';

    if (!this.lastReleaseCheck) return;

    const result = this.lastReleaseCheck;

    const header = document.createElement('div');
    header.style.fontSize = '12px';
    header.style.fontWeight = 'bold';
    header.style.padding = '4px 0';
    header.textContent = result.ready ? '✓ Release ready' : '✗ Not release ready';
    header.style.color = result.ready ? 'var(--znxstudio-success, #4caf50)' : 'var(--znxstudio-error, #f44336)';
    container.appendChild(header);

    const meta = document.createElement('div');
    meta.style.fontSize = '11px';
    meta.style.opacity = '0.8';
    meta.style.padding = '2px 0';
    meta.textContent = `${result.applicationId ?? '?'} v${result.version ?? '?'}`;
    container.appendChild(meta);

    for (const issue of result.issues) {
      const row = document.createElement('div');
      row.style.fontSize = '12px';
      row.style.padding = '2px 0';
      row.style.cursor = issue.file ? 'pointer' : 'default';
      const icon = issue.severity === 'error' ? '✗' : issue.severity === 'warning' ? '!' : 'ℹ';
      row.textContent = `${icon} ${issue.code}: ${issue.message}`;

      if (issue.file) {
        row.addEventListener('click', () => this.navigateToSource(issue.file!, issue.line));
      }
      container.appendChild(row);
    }
  }

  /* ===== Clean ===== */

  private async clean(): Promise<void> {
    const root = this.getWorkspaceRoot();
    if (!root) return;

    try {
      await window.znxstudio.mobile.clean(root);
      this.context.layout.showToast('Android build cleaned.', 'info');
      this.output()?.appendLine('Android build output cleaned.');
    } catch (error) {
      this.context.layout.showToast(`Clean failed: ${(error as Error).message}`, 'error');
    }
  }

  /* ===== Project Settings ===== */

  private async loadProjectConfig(): Promise<void> {
    const root = this.getWorkspaceRoot();
    if (!root) return;

    try {
      this.projectConfig = await window.znxstudio.mobile.projectConfig(root);
    } catch {
      this.projectConfig = null;
    }
    this.renderProjectSettings();
  }

  private showProjectSettings(): void {
    void this.loadProjectConfig();
    const output = this.output();
    if (output && this.projectConfig) {
      output.show();
      output.appendLine('--- Android Project Settings ---');
      output.appendLine(`Application ID: ${this.projectConfig.applicationId}`);
      output.appendLine(`Version: ${this.projectConfig.version}`);
      output.appendLine(`Min SDK: ${this.projectConfig.minSdk}`);
      output.appendLine(`Target SDK: ${this.projectConfig.targetSdk}`);
      output.appendLine(`Compile SDK: ${this.projectConfig.compileSdk}`);
      if (this.projectConfig.permissions.length > 0) {
        output.appendLine('Permissions:');
        for (const perm of this.projectConfig.permissions) {
          output.appendLine(`  ${perm}`);
        }
      }
    }
  }

  private renderProjectSettings(): void {
    const container = this.projectSettingsEl ?? this.sideBarEl?.querySelector('[data-role="project-settings"]');
    if (!container) return;
    container.innerHTML = '';

    if (!this.projectConfig) return;

    const cfg = this.projectConfig;
    const fields = [
      ['Application ID', cfg.applicationId],
      ['Version', cfg.version],
      ['Min SDK', String(cfg.minSdk)],
      ['Target SDK', String(cfg.targetSdk)],
    ];

    for (const [label, value] of fields) {
      const row = document.createElement('div');
      row.style.fontSize = '12px';
      row.style.padding = '1px 0';
      row.style.display = 'flex';
      row.style.gap = '6px';

      const labelEl = document.createElement('span');
      labelEl.style.opacity = '0.7';
      labelEl.style.minWidth = '85px';
      labelEl.textContent = label;
      row.appendChild(labelEl);

      const valueEl = document.createElement('span');
      valueEl.textContent = value;
      row.appendChild(valueEl);

      container.appendChild(row);
    }

    if (cfg.permissions.length > 0) {
      const permHeader = document.createElement('div');
      permHeader.style.fontSize = '11px';
      permHeader.style.opacity = '0.7';
      permHeader.style.marginTop = '6px';
      permHeader.textContent = `Permissions (${cfg.permissions.length})`;
      container.appendChild(permHeader);

      for (const perm of cfg.permissions) {
        const permRow = document.createElement('div');
        permRow.style.fontSize = '11px';
        permRow.style.padding = '1px 8px';
        permRow.textContent = perm;
        container.appendChild(permRow);
      }
    }
  }

  /* ===== Generated Android View ===== */

  private viewGenerated(): void {
    const root = this.getWorkspaceRoot();
    if (!root) return;

    const output = this.output();
    output?.show();
    output?.appendLine('--- Generated Android Files ---');
    output?.appendLine('Location: .zornux/android/');
    output?.appendLine('These files are generated by Zornux and may be overwritten.');
    output?.appendLine('Edit your .zx source and zornux.project instead.');

    this.context.layout.showToast('Generated Android files are in .zornux/android/', 'info');
  }

  /* ===== Session State ===== */

  private updateSessionStateUI(): void {
    this.renderRunToolbar();
    // Update status bar based on overall session state.
    switch (this.sessionState) {
      case 'building':
        this.status()?.setItem('mobile.status', { text: 'Android: Building', side: 'right', priority: 29 });
        break;
      case 'running':
        this.status()?.setItem('mobile.status', { text: 'Android: Running', side: 'right', priority: 29 });
        break;
      case 'debugging':
        this.status()?.setItem('mobile.debug', { text: 'Android: Debugging', side: 'right', priority: 30 });
        break;
      case 'testing':
        this.status()?.setItem('mobile.test', { text: 'Android: Testing', side: 'right', priority: 28 });
        break;
      case 'profiling':
        this.status()?.setItem('mobile.profile', { text: 'Android: Profiling', side: 'right', priority: 27 });
        break;
      case 'failed':
        this.status()?.setItem('mobile.status', { text: 'Android: Failed', side: 'right', priority: 29, autoHideMs: 6000 });
        break;
      case 'idle':
      case 'preparing':
      case 'stopping':
        this.status()?.removeItem?.('mobile.status');
        this.status()?.removeItem?.('mobile.debug');
        this.status()?.removeItem?.('mobile.test');
        this.status()?.removeItem?.('mobile.profile');
        break;
    }
  }

  /* ===== Log streaming ===== */

  private logBuffer: string[] = [];
  private logFlushScheduled = false;

  private appendLog(line: string): void {
    if (!this.logOutputEl) return;
    this.logBuffer.push(line);
    if (!this.logFlushScheduled) {
      this.logFlushScheduled = true;
      requestAnimationFrame(() => {
        if (this.logOutputEl && this.logBuffer.length > 0) {
          this.logOutputEl.textContent += this.logBuffer.join('\n') + '\n';
          this.logBuffer.length = 0;
          this.logOutputEl.scrollTop = this.logOutputEl.scrollHeight;
        }
        this.logFlushScheduled = false;
      });
    }
  }

  /* ===== Helpers ===== */

  private navigateToSource(file: string, _line?: number): void {
    const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
    if (editor && file) {
      void editor.openFile(file);
    }
  }

  private renderEmpty(container: Element, message: string): void {
    const el = document.createElement('div');
    el.textContent = message;
    el.style.opacity = '0.6';
    el.style.fontSize = '12px';
    el.style.padding = '4px 0';
    container.appendChild(el);
  }

  private status(): StatusService | undefined {
    return this.context.services.tryGet<StatusService>(ServiceKeys.Status);
  }

  private output(): OutputService | undefined {
    return this.context.services.tryGet<OutputService>(ServiceKeys.Output);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function groupAndroidDevices(devices: AndroidDevice[]): {
  physical: AndroidDevice[];
  virtual: AndroidDevice[];
} {
  return {
    physical: devices.filter((device) => device.type === 'physical'),
    virtual: devices.filter((device) => device.type === 'emulator'),
  };
}

export function mobileSessionControls(state: MobileSessionState, hasDevice: boolean): {
  canLaunch: boolean;
  canStop: boolean;
  label: string;
} {
  const active = state !== 'idle' && state !== 'failed';
  const labels: Record<MobileSessionState, string> = {
    idle: 'Idle',
    preparing: 'Preparing…',
    building: 'Building…',
    running: 'Running',
    debugging: 'Debugging',
    testing: 'Testing',
    profiling: 'Profiling',
    stopping: 'Stopping…',
    failed: 'Failed',
  };
  return {
    canLaunch: hasDevice && !active,
    canStop: active && state !== 'stopping',
    label: labels[state],
  };
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
