import type { SimulatorAnimationScheduler } from './SimulatorAnimationScheduler';

export type TransitionType = 'none' | 'fade' | 'slide_left' | 'slide_right' | 'slide_up' | 'slide_down' | 'scale';

export interface TransitionConfig {
  type: TransitionType;
  duration: number;
}

const DEFAULT_DURATION = 300;

export class SimulatorTransitions {
  private transitioning = false;
  private pendingTransition: (() => void) | null = null;
  private readonly scheduler: SimulatorAnimationScheduler;

  constructor(scheduler: SimulatorAnimationScheduler) {
    this.scheduler = scheduler;
  }

  isTransitioning(): boolean {
    return this.transitioning;
  }

  async transition(
    container: HTMLElement,
    oldContent: HTMLElement | null,
    newContent: HTMLElement,
    config: TransitionConfig,
  ): Promise<void> {
    if (this.transitioning) {
      this.scheduler.cancel('screen-transition');
      if (this.pendingTransition) this.pendingTransition();
    }

    if (config.type === 'none' || !oldContent) {
      if (oldContent) oldContent.remove();
      container.appendChild(newContent);
      return;
    }

    this.transitioning = true;
    const duration = config.duration || DEFAULT_DURATION;
    container.appendChild(newContent);

    return new Promise<void>(resolve => {
      this.pendingTransition = resolve;
      const applyTransform = (el: HTMLElement, value: string, opacity: string) => {
        el.style.transform = value;
        el.style.opacity = opacity;
        el.style.position = 'absolute';
        el.style.inset = '0';
      };

      const [oldStart, oldEnd, newStart, newEnd] = this.getTransforms(config.type);
      if (oldContent) applyTransform(oldContent, oldStart, '1');
      applyTransform(newContent, newStart, config.type === 'fade' ? '0' : '1');

      this.scheduler.start({
        id: 'screen-transition',
        duration,
        easing: 'ease_in_out',
        onUpdate: (progress) => {
          if (oldContent) {
            const ot = this.interpolateTransform(oldStart, oldEnd, progress);
            oldContent.style.transform = ot;
            if (config.type === 'fade') oldContent.style.opacity = String(1 - progress);
          }
          const nt = this.interpolateTransform(newStart, newEnd, progress);
          newContent.style.transform = nt;
          if (config.type === 'fade') newContent.style.opacity = String(progress);
        },
        onComplete: () => {
          if (oldContent) oldContent.remove();
          newContent.style.transform = '';
          newContent.style.opacity = '';
          newContent.style.position = '';
          newContent.style.inset = '';
          this.transitioning = false;
          this.pendingTransition = null;
          resolve();
        },
      });
    });
  }

  private getTransforms(type: TransitionType): [string, string, string, string] {
    switch (type) {
      case 'fade': return ['none', 'none', 'none', 'none'];
      case 'slide_left': return ['translateX(0)', 'translateX(-100%)', 'translateX(100%)', 'translateX(0)'];
      case 'slide_right': return ['translateX(0)', 'translateX(100%)', 'translateX(-100%)', 'translateX(0)'];
      case 'slide_up': return ['translateY(0)', 'translateY(-100%)', 'translateY(100%)', 'translateY(0)'];
      case 'slide_down': return ['translateY(0)', 'translateY(100%)', 'translateY(-100%)', 'translateY(0)'];
      case 'scale': return ['scale(1)', 'scale(0.8)', 'scale(1.2)', 'scale(1)'];
      default: return ['none', 'none', 'none', 'none'];
    }
  }

  private interpolateTransform(from: string, to: string, progress: number): string {
    if (from === 'none' && to === 'none') return 'none';
    const fromVal = this.extractValue(from);
    const toVal = this.extractValue(to);
    const fn = from.match(/^(\w+)\(/)?.[1] ?? 'translateX';
    const unit = from.includes('%') ? '%' : '';
    const current = fromVal + (toVal - fromVal) * progress;
    return `${fn}(${current}${unit})`;
  }

  private extractValue(transform: string): number {
    const match = transform.match(/[-\d.]+/);
    return match ? parseFloat(match[0]) : 0;
  }

  reset(): void {
    this.scheduler.cancel('screen-transition');
    this.transitioning = false;
    this.pendingTransition = null;
  }
}
