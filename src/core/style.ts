import type { ModdleElement } from 'bpmn-moddle';

import type { Finding, IndexedFlow } from '../types.js';
import type { BpmnDocument } from './document.js';
import { isType } from './moddle.js';
import { rawRefId } from './model.js';

const EPSILON = 1e-6;

interface Point {
  x: number;
  y: number;
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DiagramGeometry {
  id: string;
  shapes: Map<string, Bounds>;
  edges: Map<string, Point[]>;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function shapeBounds(shape: ModdleElement): Bounds | null {
  const bounds = shape.bounds;

  if (!bounds) {
    return null;
  }

  const x = numberValue(bounds.x);
  const y = numberValue(bounds.y);
  const width = numberValue(bounds.width);
  const height = numberValue(bounds.height);

  if (x === null || y === null || width === null || height === null) {
    return null;
  }

  return { x, y, width, height };
}

function edgePoints(edge: ModdleElement): Point[] {
  const waypoints = Array.isArray(edge.waypoint) ? edge.waypoint : [];
  const points: Point[] = [];

  for (const waypoint of waypoints) {
    const x = numberValue(waypoint?.x);
    const y = numberValue(waypoint?.y);

    if (x === null || y === null) {
      continue;
    }

    points.push({ x, y });
  }

  return points;
}

function diagramGeometry(definitions: ModdleElement): DiagramGeometry[] {
  const diagrams = Array.isArray(definitions.diagrams) ? definitions.diagrams : [];
  const result: DiagramGeometry[] = [];

  for (const diagram of diagrams) {
    const shapes = new Map<string, Bounds>();
    const edges = new Map<string, Point[]>();
    const planeElements = Array.isArray(diagram.plane?.planeElement)
      ? diagram.plane.planeElement
      : [];

    for (const element of planeElements) {
      const reference = rawRefId(element.bpmnElement, element.$attrs, 'bpmnElement');

      if (reference === null) {
        continue;
      }

      if (isType(element, 'bpmndi:BPMNShape')) {
        const bounds = shapeBounds(element);

        if (bounds !== null && !shapes.has(reference)) {
          shapes.set(reference, bounds);
        }
      } else if (isType(element, 'bpmndi:BPMNEdge')) {
        const points = edgePoints(element);

        if (points.length >= 2 && !edges.has(reference)) {
          edges.set(reference, points);
        }
      }
    }

    result.push({
      id: typeof diagram.id === 'string' ? diagram.id : '',
      shapes,
      edges
    });
  }

  return result;
}

function styleFinding(
  severity: Finding['severity'],
  rule: string,
  message: string,
  elementId?: string,
  details?: Record<string, unknown>
): Finding {
  const finding: Finding = {
    severity,
    source: 'style',
    rule,
    message
  };

  if (elementId !== undefined) {
    finding.elementId = elementId;
  }

  if (details !== undefined) {
    finding.details = details;
  }

  return finding;
}

function graph(flows: IndexedFlow[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();

  for (const flow of flows) {
    if (flow.sourceId === null || flow.targetId === null) {
      continue;
    }

    const targets = adjacency.get(flow.sourceId) ?? [];
    targets.push(flow.targetId);
    adjacency.set(flow.sourceId, targets);
  }

  return adjacency;
}

function canReach(
  adjacency: Map<string, string[]>,
  start: string,
  target: string
): boolean {
  const stack = [start];
  const seen = new Set<string>();

  while (stack.length > 0) {
    const current = stack.pop() as string;

    if (current === target) {
      return true;
    }

    if (seen.has(current)) {
      continue;
    }

    seen.add(current);
    stack.push(...(adjacency.get(current) ?? []));
  }

  return false;
}

function checkFlowDirection(
  doc: BpmnDocument,
  geometry: DiagramGeometry
): Finding[] {
  const findings: Finding[] = [];
  const adjacency = graph(doc.index.flows);

  for (const [flowId, points] of geometry.edges) {
    const flow = doc.index.flows.find((candidate) => candidate.id === flowId);

    if (!flow || flow.sourceId === null || flow.targetId === null) {
      continue;
    }

    const first = points[0];
    const last = points[points.length - 1];

    if (!first || !last) {
      continue;
    }

    if (last.x >= first.x - EPSILON) {
      continue;
    }

    if (canReach(adjacency, flow.targetId, flow.sourceId)) {
      continue;
    }

    findings.push(
      styleFinding(
        'warning',
        'style/flow-direction',
        'Sequence flow ' + flow.id + ' runs right-to-left; place non-loop flows left-to-right.',
        flow.id,
        {
          diagramId: geometry.id,
          source: flow.sourceId,
          target: flow.targetId,
          fromX: first.x,
          toX: last.x
        }
      )
    );
  }

  return findings;
}

function cross(first: Point, second: Point, third: Point): number {
  return (
    (second.x - first.x) * (third.y - first.y) -
    (second.y - first.y) * (third.x - first.x)
  );
}

function segmentsIntersect(
  first: Point,
  second: Point,
  third: Point,
  fourth: Point
): boolean {
  const firstSide = cross(first, second, third);
  const secondSide = cross(first, second, fourth);
  const thirdSide = cross(third, fourth, first);
  const fourthSide = cross(third, fourth, second);

  return (
    ((firstSide > EPSILON && secondSide < -EPSILON) ||
      (firstSide < -EPSILON && secondSide > EPSILON)) &&
    ((thirdSide > EPSILON && fourthSide < -EPSILON) ||
      (thirdSide < -EPSILON && fourthSide > EPSILON))
  );
}

function checkFlowCrossing(
  doc: BpmnDocument,
  geometry: DiagramGeometry
): Finding[] {
  const findings: Finding[] = [];
  const edges = [...geometry.edges.entries()]
    .map(([flowId, points]) => {
      const flow = doc.index.flows.find((candidate) => candidate.id === flowId);
      return flow ? { flow, points } : null;
    })
    .filter((value): value is { flow: IndexedFlow; points: Point[] } => value !== null);

  for (let firstIndex = 0; firstIndex < edges.length; firstIndex += 1) {
    const first = edges[firstIndex];

    if (!first) {
      continue;
    }

    for (let secondIndex = firstIndex + 1; secondIndex < edges.length; secondIndex += 1) {
      const second = edges[secondIndex];

      if (!second) {
        continue;
      }

      if (
        first.flow.sourceId === second.flow.sourceId ||
        first.flow.targetId === second.flow.targetId ||
        first.flow.sourceId === second.flow.targetId ||
        first.flow.targetId === second.flow.sourceId
      ) {
        continue;
      }

      let crossing = false;

      for (let firstSegment = 0; firstSegment < first.points.length - 1 && !crossing; firstSegment += 1) {
        for (let secondSegment = 0; secondSegment < second.points.length - 1; secondSegment += 1) {
          const firstStart = first.points[firstSegment];
          const firstEnd = first.points[firstSegment + 1];
          const secondStart = second.points[secondSegment];
          const secondEnd = second.points[secondSegment + 1];

          if (!firstStart || !firstEnd || !secondStart || !secondEnd) {
            continue;
          }

          if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) {
            crossing = true;
            break;
          }
        }
      }

      if (crossing) {
        findings.push(
          styleFinding(
            'warning',
            'style/flow-crossing',
            'Sequence flows ' + first.flow.id + ' and ' + second.flow.id + ' cross.',
            first.flow.id,
            {
              diagramId: geometry.id,
              flows: [first.flow.id, second.flow.id]
            }
          )
        );
      }
    }
  }

  return findings;
}

function checkElementOverlap(
  doc: BpmnDocument,
  geometry: DiagramGeometry
): Finding[] {
  const findings: Finding[] = [];
  const nodes = doc.index.elements.filter(
    (element) =>
      element.semanticKind !== 'subprocess' &&
      element.semanticKind !== 'boundary' &&
      geometry.shapes.has(element.id)
  );

  for (let firstIndex = 0; firstIndex < nodes.length; firstIndex += 1) {
    const first = nodes[firstIndex];

    if (!first) {
      continue;
    }

    const firstBounds = geometry.shapes.get(first.id);

    if (!firstBounds) {
      continue;
    }

    for (let secondIndex = firstIndex + 1; secondIndex < nodes.length; secondIndex += 1) {
      const second = nodes[secondIndex];

      if (!second) {
        continue;
      }

      const secondBounds = geometry.shapes.get(second.id);

      if (!secondBounds) {
        continue;
      }

      const overlapX =
        Math.min(firstBounds.x + firstBounds.width, secondBounds.x + secondBounds.width) -
        Math.max(firstBounds.x, secondBounds.x);
      const overlapY =
        Math.min(firstBounds.y + firstBounds.height, secondBounds.y + secondBounds.height) -
        Math.max(firstBounds.y, secondBounds.y);

      if (overlapX > 1 && overlapY > 1) {
        findings.push(
          styleFinding(
            'warning',
            'style/element-overlap',
            'Flow nodes ' + first.id + ' and ' + second.id + ' overlap.',
            first.id,
            {
              diagramId: geometry.id,
              elements: [first.id, second.id]
            }
          )
        );
      }
    }
  }

  return findings;
}

function checkGatewayDefault(doc: BpmnDocument): Finding[] {
  const findings: Finding[] = [];

  for (const element of doc.index.elements) {
    if (
      !isType(element.element, 'bpmn:ExclusiveGateway') &&
      !isType(element.element, 'bpmn:InclusiveGateway')
    ) {
      continue;
    }

    const outgoing = doc.index.flows.filter((flow) => flow.sourceId === element.id);

    if (outgoing.length < 2 || outgoing.some((flow) => flow.isDefault)) {
      continue;
    }

    findings.push(
      styleFinding(
        'warning',
        'style/gateway-default',
        element.id + ' has multiple outgoing flows but no default flow.',
        element.id,
        {
          outgoing: outgoing.map((flow) => flow.id)
        }
      )
    );
  }

  return findings;
}

export function styleFindings(doc: BpmnDocument): Finding[] {
  if (!doc.index.di.content) {
    return [
      styleFinding(
        'info',
        'style/no-di',
        'Style checks require BPMN DI; run "bpmn layout <file> --force" first.'
      )
    ];
  }

  const findings: Finding[] = [];

  for (const geometry of diagramGeometry(doc.definitions)) {
    findings.push(...checkFlowDirection(doc, geometry));
    findings.push(...checkFlowCrossing(doc, geometry));
    findings.push(...checkElementOverlap(doc, geometry));
  }

  findings.push(...checkGatewayDefault(doc));
  return findings;
}
