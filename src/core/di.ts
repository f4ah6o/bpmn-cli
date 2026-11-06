import type { ModdleElement } from 'bpmn-moddle';

import type { Diagnostic } from '../types.js';
import { isType } from './moddle.js';
import { diRefId } from './model.js';

export function removeDiForIds(
  definitions: ModdleElement,
  ids: Set<string>
): number {
  let removed = 0;
  const diagrams = Array.isArray(definitions.diagrams)
    ? definitions.diagrams
    : [];

  for (let index = diagrams.length - 1; index >= 0; index -= 1) {
    const diagram = diagrams[index];
    const plane = diagram.plane;
    const planeReference = plane ? diRefId(plane) : null;

    if (planeReference !== null && ids.has(planeReference)) {
      // Collapsed subprocesses get their own BPMNDiagram whose plane points
      // at the subprocess. Remove the whole diagram when its subject is gone.
      diagrams.splice(index, 1);
      continue;
    }

    if (!plane || !Array.isArray(plane.planeElement)) {
      continue;
    }

    const kept = plane.planeElement.filter((di: ModdleElement) => {
      const reference = diRefId(di);

      if (reference !== null && ids.has(reference)) {
        removed += 1;
        return false;
      }

      return true;
    });

    if (kept.length !== plane.planeElement.length) {
      plane.set('planeElement', kept);
    }
  }

  return removed;
}

export function countDi(definitions: ModdleElement): { shapes: number; edges: number } {
  let shapes = 0;
  let edges = 0;

  for (const diagram of Array.isArray(definitions.diagrams) ? definitions.diagrams : []) {
    for (const di of Array.isArray(diagram.plane?.planeElement) ? diagram.plane.planeElement : []) {
      if (isType(di, 'bpmndi:BPMNShape')) {
        shapes += 1;
      } else if (isType(di, 'bpmndi:BPMNEdge')) {
        edges += 1;
      }
    }
  }

  return { shapes, edges };
}
export function staleDiDiagnostic(elementId?: string): Diagnostic {
  return {
    source: 'cli',
    code: 'STALE_DI',
    message:
      'The diagram already contains BPMN DI. The edit was saved without regenerating layout; ' +
      'run "bpmn layout <file> --force" to regenerate the diagram.',
    ...(elementId === undefined ? {} : { elementId })
  };
}
