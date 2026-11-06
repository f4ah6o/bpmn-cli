import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lstat, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ROOT,
  assertOk,
  diInfo,
  parseBpmn,
  parseJson,
  readText,
  runCli,
  sha256,
  tempDir,
  writeBpmn
} from '../helpers/cli.js';

async function initFile(t, name = 'file.bpmn', extra = []) {
  const dir = await tempDir(t);
  const file = join(dir, name);
  assertOk(await runCli(['init', file, '--name', 'Test', ...extra]), 'init');
  return { dir, file };
}

test('add supports kinds, subtypes, and generated ids', async (t) => {
  const { file } = await initFile(t);

  const commands = [
    ['add', 'start', file],
    ['add', 'task', file, '--type', 'user'],
    ['add', 'task', file, '--type', 'service'],
    ['add', 'gateway', file, '--type', 'inclusive'],
    ['add', 'end', file]
  ];

  for (const args of commands) {
    assertOk(await runCli(args), args[0]);
  }

  const listing = parseJson(await runCli(['list', file, '--format', 'json']));
  assert.deepEqual(
    listing.elements.map((element) => element.id),
    ['StartEvent_1', 'UserTask_1', 'ServiceTask_1', 'InclusiveGateway_1', 'EndEvent_1']
  );
  assert.deepEqual(
    listing.elements.map((element) => element.type),
    [
      'bpmn:StartEvent',
      'bpmn:UserTask',
      'bpmn:ServiceTask',
      'bpmn:InclusiveGateway',
      'bpmn:EndEvent'
    ]
  );

  const duplicate = await runCli([
    'add',
    'start',
    file,
    '--id',
    'StartEvent_1',
    '--format',
    'json'
  ]);
  assert.equal(duplicate.code, 4);
  assert.equal(JSON.parse(duplicate.stderr).error.code, 'E_ELEMENT_EXISTS');

  const invalidId = await runCli([
    'add',
    'start',
    file,
    '--id',
    'bad id',
    '--format',
    'json'
  ]);
  assert.equal(invalidId.code, 2);
  assert.equal(JSON.parse(invalidId.stderr).error.code, 'E_USAGE');

  const invalidKind = await runCli(['add', 'banana', file, '--format', 'json']);
  assert.equal(invalidKind.code, 2);

  const invalidType = await runCli([
    'add',
    'start',
    file,
    '--type',
    'timer',
    '--format',
    'json'
  ]);
  assert.equal(invalidType.code, 2);
});

