import { ServiceKeys, type InputBoxService, type KeybindingService, type LayoutService, type SettingsService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { parseUserKeybindings, renderUserKeybindings } from '../keybindings/keybindings';
import {
  MacroRecorder,
  macroDurationMs,
  parseMacros,
  removeMacro,
  replayMacro,
  upsertMacro,
  type Macro,
} from './macros';
import {
  allProfiles,
  captureProfile,
  findProfile,
  matchesProfile,
  parseProfiles,
  removeProfile,
  upsertProfile,
  type LayoutProfile,
} from './layoutProfiles';

const MACROS_SETTING = 'znxstudio.macros';
const PROFILES_SETTING = 'znxstudio.layout.profiles';
const ACTIVE_PROFILE_SETTING = 'znxstudio.layout.activeProfile';

/**
 * Macros (Phase 17E) and layout profiles (Phase 17F).
 *
 * The recorder listens to the command registry, not the keyboard, so a macro
 * replays what the user DID rather than which keys happened to be bound. A
 * profile bundles the layout, the panel strip and the keybinding overrides, so
 * switching context is one command rather than nine settings.
 */
export class WorkbenchUxModule implements IModule {
  readonly id = 'znxstudio.workbenchUx';
  readonly displayName = 'Macros & Layout Profiles';

  private context!: ModuleContext;
  private settings: SettingsService | undefined;
  private layoutService: LayoutService | undefined;
  private keybindings: KeybindingService | undefined;
  private readonly recorder = new MacroRecorder();
  private macros: Macro[] = [];
  private profiles: LayoutProfile[] = [];
  private stopObserving: (() => void) | undefined;
  private replaying = false;
  private namingMacro = false;
  private savingProfile = false;

  activate(context: ModuleContext): void {
    this.context = context;
    this.settings = context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    this.layoutService = context.services.tryGet<LayoutService>(ServiceKeys.Layout);
    this.keybindings = context.services.tryGet<KeybindingService>(ServiceKeys.Keybindings);

    this.macros = parseMacros(this.settings?.get<unknown>(MACROS_SETTING, []));
    this.profiles = parseProfiles(this.settings?.get<unknown>(PROFILES_SETTING, []));

    context.commands.register(CommandIds.MacroStartRecording, () => this.startRecording(), 'Macro: Start Recording');
    context.commands.register(CommandIds.MacroStopRecording, () => this.stopRecording(), 'Macro: Stop Recording');
    context.commands.register(CommandIds.MacroReplay, () => void this.replay(), 'Macro: Replay');
    context.commands.register(CommandIds.MacroShow, () => this.showMacros(), 'Macro: Show Macros');
    context.commands.register(CommandIds.LayoutProfilesShow, () => this.showProfiles(), 'View: Layout Profiles');
    context.commands.register(CommandIds.LayoutProfileSave, () => this.saveProfile(), 'View: Save Layout Profile');
    context.commands.addEnablementRule((id) => {
      if (id === CommandIds.MacroStartRecording) return !this.recorder.isRecording && !this.namingMacro;
      if (id === CommandIds.MacroStopRecording) return this.recorder.isRecording && !this.namingMacro;
      if (id === CommandIds.MacroReplay) return !this.recorder.isRecording && !this.replaying && this.macros.length > 0;
      if (id === CommandIds.LayoutProfileSave) return !this.savingProfile;
      return undefined;
    });

    void selfTestCoordinator.run('workbench-ux', () => this.maybeSelfTest());
  }

  deactivate(): void {
    this.stopObserving?.();
  }

  /* ----- macros (17E) ----- */
  private startRecording(): void {
    if (this.recorder.isRecording) return;
    this.recorder.start(Date.now());
    // Observe the registry, not the keyboard: a macro records intent, not keys.
    this.stopObserving = this.context.commands.onDidExecute((id) => {
      if (this.replaying) return; // a replay must not re-record itself
      this.recorder.record(id, Date.now());
    });
    this.context.commands.notifyEnablementChanged();
    this.context.layout.showToast('Recording. Every command you run is captured.', 'info');
  }

  private async stopRecording(): Promise<void> {
    if (!this.recorder.isRecording || this.namingMacro) return;
    const refused = this.recorder.refusedCommands;
    this.stopObserving?.();
    this.stopObserving = undefined;
    const recorded = this.recorder.stop('Recorded macro');
    this.context.commands.notifyEnablementChanged();
    if (!recorded) {
      this.context.layout.showToast('Nothing was recorded.', 'info');
      return;
    }

    this.namingMacro = true;
    this.context.commands.notifyEnablementChanged();
    try {
      const input = this.context.services.get<InputBoxService>(ServiceKeys.InputBox);
      const value = await input.prompt({
        title: 'Save Recorded Macro',
        label: 'Macro name',
        value: 'My macro',
        placeholder: 'A descriptive name for this command sequence',
        submitLabel: 'Save Macro',
        validate: (name) => name.trim() ? null : 'Enter a macro name.',
      });
      if (value === null) {
        this.context.layout.showToast('Recording discarded.', 'info');
        return;
      }
      const name = value.trim();
      if (this.macros.some((entry) => entry.name === name)) {
        const replace = await input.confirm({
          title: 'Replace Macro?',
          message: `A macro named “${name}” already exists. Replace it with this recording?`,
          confirmLabel: 'Replace',
        });
        if (!replace) return;
      }
      const macro: Macro = { ...recorded, name };
      this.macros = upsertMacro(this.macros, macro);
      this.settings?.set(MACROS_SETTING, this.macros);

      const note = refused.length ? ` ${refused.length} command(s) were refused as unsafe to replay.` : '';
      this.context.layout.showToast(`Saved "${macro.name}" (${macro.steps.length} steps).${note}`, 'info');
    } catch (error) {
      this.context.layout.showToast(`Could not save macro: ${(error as Error).message}`, 'error');
    } finally {
      this.namingMacro = false;
      this.context.commands.notifyEnablementChanged();
    }
  }

  private async replay(name?: string): Promise<void> {
    if (this.recorder.isRecording) {
      this.context.layout.showToast('Stop recording before replaying.', 'info');
      return;
    }
    const macro = name ? this.macros.find((entry) => entry.name === name) : this.macros[0];
    if (!macro) {
      this.context.layout.showToast('No macro to replay.', 'info');
      return;
    }

    this.replaying = true;
    const result = await replayMacro(macro, (command) => this.context.commands.execute(command));
    this.replaying = false;

    this.context.layout.showToast(
      result.ok
        ? `Replayed "${macro.name}" — ${result.executed} step(s).`
        : `"${macro.name}" stopped at step ${result.executed} (${result.failedCommand}): ${result.error}`,
      result.ok ? 'info' : 'error',
    );
  }

  private showMacros(): void {
    const view = document.createElement('div');
    view.className = 'znxstudio-macros';

    const render = (): void => {
      view.replaceChildren();
      view.appendChild(
        note(
          this.recorder.isRecording
            ? `● Recording — ${this.recorder.stepCount} step(s) captured.`
            : 'Record a sequence of commands, then replay it. Destructive commands are never captured.',
          this.recorder.isRecording ? 'znxstudio-macros-recording' : 'znxstudio-macros-note',
        ),
      );

      const toggle = document.createElement('button');
      toggle.className = 'znxstudio-btn-small';
      toggle.textContent = this.recorder.isRecording ? '⏹ Stop recording' : '⏺ Start recording';
      toggle.addEventListener('click', () => {
        if (this.recorder.isRecording) {
          void this.stopRecording().finally(render);
        } else {
          this.startRecording();
          render();
        }
      });
      view.appendChild(toggle);

      for (const macro of this.macros) {
        const row = document.createElement('div');
        row.className = 'znxstudio-macros-row';

        const title = document.createElement('span');
        title.textContent = `${macro.name} · ${macro.steps.length} step(s) · ${macroDurationMs(macro)}ms`;

        const play = document.createElement('button');
        play.className = 'znxstudio-btn-small';
        play.textContent = '▶';
        play.addEventListener('click', () => void this.replay(macro.name));

        const remove = document.createElement('button');
        remove.className = 'znxstudio-btn-small';
        remove.textContent = '✕';
        remove.addEventListener('click', () => {
          this.macros = removeMacro(this.macros, macro.name);
          this.settings?.set(MACROS_SETTING, this.macros);
          render();
        });

        row.append(title, play, remove);
        view.appendChild(row);

        const steps = document.createElement('div');
        steps.className = 'znxstudio-macros-steps';
        steps.textContent = macro.steps.map((step) => step.command).join(' → ');
        view.appendChild(steps);
      }
    };

    render();
    this.context.layout.setSideBar('Macros', view);
    this.context.layout.focusSideBar();
  }

  /* ----- layout profiles (17F) ----- */
  private configuration() {
    return {
      layout: this.layoutService?.layout() ?? allProfiles([])[0].layout,
      panels: this.layoutService?.panels() ?? { order: [], hidden: [] },
      keybindings: (this.keybindings?.bindings() ?? []).filter((binding) => binding.source === 'user'),
    };
  }

  private applyProfile(profile: LayoutProfile): void {
    this.layoutService?.setLayout(profile.layout);
    this.layoutService?.setPanelPreferences(profile.panels);
    this.keybindings?.setUserBindings(profile.keybindings);
    this.settings?.set(ACTIVE_PROFILE_SETTING, profile.name);
    this.context.layout.showToast(`Layout profile: ${profile.name}`, 'info');
  }

  private async saveProfile(): Promise<void> {
    if (this.savingProfile) return;
    this.savingProfile = true;
    this.context.commands.notifyEnablementChanged();
    try {
      const input = this.context.services.get<InputBoxService>(ServiceKeys.InputBox);
      const value = await input.prompt({
        title: 'Save Layout Profile',
        label: 'Profile name',
        value: 'My layout',
        placeholder: 'A name for the current layout and keybindings',
        submitLabel: 'Save Profile',
        validate: (name) => {
          const normalized = name.trim();
          if (!normalized) return 'Enter a layout profile name.';
          return allProfiles([]).some((profile) => profile.builtIn && profile.name === normalized)
            ? 'Built-in layout profiles cannot be replaced.'
            : null;
        },
      });
      if (value === null) return;
      const name = value.trim();
      if (this.profiles.some((profile) => profile.name === name)) {
        const replace = await input.confirm({
          title: 'Replace Layout Profile?',
          message: `A layout profile named “${name}” already exists. Replace it with the current layout?`,
          confirmLabel: 'Replace',
        });
        if (!replace) return;
      }
      const profile = captureProfile(name, this.configuration());
      this.profiles = upsertProfile(this.profiles, profile);
      this.settings?.set(PROFILES_SETTING, this.profiles);
      this.context.layout.showToast(`Saved layout profile "${profile.name}".`, 'info');
    } catch (error) {
      this.context.layout.showToast(`Could not save layout profile: ${(error as Error).message}`, 'error');
    } finally {
      this.savingProfile = false;
      this.context.commands.notifyEnablementChanged();
    }
  }

  private showProfiles(): void {
    const view = document.createElement('div');
    view.className = 'znxstudio-profiles';

    const render = (): void => {
      view.replaceChildren();
      const active = this.settings?.get<string>(ACTIVE_PROFILE_SETTING, 'Default') ?? 'Default';
      const configuration = this.configuration();

      for (const profile of allProfiles(this.profiles)) {
        const row = document.createElement('div');
        row.className = 'znxstudio-profiles-row';

        const apply = document.createElement('button');
        apply.className = 'znxstudio-btn-small';
        apply.textContent = profile.name;
        apply.addEventListener('click', () => {
          this.applyProfile(profile);
          render();
        });

        const state = document.createElement('span');
        state.className = 'znxstudio-profiles-state';
        // Only the profile the user last applied can be "modified"; the others
        // simply differ, which says nothing.
        state.textContent =
          profile.name === active ? (matchesProfile(profile, configuration) ? 'active' : 'active · modified') : profile.builtIn ? 'built-in' : '';

        row.append(apply, state);

        if (!profile.builtIn) {
          const remove = document.createElement('button');
          remove.className = 'znxstudio-btn-small';
          remove.textContent = '✕';
          remove.addEventListener('click', () => {
            this.profiles = removeProfile(this.profiles, profile.name);
            this.settings?.set(PROFILES_SETTING, this.profiles);
            render();
          });
          row.appendChild(remove);
        }
        view.appendChild(row);
      }

      const save = document.createElement('button');
      save.className = 'znxstudio-btn-small';
      save.textContent = this.savingProfile ? 'Saving…' : '＋ Save current layout';
      save.disabled = this.savingProfile;
      save.addEventListener('click', () => {
        void this.saveProfile().finally(render);
      });
      view.appendChild(save);
    };

    render();
    this.context.layout.setSideBar('Layout Profiles', view);
    this.context.layout.focusSideBar();
  }

  /* ----- optional headless self-test (ZNXSTUDIO_SELFTEST=1) ----- */
  private async maybeSelfTest(): Promise<void> {
    let enabled = false;
    try {
      enabled = (await window.znxstudio.app.getInfo()).selftest === true;
    } catch {
      enabled = false;
    }
    if (!enabled) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    // Record through the REAL command registry, then replay through it.
    this.recorder.start(Date.now());
    const stop = this.context.commands.onDidExecute((id) => this.recorder.record(id, Date.now()));
    await this.context.commands.execute(CommandIds.LayoutToggleSideBar);
    await this.context.commands.execute(CommandIds.LayoutToggleSideBar);
    // A refused command must not land in the macro, even when genuinely invoked.
    this.recorder.record(CommandIds.MacroReplay, Date.now());
    stop();
    const macro = this.recorder.stop('selftest');
    log(
      `macro REAL record: steps=${macro?.steps.length} [${macro?.steps.map((s) => s.command).join(', ')}] ` +
        `refused=[${this.recorder.refusedCommands.join(', ') || 'none'}]`,
    );

    if (macro) {
      const before = this.layoutService?.layout().sidebar.visible;
      this.replaying = true;
      const result = await replayMacro(macro, (command) => this.context.commands.execute(command), () => Promise.resolve());
      this.replaying = false;
      log(
        `macro REAL replay: ok=${result.ok} executed=${result.executed} sidebar.visible ${before} → ${this.layoutService?.layout().sidebar.visible}`,
      );

      const bad: Macro = { name: 'bad', steps: [{ command: 'znxstudio.does.not.exist', delayMs: 0 }] };
      const failure = await replayMacro(bad, (command) => this.context.commands.execute(command), () => Promise.resolve());
      log(`macro REAL replay stops at a bad step: ok=${failure.ok} failed=${failure.failedCommand}`);
    }

    // Profiles against the REAL layout service.
    const focus = findProfile(allProfiles(this.profiles), 'Focus')!;
    const original = this.layoutService?.layout();
    this.applyProfile(focus);
    log(
      `profile REAL apply Focus: sidebar=${this.layoutService?.layout().sidebar.visible} panel=${this.layoutService?.layout().panel.visible} statusBar=${this.layoutService?.layout().statusBarVisible}`,
    );
    log(`profile matches after apply: ${matchesProfile(focus, this.configuration())}`);

    const captured = captureProfile('SelfTest', this.configuration());
    log(`profile capture: name=${captured.name} builtIn=${captured.builtIn} keybindings=${Object.keys(captured.keybindings).length}`);
    log(`profile built-in name refused: ${upsertProfile([], captureProfile('Default', this.configuration())).length === 0}`);

    if (original) this.layoutService?.setLayout(original);
    log(`profile restored original layout: ${this.layoutService?.layout().sidebar.visible === original?.sidebar.visible}`);

    // Keybinding overrides round-trip through a profile.
    const user = parseUserKeybindings({ 'ctrl+alt+z': CommandIds.LayoutToggleZen });
    log(`profile keybindings canonicalised: ${JSON.stringify(renderUserKeybindings(user))}`);
  }
}

function note(text: string, className: string): HTMLElement {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = text;
  return element;
}
