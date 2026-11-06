import { BpmnModdle } from 'bpmn-moddle';
import type { ModdleElement } from 'bpmn-moddle';

export const moddle = new BpmnModdle();

export function create(
  type: string,
  attrs: Record<string, any> = {}
): ModdleElement {
  return moddle.create(type, attrs);
}

export function isType(element: ModdleElement | null | undefined, type: string): boolean {
  if (!element) {
    return false;
  }

  return element.$type === type || element.$instanceOf?.(type) === true;
}

export function attach(
  container: ModdleElement,
  child: ModdleElement,
  collection = 'flowElements'
): void {
  child.$parent = container;
  container.get(collection).push(child);
}

export function attachRoot(definitions: ModdleElement, root: ModdleElement): void {
  root.$parent = definitions;
  definitions.get('rootElements').push(root);
}

export function clearRawAttribute(
  element: ModdleElement,
  name: string
): void {
  if (element.$attrs && Object.prototype.hasOwnProperty.call(element.$attrs, name)) {
    delete element.$attrs[name];
  }
}

export function hasDescriptorProperty(
  element: ModdleElement,
  property: string
): boolean {
  const properties = element.$descriptor?.properties;

  if (Array.isArray(properties)) {
    return properties.some((candidate: { name: string }) => candidate.name === property);
  }

  return false;
}
