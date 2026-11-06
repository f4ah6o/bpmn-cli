import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { BpmnModdle } from 'bpmn-moddle';
import { layoutProcess } from 'bpmn-auto-layout';

const require = createRequire(import.meta.url);

test('pinned bpmn-moddle and bpmn-auto-layout generate BPMN DI', async () => {
  const moddle = new BpmnModdle();
  const definitions = moddle.create('bpmn:Definitions', {
    id: 'Definitions_1',
    targetNamespace: 'http://bpmn.io/schema/bpmn'
  });
  const process = moddle.create('bpmn:Process', {
    id: 'Process_1',
    isExecutable: false
  });
  process.$parent = definitions;
  definitions.get('rootElements').push(process);

  const start = moddle.create('bpmn:StartEvent', { id: 's' });
  const task = moddle.create('bpmn:Task', { id: 't', name: 'Task' });
  const end = moddle.create('bpmn:EndEvent', { id: 'e' });

  for (const element of [start, task, end]) {
    element.$parent = process;
    process.get('flowElements').push(element);
  }

  const connect = (source, target, id) => {
    const flow = moddle.create('bpmn:SequenceFlow', {
      id,
      sourceRef: source,
      targetRef: target
    });
    flow.$parent = process;
    process.get('flowElements').push(flow);
    source.get('outgoing').push(flow);
    target.get('incoming').push(flow);
  };

  connect(start, task, 'f1');
  connect(task, end, 'f2');

  const { xml } = await moddle.toXML(definitions, { format: true });
  const result = await layoutProcess(xml);

  assert.ok(Array.isArray(result.warnings));
  assert.match(result.xml, /BPMNDiagram/);
  assert.match(result.xml, /BPMNShape/);
  assert.match(result.xml, /BPMNEdge/);

  const { rootElement } = await moddle.fromXML(result.xml);
  assert.equal(rootElement.diagrams.length, 1);
});

test('pinned bpmn-js runtime exposes the saveSVG version', async () => {
  const packageJson = JSON.parse(
    await readFile(
      new URL('../node_modules/bpmn-js/package.json', import.meta.url),
      'utf8'
    )
  );

  assert.equal(packageJson.version, '18.31.1');
  assert.equal(packageJson.dependencies['diagram-js'], '^15.28.0');
});

test('pinned bpmnlint exposes an async Linter with NodeResolver', async () => {
  const { Linter } = require('bpmnlint');
  const NodeResolver = require('bpmnlint/lib/resolver/node-resolver');
  const linter = new Linter({
    config: {
      extends: ['bpmnlint:recommended'],
      rules: { 'label-required': 'warn', 'no-bpmndi': 'warn' }
    },
    resolver: new NodeResolver()
  });

  const moddle = new BpmnModdle();
  const { rootElement } = await moddle.fromXML(
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:test"><bpmn:process id="P"/></bpmn:definitions>'
  );

  const reports = await linter.lint(rootElement);
  assert.equal(typeof reports, 'object');
});
