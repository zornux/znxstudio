import type { MobileIRNode, MobileIRScreen } from '../../shared/simulatorTypes';
import type { SimulatorDiagnosticSeverity } from '../../shared/simulatorTypes';

export interface ResponsiveDiagnostic {
  nodeId: string;
  kind: string;
  check: ResponsiveCheck;
  severity: SimulatorDiagnosticSeverity;
  message: string;
}

export type ResponsiveCheck =
  | 'horizontal_overflow'
  | 'outside_viewport'
  | 'text_clipping'
  | 'zero_size'
  | 'overlapping_interactive'
  | 'tiny_touch_target'
  | 'hidden_by_safe_area';

const MIN_TOUCH = 48;

export class SimulatorResponsive {
  analyze(screen: MobileIRScreen, viewportWidth: number, viewportHeight: number): ResponsiveDiagnostic[] {
    const diagnostics: ResponsiveDiagnostic[] = [];
    this.analyzeNodes(screen.rootChildren, viewportWidth, viewportHeight, diagnostics);
    return diagnostics;
  }

  analyzeDOM(root: HTMLElement, viewportWidth: number, viewportHeight: number): ResponsiveDiagnostic[] {
    const diagnostics: ResponsiveDiagnostic[] = [];
    const nodes = root.querySelectorAll<HTMLElement>('.zsim-node');
    const interactiveRects: { id: string; rect: DOMRect }[] = [];

    for (const el of nodes) {
      const nodeId = el.dataset.nodeId ?? '';
      const kind = el.dataset.kind ?? '';
      const rect = el.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const relLeft = rect.left - rootRect.left;
      const relTop = rect.top - rootRect.top;
      const relRight = relLeft + rect.width;
      const relBottom = relTop + rect.height;

      if (relRight > viewportWidth && rect.width > 0) {
        diagnostics.push({ nodeId, kind, check: 'horizontal_overflow', severity: 'warning', message: `${kind} overflows viewport (right edge at ${Math.round(relRight)}px, viewport ${viewportWidth}px)` });
      }
      if (relBottom > viewportHeight && relTop < viewportHeight) {
        diagnostics.push({ nodeId, kind, check: 'outside_viewport', severity: 'info', message: `${kind} extends beyond viewport bottom` });
      }
      if (rect.width === 0 && rect.height === 0 && el.childElementCount > 0) {
        diagnostics.push({ nodeId, kind, check: 'zero_size', severity: 'warning', message: `${kind} has zero size but contains children` });
      }
      if (el.scrollWidth > el.clientWidth + 1 && kind === 'text') {
        diagnostics.push({ nodeId, kind, check: 'text_clipping', severity: 'info', message: 'Text content may be clipped' });
      }
      const isInteractive = el.style.cursor === 'pointer' || el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.tagName === 'SELECT';
      if (isInteractive) {
        if (rect.width > 0 && rect.width < MIN_TOUCH && rect.height > 0 && rect.height < MIN_TOUCH) {
          diagnostics.push({ nodeId, kind, check: 'tiny_touch_target', severity: 'warning', message: `Touch target ${Math.round(rect.width)}x${Math.round(rect.height)}px below ${MIN_TOUCH}dp minimum` });
        }
        interactiveRects.push({ id: nodeId, rect });
      }
    }

    for (let i = 0; i < interactiveRects.length; i++) {
      for (let j = i + 1; j < interactiveRects.length; j++) {
        if (this.rectsOverlap(interactiveRects[i].rect, interactiveRects[j].rect)) {
          diagnostics.push({
            nodeId: interactiveRects[i].id, kind: 'interactive',
            check: 'overlapping_interactive', severity: 'warning',
            message: `Interactive elements ${interactiveRects[i].id} and ${interactiveRects[j].id} overlap`,
          });
        }
      }
    }

    return diagnostics;
  }

  private analyzeNodes(nodes: MobileIRNode[], vw: number, _vh: number, diagnostics: ResponsiveDiagnostic[]): void {
    for (const node of nodes) {
      const w = Number(node.properties.width || 0);
      if (w > vw && w > 0) {
        diagnostics.push({ nodeId: node.id, kind: node.kind, check: 'horizontal_overflow', severity: 'warning', message: `${node.kind} width ${w}px exceeds viewport ${vw}px` });
      }
      this.analyzeNodes(node.children, vw, _vh, diagnostics);
    }
  }

  private rectsOverlap(a: DOMRect, b: DOMRect): boolean {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }
}
