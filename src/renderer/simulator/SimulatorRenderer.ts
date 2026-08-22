import { Emitter, type Event } from '../core/Emitter';
import type { MobileIRNode, MobileIRScreen, SimulatorTheme, InspectedComponent } from '../../shared/simulatorTypes';
import type { SimulatorRuntime } from './SimulatorRuntime';

const SEMANTIC_COLORS: Record<string, string> = {
  primary: '#6750A4', secondary: '#625B71', accent: '#7D5260', error: '#B3261E',
  success: '#2E7D32', transparent: 'transparent', white: '#FFFFFF', black: '#000000',
};

function resolveColor(value: unknown): string | undefined {
  const color = String(value ?? '').trim();
  if (!color) return undefined;
  if (SEMANTIC_COLORS[color.toLowerCase()]) return SEMANTIC_COLORS[color.toLowerCase()];
  if (/^#[0-9a-f]{3,8}$/i.test(color) || /^(?:rgb|hsl)a?\(/i.test(color) || /^var\(--[\w-]+\)$/.test(color)) return color;
  return undefined;
}

function toCssSize(value: string | number | boolean): string {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? `${value}px` : '';
  const raw = String(value).trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'match' || raw === 'match_parent' || raw === 'fill' || raw === 'stretch') return '100%';
  if (raw === 'wrap' || raw === 'wrap_content' || raw === 'auto') return 'auto';
  if (/^\d+(?:\.\d+)?$/.test(raw)) return `${raw}px`;
  if (/^\d+(?:\.\d+)?(?:px|%|vw|vh|rem|em)$/.test(raw)) return raw;
  const mobileUnit = raw.match(/^(\d+(?:\.\d+)?)(?:dp|sp)$/);
  if (mobileUnit) return `${mobileUnit[1]}px`;
  return raw;
}

const TEXT_SIZE_MAP: Record<string, string> = {
  heading: '24px', subheading: '20px', body: '14px', caption: '12px', overline: '10px',
};

const TEXT_WEIGHT_MAP: Record<string, string> = {
  normal: '400', bold: '700', light: '300',
};

const ICON_MAP: Record<string, string> = {
  star: '★', home: '⌂', search: '🔍', add: '+', close: '✕', check: '✓',
  delete: '🗑', edit: '✎', settings: '⚙', person: '👤', favorite: '♥',
  arrow_back: '←', arrow_forward: '→', menu: '☰', more_vert: '⋮',
  share: '↗', send: '➤', refresh: '↻', info: 'ℹ', warning: '⚠',
  error: '⊘', visibility: '👁', lock: '🔒', unlock: '🔓', mail: '✉',
  phone: '☎', camera: '📷', location: '📍', notification: '🔔', cart: '🛒',
};

export class SimulatorRenderer {
  readonly element: HTMLDivElement;
  private runtime: SimulatorRuntime | null = null;
  private readonly nodeElements = new Map<string, HTMLElement>();
  private readonly disposables: (() => void)[] = [];
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  private readonly _onNodeClick = new Emitter<{ nodeId: string; node: MobileIRNode }>();
  readonly onNodeClick: Event<{ nodeId: string; node: MobileIRNode }> = this._onNodeClick.event;

