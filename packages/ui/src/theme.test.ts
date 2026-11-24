/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROLES = [
  'canvas',
  'surface',
  'surface-muted',
  'line',
  'ink',
  'ink-muted',
  'ink-faint',
  'accent',
  'accent-hover',
  'on-accent',
  'accent-strong',
  'highlight',
];

const PAIRS: [foreground: string, background: string][] = [
  ['ink', 'canvas'],
  ['ink', 'surface'],
  ['ink', 'highlight'],
  ['ink-muted', 'canvas'],
  ['ink-muted', 'surface'],
  ['ink-muted', 'highlight'],
  ['on-accent', 'accent'],
  ['on-accent', 'accent-hover'],
  ['accent-strong', 'canvas'],
  ['accent-strong', 'surface'],
];

type Rgba = [r: number, g: number, b: number, a: number];
type Mode = 'light' | 'dark';

// Not `new URL('./theme.css', import.meta.url)`: Vite rewrites that into an http:// asset URL under jsdom.
const themePath = join(dirname(fileURLToPath(import.meta.url)), 'theme.css');
const css = readFileSync(themePath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const DARK_BLOCK = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}\s*\}/;

function tokens(block: string | undefined): Record<string, string> {
  const matches = (block ?? '').matchAll(/--stow-([\w-]+)\s*:\s*([^;]+);/g);
  return Object.fromEntries([...matches].map(([, name, value]) => [name, value.trim()]));
}

const modes: Record<Mode, Record<string, string>> = {
  light: tokens(css.replace(DARK_BLOCK, '').match(/:root\s*\{([^}]*)\}/)?.[1]),
  dark: tokens(css.match(DARK_BLOCK)?.[1]),
};

function parse(value: string): Rgba {
  const hex = value.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (hex) return [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16), 1];
  const rgb = value.match(/^rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/);
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] ? 100 : 1);
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), alpha];
  }
  throw new Error(`Unsupported colour: ${value}`);
}

/** The role's colour as seen on screen: translucent roles are composited over `surface`. */
function resolve(mode: Mode, role: string): [number, number, number] {
  const value = modes[mode][role];
  if (value === undefined) throw new Error(`--stow-${role} is missing in ${mode} mode`);
  const [r, g, b, a] = parse(value);
  if (a === 1) return [r, g, b];
  const under = resolve(mode, 'surface');
  return [r * a + under[0] * (1 - a), g * a + under[1] * (1 - a), b * a + under[2] * (1 - a)];
}

function luminance([r, g, b]: [number, number, number]): number {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('theme.css', () => {
  it.each(['light', 'dark'] as const)('defines every colour role in %s mode', (mode) => {
    expect(Object.keys(modes[mode]).sort()).toEqual([...ROLES].sort());
  });

  const cases = PAIRS.flatMap(([fg, bg]) => (['light', 'dark'] as const).map((mode) => [fg, bg, mode] as const));
  it.each(cases)('%s on %s has at least 4.5:1 contrast in %s mode', (fg, bg, mode) => {
    expect(contrast(resolve(mode, fg), resolve(mode, bg))).toBeGreaterThanOrEqual(4.5);
  });
});
