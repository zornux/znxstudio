import type { ComponentNode } from './designerDocument';

export type StyleMap = Record<string, string>;

const SEMANTIC_COLORS: Record<string, string> = {
  primary: '#6750A4', secondary: '#625B71', accent: '#7D5260', error: '#B3261E',
  success: '#2E7D32', transparent: 'transparent', white: '#FFFFFF', black: '#000000',
};

export function previewColor(value: unknown): string | undefined {
  const color = String(value ?? '').trim();
  if (!color) return undefined;
  if (SEMANTIC_COLORS[color.toLowerCase()]) return SEMANTIC_COLORS[color.toLowerCase()];
  if (/^#[0-9a-f]{3,8}$/i.test(color) || /^(?:rgb|hsl)a?\(/i.test(color) || /^var\(--[\w-]+\)$/.test(color)) return color;
  return undefined;
}

/** Convert designer size syntax to a browser preview value. */
export function previewSize(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? `${value}px` : undefined;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === 'match' || raw === 'match_parent' || raw === 'fill' || raw === 'stretch') return '100%';
  if (raw === 'wrap' || raw === 'wrap_content' || raw === 'auto') return 'auto';
  if (/^\d+(?:\.\d+)?$/.test(raw)) return `${raw}px`;
  if (/^\d+(?:\.\d+)?(?:px|%|vw|vh|rem|em)$/.test(raw)) return raw;
  const mobileUnit = raw.match(/^(\d+(?:\.\d+)?)(?:dp|sp)$/);
  return mobileUnit ? `${mobileUnit[1]}px` : undefined;
}

function pixels(value: unknown): string | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number !== 0 ? `${number}px` : undefined;
}

export function nodeLayoutStyles(node: ComponentNode): StyleMap {
  const p = node.properties;
  const styles: StyleMap = {};
  if (p.positionMode === 'freeform') {
    styles.position = 'absolute';
    styles.left = `${Math.max(0, Number(p.x) || 0)}px`;
    styles.top = `${Math.max(0, Number(p.y) || 0)}px`;
    styles.zIndex = '1';
  }
  if (Number(p.zIndex) !== 0) styles.zIndex = String(Math.round(Number(p.zIndex)));
  const ratio = String(p.aspectRatio ?? '').trim();
  if (/^\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?$/.test(ratio)) styles.aspectRatio = ratio.replace(/\s/g, '');
  const width = previewSize(p.width);
  const height = previewSize(p.height);
  if (width) styles.width = width;
  if (height) styles.height = height;
  styles.boxSizing = 'border-box';

  const alignment = String(p.alignment ?? '');
  if (alignment === 'center') styles.alignSelf = 'center';
  else if (alignment === 'end') styles.alignSelf = 'flex-end';
  else if (alignment === 'stretch') {
    styles.alignSelf = 'stretch';
    if (!width) styles.width = 'auto';
  } else if (alignment === 'start') styles.alignSelf = 'flex-start';

  // A non-stretched item needs an intrinsic width for align-self to be visible.
  if (alignment && alignment !== 'stretch' && !width) styles.width = 'fit-content';
  const marginTop = pixels(p.marginTop);
  const marginBottom = pixels(p.marginBottom);
  const marginStart = pixels(p.marginStart);
  const marginEnd = pixels(p.marginEnd);
  if (marginTop) styles.marginTop = marginTop;
  if (marginBottom) styles.marginBottom = marginBottom;
  if (marginStart) styles.marginInlineStart = marginStart;
  if (marginEnd) styles.marginInlineEnd = marginEnd;
  return styles;
}

export function visualStyles(node: ComponentNode): StyleMap {
  const p = node.properties;
  const styles: StyleMap = {};
  if (p.padding !== undefined && Number.isFinite(Number(p.padding))) {
    styles.padding = `${Math.max(0, Number(p.padding))}px`;
  }
  const background = previewColor(p.backgroundColor);
  const border = previewColor(p.borderColor);
  if (background) styles.backgroundColor = background;
  if (border && Number(p.borderWidth) > 0) styles.border = `${Number(p.borderWidth)}px solid ${border}`;
  if (Number(p.cornerRadius) > 0) styles.borderRadius = `${Number(p.cornerRadius)}px`;
  if (Number(p.elevation) > 0) styles.boxShadow = `0 ${Number(p.elevation)}px ${Number(p.elevation) * 2}px rgba(0,0,0,.2)`;
  if (Number(p.rotation) !== 0) styles.transform = `rotate(${Number(p.rotation)}deg)`;
  const opacity = Number(p.opacity);
  if (Number.isFinite(opacity)) styles.opacity = String(Math.max(0, Math.min(1, opacity)));
  const height = previewSize(p.height);
  if (height) styles.height = '100%';
  if (p.visible === false) styles.opacity = '0.32';
  if (p.enabled === false) {
    styles.opacity = '0.5';
    styles.filter = 'grayscale(0.65)';
  }
  return styles;
}

export function containerStyles(node: ComponentNode): StyleMap {
  const p = node.properties;
  const styles: StyleMap = {};
  const spacing = pixels(p.spacing);
  if (spacing) styles.gap = spacing;

  if (node.kind === 'row') styles.flexDirection = 'row';
  else if (node.kind === 'grid') {
    styles.display = 'grid';
    const columns = Math.max(1, Math.round(Number(p.columns) || 1));
    styles.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
  } else if (node.kind === 'stack') {
    styles.display = 'grid';
    const alignment = String(p.contentAlignment ?? 'center');
    const stackMap: Record<string, string> = {
      top_start: 'start', top_center: 'start center', top_end: 'start end',
      center_start: 'center start', center: 'center', center_end: 'center end',
      bottom_start: 'end start', bottom_center: 'end center', bottom_end: 'end',
    };
    styles.placeItems = stackMap[alignment] ?? 'center';
  } else {
    styles.flexDirection = String(p.direction) === 'horizontal' ? 'row' : 'column';
  }

  const main = String(p.mainAlignment ?? '');
  const mainMap: Record<string, string> = {
    start: 'flex-start', center: 'center', end: 'flex-end',
    space_between: 'space-between', space_around: 'space-around',
  };
  if (mainMap[main]) styles.justifyContent = mainMap[main];

  const cross = String(p.crossAlignment ?? '');
  const crossMap: Record<string, string> = {
    start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch',
  };
  if (crossMap[cross]) styles.alignItems = crossMap[cross];
  return styles;
}

export function applyStyles(element: HTMLElement, styles: StyleMap): void {
  Object.assign(element.style, styles);
}
