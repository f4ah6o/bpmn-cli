import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ROOT,
  parseJson,
  runCli,
  tempDir
} from '../helpers/cli.js';

const packageVersion = JSON.parse(
  await readFile(join(ROOT, 'package.json'), 'utf8')
).version;

test('init and add return the documented JSON envelope', async (t) => {
  const dir = await tempDir(t);
  const file = join(dir, 'api.bpmn');

  const init = await runCli([
    'init',
    file,
    '--name',
    'API',
    '--id',
    'Process_API',
    '--format',
    'json'
  ]);
  assert.equal(init.code, 0);
  const created = parseJson(init);
  assert.equal(created.schemaVersion, 1);
  assert.equal(created.tool.name, 'bpmn-cli');
  assert.equal(created.tool.version, packageVersion);
  assert.equal(created.ok, true);
  assert.equal(created.command, 'init');
  assert.equal(created.file, file);
  assert.equal(created.definitions.id, 'Definitions_1');
  assert.equal(created.process.id, 'Process_API');
  assert.equal(created.process.name, 'API');
  assert.equal(created.process.isExecutable, false);
  assert.deepEqual(created.changes.map((change) => change.op), ['add']);
  assert.deepEqual(created.warnings, []);
  assert.equal(created.layout.performed, false);

  const add = await runCli([
    'add',
    'task',
    file,
    '--id',
    'task',
    '--name',
    'Task',
    '--format',
    'json'
  ]);
  assert.equal(add.code, 0);
  const added = parseJson(add);
  assert.equal(added.ok, true);
  assert.equal(added.command, 'add');
  assert.deepEqual(added.changes[0], {
    op: 'add',
    id: 'task',
    type: 'bpmn:Task',
    name: 'Task'
  });
  assert.deepEqual(added.di, { present: false, stale: false });
  assert.deepEqual(added.warnings, []);
});

test('list JSON contains stable top-level sections', async (t) => {
  const dir = await tempDir(t);
  const file = join(dir, 'list.bpmn');

  for (const args of [
    ['init', file, '--name', 'List'],
    ['add', 'start', file, '--id', 's'],
    ['add', 'end', file, '--id', 'e'],
    ['connect', file, 's', 'e', '--id', 'F']
  ]) {
    assert.equal((await runCli(args)).code, 0);
  }

  const result = await runCli(['list', file, '--format', 'json']);
  assert.equal(result.code, 0);
  const listing = parseJson(result);

  for (const key of [
    'schemaVersion',
    'tool',
    'ok',
    'command',
    'file',
    'definitions',
    'processes',
    'collaborations',
    'lanes',
    'elements',
    'flows',
    'messageFlows',
    'di',
    'counts',
    'warnings'
  ]) {
    assert.ok(Object.prototype.hasOwnProperty.call(listing, key), key);
  }

  assert.equal(listing.counts.elements, 2);
  assert.equal(listing.counts.flows, 1);
  assert.deepEqual(listing.flows[0].source, 's');
  assert.deepEqual(listing.flows[0].target, 'e');
  assert.deepEqual(listing.elements[0].outgoing, ['F']);
  assert.deepEqual(listing.elements[1].incoming, ['F']);
  assert.equal(listing.di.present, false);
});

test('validate JSON reports ok=false for errors and exits 1', async () => {
  const result = await runCli([
    'validate',
    join(ROOT, 'test/fixtures/missing-end-event.bpmn'),
    '--format',
    'json'
  ]);

  assert.equal(result.code, 1);
  assert.equal(result.stderr, '');
  const validation = parseJson(result);
  assert.equal(validation.ok, false);
  assert.equal(validation.valid, false);
  assert.ok(validation.summary.errors >= 1);
  assert.ok(Array.isArray(validation.findings));
  assert.deepEqual(validation.warnings, []);
});

test('action errors are JSON on stderr and keep stdout empty', async (t) => {
  const dir = await tempDir(t);
  const file = join(dir, 'missing.bpmn');

  const result = await runCli(['add', 'task', file, '--format', 'json']);
  assert.equal(result.code, 3);
  assert.equal(result.stdout, '');
  const error = JSON.parse(result.stderr);
  assert.equal(error.ok, false);
  assert.equal(error.command, 'add');
  assert.equal(error.file, file);
  assert.equal(error.error.code, 'E_FILE_NOT_FOUND');
});

test('commander usage errors are clean JSON in JSON mode', async (t) => {
  const dir = await tempDir(t);
  const file = join(dir, 'usage.bpmn');
  assert.equal((await runCli(['init', file])).code, 0);

  const result = await runCli([
    'connect',
    file,
    's',
    '--format',
    'json'
  ]);

  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  const error = JSON.parse(result.stderr);
  assert.equal(error.ok, false);
  assert.equal(error.command, 'connect');
  assert.equal(error.error.code, 'E_USAGE');
  assert.doesNotMatch(result.stderr, /Usage: bpmn/);
  assert.doesNotMatch(result.stderr, /^error:/m);
});

test('unknown commands respect JSON mode', async () => {
  const result = await runCli(['no-such-command', '--format', 'json']);

  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  const error = JSON.parse(result.stderr);
  assert.equal(error.error.code, 'E_USAGE');
  assert.doesNotMatch(result.stderr, /Usage: bpmn/);
});

test('help and version exit successfully', async () => {
  const version = await runCli(['--version']);
  assert.equal(version.code, 0);
  assert.equal(version.stdout.trim(), packageVersion);

  const help = await runCli(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Usage: bpmn/);
  assert.match(help.stdout, /validate/);
  assert.match(help.stdout, /layout/);
});

test('exit code matrix for common failures', async (t) => {
  const dir = await tempDir(t);
  const file = join(dir, 'matrix.bpmn');

  assert.equal((await runCli(['init', file])).code, 0);
  assert.equal(
    (await runCli(['add', 'start', file, '--id', 's'])).code,
    0
  );
  assert.equal(
    (await runCli(['add', 'start', file, '--id', 's'])).code,
    4
  );
  assert.equal(
    (await runCli(['add', 'start', file, '--type', 'timer'])).code,
    2
  );
  assert.equal(
    (await runCli(['validate', join(dir, 'missing.bpmn')])).code,
    3
  );
  assert.equal(
    (await runCli([
      'validate',
      join(ROOT, 'test/fixtures/missing-end-event.bpmn')
    ])).code,
    1
  );
});
