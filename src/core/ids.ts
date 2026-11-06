import type { ModdleElement } from 'bpmn-moddle';

import { usageError } from '../errors.js';

const XML_ID_PATTERN = /^[\p{L}_][\p{L}\p{N}\p{M}._-]*$/u;

const SKIP_KEYS = new Set([
  '$parent',
  '$model',
  '$descriptor',
  '$attrs',
  '$type',
  '$instanceOf',
  '$body'
]);

export function assertValidId(id: string): void {
  if (!XML_ID_PATTERN.test(id) || id.includes(':')) {
    throw usageError(
      `Invalid BPMN id "${id}". Use an XML id (letters, digits, ".", "_" or "-"; no spaces or colons).`
    );
  }
}

export function collectIds(root: ModdleElement): Map<string, ModdleElement[]> {
  const seen = new Set<object>();
  const ids = new Map<string, ModdleElement[]>();

  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object' || seen.has(value)) {
      return;
    }

    seen.add(value);

    const element = value as ModdleElement;

    if (typeof element.id === 'string' && element.id.length > 0) {
      const list = ids.get(element.id) ?? [];
      list.push(element);
      ids.set(element.id, list);
    }

    for (const key of Object.keys(element)) {
      if (SKIP_KEYS.has(key)) {
        continue;
      }

      if (key.startsWith('$') && key !== '$children') {
        continue;
      }

      const child = (element as Record<string, unknown>)[key];

      if (Array.isArray(child)) {
        for (const entry of child) {
          visit(entry);
        }
      } else if (child !== null && typeof child === 'object') {
        visit(child);
      }
    }
  };

  visit(root);

  return ids;
}

export function collectIdSet(root: ModdleElement): Set<string> {
  return new Set(collectIds(root).keys());
}

export function allocateId(ids: Set<string>, prefix: string): string {
  let counter = 1;

  while (ids.has(`${prefix}_${counter}`)) {
    counter += 1;
  }

  const id = `${prefix}_${counter}`;
  ids.add(id);
  return id;
}
