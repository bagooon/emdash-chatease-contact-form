import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const readJson = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const manifest = readJson('../package.json');
const lock = readJson('../package-lock.json');
assert.equal(manifest.name, '@bagooon/chatease-emdash-form');
assert.equal(lock.name, manifest.name);
assert.equal(lock.packages[''].name, manifest.name);
assert.equal(lock.version, manifest.version);
assert.equal(lock.packages[''].version, manifest.version);
assert.equal(manifest.publishConfig.access, 'public');
assert.equal(manifest.publishConfig.registry, 'https://registry.npmjs.org/');
assert.notEqual(manifest.private, true);

assert.ok(process.env.npm_execpath, 'Run this check with npm run check:package');
const [pack] = JSON.parse(execFileSync(process.execPath, [process.env.npm_execpath, 'pack', '--dry-run', '--ignore-scripts', '--json'], { cwd: root, encoding: 'utf8' }));
assert.equal(pack.name, manifest.name);
assert.equal(pack.version, manifest.version);
const files = new Set(pack.files.map(file => file.path));
const targets = value => typeof value === 'string' ? [value] : Object.values(value).flatMap(targets);
const required = [
  'package.json', 'README.md', 'LICENSE', '.github/assets/chatease_logo.svg',
  'src/astro/index.ts', 'src/astro/ChatEaseForm.astro', 'src/astro/client.ts', 'src/model.ts',
  manifest.main, manifest.types, ...targets(manifest.exports),
];
for (const target of required) assert.ok(files.has(target.replace(/^\.\//, '')), `Missing package file: ${target}`);
for (const file of files) {
  assert.ok(/^(dist\/.+\.(js|d\.ts)|src\/astro\/(index\.ts|ChatEaseForm\.astro|client\.ts)|src\/model\.ts|\.github\/assets\/chatease_logo\.svg|package\.json|README\.md|LICENSE)$/.test(file), `Unexpected package file: ${file}`);
}

const { chateasePlugin, createPlugin } = await import('../dist/index.js');
const descriptor = chateasePlugin();
assert.equal(descriptor.id, 'chatease-contact-form', 'Keep the existing settings namespace');
assert.equal(descriptor.version, manifest.version);
assert.equal(descriptor.entrypoint, manifest.name);
assert.equal(descriptor.componentsEntry, `${manifest.name}/astro`);
assert.equal(typeof createPlugin, 'function');
console.log(`Package OK: ${manifest.name}@${manifest.version} (${files.size} files, ${pack.size} bytes)`);
