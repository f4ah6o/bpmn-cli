import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import {
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

async function buildApproval(dir, file) {
  const commands = [
    ['init', file, '--name', '承認業務'],
    ['add', 'start', file, '--id', 'start'],
    ['add', 'task', file, '--id', 'request', '--name', '申請'],
    ['add', 'gateway', file, '--id', 'decision', '--type', 'exclusive'],
    ['add', 'task', file, '--id', 'approve', '--name', '承認'],
    ['add', 'end', file, '--id', 'end'],
    ['connect', file, 'start', 'request'],
    ['connect', file, 'request', 'decision'],
    ['connect', file, 'decision', 'approve'],
    ['connect', file, 'approve', 'end']
  ];

  for (const args of commands) {
    assertOk(await runCli(args), args[0]);
  }
}

test('documented approval workflow creates and validates a BPMN file', async (t) => {
  const dir = await tempDir(t);
  const file = join(dir, 'approval.bpmn');

  await buildApproval(dir, file);

  const layout = await runCli(['layout', file]);
  assertOk(layout, 'layout');
  assert.match(layout.stdout, /Wrote layout/);

  const xml = await readText(file);
  const { rootElement } = await parseBpmn(xml);
  const process = rootElement.rootElements.find(
    (element) => element.$type === 'bpmn:Process'
  );

  assert.equal(process.id, 'Process_1');
  assert.equal(process.name, '承認業務');
  assert.equal(process.isExecutable, false);

  const flowNodes = process.flowElements.filter(
    (element) => element.$type !== 'bpmn:SequenceFlow'
  );
  const flows = process.flowElements.filter(
    (element) => element.$type === 'bpmn:SequenceFlow'
  );

  assert.deepEqual(
    flowNodes.map((element) => element.id),
    ['start', 'request', 'decision', 'approve', 'end']
  );
  assert.deepEqual(
    flows.map((element) => element.id),
    ['Flow_1', 'Flow_2', 'Flow_3', 'Flow_4']
  );

  const di = diInfo(rootElement);
  assert.equal(di.diagrams, 1);
  assert.equal(di.shapes.length, 5);
  assert.equal(di.edges.length, 4);
  assert.deepEqual(
    [...di.shapeIds].sort(),
    ['approve', 'decision', 'end', 'request', 'start']
  );
  assert.deepEqual(
    [...di.edgeIds].sort(),
    ['Flow_1', 'Flow_2', 'Flow_3', 'Flow_4']
  );

  const start = flowNodes.find((element) => element.id === 'start');
  const end = flowNodes.find((element) => element.id === 'end');
  assert.deepEqual(start.outgoing.map((flow) => flow.id), ['Flow_1']);
  assert.deepEqual(end.incoming.map((flow) => flow.id), ['Flow_4']);

  const validate = await runCli(['validate', file, '--format', 'json']);
  assert.equal(validate.code, 0);
  const validation = parseJson(validate);
  assert.equal(validation.ok, true);
  assert.equal(validation.valid, true);
  assert.equal(validation.summary.errors, 0);

  const list = await runCli(['list', file, '--format', 'json']);
  assertOk(list, 'list');
  const listing = parseJson(list);
  assert.equal(listing.ok, true);
  assert.equal(listing.counts.elements, 5);
  assert.equal(listing.counts.flows, 4);
  assert.equal(listing.di.present, true);
  assert.equal(listing.di.missing, 0);
  assert.equal(listing.di.stale, 0);
  assert.deepEqual(
    listing.elements.map((element) => element.id),
    ['start', 'request', 'decision', 'approve', 'end']
  );
  assert.deepEqual(
    listing.flows.map((flow) => flow.id),
    ['Flow_1', 'Flow_2', 'Flow_3', 'Flow_4']
  );
  assert.deepEqual(listing.elements.find((element) => element.id === 'start').outgoing, [
    'Flow_1'
  ]);
});

test('conditional gateway branch and default flow survive layout', async (t) => {
  const dir = await tempDir(t);
  const file = join(dir, 'branch.bpmn');

  const commands = [
    ['init', file, '--name', '分岐'],
    ['add', 'start', file, '--id', 'start', '--name', '開始'],
    ['add', 'task', file, '--id', 'request', '--name', '申請'],
    ['add', 'gateway', file, '--id', 'decision', '--name', '判定'],
    ['add', 'task', file, '--id', 'approve', '--name', '承認'],
    ['add', 'task', file, '--id', 'reject', '--name', '却下'],
    ['add', 'end', file, '--id', 'end', '--name', '終了'],
    ['add', 'end', file, '--id', 'rejected', '--name', '却下終了'],
    ['connect', file, 'start', 'request', '--id', 'F0'],
    ['connect', file, 'request', 'decision', '--id', 'F1'],
    ['connect', file, 'decision', 'approve', '--id', 'F_approve', '--default'],
    ['connect', file, 'decision', 'reject', '--id', 'F_reject', '--condition', 'approved == false', '--name', '却下'],
    ['connect', file, 'approve', 'end', '--id', 'F_end'],
    ['connect', file, 'reject', 'rejected', '--id', 'F_rejected']
  ];

  for (const args of commands) {
    assertOk(await runCli(args), args[0]);
  }

  const layout = await runCli(['layout', file]);
  assertOk(layout, 'layout');

  const xml = await readText(file);
  assert.match(xml, /default="F_approve"/);

  const { rootElement } = await parseBpmn(xml);
  const process = rootElement.rootElements.find(
    (element) => element.$type === 'bpmn:Process'
  );
  const rejectFlow = process.flowElements.find(
    (element) => element.id === 'F_reject'
  );
  assert.equal(rejectFlow.conditionExpression.body, 'approved == false');

  const di = diInfo(rootElement);
  assert.equal(di.shapes.length, 7);
  assert.equal(di.edges.length, 6);

  const validate = await runCli(['validate', file, '--format', 'json']);
  assert.equal(validate.code, 0);
  const validation = parseJson(validate);
  assert.equal(validation.summary.errors, 0);
});

test('add and connect preserve existing DI and report staleness', async (t) => {
  const dir = await tempDir(t);
  const file = join(dir, 'approval.bpmn');

  await buildApproval(dir, file);
  assertOk(await runCli(['layout', file]), 'layout');

  const add = await runCli(['add', 'task', file, '--id', 'extra', '--name', '追加']);
  assertOk(add, 'add');
  assert.match(add.stderr, /warning:/);
  const beforeBlockedLayout = sha256(await readText(file));

  const list = parseJson(await runCli(['list', file, '--format', 'json']));
  assert.equal(list.counts.elements, 6);
  assert.equal(list.di.missing, 1);
  assert.equal(list.di.stale, 0);

  const blocked = await runCli(['layout', file]);
  assert.equal(blocked.code, 4);
  assert.equal(sha256(await readText(file)), beforeBlockedLayout);

  const forced = await runCli(['layout', file, '--force']);
  assertOk(forced, 'layout --force');
  const after = parseJson(await runCli(['list', file, '--format', 'json']));
  assert.equal(after.di.missing, 0);
});

test('layout output and stdout modes do not modify the input', async (t) => {
  const dir = await tempDir(t);
  const file = join(dir, 'plain.bpmn');
  const output = join(dir, 'layout.bpmn');

  const commands = [
    ['init', file, '--name', 'Plain'],
    ['add', 'start', file, '--id', 's', '--name', 'S'],
    ['add', 'task', file, '--id', 't', '--name', 'T'],
    ['add', 'end', file, '--id', 'e', '--name', 'E'],
    ['connect', file, 's', 't', '--id', 'F1'],
    ['connect', file, 't', 'e', '--id', 'F2']
  ];

  for (const args of commands) {
    assertOk(await runCli(args), args[0]);
  }

  const before = sha256(await readText(file));

  const outputRun = await runCli(['layout', file, '--output', output]);
  assertOk(outputRun, 'layout --output');
  assert.equal(sha256(await readText(file)), before);

  const outputDi = diInfo(
    (await parseBpmn(await readText(output))).rootElement
  );
  assert.equal(outputDi.shapes.length, 3);
  assert.equal(outputDi.edges.length, 2);

  const existing = await runCli(['layout', file, '--output', output]);
  assert.equal(existing.code, 4);

  const existingForced = await runCli([
    'layout',
    file,
    '--output',
    output,
    '--force'
  ]);
  assertOk(existingForced, 'layout --output --force');

  const stdoutRun = await runCli(['layout', output, '--stdout']);
  assertOk(stdoutRun, 'layout --stdout');
  assert.match(stdoutRun.stdout, /^<\?xml/);
  assert.match(stdoutRun.stdout, /BPMNDiagram/);

  const jsonStdout = await runCli([
    'layout',
    output,
    '--stdout',
    '--format',
    'json'
  ]);
  assert.equal(jsonStdout.code, 2);
  const error = JSON.parse(jsonStdout.stderr);
  assert.equal(error.error.code, 'E_USAGE');
  assert.equal(jsonStdout.stdout, '');
});

test('init requires --force for an existing file', async (t) => {
  const dir = await tempDir(t);
  const file = await writeBpmn(
    dir,
    'existing.bpmn',
    '<?xml version="1.0"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:test"/>'
  );

  const blocked = await runCli(['init', file, '--name', 'X']);
  assert.equal(blocked.code, 4);
  assert.match(blocked.stderr, /already exists/);

  const forced = await runCli(['init', file, '--name', 'X', '--force']);
  assertOk(forced, 'init --force');

  const parsed = await parseBpmn(await readText(file));
  assert.equal(
    parsed.rootElement.rootElements[0].name,
    'X'
  );
});
