/**
 * Inline UI glyphs (docs/ASSET_DIRECTION.md §5.4). 24×24, 1.7 px stroke, `currentColor`.
 * Inline SVG keeps the bundle small and the glyphs crisp at every device pixel ratio.
 */
const PATHS: Readonly<Record<string, string>> = {
  layers: '<path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 16 9 5 9-5"/>',
  speed: '<path d="M5 12a7 7 0 1 1 14 0"/><path d="m12 12 4-3"/><path d="M4 19h16"/>',
  menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
  world: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c3 3.5 3 14.5 0 18"/><path d="M12 3c-3 3.5-3 14.5 0 18"/>',
  settlement: '<path d="M4 20V9l8-5 8 5v11"/><path d="M9 20v-6h6v6"/>',
  civ: '<path d="m12 3 3 5 6 1-4 4 1 6-6-3-6 3 1-6-4-4 6-1 3-5Z"/>',
  economy: '<path d="M4 19V9"/><path d="M10 19V5"/><path d="M16 19v-7"/><path d="M22 19H2"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/>',
  influence: '<path d="M4 20 20 4"/><path d="m14 4 6 6"/><path d="m4 14 6 6"/><circle cx="12" cy="12" r="2.5"/>',
  close: '<path d="m6 6 12 12"/><path d="m18 6-12 12"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3"/><path d="M8 21v-7h8v7"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m6 7 1 14h10l1-14"/>',
  pencil: '<path d="m4 20 4-1 11-11-3-3L5 16l-1 4Z"/>',
  play: '<path d="M8 5v14l11-7-11-7Z"/>',
  pause: '<path d="M8 5v14"/><path d="M16 5v14"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  warning: '<path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v6"/><circle cx="12" cy="18" r=".6"/>',
  food: '<path d="M12 21V9"/><path d="M12 12c-4 0-6-2-6-6 4 0 6 2 6 6Z"/><path d="M12 14c4 0 6-2 6-6-4 0-6 2-6 6Z"/>',
  water: '<path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11Z"/>',
  wood: '<path d="M5 19 19 5"/><path d="m14 4 6 6"/>',
  stone: '<path d="m4 16 4-9 8-2 4 7-4 7H8l-4-3Z"/>',
  metal: '<path d="m4 9 6-5 10 4-4 11-8 1-4-11Z"/><path d="m4 9 8 3 8-4"/><path d="M12 12v8"/>',
  goods: '<path d="m4 8 8-4 8 4v8l-8 4-8-4V8Z"/><path d="m4 8 8 4 8-4"/><path d="M12 12v8"/>',
  war: '<path d="m5 19 9-9"/><path d="m14 10 5-5"/><path d="m4 16 4 4"/><path d="m15 4 5 5"/>',
  treaty: '<path d="M6 3h9l3 3v15H6z"/><path d="M9 10h6"/><path d="M9 14h6"/><path d="m9 18 2 2 4-4"/>',
  capital: '<path d="M12 3v18"/><path d="M5 8h14"/><path d="m5 8-3 6h6L5 8Z"/><path d="m19 8-3 6h6l-3-6Z"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15"/><path d="M15 6v15"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3v18"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1-2.9 2.9-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21h-4v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1-2.9-2.9.1-.1A1.6 1.6 0 0 0 4.6 15a1.6 1.6 0 0 0-1.5-1H3v-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1 2.9-2.9.1.1A1.6 1.6 0 0 0 9 4.6a1.6 1.6 0 0 0 1-1.5V3h4v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1 2.9 2.9-.1.1a1.6 1.6 0 0 0-.3 1.8 1.6 1.6 0 0 0 1.5 1H21v4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15 9-2 5-5 2 2-5 5-2Z"/>',
  legacy: '<path d="m4 19 2-9 6-6 6 6 2 9"/><path d="M4 19h16"/><path d="M9 19v-5h6v5"/><circle cx="12" cy="7" r="1.4"/>',
};

export function iconSvg(name: string, size = 20): string {
  const body = PATHS[name] ?? PATHS.world ?? '';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function icon(name: string, size = 20): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'glyph';
  span.innerHTML = iconSvg(name, size);
  return span;
}

export const RESOURCE_ICONS = ['food', 'water', 'wood', 'stone', 'metal', 'goods'] as const;
export const LAYER_ICONS: Readonly<Record<string, string>> = {
  political: 'civ',
  terrain: 'map',
  population: 'settlement',
  economy: 'economy',
  ecology: 'food',
  history: 'history',
};
