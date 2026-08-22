import {
    CANVAS_WIDTH, CANVAS_HEIGHT, HUD_HEIGHT, PLAY_TOP, PLAY_HEIGHT,
    FRAME_TIME, COLORS, GAME_LIST, STATE_HUB, STATE_GAME, STATE_TILT_PROMPT,
} from './constants.js';
import { Renderer } from './renderer.js';
import { input } from './input.js';
import { audio } from './audio.js';
import { getHighScore } from './storage.js';
import { createGame } from '../games/index.js';

const ROW_H = 40;
const LIST_TOP = 56;

class Hub {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.canvas.width = CANVAS_WIDTH;
        this.canvas.height = CANVAS_HEIGHT;
        this.renderer = new Renderer(this.canvas);
        input.attach(this.canvas);

        this.state = STATE_HUB;
        this.activeMeta = null;
        this.activeGame = null;
        this.pendingMeta = null;

        this._lastTime = 0;
        this._accumulator = 0;

        this._gestureBound = false;
        this._bindFirstGesture();

        requestAnimationFrame((t) => this._loop(t));
    }

    _bindFirstGesture() {
        const unlock = () => {
            audio.init();
            audio.resume();
        };
        window.addEventListener('pointerdown', unlock, { once: true });
    }

    _loop(timestamp) {
        requestAnimationFrame((t) => this._loop(t));
        let delta = timestamp - this._lastTime;
        this._lastTime = timestamp;
        if (delta > 100) delta = 100;

        this._accumulator += delta;
        while (this._accumulator >= FRAME_TIME) {
            this._update(FRAME_TIME);
            this._accumulator -= FRAME_TIME;
        }
        this._render();
        input.endFrame();
    }

    _update(dt) {
        if (this.state === STATE_HUB) this._updateHubList();
        else if (this.state === STATE_TILT_PROMPT) this._updateTiltPrompt();
        else if (this.state === STATE_GAME) this._updateGame(dt);
    }

    _updateHubList() {
        const tap = input.tapped ? { x: input.tapX, y: input.tapY } : null;
        if (!tap) return;
        const index = Math.floor((tap.y - LIST_TOP) / ROW_H);
        if (index < 0 || index >= GAME_LIST.length) return;
        if (tap.x < 4 || tap.x > CANVAS_WIDTH - 4) return;
        input.consumeTap();
        audio.select();
        const meta = GAME_LIST[index];
        this.pendingMeta = meta;
        if (meta.tilt && input.tiltPermission !== 'granted' && input.tiltSupported) {
            this.state = STATE_TILT_PROMPT;
        } else {
            this._enterGame(meta);
        }
    }

    async _updateTiltPrompt() {
        const tap = input.consumeTap();
        if (!tap) return;
        if (tap.y > CANVAS_HEIGHT - 60) {
            // Skip / play with drag-to-steer fallback instead.
            this._enterGame(this.pendingMeta);
            return;
        }
        const result = await input.requestTiltPermission();
        if (result === 'granted') {
            input.calibrateTilt();
        }
        this._enterGame(this.pendingMeta);
    }

    _enterGame(meta) {
        this.activeMeta = meta;
        this.activeGame = createGame(meta.id, {
            renderer: this.renderer,
            audio,
            input,
            getHighScore: (id) => getHighScore(id ?? meta.id),
        });
        this.activeGame.enter();
        this.state = STATE_GAME;
    }

    _updateGame(dt) {
        const tap = input.tapped ? { x: input.tapX, y: input.tapY } : null;
        if (tap && tap.y < HUD_HEIGHT) {
            if (tap.x < HUD_HEIGHT) {
                input.consumeTap();
                this.state = STATE_HUB;
                this.activeGame = null;
                return;
            }
            if (tap.x > CANVAS_WIDTH - HUD_HEIGHT) {
                input.consumeTap();
                audio.toggleMute();
                return;
            }
        }
        this.activeGame.update(dt);
    }

    _render() {
        const r = this.renderer;
        r.clear(COLORS.bg);
        if (this.state === STATE_HUB) this._renderHubList();
        else if (this.state === STATE_TILT_PROMPT) this._renderTiltPrompt();
        else if (this.state === STATE_GAME) this._renderGame();
    }

    _renderHubList() {
        const r = this.renderer;
        r.drawText('POCKETEERS', CANVAS_WIDTH / 2, 14, COLORS.accent, 'center', 2);
        r.drawText('TAP A GAME TO PLAY', CANVAS_WIDTH / 2, 34, COLORS.accentDim, 'center', 1);

        GAME_LIST.forEach((meta, i) => {
            const y = LIST_TOP + i * ROW_H;
            r.strokeRect(4, y, CANVAS_WIDTH - 8, ROW_H - 6, COLORS.accentDim);
            r.drawText(meta.title, 10, y + 8, COLORS.white, 'left', 1);
            r.drawText(meta.subtitle, 10, y + 20, COLORS.accentDim, 'left', 1);
            const hs = getHighScore(meta.id);
            if (hs > 0) {
                r.drawText('HI ' + hs, CANVAS_WIDTH - 10, y + 8, COLORS.warn, 'right', 1);
            }
        });
    }

    _renderTiltPrompt() {
        const r = this.renderer;
        const cy = CANVAS_HEIGHT / 2;
        r.drawText(this.pendingMeta.title, CANVAS_WIDTH / 2, cy - 60, COLORS.accent, 'center', 2);
        r.drawText('THIS GAME USES TILT', CANVAS_WIDTH / 2, cy - 20, COLORS.white, 'center', 1);
        r.drawText('HOLD PHONE FLAT AND', CANVAS_WIDTH / 2, cy - 6, COLORS.white, 'center', 1);
        r.drawText('TAP BELOW TO ALLOW', CANVAS_WIDTH / 2, cy + 8, COLORS.white, 'center', 1);
        r.strokeRect(40, cy + 24, CANVAS_WIDTH - 80, 24, COLORS.accent);
        r.drawText('ALLOW TILT', CANVAS_WIDTH / 2, cy + 32, COLORS.accent, 'center', 1);
        r.drawText('TAP HERE TO USE', CANVAS_WIDTH / 2, CANVAS_HEIGHT - 44, COLORS.accentDim, 'center', 1);
        r.drawText('DRAG-TO-STEER INSTEAD', CANVAS_WIDTH / 2, CANVAS_HEIGHT - 32, COLORS.accentDim, 'center', 1);
    }

    _renderGame() {
        const r = this.renderer;
        r.rect(0, 0, CANVAS_WIDTH, HUD_HEIGHT, COLORS.lcdBg);
        r.drawText('<', 8, 6, COLORS.white, 'left', 1);
        r.drawText(this.activeMeta.title, CANVAS_WIDTH / 2, 6, COLORS.white, 'center', 1);
        r.drawText(audio.muted ? 'X' : ')', CANVAS_WIDTH - 12, 6, COLORS.white, 'left', 1);
        this.activeGame.render();
    }
}

new Hub();
