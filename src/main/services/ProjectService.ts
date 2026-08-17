import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type {
  CreateProjectOptions,
  CreatedProject,
  ProjectDiagnostic,
  ScaffoldRequest,
  ScaffoldResult,
  WorkspaceInfo,
  WorkspaceType,
  ZnxStudioProject,
} from '../../shared/types';

import { resolveZornux } from '../util/zornuxRuntime';

const MANIFEST_FILE = 'znxstudio.project.json';

/** Cross-platform demo scripts so the Run/Build runner has something to execute. */
const DEFAULT_SCRIPTS: Record<string, string> = {
  build: 'echo [1/2] Compiling && echo [2/2] Linking && echo Build succeeded',
  run: 'echo Starting ZnxStudio app... && echo Hello from your Zornux project!',
};

/**
 * Project lifecycle + workspace intelligence. Scaffolds projects, and loads +
 * validates a folder into a typed WorkspaceInfo (never throwing to the renderer;
 * problems are returned as diagnostics). Language-specific templates are NOT
 * baked in here — they will register scaffolders through the extension system.
 */
export class ProjectService {
  async createProject(options: CreateProjectOptions): Promise<CreatedProject> {
    const projectDir = join(options.location, options.name);
    await fs.mkdir(join(projectDir, 'src'), { recursive: true });

    const manifest: ZnxStudioProject = {
      name: options.name,
      type: options.type ?? 'zornux-zoijs-fullstack',
      version: '0.1.0',
      scripts: { ...DEFAULT_SCRIPTS },
      languageTargets: ['zornux'],
      frameworkTargets: ['zoijs'],
      extensionRequirements: [],
      workspace: {
        sourceDirs: ['src'],
        generatedDirs: ['dist'],
        configFiles: [MANIFEST_FILE],
      },
    };

    await fs.writeFile(
      join(projectDir, MANIFEST_FILE),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
    await fs.writeFile(
      join(projectDir, 'README.md'),
      `# ${options.name}\n\nCreated with ZnxStudio.\n`,
      'utf8',
    );
    await fs.writeFile(
      join(projectDir, 'src', 'main.zx'),
      `Say "Hello from ${options.name}".\n`,
      'utf8',
    );

    return { path: projectDir, name: options.name };
  }

  /**
   * Scaffold a project from a rendered template (Phase 5G). For Zornux
   * templates this runs the REAL `zornux init` first so the `zornux.project`
   * manifest is authoritative, then writes the template's files (which may
   * override init's placeholder `src/main.zx`). Never throws — a failure is
   * reported as `{ ok: false, error }`.
   */
  async scaffoldProject(request: ScaffoldRequest): Promise<ScaffoldResult> {
    const projectDir = join(request.location, request.name);
    try {
      await fs.mkdir(projectDir, { recursive: true });

      if (request.runZornuxInit) {
        const init = await this.runInit(projectDir, request.compilerPath);
        if (!init.ok) return { ok: false, path: projectDir, name: request.name, error: init.error };
      }

      for (const file of request.files) {
        const target = join(projectDir, file.path);
        await fs.mkdir(dirname(target), { recursive: true });
        await fs.writeFile(target, file.content, 'utf8');
      }

      return { ok: true, path: projectDir, name: request.name };
    } catch (error) {
      return { ok: false, path: projectDir, name: request.name, error: (error as Error).message };
    }
  }

  /** Runs `zornux init <dir>`; resolves with a structured outcome (never throws). */
  private runInit(projectDir: string, compilerPath?: string | null): Promise<{ ok: boolean; error?: string }> {
    const command = compilerPath?.trim() || resolveZornux().path;
    return new Promise((resolve) => {
      const child = spawn(command, ['init', projectDir], { windowsHide: true });
      let stderr = '';
      let stdout = '';
      const timer = setTimeout(() => {
        child.kill();
        resolve({ ok: false, error: "'zornux init' timed out." });
      }, 30_000);
      child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('error', (error) => {
        clearTimeout(timer);
        resolve({ ok: false, error: (error as Error).message });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(code === 0 ? { ok: true } : { ok: false, error: (stderr.trim() || stdout.trim()) || `zornux init failed (exit ${code}).` });
      });
    });
  }

  /** Load + validate a folder. Always resolves; failures become diagnostics. */
  async loadWorkspace(folder: string): Promise<WorkspaceInfo> {
    const diagnostics: ProjectDiagnostic[] = [];
    let project: ZnxStudioProject | null = null;
    let isZnxStudioProject = false;

    let raw: string | null = null;
    try {
      raw = await fs.readFile(join(folder, MANIFEST_FILE), 'utf8');
    } catch {
      raw = null;
    }

    if (raw === null) {
      diagnostics.push({
        severity: 'info',
        code: 'no-manifest',
        message: `No ${MANIFEST_FILE} found in this folder.`,
        hint: 'Opening as a generic workspace. Use “Create Project” to scaffold one.',
      });
    } else {
      isZnxStudioProject = true;
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        diagnostics.push({
          severity: 'error',
          code: 'invalid-json',
          message: `${MANIFEST_FILE} is not valid JSON: ${(error as Error).message}`,
          hint: 'Fix the JSON syntax. The folder will load as a generic workspace until then.',
        });
      }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        project = validateProject(parsed as Record<string, unknown>, folder, diagnostics);
      } else if (parsed !== null) {
        diagnostics.push({
          severity: 'error',
          code: 'not-an-object',
          message: `${MANIFEST_FILE} must contain a JSON object.`,
        });
      }
    }

