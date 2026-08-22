import { CANVAS_WIDTH, CANVAS_HEIGHT, COLORS } from './constants.js';

const FONT_FAMILY = '"Fredoka", system-ui, -apple-system, sans-serif';

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        // Render at native device resolution (capped) rather than the fixed
        // 240x320 logical size, so smooth fonts/curves stay crisp instead of
        // being nearest-neighbor upscaled. All drawing calls still use the
        // 240x320 logical coordinate space via ctx.scale.
        this.dpr = Math.min(window.devicePixelRatio || 1, 3);
        canvas.width = CANVAS_WIDTH * this.dpr;
        canvas.height = CANVAS_HEIGHT * this.dpr;
        this.ctx = canvas.getContext('2d');
        this.ctx.imageSmoothingEnabled = true;
        this._shakeMag = 0;
        this._shakeFrames = 0;
    }

    clear(color = COLORS.bg) {
        let ox = 0, oy = 0;
        if (this._shakeFrames > 0) {
            ox = (Math.random() * 2 - 1) * this._shakeMag;
            oy = (Math.random() * 2 - 1) * this._shakeMag;
            this._shakeFrames--;
        }
        // Reapply the DPR scale every frame (setTransform is absolute, not
        // cumulative) with the shake offset folded into the translation.
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, ox * this.dpr, oy * this.dpr);
        this.ctx.fillStyle = color;
        this.ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    // Brief camera shake for impacts/wins. Call once; decays automatically.
    shake(magnitude = 3, frames = 10) {
        this._shakeMag = magnitude;
        this._shakeFrames = frames;
    }

    rect(x, y, w, h, color) {
        this.ctx.fillStyle = color;
        this.ctx.fillRect(x, y, w, h);
    }

    strokeRect(x, y, w, h, color, lineWidth = 1) {
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = lineWidth;
        this.ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    }

    circle(x, y, r, color) {
        this.ctx.fillStyle = color;
        this.ctx.beginPath();
        this.ctx.arc(x, y, r, 0, Math.PI * 2);
        this.ctx.fill();
    }

    glowCircle(x, y, r, color, glowAmount = 8) {
        this.ctx.save();
        this.ctx.shadowColor = color;
        this.ctx.shadowBlur = glowAmount;
        this.circle(x, y, r, color);
        this.ctx.restore();
    }

    roundRect(x, y, w, h, radius, color) {
        const rad = Math.min(radius, w / 2, h / 2);
        this.ctx.fillStyle = color;
        this.ctx.beginPath();
        this.ctx.roundRect(x, y, w, h, rad);
        this.ctx.fill();
    }

    strokeCircle(x, y, r, color, lineWidth = 1) {
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = lineWidth;
        this.ctx.beginPath();
        this.ctx.arc(x, y, r, 0, Math.PI * 2);
        this.ctx.stroke();
    }

    line(x1, y1, x2, y2, color, lineWidth = 1) {
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = lineWidth;
        this.ctx.beginPath();
        this.ctx.moveTo(x1, y1);
        this.ctx.lineTo(x2, y2);
        this.ctx.stroke();
    }

    _font(scale) {
        const px = Math.round(6 * scale + 6);
        return `600 ${px}px ${FONT_FAMILY}`;
    }

    drawText(text, x, y, color, align = 'left', scale = 1) {
        this.ctx.font = this._font(scale);
        this.ctx.fillStyle = color;
        this.ctx.textAlign = align === 'right' ? 'right' : align === 'center' ? 'center' : 'left';
        this.ctx.textBaseline = 'top';
        this.ctx.fillText(text.toString(), x, y);
    }

    textWidth(text, scale = 1) {
        this.ctx.font = this._font(scale);
        return this.ctx.measureText(text.toString()).width;
    }
}
