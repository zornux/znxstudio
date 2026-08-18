/**
 * Drag-and-drop system for the visual designer. Handles dragging components
 * from the toolbox onto the canvas, rearranging components within the canvas,
 * and providing visual feedback (drop indicators, ghost previews).
 */

import { Emitter, type Event } from '../core/Emitter';

// ---------------------------------------------------------------------------
// Drag data
// ---------------------------------------------------------------------------

export type DragSource =
  | { origin: 'toolbox'; componentKind: string }
  | { origin: 'canvas'; nodeId: string; grabOffsetX: number; grabOffsetY: number };

export interface DropTarget {
  parentId: string | null;
  index: number;
  /** True when dropping on the freeform root canvas rather than a flow slot. */
  freeform: boolean;
}

export interface DropResult {
  source: DragSource;
  target: DropTarget;
  clientX: number;
  clientY: number;
}

// ---------------------------------------------------------------------------
// Drop zone registration
// ---------------------------------------------------------------------------

interface DropZoneEntry {
  element: HTMLElement;
  parentId: string | null;
  index: number;
  freeform: boolean;
  accepts: (source: DragSource) => boolean;
}

const DROP_ZONE_HIT_SLOP = 8;

// ---------------------------------------------------------------------------
// DragDropManager
// ---------------------------------------------------------------------------

export class DragDropManager {
  private activeDrag: DragSource | null = null;
  private ghostEl: HTMLElement | null = null;
  private readonly dropZones: DropZoneEntry[] = [];
  private activeDropZone: DropZoneEntry | null = null;
  private dragMoveHandler: ((e: MouseEvent) => void) | null = null;
  private dragEndHandler: ((e: MouseEvent) => void) | null = null;

  private readonly _onDrop = new Emitter<DropResult>();
  readonly onDrop: Event<DropResult> = this._onDrop.event;

  private readonly _onDragStart = new Emitter<DragSource>();
  readonly onDragStart: Event<DragSource> = this._onDragStart.event;

  private readonly _onDragEnd = new Emitter<void>();
  readonly onDragEnd: Event<void> = this._onDragEnd.event;

  isDragging(): boolean {
    return this.activeDrag !== null;
  }

  currentDrag(): DragSource | null {
    return this.activeDrag;
  }

  // ---- Drag initiation (called by toolbox items or canvas nodes) ----

  startDrag(source: DragSource, e: MouseEvent, ghostLabel: string): void {
    if (this.activeDrag) return;
    this.activeDrag = source;

    this.ghostEl = document.createElement('div');
    this.ghostEl.className = 'zd-drag-ghost';
    this.ghostEl.textContent = ghostLabel;
    this.ghostEl.style.left = `${e.clientX + 12}px`;
    this.ghostEl.style.top = `${e.clientY + 12}px`;
    document.body.appendChild(this.ghostEl);

    this.dragMoveHandler = (ev: MouseEvent) => this.onMouseMove(ev);
    this.dragEndHandler = (ev: MouseEvent) => this.onMouseUp(ev);
    document.addEventListener('mousemove', this.dragMoveHandler);
    document.addEventListener('mouseup', this.dragEndHandler);

    this._onDragStart.fire(source);
  }

  // ---- Drop zone management ----

  registerDropZone(
    element: HTMLElement,
    parentId: string | null,
    index: number,
    accepts: (source: DragSource) => boolean = () => true,
    freeform = false,
  ): () => void {
    const entry: DropZoneEntry = { element, parentId, index, accepts, freeform };
    this.dropZones.push(entry);
    return () => {
      const idx = this.dropZones.indexOf(entry);
      if (idx >= 0) this.dropZones.splice(idx, 1);
    };
  }

  clearDropZones(): void {
    this.dropZones.length = 0;
    this.activeDropZone = null;
  }

  // ---- Internal mouse handling ----

  private onMouseMove(e: MouseEvent): void {
    if (!this.activeDrag || !this.ghostEl) return;
    this.ghostEl.style.left = `${e.clientX + 12}px`;
    this.ghostEl.style.top = `${e.clientY + 12}px`;

    // Hit-test drop zones
    let best: DropZoneEntry | null = null;
    let bestArea = Infinity;
    let bestDist = Infinity;
    for (const zone of this.dropZones) {
      if (!zone.accepts(this.activeDrag)) continue;
      const rect = zone.element.getBoundingClientRect();
      // Insertion indicators are intentionally slim visually, but should not
      // require pixel-perfect aim. Give short dimensions a comfortable hit
      // target while leaving normal-sized container/canvas zones unchanged.
      const slopX = rect.width < DROP_ZONE_HIT_SLOP * 2 ? DROP_ZONE_HIT_SLOP : 0;
      const slopY = rect.height < DROP_ZONE_HIT_SLOP * 2 ? DROP_ZONE_HIT_SLOP : 0;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      if (
        e.clientX >= rect.left - slopX &&
        e.clientX <= rect.right + slopX &&
        e.clientY >= rect.top - slopY &&
        e.clientY <= rect.bottom + slopY
      ) {
        const area = Math.max(rect.width, 1) * Math.max(rect.height, 1);
        const dist = dx * dx + dy * dy;
        // Nested containers and insertion indicators must win over the canvas
        // fallback. Area is a reliable proxy for specificity in the rendered
        // tree; distance breaks ties between adjacent insertion indicators.
        if (area < bestArea || (area === bestArea && dist < bestDist)) {
          bestArea = area;
          bestDist = dist;
          best = zone;
        }
      }
    }

    if (this.activeDropZone !== best) {
      if (this.activeDropZone) {
        this.activeDropZone.element.classList.remove('zd-drop-active');
      }
      this.activeDropZone = best;
      if (best) {
        best.element.classList.add('zd-drop-active');
      }
    }
  }

  private onMouseUp(e: MouseEvent): void {
    if (this.activeDrag && this.activeDropZone) {
      this._onDrop.fire({
        source: this.activeDrag,
        target: {
          parentId: this.activeDropZone.parentId,
          index: this.activeDropZone.index,
          freeform: this.activeDropZone.freeform,
        },
        clientX: e.clientX,
        clientY: e.clientY,
      });
    }

    this.endDrag();
  }

  private endDrag(): void {
    if (this.activeDropZone) {
      this.activeDropZone.element.classList.remove('zd-drop-active');
      this.activeDropZone = null;
    }
    if (this.ghostEl) {
      this.ghostEl.remove();
      this.ghostEl = null;
    }
    if (this.dragMoveHandler) {
      document.removeEventListener('mousemove', this.dragMoveHandler);
      this.dragMoveHandler = null;
    }
    if (this.dragEndHandler) {
      document.removeEventListener('mouseup', this.dragEndHandler);
      this.dragEndHandler = null;
    }
    this.activeDrag = null;
    this._onDragEnd.fire();
  }

  cancelDrag(): void {
    this.endDrag();
  }

  dispose(): void {
    this.endDrag();
    this.dropZones.length = 0;
    this._onDrop.dispose();
    this._onDragStart.dispose();
    this._onDragEnd.dispose();
  }
}
