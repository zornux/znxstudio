import type { WorkspaceInfo, WorkspaceType } from '../../shared/types';

/**
 * The logical "solution" view of a multi-root workspace: a Solution containing
 * Projects. Pure and Monaco/IPC-free so it is unit-testable — it distills the
 * raw WorkspaceInfo folders into a project-centric model (type, version,
 * targets, scripts, problem count) that the Solution Explorer renders.
 */
export interface SolutionProject {
  root: string;
  name: string;
  /** Detected project type (drives the badge). */
  type: WorkspaceType;
  /** True when the folder has a `znxstudio.project.json` manifest. */
  isProject: boolean;
  version: string | null;
  /** Language + framework targets, in order. */
  targets: string[];
  /** Script names (runnable). */
  scripts: string[];
  problemCount: number;
}

export interface Solution {
  name: string;
  projects: SolutionProject[];
  /** How many folders are real projects (have a manifest). */
  projectCount: number;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function toProject(folder: WorkspaceInfo): SolutionProject {
  const project = folder.project;
  return {
    root: folder.root,
    name: project?.name ?? baseName(folder.root),
    type: folder.detectedType,
    isProject: folder.isZnxStudioProject,
    version: project?.version ?? null,
    targets: [...(project?.languageTargets ?? []), ...(project?.frameworkTargets ?? [])],
    scripts: Object.keys(project?.scripts ?? {}),
    problemCount: folder.diagnostics.length,
  };
}

export function buildSolution(folders: WorkspaceInfo[], solutionName?: string): Solution {
  const projects = folders.map(toProject);
  const name =
    solutionName ?? projects.find((project) => project.isProject)?.name ?? projects[0]?.name ?? 'Workspace';
  return {
    name,
    projects,
    projectCount: projects.filter((project) => project.isProject).length,
  };
}
