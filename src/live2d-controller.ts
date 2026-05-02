import * as PIXI from 'pixi.js';
import type { Live2DAction } from './types';

declare global {
  interface Window {
    PIXI: typeof PIXI;
  }
}

window.PIXI = PIXI;

export class Live2DController {
  private app: PIXI.Application;
  private Live2DModel: any | null = null;
  private model: any | null = null;
  private sprite: PIXI.Sprite | null = null;
  private lastMotion = '';
  private moodOffset = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.app = new PIXI.Application({
      view: canvas,
      autoStart: true,
      resizeTo: window,
      backgroundAlpha: 0,
      antialias: true
    });

    window.addEventListener('resize', () => this.fitModel());
    this.app.ticker.add(() => this.animateFallback());
  }

  async loadModel(paths: string[]): Promise<string> {
    const Live2DModel = await this.getLive2DModel();
    const errors: string[] = [];

    for (const path of paths) {
      try {
        const model = await Live2DModel.from(path, { autoInteract: false });
        this.setModel(model);
        return path;
      } catch (error) {
        errors.push(`${path}: ${String(error)}`);
      }
    }

    throw new Error(errors.join('\n'));
  }

  private async getLive2DModel() {
    if (!this.Live2DModel) {
      const module = await import('pixi-live2d-display/cubism4');
      this.Live2DModel = module.Live2DModel;
    }

    return this.Live2DModel;
  }

  async loadFallbackImage(paths: string[]): Promise<string> {
    const errors: string[] = [];

    for (const path of paths) {
      try {
        const texture = await PIXI.Texture.fromURL(path);
        this.setSprite(new PIXI.Sprite(texture));
        return path;
      } catch (error) {
        errors.push(`${path}: ${String(error)}`);
      }
    }

    throw new Error(errors.join('\n'));
  }

  async apply(action: Live2DAction): Promise<void> {
    this.applyFallbackMood(action);

    if (!this.model) {
      return;
    }

    if (action.expression) {
      await this.applyExpression(action.expression);
    }

    if (action.motion) {
      await this.applyMotion(action.motion.group, action.motion.index, action.motion.name);
    }
  }

  private setModel(model: any) {
    if (this.sprite) {
      this.app.stage.removeChild(this.sprite);
      this.sprite.destroy();
      this.sprite = null;
    }

    if (this.model) {
      this.app.stage.removeChild(this.model);
      this.model.destroy();
    }

    this.model = model;
    this.model.anchor?.set?.(0.5, 1);
    this.app.stage.addChild(this.model);
    this.fitModel();
  }

  private setSprite(sprite: PIXI.Sprite) {
    if (this.model) {
      this.app.stage.removeChild(this.model);
      this.model.destroy();
      this.model = null;
    }

    if (this.sprite) {
      this.app.stage.removeChild(this.sprite);
      this.sprite.destroy();
    }

    this.sprite = sprite;
    this.sprite.anchor.set(0.5, 1);
    this.app.stage.addChild(this.sprite);
    this.fitModel();
  }

  private fitModel() {
    const target = this.model ?? this.sprite;
    if (!target) {
      return;
    }

    const width = window.innerWidth;
    const height = window.innerHeight;
    const bounds = target.getLocalBounds();
    const scale = Math.min((width * 0.72) / bounds.width, (height * 0.92) / bounds.height);

    target.scale.set(Number.isFinite(scale) ? scale : 1);
    target.position.set(width * 0.5, height * 0.98);
  }

  private async applyExpression(expression: string) {
    try {
      if (typeof this.model.expression === 'function') {
        await this.model.expression(expression);
      } else if (this.model.internalModel?.motionManager?.expressionManager) {
        this.model.internalModel.motionManager.expressionManager.setExpression(expression);
      }
    } catch {
      // Model expression names vary; ignore missing optional expressions.
    }
  }

  private async applyMotion(group?: string, index?: number, name?: string) {
    const key = `${group ?? ''}:${index ?? ''}:${name ?? ''}`;
    if (!group || key === this.lastMotion) {
      return;
    }

    this.lastMotion = key;

    try {
      if (typeof this.model.motion === 'function') {
        await this.model.motion(group, index);
      }
    } catch {
      // Motion groups vary per model; ignore missing optional motions.
    }
  }

  private applyFallbackMood(action: Live2DAction) {
    if (!this.sprite) {
      return;
    }

    if (action.state === 'failed') {
      this.moodOffset = -8;
      this.sprite.tint = 0xffd6dc;
    } else if (action.state === 'succeeded') {
      this.moodOffset = -18;
      this.sprite.tint = 0xffffff;
    } else if (action.state === 'asking') {
      this.moodOffset = -12;
      this.sprite.tint = 0xfff2ba;
    } else if (action.state === 'coding' || action.state === 'running') {
      this.moodOffset = -5;
      this.sprite.tint = 0xe8f3ff;
    } else {
      this.moodOffset = 0;
      this.sprite.tint = 0xffffff;
    }
  }

  private animateFallback() {
    if (!this.sprite) {
      return;
    }

    const time = performance.now() / 1000;
    const bob = Math.sin(time * 1.8) * 4;
    this.sprite.y = window.innerHeight * 0.98 + bob + this.moodOffset;
    this.sprite.rotation = Math.sin(time * 0.8) * 0.01;
  }
}
