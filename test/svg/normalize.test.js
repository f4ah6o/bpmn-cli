import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSvg } from '../../dist/svg/normalize.js';

test('normalizes browser-specific SVG serialization details', () => {
  const input = `<svg width="10.04" height="20.06" viewBox="1.04 2.06 3.08 4.02"><g transform="matrix(-1.8369701987210297e-16 -1 1 -1.8369701987210297e-16 0 160)" style="stroke-dasharray: 10000,1; stroke: hsl(225, 10%, 15%); marker-end: url(#marker-abc);"><marker id="marker-abc"/><marker id="marker-def"/></g></svg>`;

  const output = normalizeSvg(input);

  assert.match(output, /width="10"/);
  assert.match(output, /height="20\.1"/);
  assert.match(output, /viewBox="1 2\.1 3\.1 4"/);
  assert.match(output, /matrix\(-1\.83697e-16 -1 1 -1\.83697e-16 0 160\)/);
  assert.match(output, /stroke-dasharray: 10000, 1/);
  assert.match(output, /stroke: rgb\(34, 36, 42\)/);
  assert.match(output, /id="marker-1"/);
  assert.match(output, /id="marker-2"/);
  assert.match(output, /marker-end: url\('#marker-1'\)/);
  assert.match(output, /marker-end:/);
  assert.doesNotMatch(output, /marker-end: url\('#marker-2'\)/);
});

test('normalization is idempotent', () => {
  const input = '<svg width="10.04" viewBox="1.04 2.06 3.08 4.02"><path style="stroke-dasharray: 1,2;"/></svg>';
  const once = normalizeSvg(input);
  assert.equal(normalizeSvg(once), once);
});
