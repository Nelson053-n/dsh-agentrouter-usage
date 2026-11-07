import assert from 'node:assert/strict';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const skipped = new Set(['.git', 'node_modules', 'coverage']);
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skipped.has(name)) continue;
    const path = join(dir, name);
    const stat = lstatSync(path);
    assert.equal(stat.isSymbolicLink(), false, `Symlink not allowed in source distribution: ${relative(root, path)}`);
    if (stat.isDirectory()) walk(path);
    else if (stat.isFile()) files.push(path);
  }
}
walk(root);

const forbiddenNames = /^(?:\.credentials\.(?:yaml|yml)|auth\.json|\.env(?:\..*)?|.*\.(?:jsonl|log|pem|key|p12|pfx))$/i;
const privateDirectories = new Set(['.dsh', '.codex', 'profiles', 'storages', 'sessions']);
const rules = [
  ['provider API key', /\bsk-(?:ant-[A-Za-z0-9_-]+-|or-v1-)?[A-Za-z0-9_-]{24,}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{24,})\b/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['literal bearer credential', /\bBearer\s+[A-Za-z0-9_.-]{32,}\b/],
  ['hardcoded personal path', /(?:[A-Za-z]:\\Users\\|\/Users\/|\/home\/)[A-Za-z0-9_.-]+[\\/]/]
];
const problems = [];
for (const file of files) {
  const rel = relative(root, file).replaceAll('\\', '/');
  if (forbiddenNames.test(basename(file)) && basename(file) !== '.env.example') problems.push(`${rel}: runtime/credential filename`);
  if (rel.split('/').some((part) => privateDirectories.has(part))) problems.push(`${rel}: runtime data directory`);
  const bytes = readFileSync(file);
  if (bytes.includes(0)) { problems.push(`${rel}: unexpected binary file`); continue; }
  const text = bytes.toString('utf8');
  for (const [rule, pattern] of rules) {
    const match = pattern.exec(text);
    if (match) problems.push(`${rel}:${text.slice(0, match.index).split('\n').length}: ${rule}`);
  }
}
if (problems.length > 0) {
  // Never print a matching value: even a failed scan must not leak a secret into CI logs.
  console.error(problems.join('\n'));
  process.exit(1);
}

const project = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const name of ['usage-ledger', 'token-usage']) {
  const dir = join(root, 'packages', name);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.name, `@local/${name}`);
  assert.equal(pkg.version, project.version);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(pkg.exports['./icon'], './icon.svg');
  assert.ok(pkg.exports['./locale/*.json']);
  for (const [key, target] of Object.entries(pkg.exports)) {
    if (key.includes('*')) continue;
    assert.ok(target.startsWith('./') && !target.includes('..'), `Export must stay in package: ${key}`);
    assert.ok(lstatSync(join(dir, target)).isFile(), `Missing export: ${target}`);
  }
  for (const entry of pkg.files) {
    if (entry.includes('*')) continue;
    assert.ok(lstatSync(join(dir, entry)).isFile(), `Missing distributed file: ${name}/${entry}`);
  }
  for (const lang of ['en', 'ru', 'zh']) {
    const locale = JSON.parse(readFileSync(join(dir, 'locale', lang + '.json'), 'utf8'));
    assert.ok(locale.meta.title?.trim());
    assert.ok(locale.meta.description?.trim());
  }
  const icon = readFileSync(join(dir, 'icon.svg'), 'utf8');
  assert.ok(Buffer.byteLength(icon) <= 256 * 1024);
  assert.match(icon, /^\s*<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(icon, /<\/svg>\s*$/);
  assert.doesNotMatch(icon, /<script\b|\bon\w+\s*=|(?:href|src)\s*=\s*["']https?:/i);
  const patch = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8');
  assert.ok(patch.includes(`name: '@local/${name}'`));
}
const client = JSON.parse(readFileSync(join(root, 'packages/token-usage/package.json'), 'utf8'));
assert.equal(client.dsh.client.platform, 'web');
assert.equal(client.exports['./client'], './client.js');
assert.deepEqual(client.dsh.client.inject, ['@deepseek-ai/dsh-client-ui-conversation']);
console.log(`ok: ${files.length} source files; no detected credentials/personal paths; package resources and metadata valid`);

export { root, files };
