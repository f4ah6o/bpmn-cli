import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { parseJson, runCli } from '../helpers/cli.js';

test('skill prints the bundled BPMN authoring skill', async () => {
  const result = await runCli(['skill']);

  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /^---\nname: bpmn-cli\n/);
  assert.match(result.stdout, /## Completion gate/);
});

test('skill --format json returns path and content', async () => {
  const result = await runCli(['skill', '--format', 'json']);

  assert.equal(result.code, 0);
  const output = parseJson(result);
  assert.equal(output.command, 'skill');
  assert.equal(output.file, null);
  assert.equal(output.skill.name, 'bpmn-cli');
  assert.match(output.skill.path, /skills\/bpmn-cli\/SKILL\.md$/);
  assert.equal(output.skill.bytes, Buffer.byteLength(output.skill.content, 'utf8'));
  assert.equal(output.skill.content, await readFile(output.skill.path, 'utf8'));
});

test('skill is listed in help with a short pointer', async () => {
  const result = await runCli(['--help']);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /skill \[options\]/);
  assert.match(
    result.stdout,
    /Run "bpmn skill" to print the BPMN authoring skill for AI agents/
  );
});

test('skill --help exits successfully', async () => {
  const result = await runCli(['skill', '--help']);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Usage: bpmn skill/);
});
