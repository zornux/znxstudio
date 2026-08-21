import { Emitter, type Event } from '../core/Emitter';
import type { SimulatorClock } from './SimulatorClock';

export type EasingFunction = 'linear' | 'ease' | 'ease_in' | 'ease_out' | 'ease_in_out';

export interface AnimationConfig {
  id: string;
  duration: number;
  delay?: number;
  easing?: EasingFunction;
  repeat?: number;
  reverse?: boolean;
  onUpdate: (progress: number) => void;
  onComplete?: () => void;
}

interface ActiveAnimation {
  config: AnimationConfig;
  startTime: number;
  paused: boolean;
  pauseTime: number;
  iteration: number;
  completed: boolean;
}

export interface AnimationEvent {
  id: string;
  action: 'start' | 'complete' | 'cancel' | 'pause' | 'resume';
}

const EASING_FNS: Record<EasingFunction, (t: number) => number> = {
  linear: t => t,
  ease: t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2,
  ease_in: t => t * t,
  ease_out: t => 1 - (1 - t) * (1 - t),
  ease_in_out: t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2,
};

export class SimulatorAnimationScheduler {
  private readonly animations = new Map<string, ActiveAnimation>();
  private rafId: number | null = null;
  private running = false;
  private readonly clock: SimulatorClock;

  private readonly _onAnimation = new Emitter<AnimationEvent>();
  readonly onAnimation: Event<AnimationEvent> = this._onAnimation.event;

  constructor(clock: SimulatorClock) {
    this.clock = clock;
    this.clock.onTick(() => { if (this.animations.size > 0) this.tick(); });
  }

  start(config: AnimationConfig): void {
    const existing = this.animations.get(config.id);
    if (existing) this.cancel(config.id);
    const startTime = this.clock.now() + (config.delay ?? 0);
    this.animations.set(config.id, {
      config,
      startTime,
      paused: false,
      pauseTime: 0,
      iteration: 0,
      completed: false,
    });
    this._onAnimation.fire({ id: config.id, action: 'start' });
    this.ensureLoop();
  }

  cancel(id: string): void {
    if (this.animations.delete(id)) {
      this._onAnimation.fire({ id, action: 'cancel' });
    }
  }

  pause(id: string): void {
    const anim = this.animations.get(id);
    if (anim && !anim.paused) {
      anim.paused = true;
      anim.pauseTime = this.clock.now();
      this._onAnimation.fire({ id, action: 'pause' });
    }
  }

  resume(id: string): void {
    const anim = this.animations.get(id);
    if (anim && anim.paused) {
      const pauseDuration = this.clock.now() - anim.pauseTime;
      anim.startTime += pauseDuration;
      anim.paused = false;
      this._onAnimation.fire({ id, action: 'resume' });
      this.ensureLoop();
    }
  }

  finishAll(): void {
    for (const [id, anim] of this.animations) {
      anim.config.onUpdate(1);
      anim.config.onComplete?.();
      this._onAnimation.fire({ id, action: 'complete' });
    }
    this.animations.clear();
  }

  cancelAll(): void {
    for (const id of this.animations.keys()) {
      this._onAnimation.fire({ id, action: 'cancel' });
    }
    this.animations.clear();
  }

  isAnimating(id?: string): boolean {
    if (id) return this.animations.has(id);
    return this.animations.size > 0;
  }

  activeCount(): number {
    return this.animations.size;
  }

  private tick(): void {
    const now = this.clock.now();
    const completed: string[] = [];

    for (const [id, anim] of this.animations) {
      if (anim.paused) continue;
      if (now < anim.startTime) continue;

      const elapsed = now - anim.startTime;
      const duration = anim.config.duration;
      const maxIterations = anim.config.repeat ?? 1;
      const iteration = Math.floor(elapsed / duration);
      const rawProgress = Math.min((elapsed % duration) / duration, 1);

      if (iteration >= maxIterations) {
        anim.config.onUpdate(1);
        anim.config.onComplete?.();
        completed.push(id);
        continue;
      }

      let progress = rawProgress;
      if (anim.config.reverse && iteration % 2 === 1) {
        progress = 1 - progress;
      }

      const easingFn = EASING_FNS[anim.config.easing ?? 'ease'];
      anim.config.onUpdate(easingFn(progress));
      anim.iteration = iteration;
    }

    for (const id of completed) {
      this.animations.delete(id);
      this._onAnimation.fire({ id, action: 'complete' });
    }
  }

  private ensureLoop(): void {
    if (this.running || this.clock.mode() !== 'realtime') return;
    this.running = true;
    const loop = () => {
      if (this.animations.size === 0) { this.running = false; return; }
      this.tick();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  reset(): void {
    this.cancelAll();
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    this.running = false;
  }

  dispose(): void {
    this.reset();
    this._onAnimation.dispose();
  }
}