test('connect and update maintain conditions and default flows', async (t) => {
  const { file } = await initFile(t, 'defaults.bpmn');

  const setup = [
    ['add', 'start', file, '--id', 's'],
    ['add', 'gateway', file, '--id', 'g'],
    ['add', 'task', file, '--id', 'a'],
    ['add', 'task', file, '--id', 'b'],
    ['add', 'end', file, '--id', 'e'],
    ['connect', file, 's', 'g', '--id', 'F0'],
    ['connect', file, 'g', 'a', '--id', 'Fa'],
    ['connect', file, 'g', 'b', '--id', 'Fb']
  ];

  for (const args of setup) {
    assertOk(await runCli(args), args[0]);
  }

  assertOk(await runCli(['update', file, 'Fa', '--default']), 'default');
  let xml = await readText(file);
  assert.match(xml, /default="Fa"/);

  let listing = parseJson(await runCli(['list', file, '--format', 'json']));
  assert.equal(
    listing.flows.find((flow) => flow.id === 'Fa').isDefault,
    true
  );

  const conditionOnDefault = await runCli([
    'update',
    file,
    'Fa',
    '--condition',
    'x',
    '--format',
    'json'
  ]);
  assert.equal(conditionOnDefault.code, 4);
  assert.equal(
    JSON.parse(conditionOnDefault.stderr).error.code,
    'E_DEFAULT_FLOW_CONDITION'
  );

  const conflict = await runCli([
    'update',
    file,
    'Fa',
    '--default',
    '--condition',
    'x',
    '--format',
    'json'
  ]);
  assert.equal(conflict.code, 2);

  assertOk(await runCli(['update', file, 'Fa', '--no-default']), 'no-default');
  listing = parseJson(await runCli(['list', file, '--format', 'json']));
  assert.equal(
    listing.flows.find((flow) => flow.id === 'Fa').isDefault,
    false
  );
  xml = await readText(file);
  assert.doesNotMatch(xml, /default="Fa"/);

  assertOk(
    await runCli(['update', file, 'Fb', '--condition', 'second']),
    'condition'
  );
  const { rootElement } = await parseBpmn(await readText(file));
  const process = rootElement.rootElements.find(
    (element) => element.$type === 'bpmn:Process'
  );
  assert.equal(
    process.flowElements.find((element) => element.id === 'Fb')
      .conditionExpression.body,
    'second'
  );

  assertOk(
    await runCli(['update', file, 'Process_1', '--executable']),
    'executable'
  );
  listing = parseJson(await runCli(['list', file, '--format', 'json']));
  assert.equal(listing.processes[0].isExecutable, true);

  assertOk(
    await runCli(['rename', file, 'Process_1', '--name', '']),
    'rename empty'
  );
  assert.doesNotMatch(await readText(file), /name="Test"/);

  const duplicate = await runCli([
    'connect',
    file,
    's',
    'g',
    '--format',
    'json'
  ]);
  assert.equal(duplicate.code, 4);
  assert.equal(JSON.parse(duplicate.stderr).error.code, 'E_DUPLICATE_FLOW');

  const missing = await runCli([
    'connect',
    file,
    'missing',
    'g',
    '--format',
    'json'
  ]);
  assert.equal(missing.code, 4);
  assert.equal(JSON.parse(missing.stderr).error.code, 'E_ELEMENT_NOT_FOUND');

  const badOptions = await runCli([
    'connect',
    file,
    'g',
    'a',
    '--default',
    '--condition',
    'x',
    '--format',
    'json'
  ]);
  assert.equal(badOptions.code, 2);
});

test('cross-scope connections fail without modifying the file', async (t) => {
  const dir = await tempDir(t);
  const file = join(dir, 'nested.bpmn');
  await writeFile(
    file,
    await readFile(join(ROOT, 'test/fixtures/nested.bpmn'), 'utf8'),
    'utf8'
  );

  const before = sha256(await readText(file));
  const result = await runCli([
    'connect',
    file,
    'start',
    'subTask',
    '--format',
    'json'
  ]);

  assert.equal(result.code, 4);
  assert.equal(JSON.parse(result.stderr).error.code, 'E_CROSS_SCOPE_FLOW');
  assert.equal(sha256(await readText(file)), before);
});

test('remove requires cascade for connected nodes and cleans up DI', async (t) => {
  const { dir, file } = await initFile(t, 'remove.bpmn');

  const setup = [
    ['add', 'start', file, '--id', 's', '--name', 'S'],
    ['add', 'task', file, '--id', 't', '--name', 'T'],
    ['add', 'end', file, '--id', 'e', '--name', 'E'],
    ['connect', file, 's', 't', '--id', 'F1'],
    ['connect', file, 't', 'e', '--id', 'F2']
  ];

  for (const args of setup) {
    assertOk(await runCli(args), args[0]);
  }

  assertOk(await runCli(['layout', file]), 'layout');
  const before = sha256(await readText(file));

  const blocked = await runCli(['remove', file, 't', '--format', 'json']);
  assert.equal(blocked.code, 4);
  assert.equal(
    JSON.parse(blocked.stderr).error.code,
    'E_REMOVE_REQUIRES_CASCADE'
  );
  assert.equal(sha256(await readText(file)), before);

  assertOk(await runCli(['remove', file, 't', '--cascade']), 'cascade');
  const { rootElement } = await parseBpmn(await readText(file));
  const di = diInfo(rootElement);
  assert.equal(rootElement.rootElements[0].flowElements.length, 2);
  assert.deepEqual(di.shapeIds.sort(), ['e', 's']);
  assert.equal(di.edges.length, 0);
});

