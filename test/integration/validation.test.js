import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import {
  ROOT,
  parseJson,
  runCli,
  tempDir,
  writeBpmn
} from '../helpers/cli.js';

test('external diagrams without incoming/outgoing are not reported as disconnected', async () => {
  const result = await runCli([
    'validate',
    join(ROOT, 'test/fixtures/nested.bpmn'),
    '--format',
    'json'
  ]);

  assert.equal(result.code, 0);
  const validation = parseJson(result);
  assert.equal(validation.summary.errors, 0);
  assert.equal(
    validation.findings.some((finding) => finding.rule === 'no-disconnected'),
    false
  );
  assert.equal(
    validation.findings.some((finding) => finding.rule === 'no-implicit-start'),
    false
  );
});

test('gateway analysis uses derived flow references', async () => {
  const result = await runCli([
    'validate',
    join(ROOT, 'test/fixtures/gateway-no-refs.bpmn'),
    '--format',
    'json'
  ]);

  assert.equal(result.code, 0);
  const validation = parseJson(result);
  assert.equal(validation.summary.errors, 0);
  assert.equal(
    validation.findings.some((finding) => finding.rule === 'no-disconnected'),
    false
  );
});

test('missing end event is a validation error', async () => {
  const result = await runCli([
    'validate',
    join(ROOT, 'test/fixtures/missing-end-event.bpmn'),
    '--format',
    'json'
  ]);

  assert.equal(result.code, 1);
  const validation = parseJson(result);
  assert.equal(validation.ok, false);
  assert.equal(validation.valid, false);
  assert.ok(validation.summary.errors >= 1);
  assert.ok(
    validation.findings.some(
      (finding) =>
        finding.rule === 'end-event-required' && finding.severity === 'error'
    )
  );
});

test('dangling sequence-flow reference is a structural error', async () => {
  const result = await runCli([
    'validate',
    join(ROOT, 'test/fixtures/dangling-flow.bpmn'),
    '--format',
    'json'
  ]);

  assert.equal(result.code, 1);
  const validation = parseJson(result);
  assert.ok(
    validation.findings.some(
      (finding) =>
        finding.rule === 'sequence-flow-missing-endpoint' &&
        finding.elementId === 'broken' &&
        finding.source === 'structural'
    )
  );
});

test('broken XML exits with an IO/parse error and JSON on stderr', async () => {
  const result = await runCli([
    'validate',
    join(ROOT, 'test/fixtures/broken.bpmn'),
    '--format',
    'json'
  ]);

  assert.equal(result.code, 3);
  assert.equal(result.stdout, '');
  const error = JSON.parse(result.stderr);
  assert.equal(error.ok, false);
  assert.equal(error.error.code, 'E_PARSE_FAILED');
  assert.match(error.error.message, /parse/i);
});

test('--no-lint skips bpmnlint findings', async () => {
  const result = await runCli([
    'validate',
    join(ROOT, 'test/fixtures/missing-end-event.bpmn'),
    '--no-lint',
    '--format',
    'json'
  ]);

  assert.equal(result.code, 0);
  const validation = parseJson(result);
  assert.equal(validation.summary.errors, 0);
  assert.equal(validation.findings.length, 0);
});

test('strict bpmnlint config restores label and DI errors', async (t) => {
  const dir = await tempDir(t);
  const config = await writeBpmn(
    dir,
    'strict.json',
    JSON.stringify({ extends: ['bpmnlint:recommended'] })
  );

  const result = await runCli([
    'validate',
    join(ROOT, 'test/fixtures/gateway-no-refs.bpmn'),
    '--config',
    config,
    '--format',
    'json'
  ]);

  assert.equal(result.code, 1);
  const validation = parseJson(result);
  assert.ok(
    validation.findings.some(
      (finding) =>
        finding.rule === 'label-required' && finding.severity === 'error'
    )
  );
  assert.ok(
    validation.findings.some(
      (finding) => finding.rule === 'no-bpmndi' && finding.severity === 'error'
    )
  );
});

test('--config and --no-lint are mutually exclusive', async (t) => {
  const dir = await tempDir(t);
  const config = await writeBpmn(dir, 'config.json', '{}');

  const result = await runCli([
    'validate',
    join(ROOT, 'test/fixtures/nested.bpmn'),
    '--config',
    config,
    '--no-lint',
    '--format',
    'json'
  ]);

  assert.equal(result.code, 2);
  assert.equal(JSON.parse(result.stderr).error.code, 'E_USAGE');
});

test('inconsistent incoming/outgoing arrays are reported', async (t) => {
  const dir = await tempDir(t);
  const file = await writeBpmn(
    dir,
    'inconsistent.bpmn',
    `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:test">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="s">
      <bpmn:outgoing>F2</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="t"/>
    <bpmn:endEvent id="e"/>
    <bpmn:sequenceFlow id="F1" sourceRef="s" targetRef="t"/>
    <bpmn:sequenceFlow id="F2" sourceRef="t" targetRef="e"/>
  </bpmn:process>
</bpmn:definitions>
`
  );

  const result = await runCli([
    'validate',
    file,
    '--no-lint',
    '--format',
    'json'
  ]);

  assert.equal(result.code, 0);
  const validation = parseJson(result);
  const mismatch = validation.findings.find(
    (finding) => finding.rule === 'incoming-outgoing-mismatch'
  );
  assert.ok(mismatch);
  assert.equal(mismatch.elementId, 's');
  assert.equal(mismatch.severity, 'warning');
});
