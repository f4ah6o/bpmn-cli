import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ROOT,
  assertOk,
  parseJson,
  runCli,
  sha256,
  tempDir
} from '../helpers/cli.js';

const SIMPLE = join(ROOT, 'test', 'fixtures', 'svg', 'simple.bpmn');
const NO_DI = join(ROOT, 'test', 'fixtures', 'lanes.bpmn');
const NESTED = join(ROOT, 'test', 'fixtures', 'svg', 'nested.bpmn');

test('export-svg writes SVG without modifying the BPMN input', async (t) => {
  const directory = await tempDir(t);
  const output = join(directory, 'simple.svg');
  const before = sha256(await readFile(SIMPLE, 'utf8'));

  const result = await runCli(['export-svg', SIMPLE, '--output', output]);

  assertOk(result, 'export-svg');
  assert.match(result.stdout, /Wrote SVG to/);
  assert.equal(sha256(await readFile(SIMPLE, 'utf8')), before);
  assert.match(await readFile(output, 'utf8'), /<svg\b/);
});

test('export-svg JSON reports renderer, diagram, DI, and dimensions', async (t) => {
  const directory = await tempDir(t);
  const output = join(directory, 'simple.svg');

  const result = await runCli([
    'export-svg',
    SIMPLE,
    '--output',
    output,
    '--format',
    'json',
    '--force'
  ]);

  assertOk(result, 'export-svg JSON');
  const payload = parseJson(result);

  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'export-svg');
  assert.equal(payload.file, SIMPLE);
  assert.equal(payload.output, output);
  assert.equal(payload.wrote, true);
  assert.equal(payload.format, 'svg');
  assert.equal(payload.bpmnJs, '18.31.1');
  assert.equal(payload.di.present, true);
  assert.equal(payload.di.generated, false);
  assert.equal(payload.di.shapes, 3);
  assert.equal(payload.di.edges, 2);
  assert.equal(payload.svg.width, 384);
  assert.equal(payload.svg.height, 90);
  assert.equal(payload.svg.viewBox, '73 75 384 90');
  assert.ok(payload.svg.bytes > 0);
  assert.deepEqual(payload.warnings, []);
});

test('export-svg --stdout emits SVG', async () => {
  const result = await runCli(['export-svg', SIMPLE, '--stdout']);

  assertOk(result, 'export-svg --stdout');
  assert.match(result.stdout, /<svg\b/);
  assert.equal(result.stderr, '');
});

test('export-svg auto-layouts a BPMN without DI in memory', async (t) => {
  const directory = await tempDir(t);
  const output = join(directory, 'lanes.svg');
  const before = sha256(await readFile(NO_DI, 'utf8'));

  const result = await runCli([
    'export-svg',
    NO_DI,
    '--output',
    output,
    '--format',
    'json',
    '--force'
  ]);

  assertOk(result, 'export-svg no DI');
  const payload = parseJson(result);

  assert.equal(payload.di.generated, true);
  assert.equal(payload.di.present, true);
  assert.ok(payload.di.shapes > 0);
  assert.equal(sha256(await readFile(NO_DI, 'utf8')), before);
});

test('export-svg --relayout regenerates DI without touching the input', async (t) => {
  const directory = await tempDir(t);
  const output = join(directory, 'relayout.svg');

  const result = await runCli([
    'export-svg',
    SIMPLE,
    '--relayout',
    '--output',
    output,
    '--format',
    'json',
    '--force'
  ]);

  assertOk(result, 'export-svg --relayout');
  assert.equal(parseJson(result).di.generated, true);
});

test('export-svg requires --force for an existing output', async (t) => {
  const directory = await tempDir(t);
  const output = join(directory, 'existing.svg');
  await writeFile(output, 'existing', 'utf8');

  const refused = await runCli(['export-svg', SIMPLE, '--output', output]);
  assert.equal(refused.code, 4);
  assert.match(refused.stderr, /Output file already exists/);

  const forced = await runCli(['export-svg', SIMPLE, '--output', output, '--force']);
  assertOk(forced, 'export-svg --force');
});

test('export-svg rejects writing over the BPMN input', async (t) => {
  const result = await runCli([
    'export-svg',
    SIMPLE,
    '--output',
    SIMPLE,
    '--force'
  ]);

  assert.equal(result.code, 4);
  assert.match(result.stderr, /same as the BPMN input/);
});

test('export-svg selects and validates BPMNDiagram ids', async (t) => {
  const directory = await tempDir(t);

  const warning = await runCli([
    'export-svg',
    NESTED,
    '--output',
    join(directory, 'first.svg'),
    '--format',
    'json',
    '--force'
  ]);
  assertOk(warning, 'nested default diagram');
  assert.ok(
    parseJson(warning).warnings.some(
      (item) => item.code === 'SVG_MULTIPLE_DIAGRAMS'
    )
  );

  const selected = await runCli([
    'export-svg',
    NESTED,
    '--output',
    join(directory, 'sub.svg'),
    '--diagram',
    'BPMNDiagram_sub',
    '--format',
    'json',
    '--force'
  ]);
  assertOk(selected, 'nested selected diagram');
  assert.equal(parseJson(selected).diagram.id, 'BPMNDiagram_sub');

  const missing = await runCli(['export-svg', NESTED, '--diagram', 'nope']);
  assert.equal(missing.code, 4);
  assert.match(missing.stderr, /No BPMNDiagram found/);
});

test('export-svg rejects conflicting output modes', async () => {
  const stdoutAndOutput = await runCli([
    'export-svg',
    SIMPLE,
    '--stdout',
    '--output',
    '/tmp/x.svg'
  ]);
  assert.equal(stdoutAndOutput.code, 2);

  const stdoutAndJson = await runCli([
    'export-svg',
    SIMPLE,
    '--stdout',
    '--format',
    'json'
  ]);
  assert.equal(stdoutAndJson.code, 2);
});

test('export-svg rejects an empty process', async (t) => {
  const directory = await tempDir(t);
  const input = join(directory, 'empty.bpmn');
  assertOk(await runCli(['init', input, '--id', 'Process_Empty']));

  const result = await runCli([
    'export-svg',
    input,
    '--output',
    join(directory, 'empty.svg')
  ]);

  assert.equal(result.code, 4);
  assert.match(result.stderr, /no flow elements/);
});

test('export-svg reports missing input as an IO error', async () => {
  const result = await runCli([
    'export-svg',
    join(ROOT, 'does-not-exist.bpmn'),
    '--output',
    join(ROOT, '.test-missing.svg')
  ]);

  assert.equal(result.code, 3);
  assert.match(result.stderr, /File not found/);
});
