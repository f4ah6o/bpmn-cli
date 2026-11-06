import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

interface GlobalDescriptor {
  name: string;
  descriptor: PropertyDescriptor | undefined;
}

export interface BrowserlessDom {
  window: any;
  document: any;
  container: any;
  cleanup(): void;
}

const GLOBAL_NAMES = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'SVGElement',
  'SVGGraphicsElement',
  'SVGSVGElement',
  'Element',
  'Node',
  'Event',
  'CustomEvent',
  'NodeFilter',
  'CSS',
  'SVGMatrix',
  'SVGPoint',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'MutationObserver',
  'ResizeObserver',
  'matchMedia'
];

function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
    enumerable: true
  });
}

function installClassList(win: any): void {
  Object.defineProperty(win.Element.prototype, 'classList', {
    configurable: true,
    get() {
      const element = this as any;
      const values = (): string[] =>
        String(element.getAttribute('class') ?? '')
          .split(/\s+/)
          .filter(Boolean);

      const write = (next: string[]): void => {
        if (next.length > 0) {
          element.setAttribute('class', next.join(' '));
        } else {
          element.removeAttribute('class');
        }
      };

      return {
        get length(): number {
          return values().length;
        },
        item(index: number): string | null {
          return values()[index] ?? null;
        },
        contains(name: string): boolean {
          return values().includes(name);
        },
        add(...names: string[]): void {
          const next = new Set(values());
          names.forEach((name) => next.add(name));
          write([...next]);
        },
        remove(...names: string[]): void {
          const next = new Set(values());
          names.forEach((name) => next.delete(name));
          write([...next]);
        },
        toggle(name: string, force?: boolean): boolean {
          const next = new Set(values());
          const enabled = force === undefined ? !next.has(name) : force;
          if (enabled) next.add(name);
          else next.delete(name);
          write([...next]);
          return enabled;
        }
      };
    }
  });
}

function installDataset(win: any): void {
  Object.defineProperty(win.Element.prototype, 'dataset', {
    configurable: true,
    get() {
      const element = this as any;
      const key = (name: string): string =>
        `data-${name.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)}`;

      return new Proxy({}, {
        get(_target, name) {
          if (typeof name !== 'string') return undefined;
          return element.getAttribute(key(name)) ?? undefined;
        },
        set(_target, name, value) {
          if (typeof name === 'string') {
            element.setAttribute(key(name), String(value));
          }
          return true;
        },
        has(_target, name) {
          return typeof name === 'string' && element.hasAttribute(key(name));
        }
      });
    }
  });
}

function installArrayItem(): PropertyDescriptor | undefined {
  const previous = Object.getOwnPropertyDescriptor(Array.prototype, 'item');

  if (!previous) {
    Object.defineProperty(Array.prototype, 'item', {
      configurable: true,
      writable: true,
      enumerable: false,
      value(this: any[], index: number) {
        return this[index] ?? null;
      }
    });
  }

  return previous;
}

function installSerialization(win: any): void {
  const proto = win.Element.prototype;

  Object.defineProperty(proto, 'hasAttributes', {
    configurable: true,
    value() {
      return Array.isArray(this.attributes) && this.attributes.length > 0;
    }
  });
}

function createTransform(win: any, matrix?: any): any {
  const transform: any = {
    matrix: matrix ?? new win.SVGMatrix(),
    angle: 0,
    setMatrix(value: any) {
      transform.matrix = value;
      return transform;
    },
    setTranslate(x: number, y: number) {
      transform.matrix = new win.SVGMatrix().translate(x, y);
      return transform;
    },
    setScale(x: number, y: number) {
      transform.matrix = new win.SVGMatrix().scale(x, y);
      return transform;
    },
    setRotate(angle: number, cx = 0, cy = 0) {
      const base = new win.SVGMatrix();
      transform.matrix =
        cx !== 0 || cy !== 0
          ? base.translate(cx, cy).rotate(angle).translate(-cx, -cy)
          : base.rotate(angle);
      return transform;
    },
    setSkewX(angle: number) {
      const base = new win.SVGMatrix();
      transform.matrix = typeof base.skewX === 'function' ? base.skewX(angle) : base;
      return transform;
    },
    setSkewY(angle: number) {
      const base = new win.SVGMatrix();
      transform.matrix = typeof base.skewY === 'function' ? base.skewY(angle) : base;
      return transform;
    }
  };

  return transform;
}

