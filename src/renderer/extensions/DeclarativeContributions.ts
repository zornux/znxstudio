/**
 * Applies a validated, data-only extension into the live IDE registries: command aliases
 * (run an allowlisted existing command), snippets, keybindings, and themes. It executes NO
 * extension code — every contribution was already validated in the main process, and this
 * layer re-checks the command allowlist as defence-in-depth. Returns a Disposable that
 * cleanly removes everything it registered (for disable / uninstall).
 */
import type { Disposable, ModuleContext } from '../core/Module';
import {
  ServiceKeys,
  type KeybindingService,
  type SnippetService,
  type ThemeService,
} from '../core/Contracts';
import { EXTENSION_CONTRIBUTABLE_COMMANDS, type ValidatedExtension } from '../../shared/extensions/registry';

export function applyContributions(context: ModuleContext, ext: ValidatedExtension): Disposable {
  const disposables: Disposable[] = [];
  const { commands, services } = context;
  const contributableOwn = new Set(ext.contributions.commands.map((c) => c.command));

  // Command aliases — register a palette command that runs an allowlisted existing command.
  for (const c of ext.contributions.commands) {
    if (!EXTENSION_CONTRIBUTABLE_COMMANDS.includes(c.runs)) continue; // defence-in-depth
    try {
      disposables.push(commands.register(c.command, () => void commands.execute(c.runs), c.title));
    } catch {
      /* id already registered — skip this alias */
    }
  }

  // Snippets.
  const snippetService = services.tryGet<SnippetService>(ServiceKeys.Snippets);
  if (snippetService && ext.contributions.snippets.length) {
    disposables.push(
      snippetService.addExternal(
        ext.contributions.snippets.map((s) => ({
          name: s.prefix,
          prefix: s.prefix,
          description: s.description ?? '',
          body: s.body,
          languages: [s.language],
        })),
      ),
    );
  }

  // Keybindings — target must be allowlisted or one of this extension's own aliases.
  const keybindings = services.tryGet<KeybindingService>(ServiceKeys.Keybindings);
  if (keybindings) {
    for (const kb of ext.contributions.keybindings) {
      if (!EXTENSION_CONTRIBUTABLE_COMMANDS.includes(kb.command) && !contributableOwn.has(kb.command)) continue;
      try {
        disposables.push(keybindings.registerExternal(kb.key, kb.command));
      } catch {
        /* invalid chord — skip */
      }
    }
  }

  // Themes.
  const theme = services.tryGet<ThemeService>(ServiceKeys.Theme);
  if (theme) {
    for (const t of ext.contributions.themes) {
      disposables.push(theme.register({ id: t.id, label: t.label, type: t.type, cssVars: t.cssVars }));
    }
  }

  return {
    dispose: () => {
      for (const d of disposables.reverse()) {
        try {
          d.dispose();
        } catch {
          /* a failed dispose must not block the rest */
        }
      }
    },
  };
}
