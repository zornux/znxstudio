import type { MobileIRNode, MobileIRScreen } from '../../shared/simulatorTypes';

export interface AccessibilityIssue {
  nodeId: string;
  kind: string;
  check: AccessibilityCheck;
  severity: 'error' | 'warning';
  message: string;
  suggestion: string;
}

export type AccessibilityCheck =
  | 'missing_label'
  | 'missing_image_description'
  | 'tiny_touch_target'
  | 'low_contrast'
  | 'unfocusable_interactive';

export interface AccessibleElement {
  nodeId: string;
  kind: string;
  role: string;
  label: string;
  focusable: boolean;
  enabled: boolean;
  order: number;
}

const INTERACTIVE_KINDS = new Set(['button', 'input', 'checkbox', 'switch', 'slider', 'dropdown', 'fab', 'chip', 'tabs', 'bottomnav']);
const MIN_TOUCH_TARGET = 48;

export class SimulatorAccessibility {
  audit(screen: MobileIRScreen): AccessibilityIssue[] {
    const issues: AccessibilityIssue[] = [];
    this.auditNodes(screen.rootChildren, issues);
    return issues;
  }

  auditNode(node: MobileIRNode): AccessibilityIssue[] {
    const issues: AccessibilityIssue[] = [];
    this.checkNode(node, issues);
    return issues;
  }

  buildAccessibleOrder(screen: MobileIRScreen): AccessibleElement[] {
    const elements: AccessibleElement[] = [];
    this.collectAccessible(screen.rootChildren, elements, 0);
    return elements;
  }

  private auditNodes(nodes: MobileIRNode[], issues: AccessibilityIssue[]): void {
    for (const node of nodes) {
      this.checkNode(node, issues);
      this.auditNodes(node.children, issues);
    }
  }

  private checkNode(node: MobileIRNode, issues: AccessibilityIssue[]): void {
    const isInteractive = INTERACTIVE_KINDS.has(node.kind) || node.events.length > 0 || node.properties.clickable === true;
    const hasLabel = !!(node.properties.contentDescription || node.properties.label || node.properties.content || node.properties.title);

    if (isInteractive && !hasLabel) {
      issues.push({
        nodeId: node.id, kind: node.kind,
        check: 'missing_label', severity: 'error',
        message: `Interactive ${node.kind} has no accessible label`,
        suggestion: 'Add a contentDescription or label property',
      });
    }

    if (node.kind === 'image' && !node.properties.alt && !node.properties.contentDescription) {
      issues.push({
        nodeId: node.id, kind: node.kind,
        check: 'missing_image_description', severity: 'warning',
        message: 'Image has no alt text or content description',
        suggestion: 'Add an alt or contentDescription property',
      });
    }

    if (isInteractive) {
      const width = Number(node.properties.width || 0);
      const height = Number(node.properties.height || 0);
      if (width > 0 && width < MIN_TOUCH_TARGET && height > 0 && height < MIN_TOUCH_TARGET) {
        issues.push({
          nodeId: node.id, kind: node.kind,
          check: 'tiny_touch_target', severity: 'warning',
          message: `Touch target ${width}x${height} is below minimum ${MIN_TOUCH_TARGET}dp`,
          suggestion: `Increase size to at least ${MIN_TOUCH_TARGET}dp`,
        });
      }
    }

    if (isInteractive && node.properties.focusable === false) {
      issues.push({
        nodeId: node.id, kind: node.kind,
        check: 'unfocusable_interactive', severity: 'warning',
        message: 'Interactive element is not focusable',
        suggestion: 'Set focusable to true or remove the explicit false',
      });
    }
  }

  private collectAccessible(nodes: MobileIRNode[], elements: AccessibleElement[], startOrder: number): number {
    let order = startOrder;
    for (const node of nodes) {
      const isInteractive = INTERACTIVE_KINDS.has(node.kind) || node.events.length > 0 || node.properties.clickable === true;
      const focusable = node.properties.focusable !== false && isInteractive;
      if (focusable || node.properties.contentDescription) {
        elements.push({
          nodeId: node.id,
          kind: node.kind,
          role: String(node.properties.semanticRole ?? (isInteractive ? 'button' : 'text')),
          label: String(node.properties.contentDescription ?? node.properties.label ?? node.properties.content ?? node.kind),
          focusable,
          enabled: node.properties.enabled !== false,
          order: order++,
        });
      }
      order = this.collectAccessible(node.children, elements, order);
    }
    return order;
  }
}