function installTransforms(win: any): void {
  for (const name of ['SVGGraphicsElement', 'SVGSVGElement']) {
    const proto = win[name]?.prototype;
    if (!proto) continue;

    proto.createSVGTransform = function createSVGTransform() {
      return createTransform(win);
    };

    proto.createSVGTransformFromMatrix = function createSVGTransformFromMatrix(matrix: any) {
      return createTransform(win, matrix);
    };

    Object.defineProperty(proto, 'transform', {
      configurable: true,
      get() {
        const element = this as any;
        let pending: any = null;

        const matrixString = (matrix: any): string =>
          `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`;

        const baseVal = {
          clear() {
            pending = new win.SVGMatrix();
            element.removeAttribute('transform');
          },
          appendItem(item: any) {
            const matrix = item?.matrix ?? item;
            if (matrix && typeof matrix.a === 'number') {
              if (!pending) pending = new win.SVGMatrix();
              pending = pending.multiply(matrix);
              element.setAttribute('transform', matrixString(pending));
            }
          },
          consolidate() {
            const matrix =
              pending ??
              (typeof element.matrixify === 'function'
                ? element.matrixify()
                : new win.SVGMatrix());
            return { matrix, angle: 0 };
          },
          createSVGTransformFromMatrix(matrix: any) {
            return createTransform(win, matrix);
          }
        };

        return { baseVal };
      },
      set(value: any) {
        if (value && typeof value.a === 'number') {
          (this as any).setAttribute(
            'transform',
            `matrix(${value.a} ${value.b} ${value.c} ${value.d} ${value.e} ${value.f})`
          );
        }
      }
    });
  }
}

function installScopeSelectors(win: any): void {
  const proto = win.Element.prototype;
  const originalQuerySelector = proto.querySelector;
  const originalQuerySelectorAll = proto.querySelectorAll;

  const scoped = (element: any, selector: string): any[] | null => {
    const match = /^:scope\s*>\s*(.+)$/.exec(selector.trim());
    if (!match) return null;

    const simple = match[1]!.trim();
    return Array.from(element.childNodes).filter(
      (node: any) =>
        node.nodeType === 1 &&
        (typeof node.matches === 'function'
          ? node.matches(simple)
          : node.localName === simple)
    );
  };

  proto.querySelector = function querySelector(selector: string) {
    const result = scoped(this, selector);
    if (result !== null) return result[0] ?? null;
    return originalQuerySelector.call(this, selector);
  };

  proto.querySelectorAll = function querySelectorAll(selector: string) {
    const result = scoped(this, selector);
    if (result !== null) return result;
    return originalQuerySelectorAll.call(this, selector);
  };
}

async function installCanvas(document: any): Promise<void> {
  const { createCanvas, GlobalFonts } = await import('@napi-rs/canvas');
  const canvas = createCanvas(1, 1);
  const context = canvas.getContext('2d');

  const configuredFont = process.env.BPMN_SVG_FONT;
  if (configuredFont && existsSync(configuredFont)) {
    try {
      GlobalFonts.registerFromPath(configuredFont, 'Arial');
    } catch {
      // The system font remains the fallback.
    }
  }

  const hasCjk = GlobalFonts.families.some((font: any) =>
    /Noto Sans CJK JP/i.test(font.family)
  );

  const cjkPattern = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;
  const wrapped = new Proxy(context, {
    get(target, property) {
      if (property === 'measureText') {
        return (text: string) => {
          if (!hasCjk || !cjkPattern.test(text)) {
            return target.measureText(text);
          }

          const original = target.font;
          const baseMetrics = target.measureText(text);

          if (!original.includes('Noto Sans CJK JP')) {
            target.font = `${original}, "Noto Sans CJK JP"`;
          }

          let metrics: any;

          try {
            metrics = target.measureText(text);
          } finally {
            target.font = original;
          }

          return {
            width: metrics.width,
            actualBoundingBoxLeft: metrics.actualBoundingBoxLeft,
            actualBoundingBoxRight: metrics.actualBoundingBoxRight,
            actualBoundingBoxAscent: metrics.actualBoundingBoxAscent,
            actualBoundingBoxDescent: metrics.actualBoundingBoxDescent,
            fontBoundingBoxAscent:
              baseMetrics.fontBoundingBoxAscent ?? metrics.fontBoundingBoxAscent,
            fontBoundingBoxDescent:
              baseMetrics.fontBoundingBoxDescent ?? metrics.fontBoundingBoxDescent
          };
        };
      }

      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, property, value) {
      Reflect.set(target, property, value, target);
      return true;
    },
    has(target, property) {
      return property in target;
    }
  });

  const originalCreateElement = document.createElement.bind(document);
  const canvasLike = {
    getContext: () => wrapped
  };

  document.createElement = (name: string, ...args: any[]) => {
    if (String(name).toLowerCase() === 'canvas') {
      return canvasLike;
    }
    return originalCreateElement(name, ...args);
  };
}