  private readonly _onInspect = new Emitter<InspectedComponent>();
  readonly onInspect: Event<InspectedComponent> = this._onInspect.event;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'zsim-viewport';
    this.element.setAttribute('role', 'application');
    this.element.setAttribute('aria-label', 'Znx Simulator viewport');
  }

  bind(runtime: SimulatorRuntime): void {
    this.runtime = runtime;

    const d1 = runtime.onDidChangeScreen(() => this.renderCurrentScreen());
    this.disposables.push(() => d1.dispose());

    const d2 = runtime.stateStore.onDidChange(() => this.renderCurrentScreen());
    this.disposables.push(() => d2.dispose());

    const d3 = runtime.onDidReload(() => this.renderCurrentScreen());
    this.disposables.push(() => d3.dispose());

    const d4 = runtime.onDidChangeEnvironment(() => this.applyEnvironment());
    this.disposables.push(() => d4.dispose());

    const d5 = runtime.onToast((msg) => this.showToast(msg));
    this.disposables.push(() => d5.dispose());

    const d6 = runtime.permissions.onPermissionDialog(({ permission }) => {
      this.showPermissionDialog(permission);
    });
    this.disposables.push(() => d6.dispose());

    this.applyEnvironment();
    this.renderCurrentScreen();
  }

  renderCurrentScreen(): void {
    if (!this.runtime) return;
    const screen = this.runtime.currentScreenModel();
    if (!screen) {
      this.element.innerHTML = '<div class="zsim-empty">No screen to display</div>';
      return;
    }
    this.nodeElements.clear();
    this.element.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'zsim-screen';
    container.dataset.screen = screen.name;
    for (const child of screen.rootChildren) {
      container.appendChild(this.renderNode(child));
    }
    this.element.appendChild(container);
  }

  highlightNode(nodeId: string): void {
    for (const [id, el] of this.nodeElements) {
      el.classList.toggle('zsim-highlighted', id === nodeId);
    }
  }

  clearHighlight(): void {
    for (const el of this.nodeElements.values()) {
      el.classList.remove('zsim-highlighted');
    }
  }

  getNodeElement(nodeId: string): HTMLElement | undefined {
    return this.nodeElements.get(nodeId);
  }

  inspectNode(nodeId: string): InspectedComponent | null {
    if (!this.runtime) return null;
    const node = this.runtime.findNode(nodeId);
    if (!node) return null;
    const el = this.nodeElements.get(nodeId);
    const rect = el?.getBoundingClientRect() ?? { x: 0, y: 0, width: 0, height: 0 };
    const state: Record<string, unknown> = {};
    if (node.properties.binding) {
      const val = this.runtime.stateStore.get(String(node.properties.binding));
      state[String(node.properties.binding)] = val;
    }
    return {
      nodeId,
      kind: node.kind,
      sourceFile: node.sourceLocation?.file,
      sourceLine: node.sourceLocation?.startLine,
      parentId: null,
      childCount: node.children.length,
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      properties: { ...node.properties },
      state,
      events: node.events.map((e) => e.event),
      accessibility: {
        role: String(node.properties.semanticRole ?? 'auto'),
        label: String(node.properties.contentDescription ?? node.properties.label ?? ''),
        focusable: node.properties.focusable === true,
        enabled: node.properties.enabled !== false,
      },
      visible: node.properties.visible !== false,
      enabled: node.properties.enabled !== false,
    };
  }

  dispose(): void {
    for (const d of this.disposables) d();
    this.disposables.length = 0;
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this._onNodeClick.dispose();
    this._onInspect.dispose();
    this.element.remove();
  }

  private renderNode(node: MobileIRNode): HTMLElement {
    const el = document.createElement('div');
    el.className = `zsim-node zsim-${node.kind}`;
    el.dataset.nodeId = node.id;
    if (node.properties.visible === false) el.classList.add('zsim-hidden');
    if (node.properties.enabled === false) el.classList.add('zsim-disabled');
    if (node.properties.testTag) el.dataset.testTag = String(node.properties.testTag);
    this.applyNodeStyles(el, node);
    this.renderNodeContent(el, node);

    if (node.kind !== 'dialog') {
      for (const child of node.children) {
        el.appendChild(this.renderNode(child));
      }
    }

    this.attachEvents(el, node);
    this.nodeElements.set(node.id, el);
    return el;
  }

  private renderNodeContent(el: HTMLElement, node: MobileIRNode): void {
    const rt = this.runtime!;
    switch (node.kind) {
      case 'text': {
        const span = document.createElement('span');
        span.className = 'zsim-text-content';
        span.textContent = this.resolveText(node.properties.content);
        const textColor = resolveColor(node.properties.color);
        if (textColor) span.style.color = textColor;
        const size = String(node.properties.size ?? 'body');
        if (TEXT_SIZE_MAP[size]) span.style.fontSize = TEXT_SIZE_MAP[size];
        const weight = String(node.properties.weight ?? 'normal');
        if (TEXT_WEIGHT_MAP[weight]) span.style.fontWeight = TEXT_WEIGHT_MAP[weight];
        if (node.properties.fontSize) span.style.fontSize = `${Number(node.properties.fontSize)}px`;
        if (node.properties.lineHeight) span.style.lineHeight = `${Number(node.properties.lineHeight)}px`;
        if (node.properties.letterSpacing) span.style.letterSpacing = `${Number(node.properties.letterSpacing)}px`;
        if (node.properties.textAlign) span.style.textAlign = String(node.properties.textAlign);
        if (node.properties.maxLines && Number(node.properties.maxLines) > 0) {
          span.style.display = '-webkit-box';
          span.style.webkitLineClamp = String(node.properties.maxLines);
          (span.style as unknown as Record<string, string>)['-webkit-box-orient'] = 'vertical';
          span.style.overflow = 'hidden';
        }
        el.appendChild(span);
        break;
      }
      case 'button': {
        const btn = document.createElement('button');
        btn.className = 'zsim-button-inner';
        const btnStyle = String(node.properties.style ?? 'primary');
        if (btnStyle !== 'primary') btn.classList.add(`zsim-btn-${btnStyle}`);
        btn.disabled = node.properties.enabled === false;
        btn.textContent = this.resolveText(node.properties.label ?? 'Button');
        if (node.properties.iconName) btn.textContent = `${ICON_MAP[String(node.properties.iconName)] ?? String(node.properties.iconName)} ${btn.textContent}`;
        if (node.properties.loading === true) {
          btn.classList.add('zsim-loading');
          btn.textContent = `◌ ${btn.textContent}`;
        }
        const containerColor = resolveColor(node.properties.containerColor);
        if (containerColor) btn.style.backgroundColor = containerColor;
        const contentColor = resolveColor(node.properties.contentColor);
        if (contentColor) btn.style.color = contentColor;
        el.appendChild(btn);
        break;
      }
      case 'input': {
        const wrapper = document.createElement('div');
        wrapper.className = 'zsim-input-wrapper';
        if (node.properties.label) {
          const label = document.createElement('label');
          label.className = 'zsim-input-label';
          label.textContent = String(node.properties.label);
          if (node.properties.required === true) label.textContent += ' *';
          wrapper.appendChild(label);
        }
        const fieldRow = document.createElement('div');
        fieldRow.className = 'zsim-input-row';
        if (node.properties.leadingIcon) {
          const leading = document.createElement('span');
          leading.className = 'zsim-input-icon zsim-input-leading';
          const leadName = String(node.properties.leadingIcon);
          leading.textContent = ICON_MAP[leadName] ?? leadName;
          fieldRow.appendChild(leading);
        }
        const input = node.properties.inputType === 'multiline'
          ? document.createElement('textarea')
          : document.createElement('input');
        input.className = 'zsim-input-field';
        if (input instanceof HTMLInputElement) {
          const typeMap: Record<string, string> = { text: 'text', number: 'number', email: 'email', password: 'password', phone: 'tel' };
          input.type = typeMap[String(node.properties.inputType ?? 'text')] ?? 'text';
        }
        input.placeholder = String(node.properties.placeholder ?? '');
        input.disabled = node.properties.enabled === false;
        if (node.properties.readOnly === true) input.readOnly = true;
        if (node.properties.maxLength && Number(node.properties.maxLength) > 0) {
          input.maxLength = Number(node.properties.maxLength);
        }
        const binding = String(node.properties.binding ?? '');
        if (binding) {
          const val = rt.stateStore.get(binding);
          if (val != null) input.value = String(val);
        }
        input.addEventListener('input', () => {
          if (binding) rt.stateStore.set(binding, input.value);
          this.fireNodeEvent(node, 'changed', input.value);
        });
        input.addEventListener('keydown', ((e: KeyboardEvent) => {
          if (e.key === 'Enter' && !(input instanceof HTMLTextAreaElement)) {
            this.fireNodeEvent(node, 'submitted', input.value);
          }
        }) as EventListener);
        fieldRow.appendChild(input);
        if (node.properties.trailingIcon) {
          const trailing = document.createElement('span');
          trailing.className = 'zsim-input-icon zsim-input-trailing';
          const trailName = String(node.properties.trailingIcon);
          trailing.textContent = ICON_MAP[trailName] ?? trailName;
          fieldRow.appendChild(trailing);
        }
        wrapper.appendChild(fieldRow);
        if (node.properties.supportingText) {
          const sup = document.createElement('small');
          sup.className = 'zsim-supporting-text';
          sup.textContent = String(node.properties.supportingText);
          wrapper.appendChild(sup);
        }
        if (node.properties.isError === true) wrapper.classList.add('zsim-error');
        el.appendChild(wrapper);
        break;
      }
      case 'checkbox': {
        const cb = document.createElement('label');
        cb.className = 'zsim-checkbox';
        const check = document.createElement('input');
        check.type = 'checkbox';
        const binding = String(node.properties.binding ?? '');
        check.checked = binding ? rt.stateStore.get(binding) === true : node.properties.checked === true;
        check.disabled = node.properties.enabled === false;
        const checkColor = resolveColor(node.properties.checkColor);
        if (checkColor) check.style.accentColor = checkColor;
        check.addEventListener('change', () => {
          if (binding) rt.stateStore.set(binding, check.checked);
          this.fireNodeEvent(node, 'toggled', check.checked);
        });
        cb.appendChild(check);
        const labelText = document.createElement('span');
        labelText.textContent = String(node.properties.label ?? '');
        const labelColor = resolveColor(node.properties.labelColor);
        if (labelColor) labelText.style.color = labelColor;
        cb.appendChild(labelText);
        el.appendChild(cb);
        break;
      }
      case 'switch': {
        const sw = document.createElement('label');
        sw.className = 'zsim-switch';
        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        const binding = String(node.properties.binding ?? '');
        toggle.checked = binding ? rt.stateStore.get(binding) === true : node.properties.checked === true;
        toggle.disabled = node.properties.enabled === false;
        toggle.addEventListener('change', () => {
          if (binding) rt.stateStore.set(binding, toggle.checked);
          this.fireNodeEvent(node, 'toggled', toggle.checked);
        });
        sw.appendChild(toggle);
        const track = document.createElement('span');
        track.className = 'zsim-switch-track';
        const trackColor = resolveColor(node.properties.trackColor);
        if (trackColor) track.style.backgroundColor = trackColor;
        sw.appendChild(track);
        const labelText = document.createElement('span');
        labelText.textContent = String(node.properties.label ?? '');
        sw.appendChild(labelText);
        el.appendChild(sw);
        break;
      }
      case 'slider': {
        const sliderWrap = document.createElement('div');
        sliderWrap.className = 'zsim-slider-wrapper';
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'zsim-slider';
        slider.min = String(node.properties.min ?? 0);
        slider.max = String(node.properties.max ?? 100);
        slider.step = String(node.properties.step ?? 1);
        const binding = String(node.properties.binding ?? '');
        slider.value = binding ? String(rt.stateStore.get(binding) ?? node.properties.value ?? 50) : String(node.properties.value ?? 50);
        slider.disabled = node.properties.enabled === false;
        const activeColor = resolveColor(node.properties.activeColor);
        if (activeColor) slider.style.accentColor = activeColor;
        let valueLabel: HTMLElement | null = null;
        if (node.properties.showValue === true) {
          valueLabel = document.createElement('span');
          valueLabel.className = 'zsim-slider-value';
          valueLabel.textContent = slider.value;
        }
        slider.addEventListener('input', () => {
          if (binding) rt.stateStore.set(binding, Number(slider.value));
          if (valueLabel) valueLabel.textContent = slider.value;
          this.fireNodeEvent(node, 'changed', Number(slider.value));
        });
        sliderWrap.appendChild(slider);
        if (valueLabel) sliderWrap.appendChild(valueLabel);
        el.appendChild(sliderWrap);
        break;
      }
      case 'dropdown': {
        const select = document.createElement('select');
        select.className = 'zsim-dropdown';
        const items = String(node.properties.items ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        for (const item of items) {
          const opt = document.createElement('option');
          opt.value = item;
          opt.textContent = item;
          select.appendChild(opt);
        }
        const binding = String(node.properties.binding ?? '');
        if (binding) {
          const val = rt.stateStore.get(binding);
          if (val != null) select.value = String(val);
        }
        select.disabled = node.properties.enabled === false;
        select.addEventListener('change', () => {
          if (binding) rt.stateStore.set(binding, select.value);
          this.fireNodeEvent(node, 'changed', select.value);
        });
        if (node.properties.label) {
          const label = document.createElement('label');
          label.className = 'zsim-dropdown-label';
          label.textContent = String(node.properties.label);
          el.appendChild(label);
        }
        el.appendChild(select);
        break;
      }
      case 'image': {
        const source = String(node.properties.source || '');
        if (source && (source.startsWith('http') || source.startsWith('data:') || source.startsWith('/'))) {
          const img = document.createElement('img');
          img.className = 'zsim-image';
          img.src = source;
          img.alt = String(node.properties.alt ?? '');
          const fit = String(node.properties.fit ?? 'contain');
          const fitMap: Record<string, string> = { contain: 'contain', cover: 'cover', fill: 'fill', none: 'none' };
          img.style.objectFit = fitMap[fit] ?? 'contain';
          if (node.properties.cornerRadius) img.style.borderRadius = `${Number(node.properties.cornerRadius)}px`;
          const tint = resolveColor(node.properties.tintColor);
          if (tint) img.style.filter = `drop-shadow(0 0 0 ${tint})`;
          img.onerror = () => {
            const placeholder = document.createElement('div');
            placeholder.className = 'zsim-image-placeholder';
            placeholder.textContent = `🖼 ${source}`;
            img.replaceWith(placeholder);
          };
          el.appendChild(img);
        } else {
          const placeholder = document.createElement('div');
          placeholder.className = 'zsim-image-placeholder';
          placeholder.textContent = `🖼 ${source || 'image'}`;
          el.appendChild(placeholder);
        }
        break;
      }
      case 'icon': {
        const icon = document.createElement('span');
        icon.className = 'zsim-icon';
        const iconName = String(node.properties.name ?? 'star');
        icon.textContent = ICON_MAP[iconName] ?? iconName;
        if (node.properties.iconSize) icon.style.fontSize = `${Number(node.properties.iconSize)}px`;
        const iconColor = resolveColor(node.properties.color) ?? resolveColor(node.properties.tintColor);
        if (iconColor) icon.style.color = iconColor;
        el.appendChild(icon);
        break;
      }
      case 'progress': {
        const indicatorColor = resolveColor(node.properties.indicatorColor);
        const pTrackColor = resolveColor(node.properties.trackColor);
        if (node.properties.progressStyle === 'circular') {
          const spinner = document.createElement('div');
          spinner.className = 'zsim-spinner';
          if (indicatorColor) spinner.style.borderTopColor = indicatorColor;
          if (pTrackColor) spinner.style.borderColor = `${pTrackColor} ${pTrackColor} ${pTrackColor} ${indicatorColor ?? 'var(--zsim-primary, #6200ee)'}`;
          el.appendChild(spinner);
        } else {
          const bar = document.createElement('div');
          bar.className = 'zsim-progress-bar';
          if (pTrackColor) bar.style.backgroundColor = pTrackColor;
          const fill = document.createElement('div');
          fill.className = 'zsim-progress-fill';
          if (indicatorColor) fill.style.backgroundColor = indicatorColor;
          const binding = String(node.properties.binding ?? '');
          const value = binding ? Number(rt.stateStore.get(binding) ?? 0) : 0;
          fill.style.width = node.properties.indeterminate === true ? '100%' : `${Math.max(0, Math.min(100, value))}%`;
          if (node.properties.indeterminate === true) bar.classList.add('zsim-indeterminate');
          bar.appendChild(fill);
          el.appendChild(bar);
        }
        break;
      }
      case 'spacer': {
        el.style.height = `${Number(node.properties.size ?? 16)}px`;
        break;
      }
      case 'divider': {
        const hr = document.createElement('hr');
        hr.className = 'zsim-divider';
        const divColor = resolveColor(node.properties.color);
        if (divColor) hr.style.borderTopColor = divColor;
        const thickness = Number(node.properties.thickness);
        if (thickness > 0) hr.style.borderTopWidth = `${thickness}px`;
        el.appendChild(hr);
        break;
      }
      case 'card': {
        el.classList.add('zsim-card');
        const cardColor = resolveColor(node.properties.contentColor);
        if (cardColor) el.style.color = cardColor;
        break;
      }
      case 'list': {
        el.classList.add('zsim-list');
        const binding = String(node.properties.binding ?? '');
        if (binding) {
          const data = rt.stateStore.get(binding);
          if (Array.isArray(data) && node.children.length > 0) {
            el.innerHTML = '';
            const template = node.children[0];
            const itemTappedHandler = node.events.find((e) => e.event === 'item_tapped');
            for (let i = 0; i < data.length; i++) {
              const itemEl = this.renderNode({
                ...template,
                id: `${template.id}_item_${i}`,
                properties: { ...template.properties, content: String(data[i]) },
              });
              if (itemTappedHandler) {
                const itemValue = data[i];
                itemEl.style.cursor = 'pointer';
                itemEl.addEventListener('click', (e) => {
                  e.stopPropagation();
                  rt.eventLog.log('button_tapped', `Item tapped: ${itemValue}`);
                  rt.stateStore.set('_item', itemValue);
                  rt.stateStore.set('_index', i);
                  void rt.executeAction(itemTappedHandler.body);
                });
              }
              if (node.properties.separator !== false && i > 0) {
                const sep = document.createElement('hr');
                sep.className = 'zsim-list-separator';
                el.appendChild(sep);
              }
              el.appendChild(itemEl);
            }
          }
        }
        break;
      }
      case 'navbar': {
        const bar = document.createElement('div');
        bar.className = 'zsim-navbar';
        const barStyle = String(node.properties.barStyle ?? 'standard');
        if (barStyle !== 'standard') bar.classList.add(`zsim-navbar-${barStyle}`);
        if (node.properties.showBack === true) {
          const back = document.createElement('button');
          back.className = 'zsim-navbar-back';
          back.textContent = '←';
          back.addEventListener('click', () => {
            this.fireNodeEvent(node, 'back_tapped');
            rt.navigation.navigateBack();
          });
          bar.appendChild(back);
        }
        const title = document.createElement('span');
        title.className = 'zsim-navbar-title';
        title.textContent = this.resolveText(node.properties.title ?? 'Title');
        bar.appendChild(title);
        el.appendChild(bar);
        break;
      }
      case 'bottomnav':
      case 'tabs': {
        const strip = document.createElement('div');
        strip.className = node.kind === 'bottomnav' ? 'zsim-bottomnav' : 'zsim-tabs';
        const items = String(node.properties.items ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        const icons = node.kind === 'bottomnav' ? String(node.properties.icons ?? '').split(',').map((s) => s.trim()) : [];
        const binding = String(node.properties.binding ?? '');
        const activeValue = binding ? String(rt.stateStore.get(binding) ?? '') : '';
        items.forEach((item, i) => {
          const tab = document.createElement('button');
          tab.className = 'zsim-tab-item';
          if (node.kind === 'bottomnav' && icons[i]) {
            const iconSpan = document.createElement('span');
            iconSpan.className = 'zsim-tab-icon';
            const iName = icons[i];
            iconSpan.textContent = ICON_MAP[iName] ?? iName;
            tab.appendChild(iconSpan);
            const labelSpan = document.createElement('span');
            labelSpan.textContent = item;
            tab.appendChild(labelSpan);
          } else {
            tab.textContent = item;
          }
          if (activeValue ? item === activeValue : i === 0) tab.classList.add('zsim-tab-active');
          tab.addEventListener('click', () => {
            strip.querySelectorAll('.zsim-tab-item').forEach((t) => t.classList.remove('zsim-tab-active'));
            tab.classList.add('zsim-tab-active');
            if (binding) rt.stateStore.set(binding, item);
            this.fireNodeEvent(node, 'changed', item);
          });
          strip.appendChild(tab);
        });
        el.appendChild(strip);
        break;
      }
      case 'fab': {
        const fab = document.createElement('button');
        fab.className = 'zsim-fab';
        const fabSize = String(node.properties.fabSize ?? 'regular');
        if (fabSize !== 'regular') fab.classList.add(`zsim-fab-${fabSize}`);
        const fabIcon = String(node.properties.iconName ?? 'add');
        fab.textContent = ICON_MAP[fabIcon] ?? fabIcon;
        if (node.properties.label) fab.textContent += ` ${String(node.properties.label)}`;
        el.appendChild(fab);
        break;
      }
      case 'chip': {
        el.classList.add('zsim-chip');
        const chipStyle = String(node.properties.chipStyle ?? 'filled');
        el.classList.add(`zsim-chip-${chipStyle}`);
        if (node.properties.selected === true) el.classList.add('zsim-chip-selected');
        const chipLabel = document.createElement('span');
        chipLabel.textContent = String(node.properties.label ?? 'Chip');
        el.appendChild(chipLabel);
        break;
      }
      case 'badge': {
        el.classList.add('zsim-badge');
        el.textContent = String(node.properties.content || '•');
        const badgeColor = resolveColor(node.properties.color);
        if (badgeColor) el.style.backgroundColor = badgeColor;
        break;
      }
      case 'snackbar': {
        el.classList.add('zsim-snackbar');
        el.classList.add('zsim-snackbar-visible');
        const msg = document.createElement('span');
        msg.textContent = String(node.properties.message ?? '');
        el.appendChild(msg);
        if (node.properties.action) {
          const actionBtn = document.createElement('button');
          actionBtn.textContent = String(node.properties.action).toUpperCase();
          actionBtn.addEventListener('click', () => this.fireNodeEvent(node, 'action_tapped'));
          el.appendChild(actionBtn);
        }
        const duration = String(node.properties.duration ?? 'short');
        if (duration !== 'indefinite') {
          const ms = duration === 'long' ? 5000 : 3000;
          setTimeout(() => {
            el.classList.remove('zsim-snackbar-visible');
            el.classList.add('zsim-snackbar-dismissed');
            this.fireNodeEvent(node, 'dismissed');
          }, ms);
        }
        break;
      }
      case 'dialog': {
        el.classList.add('zsim-dialog-overlay');
        const dialogCard = document.createElement('div');
        dialogCard.className = 'zsim-dialog';
        if (node.properties.title) {
          const title = document.createElement('div');
          title.className = 'zsim-dialog-title';
          title.textContent = String(node.properties.title);
          dialogCard.appendChild(title);
        }
        for (const child of node.children) {
          dialogCard.appendChild(this.renderNode(child));
        }
        const actions = document.createElement('div');
        actions.className = 'zsim-dialog-actions';
        if (node.properties.cancelLabel) {
          const cancelBtn = document.createElement('button');
          cancelBtn.textContent = String(node.properties.cancelLabel);
          cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.fireNodeEvent(node, 'cancelled');
          });
          actions.appendChild(cancelBtn);
        }
        if (node.properties.confirmLabel) {
          const confirmBtn = document.createElement('button');
          confirmBtn.className = 'zsim-dialog-confirm';
          confirmBtn.textContent = String(node.properties.confirmLabel);
          confirmBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.fireNodeEvent(node, 'confirmed');
          });
          actions.appendChild(confirmBtn);
        }
        dialogCard.appendChild(actions);
        el.appendChild(dialogCard);
        if (node.properties.dismissible !== false) {
          el.addEventListener('click', (e) => {
            if (e.target === el) this.fireNodeEvent(node, 'cancelled');
          });
        }
        break;
      }
      case 'column':
        el.classList.add('zsim-column');
        if (node.properties.scrollable === true) {
          el.classList.add('zsim-scrollable');
        }
        break;
      case 'row':
        el.classList.add('zsim-row');
        break;
      case 'stack': {
        el.classList.add('zsim-stack');
        const stackAlign = String(node.properties.contentAlignment ?? 'center');
        const stackMap: Record<string, string> = {
          top_start: 'start', top_center: 'start center', top_end: 'start end',
          center_start: 'center start', center: 'center', center_end: 'center end',
          bottom_start: 'end start', bottom_center: 'end center', bottom_end: 'end',
        };
        if (stackMap[stackAlign]) el.style.placeItems = stackMap[stackAlign];
        break;
      }
      case 'grid':
        el.classList.add('zsim-grid');
        if (node.properties.columns) el.style.gridTemplateColumns = `repeat(${Number(node.properties.columns)}, 1fr)`;
        break;
      case 'scrollview':
        el.classList.add('zsim-scroll');
        el.style.overflowY = node.properties.direction === 'horizontal' ? 'hidden' : 'auto';
        el.style.overflowX = node.properties.direction === 'horizontal' ? 'auto' : 'hidden';
        break;
      default:
        el.textContent = `[${node.kind}]`;
        break;
    }
  }

  private applyNodeStyles(el: HTMLElement, node: MobileIRNode): void {
    const props = node.properties;
    if (props.padding) el.style.padding = `${Number(props.padding)}px`;
    if (props.marginTop) el.style.marginTop = `${Number(props.marginTop)}px`;
    if (props.marginBottom) el.style.marginBottom = `${Number(props.marginBottom)}px`;
    if (props.marginStart) el.style.marginInlineStart = `${Number(props.marginStart)}px`;
    if (props.marginEnd) el.style.marginInlineEnd = `${Number(props.marginEnd)}px`;
    if (props.width && String(props.width) !== '') el.style.width = toCssSize(props.width);
    if (props.height && String(props.height) !== '') el.style.height = toCssSize(props.height);

    const bgColor = resolveColor(props.backgroundColor);
    if (bgColor) el.style.backgroundColor = bgColor;
    const borderColor = resolveColor(props.borderColor);
    if (borderColor) el.style.borderColor = borderColor;
    if (props.borderWidth) el.style.borderWidth = `${Number(props.borderWidth)}px`;
    if (props.borderWidth) el.style.borderStyle = 'solid';
    if (props.cornerRadius) el.style.borderRadius = `${Number(props.cornerRadius)}px`;
    if (props.opacity !== undefined && props.opacity !== 1) el.style.opacity = String(props.opacity);
    if (props.elevation) el.style.boxShadow = `0 ${Number(props.elevation)}px ${Number(props.elevation) * 2}px rgba(0,0,0,0.15)`;
    if (props.rotation) el.style.transform = `rotate(${Number(props.rotation)}deg)`;
    if (props.spacing) el.style.gap = `${Number(props.spacing)}px`;

    if (props.positionMode === 'freeform') {
      el.style.position = 'absolute';
      el.style.left = `${Math.max(0, Number(props.x) || 0)}px`;
      el.style.top = `${Math.max(0, Number(props.y) || 0)}px`;
      el.style.zIndex = '1';
    }
    const zIndex = Number(props.zIndex);
    if (zIndex !== 0 && Number.isFinite(zIndex)) el.style.zIndex = String(Math.round(zIndex));
    const ratio = String(props.aspectRatio ?? '').trim();
    if (/^\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?$/.test(ratio)) el.style.aspectRatio = ratio.replace(/\s/g, '');

    if (props.alignment === 'center') el.style.alignSelf = 'center';
    else if (props.alignment === 'end') el.style.alignSelf = 'flex-end';
    else if (props.alignment === 'stretch') el.style.alignSelf = 'stretch';
    else if (props.alignment === 'start') el.style.alignSelf = 'flex-start';

    if (props.crossAlignment) {
      const map: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' };
      el.style.alignItems = map[String(props.crossAlignment)] ?? 'stretch';
    }
    if (props.mainAlignment) {
      const map: Record<string, string> = {
        start: 'flex-start', center: 'center', end: 'flex-end',
        space_between: 'space-between', space_around: 'space-around',
      };
      el.style.justifyContent = map[String(props.mainAlignment)] ?? 'flex-start';
    }

    if (props.contentDescription) el.setAttribute('aria-label', String(props.contentDescription));
    if (props.semanticRole && props.semanticRole !== 'auto') el.setAttribute('role', String(props.semanticRole));
    if (props.clickable === true) el.style.cursor = 'pointer';
    if (props.focusable === true) {
      el.tabIndex = 0;
      el.classList.add('zsim-focusable');
    }
  }

  private attachEvents(el: HTMLElement, node: MobileIRNode): void {
    if (!this.runtime) return;
    const rt = this.runtime;

    for (const handler of node.events) {
      switch (handler.event) {
        case 'tapped':
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            rt.eventLog.log('button_tapped', `Tapped: ${node.kind} (${node.id})`);
            void rt.executeAction(handler.body);
          });
          el.style.cursor = 'pointer';
          break;
        case 'long_pressed':
          this.attachLongPress(el, node, handler.body);
          break;
        case 'swiped':
          this.attachSwipe(el, node, handler.body);
          break;
        case 'dragged':
          this.attachDrag(el, node, handler.body);
          break;
        case 'pinched':
          this.attachPinch(el, node, handler.body);
          break;
        case 'back_tapped':
          break;
      }
    }

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const inspected = this.inspectNode(node.id);
      if (inspected) this._onInspect.fire(inspected);
    });

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this._onNodeClick.fire({ nodeId: node.id, node });
    });
  }

  private attachLongPress(el: HTMLElement, _node: MobileIRNode, body: string): void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    el.addEventListener('pointerdown', () => {
      timer = setTimeout(() => {
        void this.runtime?.executeAction(body);
      }, 500);
    });
    el.addEventListener('pointerup', () => { if (timer) clearTimeout(timer); });
    el.addEventListener('pointerleave', () => { if (timer) clearTimeout(timer); });
  }

  private attachSwipe(el: HTMLElement, node: MobileIRNode, body: string): void {
    let startX = 0;
    let startY = 0;
    el.addEventListener('pointerdown', (e) => { startX = e.clientX; startY = e.clientY; });
    el.addEventListener('pointerup', (e) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 30 || Math.abs(dy) > 30) {
        this.runtime?.eventLog.log('gesture', `Swiped on ${node.kind}`);
        void this.runtime?.executeAction(body);
      }
    });
  }

  private attachDrag(el: HTMLElement, node: MobileIRNode, body: string): void {
    let dragging = false;
    el.addEventListener('pointerdown', () => { dragging = true; });
    el.addEventListener('pointermove', () => {
      if (dragging) {
        this.runtime?.eventLog.log('gesture', `Dragged on ${node.kind}`);
        void this.runtime?.executeAction(body);
        dragging = false;
      }
    });
    el.addEventListener('pointerup', () => { dragging = false; });
  }

  private attachPinch(el: HTMLElement, node: MobileIRNode, body: string): void {
    el.addEventListener('wheel', (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        this.runtime?.eventLog.log('gesture', `Pinched on ${node.kind}`);
        void this.runtime?.executeAction(body);
      }
    }, { passive: false });
  }

  private fireNodeEvent(node: MobileIRNode, eventKey: string, value?: unknown): void {
    if (!this.runtime) return;
    const handler = node.events.find((e) => e.event === eventKey);
    if (handler) {
      if (value !== undefined) {
        this.runtime.stateStore.set('_value', value);
      }
      this.runtime.eventLog.log('button_tapped', `Event ${eventKey} on ${node.kind}`);
      void this.runtime.executeAction(handler.body);
    }
  }

  private resolveText(value: unknown): string {
    if (value == null) return '';
    const text = String(value);
    if (!this.runtime) return text;
    return text.replace(/\{(\w+)\}/g, (_match, key: string) => {
      const val = this.runtime!.stateStore.get(key);
      return val != null ? String(val) : `{${key}}`;
    });
  }

  private applyEnvironment(): void {
    if (!this.runtime) return;
    const env = this.runtime.getEnvironment();
    this.element.dataset.theme = env.theme === 'system' ? 'light' : env.theme;
    this.element.style.fontSize = `${14 * env.fontScale}px`;
    const landscape = env.orientation === 'landscape';
    this.element.style.width = `${landscape ? env.deviceProfile.height : env.deviceProfile.width}px`;
    const deviceHeight = landscape ? env.deviceProfile.width : env.deviceProfile.height;
    this.element.style.height = `${Math.max(240, deviceHeight - env.deviceProfile.statusBarHeight - env.deviceProfile.navigationArea)}px`;
    if (env.reducedMotion) this.element.classList.add('zsim-reduced-motion');
    else this.element.classList.remove('zsim-reduced-motion');
  }

  private showToast(message: string): void {
    let toast = this.element.querySelector('.zsim-toast') as HTMLElement | null;
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'zsim-toast';
      this.element.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('zsim-toast-visible');
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => toast!.classList.remove('zsim-toast-visible'), 3000);
  }

  private showPermissionDialog(permission: string): void {
    if (!this.runtime) return;
    const overlay = document.createElement('div');
    overlay.className = 'zsim-permission-dialog';
    const card = document.createElement('div');
    card.className = 'zsim-permission-card';
    const title = document.createElement('div');
    title.className = 'zsim-permission-title';
    title.textContent = `Allow ${permission}?`;
    card.appendChild(title);
    const body = document.createElement('div');
    body.textContent = `This app wants to access your ${permission}. (Simulated)`;
    card.appendChild(body);
    const actions = document.createElement('div');
    actions.className = 'zsim-permission-actions';
    const deny = document.createElement('button');
    deny.textContent = 'Deny';
    deny.addEventListener('click', () => {
      this.runtime!.permissions.respondToDialog(false);
      overlay.remove();
    });
    const allow = document.createElement('button');
    allow.className = 'zsim-permission-allow';
    allow.textContent = 'Allow';
    allow.addEventListener('click', () => {
      this.runtime!.permissions.respondToDialog(true);
      overlay.remove();
    });
    actions.appendChild(deny);
    actions.appendChild(allow);
    card.appendChild(actions);
    overlay.appendChild(card);
    this.element.appendChild(overlay);
  }
}
