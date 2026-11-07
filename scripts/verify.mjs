import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { root, files } from './check-public.mjs';

function run(args, options = {}) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', timeout: 120000, ...options });
  if (result.error || result.status !== 0) throw new Error(`Node verification failed (${result.status ?? result.error?.code ?? 'interrupted'})`);
}
for (const file of files) {
  if (['.js', '.mjs'].includes(extname(file))) run(['--check', file]);
}
const parent = realpathSync(tmpdir());
const home = mkdtempSync(join(parent, 'dsh-agentrouter-offline-test-'));
try {
  const env = { ...process.env, DSH_HOME: home, CODEX_HOME: join(home, 'codex'),
    AGENTROUTER_API_KEY: '', OPENROUTER_API_KEY: '', ANTHROPIC_API_KEY: '', ANTHROPIC_ADMIN_KEY: '' };
  run(['--test', 'packages/usage-ledger/test/agentrouter.test.mjs', 'packages/usage-ledger/test/agentrouter-account.test.mjs'], { env });
  run(['packages/token-usage/test/smoke.mjs'], { env });
  console.log('ok: syntax, offline server tests, and client smoke checks passed');
} finally {
  // This is the exact unique directory allocated above, not a derived user-data path.
  const actual = realpathSync(home);
  if (actual !== home || dirname(actual) !== parent || !basename(actual).startsWith('dsh-agentrouter-offline-test-')) {
    throw new Error('Refusing to clean up an unexpected test path');
  }
  rmSync(actual, { recursive: true });
}