    let detectedType = detectType(project);

    // When the JSON manifest alone detects a plain Zornux project, refine by
    // consulting the authoritative `zornux.project` text-format manifest. If it
    // declares `type = mobile`, upgrade the workspace type to 'zornux-mobile'.
    if (detectedType === 'zornux-api' || detectedType === 'zornux-zoijs-fullstack') {
      const zornuxType = await readZornuxProjectType(folder);
      if (zornuxType === 'mobile') detectedType = 'zornux-mobile';
    }

    return {
      root: folder,
      isZnxStudioProject,
      project,
      detectedType,
      diagnostics,
    };
  }
}

function validateProject(
  raw: Record<string, unknown>,
  folder: string,
  diagnostics: ProjectDiagnostic[],
): ZnxStudioProject {
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name : undefined;
  if (!name) {
    diagnostics.push({
      severity: 'error',
      code: 'missing-name',
      message: 'Project "name" is missing or not a string.',
      hint: 'Add a top-level "name" field.',
    });
  }

  const version = typeof raw.version === 'string' ? raw.version : undefined;
  if (!version) {
    diagnostics.push({
      severity: 'warning',
      code: 'missing-version',
      message: 'Project "version" is missing.',
      hint: 'Add a "version" such as "0.1.0".',
    });
  }

  const type = typeof raw.type === 'string' ? raw.type : undefined;
  if (!type) {
    diagnostics.push({
      severity: 'info',
      code: 'missing-type',
      message: 'Project "type" is not set; it will be auto-detected.',
    });
  }

  const scripts = isStringMap(raw.scripts) ? (raw.scripts as Record<string, string>) : undefined;
  if (!scripts) {
    diagnostics.push({
      severity: 'info',
      code: 'no-scripts',
      message: 'No "scripts" are defined.',
      hint: 'Add scripts like { "build": "…", "run": "…" } to enable Run/Build.',
    });
  }

  const languageTargets = asStringArray(raw.languageTargets);
  const frameworkTargets = asStringArray(raw.frameworkTargets);
  if (!languageTargets && !frameworkTargets) {
    diagnostics.push({
      severity: 'info',
      code: 'no-targets',
      message: 'No language or framework targets are declared.',
      hint: 'Add "languageTargets": ["zornux"] and/or "frameworkTargets": ["zoijs"].',
    });
  }

  const workspaceRaw = isPlainObject(raw.workspace)
    ? (raw.workspace as Record<string, unknown>)
    : undefined;

  return {
    name: name ?? basename(folder),
    type: type ?? '',
    version: version ?? '0.0.0',
    scripts,
    languageTargets,
    frameworkTargets,
    extensionRequirements: asStringArray(raw.extensionRequirements),
    workspace: workspaceRaw
      ? {
          sourceDirs: asStringArray(workspaceRaw.sourceDirs),
          generatedDirs: asStringArray(workspaceRaw.generatedDirs),
          configFiles: asStringArray(workspaceRaw.configFiles),
        }
      : undefined,
  };
}

function detectType(project: ZnxStudioProject | null): WorkspaceType {
  if (!project) return 'generic';

  const langs = (project.languageTargets ?? []).map((value) => value.toLowerCase());
  const frameworks = (project.frameworkTargets ?? []).map((value) => value.toLowerCase());
  const declared = project.type.toLowerCase();

  const hasZornux = langs.includes('zornux') || declared.includes('zornux');
  const hasZoijs = frameworks.includes('zoijs') || declared.includes('zoijs');

  // Mobile detection: the manifest declares type "mobile" and targets Zornux.
  if (hasZornux && declared === 'mobile') return 'zornux-mobile';

  if (hasZornux && hasZoijs) return 'zornux-zoijs-fullstack';
  if (hasZoijs) return 'zoijs-frontend';
  if (hasZornux) return 'zornux-api';
  return 'generic';
}

/**
 * Check whether a workspace's `zornux.project` text-format manifest declares
 * `type = mobile`. Called by `loadWorkspace` to refine the detected type when
 * the JSON manifest alone is ambiguous (the JSON `type` field may be a freeform
 * string while the text-format manifest is authoritative for the CLI).
 */
async function readZornuxProjectType(folder: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(join(folder, 'zornux.project'), 'utf8');
    for (const line of raw.replace(/\r\n?/g, '\n').split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || trimmed.length === 0) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim().toLowerCase();
      if (key === 'type') return trimmed.slice(eq + 1).trim().toLowerCase();
    }
  } catch {
    // No zornux.project file — not a mobile project via the text manifest.
  }
  return null;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((entry): entry is string => typeof entry === 'string');
  return items.length ? items : undefined;
}

function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringMap(value: unknown): boolean {
  return isPlainObject(value) && Object.values(value as object).every((v) => typeof v === 'string');
}