test('removing a subprocess removes its separate DI diagram', async (t) => {
  const dir = await tempDir(t);
  const file = join(dir, 'nested.bpmn');
  await writeFile(
    file,
    await readFile(join(ROOT, 'test/fixtures/nested.bpmn'), 'utf8'),
    'utf8'
  );

  assertOk(await runCli(['layout', file]), 'layout');
  const before = parseJson(await runCli(['list', file, '--format', 'json']));
  assert.equal(before.di.diagrams, 2);

  assertOk(await runCli(['remove', file, 'sub', '--cascade']), 'remove sub');
  const after = parseJson(await runCli(['list', file, '--format', 'json']));
  assert.equal(after.di.diagrams, 1);
  assert.equal(after.counts.elements, 2);
  assert.equal(after.counts.flows, 0);

  const xml = await readText(file);
  assert.doesNotMatch(xml, /bpmnElement="sub"/);
});

test('removing a default flow clears the source default attribute', async (t) => {
  const { file } = await initFile(t, 'default-remove.bpmn');

  const setup = [
    ['add', 'start', file, '--id', 's'],
    ['add', 'gateway', file, '--id', 'g'],
    ['add', 'task', file, '--id', 'a'],
    ['add', 'end', file, '--id', 'e'],
    ['connect', file, 's', 'g', '--id', 'F0'],
    ['connect', file, 'g', 'a', '--id', 'Fa', '--default'],
    ['connect', file, 'a', 'e', '--id', 'F1']
  ];

  for (const args of setup) {
    assertOk(await runCli(args), args[0]);
  }

  assert.match(await readText(file), /default="Fa"/);
  assertOk(await runCli(['remove', file, 'Fa']), 'remove default flow');
  assert.doesNotMatch(await readText(file), /default="Fa"/);
});

test('init --layout on an empty process warns and writes no DI', async (t) => {
  const dir = await tempDir(t);
  const file = join(dir, 'empty.bpmn');

  const result = await runCli(['init', file, '--layout', '--format', 'json']);
  assertOk(result, 'init --layout');
  const payload = parseJson(result);
  assert.equal(payload.layout.performed, false);
  assert.ok(payload.warnings.some((warning) => warning.code === 'NO_LAYOUT_TARGETS'));

  const listing = parseJson(await runCli(['list', file, '--format', 'json']));
  assert.equal(listing.di.present, false);
});

test('writes through symlinks and preserves the symlink', async (t) => {
  const { dir, file } = await initFile(t, 'target.bpmn');
  const link = join(dir, 'link.bpmn');
  await symlink(file, link);

  const result = await runCli(['add', 'task', link, '--id', 'task', '--name', 'T']);
  assertOk(result, 'add via symlink');

  assert.equal((await lstat(link)).isSymbolicLink(), true);
  const targetListing = parseJson(
    await runCli(['list', file, '--format', 'json'])
  );
  assert.deepEqual(
    targetListing.elements.map((element) => element.id),
    ['task']
  );
});

test('reads BOM-prefixed files and preserves unicode names', async (t) => {
  const { file } = await initFile(t, 'unicode.bpmn');
  const withBom = `\uFEFF${await readText(file)}`;
  await writeFile(file, withBom, 'utf8');

  assertOk(
    await runCli([
      'update',
      file,
      'Process_1',
      '--name',
      '承認 & <業務>'
    ]),
    'unicode name'
  );

  const xml = await readText(file);
  assert.notEqual(xml.charCodeAt(0), 0xfeff);
  assert.match(xml, /name="承認 /);
  assert.match(xml, /&#38;|&amp;/);
  assert.match(xml, /&#60;|&lt;/);

  const { rootElement } = await parseBpmn(xml);
  assert.equal(rootElement.rootElements[0].name, '承認 & <業務>');
});
