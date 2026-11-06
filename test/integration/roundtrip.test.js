import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ROOT,
  assertOk,
  parseBpmn,
  parseJson,
  readText,
  runCli,
  sha256,
  tempDir
} from '../helpers/cli.js';

async function copyFixture(dir, name, target = name) {
  const file = join(dir, target);
  await writeFile(
    file,
    await readFile(join(ROOT, 'test/fixtures', name), 'utf8'),
    'utf8'
  );
  return file;
}

test('vendor extension elements survive edits and layout', async (t) => {
  const dir = await tempDir(t);
  const file = await copyFixture(dir, 'vendor-extension.bpmn');

  assertOk(await runCli(['rename', file, 'task', '--name', 'Renamed']), 'rename');
  let xml = await readText(file);
  assert.match(xml, /camunda:versionTag="v1"/);
  assert.match(xml, /camunda:property name="owner" value="ops"/);

  assertOk(await runCli(['layout', file]), 'layout');
  xml = await readText(file);
  assert.match(xml, /camunda:versionTag="v1"/);
  assert.match(xml, /camunda:property name="owner" value="ops"/);

  const { rootElement } = await parseBpmn(xml);
  const process = rootElement.rootElements.find(
    (element) => element.$type === 'bpmn:Process'
  );
  assert.equal(
    process.flowElements.find((element) => element.id === 'task').name,
    'Renamed'
  );
});

test('collaboration diagrams can be listed, validated, and laid out', async (t) => {
  const dir = await tempDir(t);
  const file = await copyFixture(dir, 'collaboration.bpmn');

  const list = parseJson(await runCli(['list', file, '--format', 'json']));
  assert.equal(list.collaborations.length, 1);
  assert.equal(list.collaborations[0].participants.length, 2);
  assert.equal(list.messageFlows.length, 1);
  assert.equal(list.counts.elements, 6);

  const before = await runCli(['validate', file, '--format', 'json']);
  assert.equal(before.code, 0);
  assert.equal(parseJson(before).summary.errors, 0);

  assertOk(await runCli(['layout', file]), 'layout');

  const after = parseJson(await runCli(['list', file, '--format', 'json']));
  assert.equal(after.di.missing, 0);
  assert.equal(after.di.stale, 0);
  assert.ok(after.di.shapes >= 8);
  assert.ok(after.di.edges >= 5);

  const validation = await runCli(['validate', file, '--format', 'json']);
  assert.equal(validation.code, 0);
  assert.equal(parseJson(validation).summary.errors, 0);
});

test('existing lanes can be listed, validated, and laid out', async (t) => {
  const dir = await tempDir(t);
  const file = await copyFixture(dir, 'lanes.bpmn');

  const listing = parseJson(await runCli(['list', file, '--format', 'json']));
  assert.equal(listing.lanes.length, 2);
  assert.deepEqual(listing.lanes[0].flowNodeRefs, ['start', 'task1']);

  const before = await runCli(['validate', file, '--format', 'json']);
  assert.equal(before.code, 0);
  assert.equal(parseJson(before).summary.errors, 0);

  assertOk(await runCli(['layout', file]), 'layout');
  const after = parseJson(await runCli(['list', file, '--format', 'json']));
  assert.equal(after.di.missing, 0);
  assert.equal(after.di.shapes, 6);
  assert.equal(after.di.edges, 3);

  const validation = await runCli(['validate', file, '--format', 'json']);
  assert.equal(validation.code, 0);
  assert.equal(parseJson(validation).summary.errors, 0);
});

test('existing boundary events can be validated and laid out', async (t) => {
  const dir = await tempDir(t);
  const file = await copyFixture(dir, 'boundary.bpmn');

  const listing = parseJson(await runCli(['list', file, '--format', 'json']));
  assert.equal(
    listing.elements.find((element) => element.id === 'timeout').attachedTo,
    'work'
  );

  const before = await runCli(['validate', file, '--format', 'json']);
  assert.equal(before.code, 0);
  assert.equal(parseJson(before).summary.errors, 0);

  assertOk(await runCli(['layout', file]), 'layout');
  const after = parseJson(await runCli(['list', file, '--format', 'json']));
  assert.equal(after.di.missing, 0);
  assert.equal(after.di.shapes, 6);
  assert.equal(after.di.edges, 4);
});

test('layout reports multiple processes without a collaboration', async (t) => {
  const dir = await tempDir(t);
  const file = await copyFixture(dir, 'multi-process.bpmn');

  const result = await runCli(['layout', file, '--format', 'json']);
  assertOk(result, 'layout');
  const payload = parseJson(result);
  assert.ok(
    payload.warnings.some((warning) => warning.code === 'MULTIPLE_PROCESSES')
  );

  const listing = parseJson(await runCli(['list', file, '--format', 'json']));
  assert.equal(listing.di.present, true);
  assert.ok(listing.di.missing > 0);
});

test('layout adds derived incoming/outgoing references', async (t) => {
  const dir = await tempDir(t);
  const file = await copyFixture(dir, 'gateway-no-refs.bpmn');

  const before = await readText(file);
  assert.doesNotMatch(before, /<bpmn:incoming>/);

  assertOk(await runCli(['layout', file]), 'layout');
  const after = await readText(file);
  assert.match(after, /<bpmn:incoming>/);
  assert.match(after, /<bpmn:outgoing>/);

  const { rootElement } = await parseBpmn(after);
  const process = rootElement.rootElements.find(
    (element) => element.$type === 'bpmn:Process'
  );
  const start = process.flowElements.find((element) => element.id === 's');
  const gateway = process.flowElements.find((element) => element.id === 'g');
  assert.deepEqual(start.outgoing.map((flow) => flow.id), ['F0']);
  assert.deepEqual(
    gateway.outgoing.map((flow) => flow.id).sort(),
    ['Fa', 'Fb']
  );
});

test('layout failure leaves the input byte-for-byte unchanged', async (t) => {
  const dir = await tempDir(t);
  const file = await copyFixture(dir, 'dangling-flow.bpmn');
  const before = sha256(await readText(file));

  const result = await runCli(['layout', file, '--format', 'json']);
  assert.equal(result.code, 4);
  const error = JSON.parse(result.stderr);
  assert.equal(error.error.code, 'E_LAYOUT_FAILED');
  assert.equal(error.error.details.layoutCode, 'INVALID_SEQUENCE_FLOW_ENDPOINT');
  assert.equal(sha256(await readText(file)), before);
});
