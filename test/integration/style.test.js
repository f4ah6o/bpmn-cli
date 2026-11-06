import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { ROOT, parseJson, runCli } from '../helpers/cli.js';

test('validate --style reports style warnings without failing', async () => {
  const result = await runCli([
    'validate',
    join(ROOT, 'test/fixtures/style-bad.bpmn'),
    '--style',
    '--no-lint',
    '--format',
    'json'
  ]);

  assert.equal(result.code, 0);
  const validation = parseJson(result);
  assert.equal(validation.summary.errors, 0);
  assert.equal(validation.summary.warnings, 4);
  assert.ok(
    validation.findings.every((finding) => finding.source === 'style')
  );

  const rules = new Set(validation.findings.map((finding) => finding.rule));
  assert.equal(rules.has('style/flow-direction'), true);
  assert.equal(rules.has('style/flow-crossing'), true);
  assert.equal(rules.has('style/element-overlap'), true);
  assert.equal(rules.has('style/gateway-default'), true);
});

test('validate without --style does not add style findings', async () => {
  const result = await runCli([
    'validate',
    join(ROOT, 'test/fixtures/style-bad.bpmn'),
    '--no-lint',
    '--format',
    'json'
  ]);

  assert.equal(result.code, 0);
  const validation = parseJson(result);
  assert.equal(
    validation.findings.some((finding) => finding.source === 'style'),
    false
  );
});

test('validate --style reports no-di as info and still succeeds', async () => {
  const result = await runCli([
    'validate',
    join(ROOT, 'test/fixtures/gateway-no-refs.bpmn'),
    '--style',
    '--no-lint',
    '--format',
    'json'
  ]);

  assert.equal(result.code, 0);
  const validation = parseJson(result);
  assert.equal(validation.summary.infos, 1);
  assert.equal(validation.findings[0].rule, 'style/no-di');
});
