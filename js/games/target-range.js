import { CANVAS_WIDTH, PLAY_TOP, PLAY_HEIGHT, COLORS } from '../core/constants.js';
import { getHighScore, setHighScore } from '../core/storage.js';

const GAME_ID = 'target-range';

const RANGE_X = 10;
const RANGE_Y = PLAY_TOP + 8;
const RANGE_W = CANVAS_WIDTH - 20;
const RANGE_H = PLAY_HEIGHT - 40;

const ROUND_TIME = 40 * 60;
const TARGET_TTL = 70;
const START_SPAWN_GAP = 55;
const MIN_SPAWN_GAP = 22;

const S_READY = 'ready';
const S_PLAYING = 'playing';
const S_GAMEOVER = 'gameover';

export class TargetRangeGame {
    constructor(deps) {
        this.renderer = deps.renderer;
        this.audio = deps.audio;
        this.input = deps.input;
        this.highScore = getHighScore(GAME_ID);
    }

    enter() {
        this.score = 0;
        this.hits = 0;
        this.misses = 0;
        this.targets = [];
        this.timeLeft = ROUND_TIME;
        this._spawnTimer = START_SPAWN_GAP;
        this.state = S_READY;
        this._stateTimer = 40;
    }

    _difficulty() {
        return Math.min(1 + (ROUND_TIME - this.timeLeft) / 1400, 2.5);
    }

    _spawnTarget() {
        const r = Math.max(9, 16 - this._difficulty() * 3);
        const x = RANGE_X + r + Math.random() * (RANGE_W - r * 2);
        const y = RANGE_Y + r + Math.random() * (RANGE_H - r * 2);
        const bonus = Math.random() < 0.15;
        this.targets.push({ x, y, r, ttl: TARGET_TTL, bonus });
    }

    update() {
        if (this.state === S_READY) {
            this._stateTimer--;
            const tap = this.input.consumeTap();
            if (tap || this._stateTimer <= 0) this.state = S_PLAYING;
            return;
        }
        if (this.state === S_GAMEOVER) {
            const tap = this.input.consumeTap();
            if (tap) this.enter();
            return;
        }

        // S_PLAYING
        this.timeLeft--;
        if (this.timeLeft <= 0) { this._gameOver(); return; }

        this._spawnTimer -= this._difficulty();
        if (this._spawnTimer <= 0 && this.targets.length < 5) {
            this._spawnTarget();
            this._spawnTimer = Math.max(MIN_SPAWN_GAP, START_SPAWN_GAP - this._difficulty() * 10);
        }

        for (const t of this.targets) t.ttl--;
        const expired = this.targets.filter((t) => t.ttl <= 0);
        if (expired.length) this.misses += expired.length;
        this.targets = this.targets.filter((t) => t.ttl > 0);

        const tap = this.input.consumeTap();
        if (tap) {
            let hitIndex = -1;
            for (let i = 0; i < this.targets.length; i++) {
                const t = this.targets[i];
                if (Math.hypot(tap.x - t.x, tap.y - t.y) < t.r) { hitIndex = i; break; }
            }
            if (hitIndex >= 0) {
                const t = this.targets[hitIndex];
                const value = t.bonus ? 100 : 25;
                this.score += value;
                this.hits++;
                this.targets.splice(hitIndex, 1);
                this.audio.hit();
                this.input.vibrate(t.bonus ? [20, 20, 20] : 25);
            } else {
                this.audio.error();
            }
        }
    }

    _gameOver() {
        this.state = S_GAMEOVER;
        this.audio.lose();
        if (setHighScore(GAME_ID, this.score)) this.highScore = this.score;
    }

    render() {
        const r = this.renderer;
        r.rect(RANGE_X, RANGE_Y, RANGE_W, RANGE_H, COLORS.lcdBg);
        r.strokeRect(RANGE_X, RANGE_Y, RANGE_W, RANGE_H, COLORS.accentDim);

        for (const t of this.targets) {
            const flashing = t.ttl < 20 && Math.floor(t.ttl / 4) % 2 === 0;
            const color = t.bonus ? COLORS.warn : COLORS.accent;
            r.circle(t.x, t.y, t.r, flashing ? COLORS.danger : color);
            r.circle(t.x, t.y, t.r * 0.55, COLORS.lcdBg);
            r.circle(t.x, t.y, t.r * 0.2, flashing ? COLORS.danger : color);
        }

        this._renderHud();

        if (this.state === S_READY) this._panel('TARGET RANGE', 'TAP TARGETS TO SCORE');
        else if (this.state === S_GAMEOVER) this._panel('TIME UP', `SCORE ${this.score}`);
    }

    _renderHud() {
        const r = this.renderer;
        const y = RANGE_Y + RANGE_H + 6;
        const seconds = Math.ceil(this.timeLeft / 60);
        r.drawText(`TIME ${seconds}`, 4, y, COLORS.white, 'left', 1);
        r.drawText(`SCORE ${this.score}`, CANVAS_WIDTH / 2, y, COLORS.white, 'center', 1);
        r.drawText(`HI ${this.highScore}`, CANVAS_WIDTH - 4, y, COLORS.warn, 'right', 1);
    }

    _panel(title, subtitle) {
        const r = this.renderer;
        const cx = CANVAS_WIDTH / 2;
        const cy = PLAY_TOP + PLAY_HEIGHT / 2 - 20;
        r.rect(20, cy - 20, CANVAS_WIDTH - 40, 44, COLORS.lcdBg);
        r.strokeRect(20, cy - 20, CANVAS_WIDTH - 40, 44, COLORS.accent);
        r.drawText(title, cx, cy - 10, COLORS.accent, 'center', 1);
        r.drawText(subtitle, cx, cy + 4, COLORS.white, 'center', 1);
    }
}
