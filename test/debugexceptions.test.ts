import { describe, expect, test } from './harness';
import {
  EXCEPTION_BREAK_MODES,
  adapterDefaultMode,
  describeMode,
  filtersFor,
  isModeSupported,
  modeForFilters,
  parseExceptionFilters,
  supportsExceptionFilters,
} from '../src/renderer/debug/exceptions';

/** The capabilities `zornux dap` 1.0.0-rc.4 actually returns from `initialize`. */
const RC4_CAPABILITIES = {
  supportsConfigurationDoneRequest: true,
  supportsConditionalBreakpoints: true,
  supportsEvaluateForHovers: true,
  supportsTerminateRequest: true,
  supportsZornuxProfiling: true,
  exceptionBreakpointFilters: [
    {
      filter: 'all',
      label: 'All errors',
      description: 'Break whenever an error is raised, even one a try or protect recovers from.',
      default: false,
    },
    {
      filter: 'uncaught',
      label: 'Uncaught errors',
      description: 'Break only on errors that escape every try, protect, and expect.',
      default: true,
    },
  ],
};

/** rc.3 and earlier: the request was accepted and ignored, and nothing was advertised. */
const RC3_CAPABILITIES = {
  supportsConfigurationDoneRequest: true,
  supportsEvaluateForHovers: true,
};

describe('filtersFor', () => {
  test('each mode maps to the DAP filters the adapter reads', () => {
    expect(filtersFor('all')).toEqual(['all']);
    expect(filtersFor('uncaught')).toEqual(['uncaught']);
  });

  test('never sends an EMPTY array — a real choice, not the absence of one', () => {
    expect(filtersFor('never')).toEqual([]);
  });

  test('there are exactly three modes', () => {
    expect(EXCEPTION_BREAK_MODES).toEqual(['all', 'uncaught', 'never']);
  });
});

describe('modeForFilters', () => {
  test('round-trips every mode', () => {
    for (const mode of EXCEPTION_BREAK_MODES) expect(modeForFilters(filtersFor(mode))).toBe(mode);
  });

  test("'all' wins over 'uncaught', exactly as the adapter resolves them", () => {
    expect(modeForFilters(['uncaught', 'all'])).toBe('all');
  });

  test('an unrecognised filter is not a mode', () => {
    expect(modeForFilters(['userUnhandled'])).toBe('never');
  });
});

describe('parseExceptionFilters', () => {
  test('reads the filters rc.4 advertises', () => {
    const filters = parseExceptionFilters(RC4_CAPABILITIES);
    expect(filters).toHaveLength(2);
    expect(filters[0].filter).toBe('all');
    expect(filters[0].default).toBe(false);
    expect(filters[1].filter).toBe('uncaught');
    expect(filters[1].default).toBe(true);
    expect(filters[1].label).toBe('Uncaught errors');
  });

  test('an adapter that advertises none honours none', () => {
    expect(parseExceptionFilters(RC3_CAPABILITIES)).toHaveLength(0);
    expect(supportsExceptionFilters(RC3_CAPABILITIES)).toBe(false);
    expect(supportsExceptionFilters(RC4_CAPABILITIES)).toBe(true);
  });

  test('garbage never throws', () => {
    expect(parseExceptionFilters(null)).toHaveLength(0);
    expect(parseExceptionFilters({ exceptionBreakpointFilters: 'nope' })).toHaveLength(0);
    expect(parseExceptionFilters({ exceptionBreakpointFilters: [{ label: 'no filter key' }] })).toHaveLength(0);
  });

  test('a filter with no description still parses, labelled by its id', () => {
    const [filter] = parseExceptionFilters({ exceptionBreakpointFilters: [{ filter: 'all' }] });
    expect(filter.label).toBe('all');
    expect(filter.description).toBe('');
    expect(filter.default).toBe(false);
  });
});

describe('adapterDefaultMode', () => {
  test("rc.4's own default is 'uncaught', and we read it rather than assume it", () => {
    expect(adapterDefaultMode(parseExceptionFilters(RC4_CAPABILITIES))).toBe('uncaught');
  });

  test('an adapter defaulting to all is respected', () => {
    const filters = parseExceptionFilters({ exceptionBreakpointFilters: [{ filter: 'all', default: true }] });
    expect(adapterDefaultMode(filters)).toBe('all');
  });

  test('when nothing is marked default we assume uncaught, which is what rc.4 does', () => {
    const filters = parseExceptionFilters({ exceptionBreakpointFilters: [{ filter: 'all' }] });
    expect(adapterDefaultMode(filters)).toBe('uncaught');
  });
});

describe('isModeSupported', () => {
  const filters = parseExceptionFilters(RC4_CAPABILITIES);

  test('a mode the adapter advertised is supported', () => {
    expect(isModeSupported('all', filters)).toBe(true);
    expect(isModeSupported('uncaught', filters)).toBe(true);
  });

  test('never is supported whenever the adapter honours the request at all', () => {
    expect(isModeSupported('never', filters)).toBe(true);
    expect(isModeSupported('never', [])).toBe(false);
  });

  test('an adapter that advertises nothing supports no mode', () => {
    expect(isModeSupported('all', [])).toBe(false);
  });
});

describe('describeMode', () => {
  test('each mode explains itself in the language of the runtime', () => {
    expect(describeMode('all')).toContain('try or protect recovers');
    expect(describeMode('uncaught')).toContain('escape every try');
    expect(describeMode('never')).toContain('Never pause');
  });
});
