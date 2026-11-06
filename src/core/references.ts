import type { ModdleElement } from 'bpmn-moddle';

import type { ModelIndex } from '../types.js';

/**
 * Rebuild FlowNode#incoming / #outgoing from all sequence flows.
 *
 * These XML elements are optional in BPMN, and both bpmnlint and
 * bpmn-auto-layout use them for graph analysis. Rebuilding them in memory
 * (and, for layout, in the serialized input) keeps behavior consistent for
 * files produced by other tools.
 */
export function reconcileFlowReferences(index: ModelIndex): void {
  const incoming = new Map<string, ModdleElement[]>();
  const outgoing = new Map<string, ModdleElement[]>();

  for (const flow of index.flows) {
    const sourceId = flow.sourceId ?? flow.source?.id ?? null;
    const targetId = flow.targetId ?? flow.target?.id ?? null;

    if (sourceId !== null) {
      const list = outgoing.get(sourceId) ?? [];
      list.push(flow.element);
      outgoing.set(sourceId, list);
    }

    if (targetId !== null) {
      const list = incoming.get(targetId) ?? [];
      list.push(flow.element);
      incoming.set(targetId, list);
    }
  }

  for (const element of index.elements) {
    element.element.set('incoming', incoming.get(element.id) ?? []);
    element.element.set('outgoing', outgoing.get(element.id) ?? []);
  }
}
