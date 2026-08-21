import type { SimulatorEnvironmentModel } from './SimulatorEnvironmentModel';
import type { SimulatorClock } from './SimulatorClock';

export interface ScreenshotMetadata {
  device: string;
  orientation: string;
  theme: string;
  fontScale: number;
  screen: string;
  scenario: string;
  timestamp: number;
  width: number;
  height: number;
}

export interface ScreenshotCapture {
  dataUrl: string;
  metadata: ScreenshotMetadata;
}

export interface VisualDiff {
  baseline: string;
  current: string;
  diffDataUrl: string;
  changedPixels: number;
  totalPixels: number;
  diffPercentage: number;
  passed: boolean;
}

const MAX_BASELINES = 200;

export class SimulatorScreenshot {
  private readonly baselines = new Map<string, string>();
  private tolerance = 0.1;
  private readonly env: SimulatorEnvironmentModel;
  private readonly clock: SimulatorClock;

  constructor(env: SimulatorEnvironmentModel, clock: SimulatorClock) {
    this.env = env;
    this.clock = clock;
  }

  async captureElement(element: HTMLElement, screen: string, scenario = 'default'): Promise<ScreenshotCapture> {
    const canvas = document.createElement('canvas');
    const rect = element.getBoundingClientRect();
    canvas.width = Math.round(rect.width);
    canvas.height = Math.round(rect.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await this.renderToCanvas(element, ctx, 0, 0);
    const envState = this.env.get();
    return {
      dataUrl: canvas.toDataURL('image/png'),
      metadata: {
        device: envState.device.id,
        orientation: envState.orientation,
        theme: envState.theme,
        fontScale: envState.fontScale,
        screen,
        scenario,
        timestamp: this.clock.now(),
        width: canvas.width,
        height: canvas.height,
      },
    };
  }

  async captureViewport(viewport: HTMLElement, screen: string, scenario = 'default'): Promise<ScreenshotCapture> {
    return this.captureElement(viewport, screen, scenario);
  }

  setBaseline(key: string, dataUrl: string): void {
    this.baselines.set(key, dataUrl);
    if (this.baselines.size > MAX_BASELINES) {
      const first = this.baselines.keys().next().value;
      if (first !== undefined) this.baselines.delete(first);
    }
  }

  getBaseline(key: string): string | undefined {
    return this.baselines.get(key);
  }

  hasBaseline(key: string): boolean {
    return this.baselines.has(key);
  }

  removeBaseline(key: string): boolean {
    return this.baselines.delete(key);
  }

  allBaselineKeys(): string[] {
    return [...this.baselines.keys()];
  }

  baselineCount(): number {
    return this.baselines.size;
  }

  setTolerance(percent: number): void {
    this.tolerance = Math.max(0, Math.min(100, percent));
  }

  getTolerance(): number {
    return this.tolerance;
  }

  async compare(baselineDataUrl: string, currentDataUrl: string): Promise<VisualDiff> {
    const [baselineImg, currentImg] = await Promise.all([
      this.loadImage(baselineDataUrl),
      this.loadImage(currentDataUrl),
    ]);
    const width = Math.max(baselineImg.width, currentImg.width);
    const height = Math.max(baselineImg.height, currentImg.height);
    const baseCanvas = this.drawToCanvas(baselineImg, width, height);
    const curCanvas = this.drawToCanvas(currentImg, width, height);
    const baseData = baseCanvas.getContext('2d')!.getImageData(0, 0, width, height);
    const curData = curCanvas.getContext('2d')!.getImageData(0, 0, width, height);

    const diffCanvas = document.createElement('canvas');
    diffCanvas.width = width;
    diffCanvas.height = height;
    const diffCtx = diffCanvas.getContext('2d')!;
    const diffImageData = diffCtx.createImageData(width, height);

    let changedPixels = 0;
    const totalPixels = width * height;
    for (let i = 0; i < baseData.data.length; i += 4) {
      const dr = Math.abs(baseData.data[i] - curData.data[i]);
      const dg = Math.abs(baseData.data[i + 1] - curData.data[i + 1]);
      const db = Math.abs(baseData.data[i + 2] - curData.data[i + 2]);
      if (dr + dg + db > 30) {
        changedPixels++;
        diffImageData.data[i] = 255;
        diffImageData.data[i + 1] = 0;
        diffImageData.data[i + 2] = 0;
        diffImageData.data[i + 3] = 200;
      } else {
        diffImageData.data[i] = curData.data[i];
        diffImageData.data[i + 1] = curData.data[i + 1];
        diffImageData.data[i + 2] = curData.data[i + 2];
        diffImageData.data[i + 3] = 80;
      }
    }
    diffCtx.putImageData(diffImageData, 0, 0);

    const diffPercentage = totalPixels > 0 ? (changedPixels / totalPixels) * 100 : 0;
    return {
      baseline: baselineDataUrl,
      current: currentDataUrl,
      diffDataUrl: diffCanvas.toDataURL('image/png'),
      changedPixels,
      totalPixels,
      diffPercentage,
      passed: diffPercentage <= this.tolerance,
    };
  }

  baselineKey(screen: string, device: string, theme: string, orientation: string): string {
    return `${screen}__${device}__${theme}__${orientation}`;
  }

  private async renderToCanvas(element: HTMLElement, ctx: CanvasRenderingContext2D, x: number, y: number): Promise<void> {
    const svgData = `<svg xmlns="http://www.w3.org/2000/svg" width="${element.scrollWidth}" height="${element.scrollHeight}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml">${element.outerHTML}</div>
      </foreignObject>
    </svg>`;
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const img = await this.loadImage(url);
      ctx.drawImage(img, x, y);
    } catch {
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(x, y, element.scrollWidth, element.scrollHeight);
      ctx.fillStyle = '#888';
      ctx.font = '12px sans-serif';
      ctx.fillText('[Screenshot capture error]', x + 10, y + 20);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  private drawToCanvas(img: HTMLImageElement, width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return canvas;
  }

  dispose(): void {
    this.baselines.clear();
  }
}
