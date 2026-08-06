/**
 * Status-bar policy — the pure model (SB-1).
 *
 * The status bar had become a toolbar: ~24 permanent segments, many of them
 * feature *launchers* (ORM, AI, Build, Run, Coverage, Security…). This policy
 * reclassifies every segment so the bar communicates STATE, not entry points.
 * Every producer keeps calling `setItem` unchanged — the StatusBarModule consults
 * this table to decide what actually renders and where.
 *
 *   • always      — essential project/runtime state; always shown.
 *   • contextual  — shown only while relevant (a build running, a debug session,
 *                   a task in flight). SB-1 still renders these; SB-2 gates them.
 *   • hidden      — a feature launcher, not a status. Never in the bar; the
 *                   feature stays reachable via the View menus, its workspace,
 *                   and the Command Palette. NOTHING is removed.
 *
 * `side` lets the policy pin an item to Project (left) or Live (right) regardless
 * of what the producer requested, so the two halves stay coherent.
 */
export type StatusLevel = 'always' | 'contextual' | 'hidden';

export interface StatusPolicyEntry {
  level: StatusLevel;
  side?: 'left' | 'right';
}

/**
 * Feature launchers that were living in the status bar. Hidden from the bar;
 * each remains available through its workspace / panel / command.
 */
const HIDDEN: string[] = [
  'editor.orm', // ORM Explorer
  'editor.ai', // AI on/off launcher (AI *activity* is a separate contextual item)
  'editor.aiReview', // AI Review
  'editor.metrics', // Metrics
  'profiler', // Profiler cache hit-rate (a counter, not a profiling session)
  'database.count', // Database
  'editor.coverage', // Coverage
  'editor.tests', // Testing
  'editor.continuous', // Continuous testing
  'editor.todos', // TODO scanner
  'editor.bookmarks', // Bookmarks (now an Explorer section)
  'editor.navHistory', // Navigation history
  'dependencies', // Dependency graph
  'run.action', // Run  → moves to the editor toolbar (SB-5)
  'build.action', // Build → moves to the editor toolbar (SB-5)
];

/** Live indicators that are only meaningful while something is happening. */
const CONTEXTUAL: { id: string; side?: 'left' | 'right' }[] = [
  { id: 'runbuild.status', side: 'right' }, // build/run progress
  { id: 'debug', side: 'right' }, // active debug session
  { id: 'tasks.status', side: 'right' }, // background task in flight
  { id: 'editor.security', side: 'right' }, // shown only while a scan runs
  { id: 'editor.perf', side: 'right' }, // shown only while profiling
  { id: 'preview.status', side: 'right' }, // preview server
  { id: 'fullstack.status', side: 'right' }, // full-stack dev server
  { id: 'zoijs.active', side: 'right' }, // Zoijs intelligence active
  { id: 'editor.collab', side: 'right' }, // collaboration session
  { id: 'editor.pair', side: 'right' },
  { id: 'editor.liveshare', side: 'right' },
  { id: 'toolchain.compat', side: 'right' }, // only when the toolchain needs attention
  { id: 'toolchain.pin', side: 'right' },
];

const TABLE: Record<string, StatusPolicyEntry> = {};
for (const id of HIDDEN) TABLE[id] = { level: 'hidden' };
for (const entry of CONTEXTUAL) TABLE[entry.id] = { level: 'contextual', side: entry.side };

/**
 * Classify a status item by id. Unknown ids — including extension-contributed
 * ones — default to `always` so third-party segments keep working.
 */
export function classifyStatus(id: string): StatusPolicyEntry {
  return TABLE[id] ?? { level: 'always' };
}

/** Test/introspection helper: the full hidden set. */
export const HIDDEN_STATUS_IDS: readonly string[] = HIDDEN;
/** Test/introspection helper: the contextual ids. */
export const CONTEXTUAL_STATUS_IDS: readonly string[] = CONTEXTUAL.map((entry) => entry.id);
