import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BpmnModdle } from 'bpmn-moddle';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const CLI = join(ROOT, 'dist', 'cli.js');

const moddle = new BpmnModdle();

export async function tempDir(t) {
  const directory = await mkdtemp(join(ROOT, '.test-tmp-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

export function runCli(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: options.cwd ?? ROOT,
      env: { ...process.env, NO_COLOR: '1', ...options.env },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

export async function writeBpmn(directory, name, xml) {
  const filePath = join(directory, name);
  await writeFile(filePath, xml, 'utf8');
  return filePath;
}

export async function readText(filePath) {
  return readFile(filePath, 'utf8');
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export async function parseBpmn(xml) {
  return moddle.fromXML(xml);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function diInfo(definitions) {
  const diagrams = Array.isArray(definitions.diagrams) ? definitions.diagrams : [];
  const shapes = [];
  const edges = [];

  for (const diagram of diagrams) {
    for (const element of diagram.plane?.planeElement ?? []) {
      if (element.$type === 'bpmndi:BPMNShape') {
        shapes.push(element);
      } else if (element.$type === 'bpmndi:BPMNEdge') {
        edges.push(element);
      }
    }
  }

  return {
    diagrams: diagrams.length,
    shapes,
    edges,
    shapeIds: shapes.map((shape) => shape.bpmnElement?.id),
    edgeIds: edges.map((edge) => edge.bpmnElement?.id)
  };
}

export function processOf(definitions, id = 'Process_1') {
  return (definitions.rootElements ?? []).find(
    (element) => element.$type === 'bpmn:Process' && element.id === id
  );
}

export function flowNodeById(process, id) {
  return (process.flowElements ?? []).find(
    (element) => element.id === id && !element.$type.endsWith('SequenceFlow')
  );
}

export function sequenceFlowById(process, id) {
  return (process.flowElements ?? []).find(
    (element) => element.id === id && element.$type === 'bpmn:SequenceFlow'
  );
}

export function assertOk(result, label) {
  if (result.code !== 0) {
    throw new Error(
      `${label ?? 'command'} failed with exit ${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
}

export function parseJson(result) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `Could not parse JSON stdout: ${error.message}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
}
