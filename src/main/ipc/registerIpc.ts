import { registerAiIpc } from './aiIpc';
import { registerCollabIpc } from './collabIpc';
import { registerWindowIpc } from './windowIpc';
import { registerGitIpc } from './gitIpc';
import { registerToolIpc } from './toolIpc';
import { registerCompilerIpc } from './compilerIpc';
import { registerConfigIpc } from './configIpc';
import { registerCoreIpc } from './coreIpc';
import { registerHealthIpc } from './healthIpc';
import { registerDebugIpc } from './debugIpc';
import { registerLspIpc } from './lspIpc';
import { registerPackageIpc } from './packageIpc';
import { registerPreviewIpc } from './previewIpc';
import { registerProjectIpc } from './projectIpc';
import { registerSearchIpc } from './searchIpc';
import { registerSettingsIpc } from './settingsIpc';
import { registerTaskIpc } from './taskIpc';
import { registerTerminalIpc } from './terminalIpc';
import { registerTrustIpc } from './trustIpc';
import { registerUpdateIpc } from './updateIpc';

/**
 * Wires every privileged endpoint the renderer can reach. Each domain lives in
 * its own registrar to keep the surface auditable and free of monolithic code.
 */
export function registerIpcHandlers(): void {
  // First: DiagnosticsService must read the previous session's crash marker
  // before any other code can touch it.
  registerHealthIpc();
  registerCoreIpc();
  // Trust must be available before any execution IPC can be invoked.
  registerTrustIpc();
  registerProjectIpc();
  registerTerminalIpc();
  registerSettingsIpc();
  registerTaskIpc();
  registerCompilerIpc();
  registerDebugIpc();
  registerLspIpc();
  registerPackageIpc();
  registerConfigIpc();
  registerPreviewIpc();
  registerSearchIpc();
  registerAiIpc();
  registerGitIpc();
  registerToolIpc();
  registerCollabIpc();
  registerWindowIpc();
  registerUpdateIpc();
}
