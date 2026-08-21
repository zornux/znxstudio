import { Emitter, type Event } from '../core/Emitter';

export type GestureType = 'tap' | 'double_tap' | 'long_press' | 'swipe_left' | 'swipe_right' | 'swipe_up' | 'swipe_down' | 'drag' | 'pinch' | 'scroll';

export interface GestureEvent {
  type: GestureType;
  target: HTMLElement;
  x: number;
  y: number;
  dx: number;
  dy: number;
  scale: number;
  velocity: number;
  timestamp: number;
}

type GestureState = 'idle' | 'pending_tap' | 'pressing' | 'dragging' | 'swiping' | 'pinching';

interface GestureHandler {
  type: GestureType;
  element: HTMLElement;
  callback: (event: GestureEvent) => void;
  priority: number;
}

const TAP_TIMEOUT = 200;
const DOUBLE_TAP_TIMEOUT = 300;
const LONG_PRESS_TIMEOUT = 500;
const SWIPE_THRESHOLD = 30;
const DRAG_THRESHOLD = 10;

export class SimulatorGestureEngine {
  private state: GestureState = 'idle';
  private readonly handlers: GestureHandler[] = [];
  private startX = 0;
  private startY = 0;
  private startTime = 0;
  private lastTapTime = 0;
  private lastTapX = 0;
  private lastTapY = 0;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private tapTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingTapTarget: HTMLElement | null = null;
  private currentTarget: HTMLElement | null = null;
  private _showTouches = false;
  private readonly touchMarkers: HTMLElement[] = [];
  private readonly maxMarkers = 20;
  private viewport: HTMLElement | null = null;

  private readonly _onGesture = new Emitter<GestureEvent>();
  readonly onGesture: Event<GestureEvent> = this._onGesture.event;

  attach(element: HTMLElement): void {
    this.viewport = element;
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerup', this.onPointerUp);
    element.addEventListener('pointercancel', this.onPointerCancel);
    element.addEventListener('wheel', this.onWheel, { passive: false });
  }

  detach(): void {
    if (!this.viewport) return;
    this.viewport.removeEventListener('pointerdown', this.onPointerDown);
    this.viewport.removeEventListener('pointermove', this.onPointerMove);
    this.viewport.removeEventListener('pointerup', this.onPointerUp);
    this.viewport.removeEventListener('pointercancel', this.onPointerCancel);
    this.viewport.removeEventListener('wheel', this.onWheel);
    this.viewport = null;
  }

