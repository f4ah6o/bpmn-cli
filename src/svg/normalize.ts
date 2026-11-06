const HSL_PATTERN = /hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/gi;

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const h = hue / 360;
  const s = saturation / 100;
  const l = lightness / 100;

  if (s === 0) {
    const value = Math.round(l * 255);
    return [value, value, value];
  }

  const channel = (p: number, q: number, t: number): number => {
    let value = t;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return [
    Math.round(channel(p, q, h + 1 / 3) * 255),
    Math.round(channel(p, q, h) * 255),
    Math.round(channel(p, q, h - 1 / 3) * 255)
  ];
}

/**
 * Make bpmn-js output deterministic and closer to browser serialization.
 *
 * bpmn-js generates random marker ids and writes hsl() colors. Browsers
 * normalize those values in the live SVG DOM, while svgdom preserves them.
 */
export function normalizeSvg(svg: string): string {
  let result = svg.replace(HSL_PATTERN, (match, hue, saturation, lightness) => {
    const values = [Number(hue), Number(saturation), Number(lightness)];
    if (!values.every((value) => Number.isFinite(value))) {
      return match;
    }

    const [red, green, blue] = hslToRgb(values[0]!, values[1]!, values[2]!);
    return `rgb(${red}, ${green}, ${blue})`;
  });

  const markerIds: string[] = [];
  const seen = new Set<string>();

  for (const match of result.matchAll(/(?:^|\s)id="(marker-[a-z0-9]+)"/g)) {
    const id = match[1]!;
    if (!seen.has(id)) {
      seen.add(id);
      markerIds.push(id);
    }
  }

  markerIds.forEach((id, index) => {
    result = result.replaceAll(id, `marker-${index + 1}`);
  });

  result = result.replace(/url\(\s*['"]?#(marker-\d+)['"]?\s*\)/g, "url('#$1')");

  result = result.replace(
    /(stroke-dasharray:\s*)([^;"]+)/g,
    (_match, prefix: string, values: string) =>
      prefix + values.split(',').map((value) => value.trim()).join(', ')
  );

  result = result.replace(/<svg\b[^>]*>/, (tag) => {
    const format = (value: string): string => {
      const number = Number(value);
      if (!Number.isFinite(number)) return value;
      return number.toFixed(1).replace(/\.0$/, '');
    };

    return tag
      .replace(/(\swidth=")([^"]+)(")/, (_match, prefix, value, suffix) =>
        `${prefix}${format(value)}${suffix}`
      )
      .replace(/(\sheight=")([^"]+)(")/, (_match, prefix, value, suffix) =>
        `${prefix}${format(value)}${suffix}`
      )
      .replace(/(\sviewBox=")([^"]+)(")/, (_match, prefix, value, suffix) => {
        const parts = value.split(/\s+/).filter(Boolean);
        if (parts.length !== 4) return `${prefix}${value}${suffix}`;
        return `${prefix}${parts.map(format).join(' ')}${suffix}`;
      });
  });

  result = result.replace(/matrix\(([^)]*)\)/g, (_match, values: string) => {
    const parts = values
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((value) => {
        const number = Number(value);
        return Number.isFinite(number) ? String(Number(number.toPrecision(6))) : value;
      });

    return `matrix(${parts.join(' ')})`;
  });

  return result;
}
