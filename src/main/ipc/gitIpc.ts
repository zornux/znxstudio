import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type { GitExecRequest, GitExecResult } from '../../shared/types';
import { GitService } from '../services/GitService';
import { GhService } from '../services/GhService';
import { sharedWorkspaceTrust } from '../services/WorkspaceTrustService';

/**
 * Source control — runs the real `git` (and optional `gh`) binaries (Phase 12).
 *
 * Trust gate (certification fix): git is auto-run on folder open (status/rev-parse
 * for the SCM view), and a repo's `.git/config` can direct git to execute code
 * (fsmonitor / pager / sshCommand / aliases / hooks). So git is an execution path
 * and must be gated like the others — otherwise opening an untrusted repo is a
 * zero-click execution vector that defeats Workspace Trust. In Restricted Mode we
 * return a normal non-zero result (rather than throwing) so the SCM view degrades
 * cleanly to "no repository" instead of erroring.
 */
const RESTRICTED: GitExecResult = {
  code: 128,
  stdout: '',
  stderr: 'Workspace is not trusted — source control is disabled in Restricted Mode.',
};

export function registerGitIpc(): void {
  const git = new GitService();
  const gh = new GhService();
  ipcMain.handle(IpcChannels.GitExec, (_event, request: GitExecRequest) =>
    sharedWorkspaceTrust().isTrusted() ? git.exec(request) : RESTRICTED,
  );
  ipcMain.handle(IpcChannels.GhExec, (_event, request: GitExecRequest) =>
    sharedWorkspaceTrust().isTrusted() ? gh.exec(request) : RESTRICTED,
  );
}
