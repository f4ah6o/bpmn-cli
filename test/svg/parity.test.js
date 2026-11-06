import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DOMParser } from '@xmldom/xmldom';
import { Resvg } from '@resvg/resvg-js';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

import { assertOk, runCli, tempDir } from '../helpers/cli.js';
import { normalizeSvg } from '../../dist/svg/normalize.js';

const FIXTURES = [
  'simple',
  'japanese',
  'gateway',
  'nested',
  'collaboration',
  'lanes',
  'boundary',
  'multi-process'
];

function canonical(node) {
  if (node.nodeType === 3) return JSON.stringify(node.nodeValue);
  if (node.nodeType !== 1) return '';

  const attributes = [];
  for (let index = 0; index < node.attributes.length; index += 1) {
    const attribute = node.attributes.item(index);
    attributes.push([attribute.name, attribute.value]);
  }
  attributes.sort((left, right) => left[0].localeCompare(right[0]));

  const children = [];
  for (let index = 0; index < node.childNodes.length; index += 1) {
    const child = canonical(node.childNodes.item(index));
    if (child) children.push(child);
  }

  return `<${node.nodeName}${attributes
    .map(([name, value]) => ` ${name}=${JSON.stringify(value)}`)
    .join('')}>${children.join('')}</${node.nodeName}>`;
}

function render(svg) {
  return new Resvg(svg, {
    fitTo: { mode: 'original' },
    font: { loadSystemFonts: true }
  })
    .render()
    .asPng();
}

for (const name of FIXTURES) {
  test(`${name} SVG matches the pinned bpmn-js reference`, async (t) => {
    const directory = await tempDir(t);
    const input = join(process.cwd(), 'test', 'fixtures', 'svg', `${name}.bpmn`);
    const output = join(directory, `${name}.svg`);

    assertOk(
      await runCli([
        'export-svg',
        input,
        '--output',
        output,
        '--force',
        '--format',
        'json'
      ]),
      `export-svg ${name}`
    );

    const candidate = normalizeSvg(await readFile(output, 'utf8'));
    const reference = normalizeSvg(
      await readFile(
        join(process.cwd(), 'test', 'fixtures', 'svg', 'reference', `${name}.svg`),
        'utf8'
      )
    );

    const parser = new DOMParser();
    const candidateDocument = parser.parseFromString(candidate, 'image/svg+xml');
    const referenceDocument = parser.parseFromString(reference, 'image/svg+xml');

    assert.equal(
      canonical(candidateDocument.documentElement),
      canonical(referenceDocument.documentElement),
      `${name} differs from the Chrome reference`
    );

    const candidatePng = PNG.sync.read(render(candidate));
    const referencePng = PNG.sync.read(render(reference));

    assert.equal(candidatePng.width, referencePng.width, `${name} width differs`);
    assert.equal(candidatePng.height, referencePng.height, `${name} height differs`);
    assert.equal(
      pixelmatch(candidatePng.data, referencePng.data, null, candidatePng.width, candidatePng.height, {
        threshold: 0
      }),
      0,
      `${name} has pixel differences`
    );
  });
}
