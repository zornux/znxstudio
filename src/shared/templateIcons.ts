/**
 * Professional SVG icons for the project template chooser.
 *
 * Design system:
 *   - 24×24 viewBox, 1.5px stroke, round caps/joins
 *   - Monochrome line style — inherits currentColor
 *   - Product-family tinting applied via CSS (--z-tmpl-zornux, --z-tmpl-zoijs)
 *   - Sized at 28px inside a 40px container (.znxstudio-template-icon)
 */

/** Zornux cube/diamond outline — the fundamental Zornux project. */
export const ICON_ZORNUX_EMPTY =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 2L3 7v10l9 5 9-5V7l-9-5Z"/>' +
  '<path d="M12 22V12"/>' +
  '<path d="M3 7l9 5 9-5"/>' +
  '</svg>';

/** Terminal prompt >_ inside a rounded square. */
export const ICON_CONSOLE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="2" y="3" width="20" height="18" rx="3"/>' +
  '<path d="M7 10l3 2.5L7 15"/>' +
  '<path d="M13 15h4"/>' +
  '</svg>';

/** Connected API nodes — central dot with four endpoint branches. */
export const ICON_WEB_API =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" opacity="0.4"/>' +
  '<circle cx="12" cy="12" r="2.5"/>' +
  '<path d="M12 4v5.5"/><circle cx="12" cy="4" r="1.5"/>' +
  '<path d="M12 14.5V20"/><circle cx="12" cy="20" r="1.5"/>' +
  '<path d="M4 12h5.5"/><circle cx="4" cy="12" r="1.5"/>' +
  '<path d="M14.5 12H20"/><circle cx="20" cy="12" r="1.5"/>' +
  '</svg>';

/** Smartphone outline with a small Zornux mark. */
export const ICON_MOBILE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="5" y="1" width="14" height="22" rx="3"/>' +
  '<path d="M10 4h4"/>' +
  '<circle cx="12" cy="19.5" r="1"/>' +
  '</svg>';

/** Smartphone with branching navigation arrows. */
export const ICON_MOBILE_NAV =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="3" y="1" width="12" height="22" rx="3"/>' +
  '<path d="M8 4h2"/>' +
  '<circle cx="9" cy="19.5" r="1"/>' +
  '<path d="M17 7h2"/><path d="M19 7l2 2.5L19 12"/>' +
  '<path d="M17 14h2"/><path d="M19 14l2 2.5-2 2.5"/>' +
  '</svg>';

/** Smartphone with sparkle/paint accent. */
export const ICON_MOBILE_STYLED =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="3" y="1" width="12" height="22" rx="3"/>' +
  '<path d="M8 4h2"/>' +
  '<circle cx="9" cy="19.5" r="1"/>' +
  '<path d="M20 3l.8 2.2L23 6l-2.2.8L20 9l-.8-2.2L17 6l2.2-.8Z"/>' +
  '<path d="M20 12l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5L18 14l1.5-.5Z"/>' +
  '</svg>';

/** Two connected layers — frontend window over backend block. */
export const ICON_FULLSTACK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="2" y="10" width="20" height="12" rx="2"/>' +
  '<path d="M2 14h20"/>' +
  '<rect x="5" y="2" width="14" height="10" rx="2"/>' +
  '<path d="M5 5.5h14"/>' +
  '</svg>';

/** Browser window with a component tree mark. */
export const ICON_ZOIJS_WEB =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="2" y="3" width="20" height="18" rx="3"/>' +
  '<path d="M2 8h20"/>' +
  '<circle cx="5" cy="5.5" r="0.8" fill="currentColor" stroke="none"/>' +
  '<circle cx="7.5" cy="5.5" r="0.8" fill="currentColor" stroke="none"/>' +
  '<circle cx="10" cy="5.5" r="0.8" fill="currentColor" stroke="none"/>' +
  '<path d="M7 13l3 3-3 3"/>' +
  '<path d="M13 17h4"/>' +
  '</svg>';

/** Map of template ID → SVG markup. */
export const TEMPLATE_ICONS: Record<string, string> = {
  'zornux-mobile-blank': ICON_MOBILE,
  'zornux-mobile-nav': ICON_MOBILE_NAV,
  'zornux-mobile-styled': ICON_MOBILE_STYLED,
  'zornux-empty': ICON_ZORNUX_EMPTY,
  'zornux-cli': ICON_CONSOLE,
  'zornux-todo-api': ICON_WEB_API,
  'zornux-zoijs-fullstack': ICON_FULLSTACK,
  'zoijs-frontend': ICON_ZOIJS_WEB,
};