function installObservers(win: any): void {
  class NoopObserver {
    observe(): void {}
    disconnect(): void {}
    unobserve(): void {}
    takeRecords(): unknown[] {
      return [];
    }
  }

  win.MutationObserver = NoopObserver;
  win.ResizeObserver = NoopObserver;
  win.matchMedia = () => ({
    matches: false,
    addListener(): void {},
    removeListener(): void {},
    addEventListener(): void {},
    removeEventListener(): void {}
  });
  win.open = () => null;
}

export async function createBrowserlessDom(): Promise<BrowserlessDom> {
  const previousGlobals: GlobalDescriptor[] = GLOBAL_NAMES.map((name) => ({
    name,
    descriptor: Object.getOwnPropertyDescriptor(globalThis, name)
  }));

  const arrayItemDescriptor = installArrayItem();
  const svgdom = await import('svgdom');

  const configuredFont = process.env.BPMN_SVG_FONT;
  const fontDir = configuredFont
    ? dirname(configuredFont)
    : process.env.BPMN_SVG_FONT_DIR ?? '/usr/share/fonts/truetype/liberation';
  const fontFile = configuredFont
    ? basename(configuredFont)
    : 'LiberationSans-Regular.ttf';

  if (existsSync(join(fontDir, fontFile))) {
    svgdom.config
      .setFontDir(fontDir)
      .setFontFamilyMappings({
        Arial: fontFile,
        'sans-serif': fontFile
      })
      .preloadFonts();
  }

  const win = svgdom.createHTMLWindow() as any;
  const document = win.document;

  win.navigator = { userAgent: 'node', platform: process.platform };
  installObservers(win);
  installClassList(win);
  installDataset(win);
  installSerialization(win);
  installTransforms(win);
  installScopeSelectors(win);
  await installCanvas(document);

  defineGlobal('window', win);
  defineGlobal('document', document);
  defineGlobal('navigator', win.navigator);

  for (const name of [
    'HTMLElement',
    'SVGElement',
    'SVGGraphicsElement',
    'SVGSVGElement',
    'Element',
    'Node',
    'Event',
    'CustomEvent',
    'NodeFilter',
    'CSS',
    'SVGMatrix',
    'SVGPoint'
  ]) {
    if (win[name]) defineGlobal(name, win[name]);
  }

  defineGlobal('getComputedStyle', win.getComputedStyle.bind(win));
  defineGlobal('requestAnimationFrame', win.requestAnimationFrame);
  defineGlobal('cancelAnimationFrame', win.cancelAnimationFrame);
  defineGlobal('MutationObserver', win.MutationObserver);
  defineGlobal('ResizeObserver', win.ResizeObserver);
  defineGlobal('matchMedia', win.matchMedia);

  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', {
    configurable: true,
    value: 1200
  });
  Object.defineProperty(container, 'clientHeight', {
    configurable: true,
    value: 800
  });

  return {
    window: win,
    document,
    container,
    cleanup() {
      for (const { name, descriptor } of previousGlobals) {
        if (descriptor) {
          Object.defineProperty(globalThis, name, descriptor);
        } else {
          delete (globalThis as any)[name];
        }
      }

      if (arrayItemDescriptor) {
        Object.defineProperty(Array.prototype, 'item', arrayItemDescriptor);
      } else {
        delete (Array.prototype as any).item;
      }
    }
  };
}
