declare module 'bpmn-moddle' {
  export interface ModdleWarning {
    message: string;
    element?: ModdleElement;
    property?: string;
    [key: string]: any;
  }

  export interface ModdleElement {
    $type: string;
    $parent?: ModdleElement;
    $attrs?: Record<string, any>;
    id?: string;
    name?: string;
    get(key: string): any;
    set(key: string, value: any): void;
    [key: string]: any;
  }

  export interface FromXMLResult {
    rootElement: ModdleElement;
    elementsById?: Record<string, ModdleElement>;
    references?: any[];
    warnings?: ModdleWarning[];
  }

  export class BpmnModdle {
    constructor(options?: any);
    create(type: string, attrs?: Record<string, any>): ModdleElement;
    fromXML(xml: string, root?: any, options?: any): Promise<FromXMLResult>;
    toXML(
      element: any,
      options?: { format?: boolean; preamble?: boolean }
    ): Promise<{ xml: string }>;
  }

  export default BpmnModdle;
}

declare module 'svgdom' {
  export interface SvgdomWindow {
    document: any;
    [key: string]: any;
  }

  export function createHTMLWindow(): SvgdomWindow;

  export const config: {
    setFontDir(dir: string): typeof config;
    setFontFamilyMappings(map: Record<string, string>): typeof config;
    preloadFonts(): typeof config;
  };
}

declare module 'bpmn-auto-layout' {
  export interface LayoutWarningLike extends Error {
    code: string;
    elementId: string;
    relatedElementIds: string[];
  }

  export class LayoutWarning extends Error {
    code: string;
    elementId: string;
    relatedElementIds: string[];
    constructor(
      code: string,
      elementId: string,
      message: string,
      relatedElementIds?: string[]
    );
  }

  export class LayoutError extends Error {
    code: string;
    elementId: string;
    relatedElementIds: string[];
    constructor(
      code: string,
      elementId: string,
      message: string,
      relatedElementIds?: string[]
    );
  }

  export function layoutProcess(
    xml: string
  ): Promise<{ xml: string; warnings: Array<LayoutWarningLike> }>;
}
