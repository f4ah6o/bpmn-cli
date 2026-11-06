import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { BpmnDocument } from '../../dist/core/document.js';
import { allocateId, assertValidId } from '../../dist/core/ids.js';
import { reconcileFlowReferences } from '../../dist/core/references.js';
import { ROOT } from '../helpers/cli.js';

test('assertValidId accepts XML ids and rejects whitespace/colons', () => {
  assert.doesNotThrow(() => assertValidId('Task_1'));
  assert.doesNotThrow(() => assertValidId('_start'));
  assert.doesNotThrow(() => assertValidId('申請_1'));

  for (const invalid of ['', '1task', 'bad id', 'a:b', '-task']) {
    assert.throws(
      () => assertValidId(invalid),
      (error) => error.code === 'E_USAGE' && error.exitCode === 2
    );
  }
});

test('allocateId finds the next free id and updates the set', () => {
  const ids = new Set(['Task_1', 'Task_2']);
  assert.equal(allocateId(ids, 'Task'), 'Task_3');
  assert.equal(ids.has('Task_3'), true);
  assert.equal(allocateId(ids, 'Task'), 'Task_4');
});

test('buildIndex understands nested subprocess containers', async () => {
  const doc = await BpmnDocument.load(
    join(ROOT, 'test/fixtures/nested.bpmn')
  );
  const index = doc.index;

  assert.equal(index.processes.length, 1);
  assert.equal(index.containers.length, 2);
  assert.equal(index.elements.length, 6);
  assert.equal(index.flows.length, 4);

  const sub = index.byId.get('sub')[0];
  assert.equal(sub.category, 'flowNode');
  assert.equal(sub.containerId, 'Process_1');

  const subTask = index.byId.get('subTask')[0];
  assert.equal(subTask.category, 'flowNode');
  assert.equal(subTask.containerId, 'sub');
  assert.equal(subTask.processId, 'Process_1');
});

test('reconcileFlowReferences builds missing incoming/outgoing arrays', async () => {
  const doc = await BpmnDocument.load(
    join(ROOT, 'test/fixtures/gateway-no-refs.bpmn')
  );

  const start = doc.index.byId.get('s')[0];
  const gateway = doc.index.byId.get('g')[0];
  assert.equal(start.element.outgoing, undefined);
  assert.equal(gateway.element.outgoing, undefined);

  reconcileFlowReferences(doc.index);

  assert.deepEqual(
    start.element.outgoing.map((flow) => flow.id),
    ['F0']
  );
  assert.deepEqual(
    gateway.element.outgoing.map((flow) => flow.id).sort(),
    ['Fa', 'Fb']
  );
  assert.deepEqual(
    gateway.element.incoming.map((flow) => flow.id),
    ['F0']
  );
});
