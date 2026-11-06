import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { BpmnDocument } from '../../dist/core/document.js';
import { styleFindings } from '../../dist/core/style.js';
import { ROOT } from '../helpers/cli.js';

test('style checks report direction, crossing, overlap, and gateway defaults', async () => {
  const doc = await BpmnDocument.load(
    join(ROOT, 'test/fixtures/style-bad.bpmn')
  );
  const findings = styleFindings(doc);
  const rules = [...new Set(findings.map((finding) => finding.rule))].sort();

  assert.deepEqual(rules, [
    'style/element-overlap',
    'style/flow-crossing',
    'style/flow-direction',
    'style/gateway-default'
  ]);
  assert.ok(findings.every((finding) => finding.source === 'style'));
  assert.ok(findings.every((finding) => finding.severity === 'warning'));
  assert.equal(
    findings.some(
      (finding) =>
        finding.rule === 'style/flow-direction' && finding.elementId === 'Flow_7'
    ),
    false
  );
});

test('style checks accept a clean left-to-right diagram', async () => {
  const doc = await BpmnDocument.load(
    join(ROOT, 'test/fixtures/svg/simple.bpmn')
  );

  assert.deepEqual(styleFindings(doc), []);
});

test('style checks report a no-DI info finding', async () => {
  const doc = await BpmnDocument.load(
    join(ROOT, 'test/fixtures/gateway-no-refs.bpmn')
  );
  const findings = styleFindings(doc);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'style/no-di');
  assert.equal(findings[0].severity, 'info');
});
