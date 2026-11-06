import { operationError } from '../errors.js';
import type { Diagnostic } from '../types.js';
import { createBrowserlessDom } from './dom.js';
import { normalizeSvg } from './normalize.js';

export const BPMN_JS_VERSION = '18.31.1';

export interface SvgRenderOptions {
  diagramId?: string;
}

export interface SvgRenderResult {
  svg: string;
  width: number;
  height: number;
  viewBox: string;
  warnings: Diagnostic[];
}

let renderQueue: Promise<void> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const previous = renderQueue;
  let release!: () => void;
  renderQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  return (async () => {
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  })();
}

function parseDimensions(svg: string): {
  width: number;
  height: number;
  viewBox: string;
} {
  const root = /<svg\b[^>]*>/.exec(svg)?.[0];

  if (!root) {
    throw operationError('E_SVG_RENDER', 'bpmn-js returned an SVG without a root element.');
  }

  const attribute = (name: string): string | undefined =>
    new RegExp(`\\b${name}="([^"]*)"`).exec(root)?.[1];

  const width = Number.parseFloat(attribute('width') ?? '');
  const height = Number.parseFloat(attribute('height') ?? '');
  const viewBox = attribute('viewBox');

  if (!Number.isFinite(width) || !Number.isFinite(height) || !viewBox) {
    throw operationError(
      'E_SVG_RENDER',
      'bpmn-js returned an SVG without numeric width, height, and viewBox.'
    );
  }

  return { width, height, viewBox };
}

async function renderInternal(
  xml: string,
  options: SvgRenderOptions
): Promise<SvgRenderResult> {
  const runtimeUrl = new URL('../svg-runtime.mjs', import.meta.url);
  let dom: Awaited<ReturnType<typeof createBrowserlessDom>> | undefined;
  let viewer: any;
  let stage = 'dom';

  try {
    dom = await createBrowserlessDom();
    stage = 'runtime';

    const runtime = (await import(runtimeUrl.href)) as {
      Viewer?: new (options: any) => any;
      BaseViewer?: new (options: any) => any;
      CoreModule?: any;
      SelectionModule?: any;
    };

    const Viewer = runtime.BaseViewer ?? runtime.Viewer;

    if (typeof Viewer !== 'function') {
      throw operationError(
        'E_SVG_RUNTIME',
        'The bundled bpmn-js runtime does not export a Viewer.'
      );
    }

    stage = 'viewer';
    viewer = new Viewer({
      container: dom.container,
      ...(runtime.BaseViewer && runtime.CoreModule
        ? {
            modules: [
              runtime.CoreModule,
              ...(runtime.SelectionModule ? [runtime.SelectionModule] : [])
            ]
          }
        : {})
    });

    stage = 'import';
    const imported = await viewer.importXML(xml, options.diagramId);
    const warnings: Diagnostic[] = [];

    for (const warning of imported?.warnings ?? []) {
      warnings.push({
        source: 'render',
        code: 'BPMN_JS_IMPORT_WARNING',
        message:
          typeof warning?.message === 'string'
            ? warning.message
            : String(warning)
      });
    }

    stage = 'save';
    if (typeof viewer.saveSVG !== 'function') {
      throw operationError(
        'E_SVG_RUNTIME',
        'The bundled bpmn-js viewer does not expose saveSVG().'
      );
    }

    const saved = await viewer.saveSVG();
    if (!saved || typeof saved.svg !== 'string') {
      throw operationError(
        'E_SVG_RENDER',
        'bpmn-js saveSVG() did not return an SVG string.'
      );
    }

    const svg = normalizeSvg(saved.svg);
    const dimensions = parseDimensions(svg);

    return { svg, ...dimensions, warnings };
  } catch (error) {
    if (error instanceof Error && 'code' in error && 'exitCode' in error) {
      throw error;
    }

    throw operationError(
      'E_SVG_RENDER',
      `Could not render BPMN as SVG: ${(error as Error).message}`,
      {
        cause: error,
        details: {
          stage,
          bpmnJs: BPMN_JS_VERSION
        }
      }
    );
  } finally {
    try {
      viewer?.destroy?.();
    } catch {
      // Cleanup must not hide the original rendering error.
    }
    dom?.cleanup();
  }
}

export function renderSvg(
  xml: string,
  options: SvgRenderOptions = {}
): Promise<SvgRenderResult> {
  return enqueue(() => renderInternal(xml, options));
}