  register(type: GestureType, element: HTMLElement, callback: (event: GestureEvent) => void, priority = 0): () => void {
    const handler: GestureHandler = { type, element, callback, priority };
    this.handlers.push(handler);
    this.handlers.sort((a, b) => b.priority - a.priority);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx !== -1) this.handlers.splice(idx, 1);
    };
  }

  setShowTouches(enabled: boolean): void {
    this._showTouches = enabled;
    if (!enabled) this.clearMarkers();
  }

  showTouches(): boolean { return this._showTouches; }

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.startTime = performance.now();
    this.currentTarget = e.target as HTMLElement;

    if (this._showTouches) this.addTouchMarker(e.clientX, e.clientY, 'tap');

    this.clearLongPress();
    this.longPressTimer = setTimeout(() => {
      if (this.state === 'idle' || this.state === 'pending_tap') {
        this.state = 'pressing';
        this.fire('long_press', e.clientX, e.clientY, 0, 0);
        this.state = 'idle';
      }
    }, LONG_PRESS_TIMEOUT);

    if (this.state === 'idle') {
      this.state = 'pending_tap';
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (this.state === 'pending_tap' && dist > DRAG_THRESHOLD) {
      this.clearLongPress();
      const parentScrollable = this.findScrollableAncestor(this.currentTarget);
      if (parentScrollable && Math.abs(dy) > Math.abs(dx)) {
        this.state = 'swiping';
      } else if (this.hasHandler('drag', this.currentTarget)) {
        this.state = 'dragging';
      } else {
        this.state = 'swiping';
      }
    }

    if (this.state === 'dragging') {
      if (this._showTouches) this.addTouchMarker(e.clientX, e.clientY, 'drag');
      this.fire('drag', e.clientX, e.clientY, dx, dy);
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    this.clearLongPress();
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const elapsed = performance.now() - this.startTime;
    const velocity = dist / Math.max(elapsed, 1);

    if (this.state === 'swiping' && dist > SWIPE_THRESHOLD) {
      if (Math.abs(dx) > Math.abs(dy)) {
        this.fire(dx > 0 ? 'swipe_right' : 'swipe_left', e.clientX, e.clientY, dx, dy, 1, velocity);
      } else {
        this.fire(dy > 0 ? 'swipe_down' : 'swipe_up', e.clientX, e.clientY, dx, dy, 1, velocity);
      }
      this.state = 'idle';
      return;
    }

    if (this.state === 'pressing') {
      this.state = 'idle';
      return;
    }

    if (this.state === 'dragging') {
      this.state = 'idle';
      return;
    }

    if (this.state === 'pending_tap' && elapsed < TAP_TIMEOUT) {
      const now = performance.now();
      const tapDist = Math.sqrt((e.clientX - this.lastTapX) ** 2 + (e.clientY - this.lastTapY) ** 2);
      if (now - this.lastTapTime < DOUBLE_TAP_TIMEOUT && tapDist < 30) {
        if (this.tapTimer) { clearTimeout(this.tapTimer); this.tapTimer = null; }
        this.fire('double_tap', e.clientX, e.clientY, 0, 0);
        this.lastTapTime = 0;
      } else {
        this.lastTapTime = now;
        this.lastTapX = e.clientX;
        this.lastTapY = e.clientY;
        this.pendingTapTarget = this.currentTarget;
        const tapX = e.clientX, tapY = e.clientY;
        this.tapTimer = setTimeout(() => {
          this.fire('tap', tapX, tapY, 0, 0);
          this.tapTimer = null;
        }, DOUBLE_TAP_TIMEOUT);
      }
    }
    this.state = 'idle';
  };

  private readonly onPointerCancel = (): void => {
    this.clearLongPress();
    this.state = 'idle';
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (e.ctrlKey) {
      e.preventDefault();
      const scale = e.deltaY < 0 ? 1.1 : 0.9;
      if (this._showTouches) this.addTouchMarker(e.clientX, e.clientY, 'pinch');
      this.fire('pinch', e.clientX, e.clientY, 0, 0, scale);
    } else {
      this.fire('scroll', e.clientX, e.clientY, e.deltaX, e.deltaY);
    }
  };

  private fire(type: GestureType, x: number, y: number, dx: number, dy: number, scale = 1, velocity = 0): void {
    const event: GestureEvent = { type, target: this.currentTarget ?? this.viewport!, x, y, dx, dy, scale, velocity, timestamp: performance.now() };
    const target = this.currentTarget;
    const matched = this.handlers.filter(h => h.type === type && target && (h.element === target || h.element.contains(target)));
    if (matched.length > 0) {
      matched[0].callback(event);
    }
    this._onGesture.fire(event);
  }

  private hasHandler(type: GestureType, target: HTMLElement | null): boolean {
    if (!target) return false;
    return this.handlers.some(h => h.type === type && (h.element === target || h.element.contains(target)));
  }

  private findScrollableAncestor(el: HTMLElement | null): HTMLElement | null {
    let current = el;
    while (current && current !== this.viewport) {
      const overflow = getComputedStyle(current).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') return current;
      current = current.parentElement;
    }
    return null;
  }

  private clearLongPress(): void {
    if (this.longPressTimer) { clearTimeout(this.longPressTimer); this.longPressTimer = null; }
  }

  private addTouchMarker(x: number, y: number, kind: string): void {
    if (!this.viewport) return;
    const rect = this.viewport.getBoundingClientRect();
    const marker = document.createElement('div');
    marker.className = `zsim-touch-marker zsim-touch-${kind}`;
    marker.style.left = `${x - rect.left}px`;
    marker.style.top = `${y - rect.top}px`;
    this.viewport.appendChild(marker);
    this.touchMarkers.push(marker);
    setTimeout(() => {
      marker.remove();
      const idx = this.touchMarkers.indexOf(marker);
      if (idx !== -1) this.touchMarkers.splice(idx, 1);
    }, 600);
    while (this.touchMarkers.length > this.maxMarkers) {
      this.touchMarkers.shift()?.remove();
    }
  }

  private clearMarkers(): void {
    for (const m of this.touchMarkers) m.remove();
    this.touchMarkers.length = 0;
  }

  currentState(): GestureState {
    return this.state;
  }

  synthesize(type: GestureType, x: number, y: number): void {
    const target = typeof document !== 'undefined' ? document.body : null;
    const event: GestureEvent = { type, target: target as HTMLElement, x, y, dx: 0, dy: 0, scale: 1, velocity: 0, timestamp: Date.now() };
    this._onGesture.fire(event);
    for (const h of this.handlers) {
      if (h.type === type) h.callback(event);
    }
  }

  reset(): void {
    this.state = 'idle';
    this.handlers.length = 0;
    this.clearLongPress();
    if (this.tapTimer) { clearTimeout(this.tapTimer); this.tapTimer = null; }
    this.clearMarkers();
  }

  dispose(): void {
    this.detach();
    this.reset();
    this._onGesture.dispose();
  }
}
