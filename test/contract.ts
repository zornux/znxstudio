/**
 * Standalone entry for the cross-repo contract check (IL-H). Run against a
 * specific Zornux `contracts/` tree in CI:
 *
 *   ZORNUX_CONTRACTS=/path/to/zornux/contracts npm run contract:check
 *
 * Point it at min / stable / prerelease fixture sets to run the compatibility
 * matrix. Exits non-zero on the first reader that can't parse a fixture.
 */
import './contract.test';
import { runAll } from './harness';

console.log('\nZornux contract check — ZnxStudio readers vs published fixtures');
runAll().then((failed) => {
  process.exit(failed > 0 ? 1 : 0);
});
