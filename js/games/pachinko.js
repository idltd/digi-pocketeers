import { CANVAS_WIDTH, PLAY_TOP, PLAY_HEIGHT, COLORS } from '../core/constants.js';
import { getHighScore, setHighScore } from '../core/storage.js';

const GAME_ID = 'pachinko';

const BOARD_X = 14;
const BOARD_Y = PLAY_TOP + 10;
const BOARD_W = CANVAS_WIDTH - 28;
const BOARD_H = PLAY_HEIGHT - 60;

const PEG_R = 2.5;
const BALL_R = 4;
const GRAVITY = 0.07;
const SIDE_ACCEL = 0.05;
const MAX_SPEED = 3.4;
const RESTITUTION = 0.55;

const BALLS_PER_ROUND = 7;
const SLOT_VALUES = [10, 50, 200, 1000, 200, 50, 10];

const S_READY = 'ready';
const S_PLAYING = 'playing';
const S_SLOTTED = 'slotted';
const S_GAMEOVER = 'gameover';

export class PachinkoGame {
    constructor(deps) {
        this.renderer = deps.renderer;
        this.audio = deps.audio;
        this.input = deps.input;
        this.highScore = getHighScore(GAME_ID);
        this._buildPegs();
    }

    enter() {
        this.score = 0;
        this.ballsLeft = BALLS_PER_ROUND;
        this.lastSlot = -1;
        this.lastValue = 0;
        this.state = S_READY;
        this._stateTimer = 40;
    }

    _buildPegs() {
        this.pegs = [];
        const rows = 8;
        const rowSpacing = BOARD_H / (rows + 1);
        for (let row = 0; row < rows; row++) {
            const y = BOARD_Y + rowSpacing * (row + 1);
            const count = row % 2 === 0 ? 6 : 5;
            const spacing = BOARD_W / (count + 1);
            for (let i = 0; i < count; i++) {
                const offset = row % 2 === 0 ? spacing : spacing * 1.5;
                const x = BOARD_X + offset + i * spacing;
                if (x > BOARD_X + 4 && x < BOARD_X + BOARD_W - 4) this.pegs.push({ x, y });
            }
        }
    }

    _spawnBall() {
        this.ballX = BOARD_X + BOARD_W / 2 + (Math.random() * 20 - 10);
        this.ballY = BOARD_Y + 2;
        this.velX = 0;
        this.velY = 0.4;
        this.state = S_PLAYING;
    }

    update() {
        if (this.state === S_READY) {
            this._stateTimer--;
            const tap = this.input.consumeTap();
            if (tap || this._stateTimer <= 0) this._spawnBall();
            return;
        }
        if (this.state === S_SLOTTED) {
            this._stateTimer--;
            if (this._stateTimer <= 0) {
                if (this.ballsLeft <= 0) this._gameOver();
                else this._spawnBall();
            }
            return;
        }
        if (this.state === S_GAMEOVER) {
            const tap = this.input.consumeTap();
            if (tap) this.enter();
            return;
        }

        // S_PLAYING
        const tilt = this.input.getTilt();
        this.velX += tilt.x * SIDE_ACCEL;
        this.velY += GRAVITY;
        const speed = Math.hypot(this.velX, this.velY);
        if (speed > MAX_SPEED) {
            this.velX = (this.velX / speed) * MAX_SPEED;
            this.velY = (this.velY / speed) * MAX_SPEED;
        }
        this.ballX += this.velX;
        this.ballY += this.velY;

        if (this.ballX < BOARD_X + BALL_R) { this.ballX = BOARD_X + BALL_R; this.velX *= -RESTITUTION; }
        if (this.ballX > BOARD_X + BOARD_W - BALL_R) { this.ballX = BOARD_X + BOARD_W - BALL_R; this.velX *= -RESTITUTION; }

        for (const peg of this.pegs) {
            const dx = this.ballX - peg.x, dy = this.ballY - peg.y;
            const dist = Math.hypot(dx, dy);
            const minDist = PEG_R + BALL_R;
            if (dist < minDist && dist > 0.01) {
                const nx = dx / dist, ny = dy / dist;
                this.ballX = peg.x + nx * minDist;
                this.ballY = peg.y + ny * minDist;
                const vn = this.velX * nx + this.velY * ny;
                this.velX -= (1 + RESTITUTION) * vn * nx;
                this.velY -= (1 + RESTITUTION) * vn * ny;
                this.velX += (Math.random() - 0.5) * 0.3;
                this.audio.tick();
            }
        }

        if (this.ballY > BOARD_Y + BOARD_H) {
            const slotW = BOARD_W / SLOT_VALUES.length;
            let slot = Math.floor((this.ballX - BOARD_X) / slotW);
            slot = Math.max(0, Math.min(SLOT_VALUES.length - 1, slot));
            const value = SLOT_VALUES[slot];
            this.score += value;
            this.lastSlot = slot;
            this.lastValue = value;
            this.ballsLeft--;
            this.state = S_SLOTTED;
            this._stateTimer = 55;
            if (value >= 1000) { this.audio.jackpot(); this.input.vibrate([40, 30, 40, 30, 80]); }
            else { this.audio.tap(); this.input.vibrate(30); }
            if (setHighScore(GAME_ID, this.score)) this.highScore = this.score;
        }
    }

    _gameOver() {
        this.state = S_GAMEOVER;
        this.audio.lose();
        if (setHighScore(GAME_ID, this.score)) this.highScore = this.score;
    }

    render() {
        const r = this.renderer;
        r.rect(BOARD_X, BOARD_Y, BOARD_W, BOARD_H, COLORS.lcdBg);
        r.strokeRect(BOARD_X, BOARD_Y, BOARD_W, BOARD_H, COLORS.accentDim);

        for (const peg of this.pegs) r.circle(peg.x, peg.y, PEG_R, COLORS.accentDim);

        if (this.state === S_PLAYING) r.circle(this.ballX, this.ballY, BALL_R, COLORS.white);

        this._renderSlots();
        this._renderHud();

        if (this.state === S_READY) this._panel('POCKET PACHINKO', 'TAP OR TILT TO DROP');
        else if (this.state === S_GAMEOVER) this._panel('OUT OF BALLS', `SCORE ${this.score}`);
    }

    _renderSlots() {
        const r = this.renderer;
        const y = BOARD_Y + BOARD_H;
        const slotW = BOARD_W / SLOT_VALUES.length;
        SLOT_VALUES.forEach((v, i) => {
            const x = BOARD_X + i * slotW;
            const highlighted = this.state === S_SLOTTED && i === this.lastSlot;
            r.strokeRect(x, y, slotW, 16, highlighted ? COLORS.warn : COLORS.ink);
            r.drawText(String(v), x + slotW / 2, y + 5, highlighted ? COLORS.warn : COLORS.accentDim, 'center', 1);
        });
    }

    _renderHud() {
        const r = this.renderer;
        const y = BOARD_Y + BOARD_H + 20;
        r.drawText(`BALLS ${this.ballsLeft}`, 4, y, COLORS.white, 'left', 1);
        r.drawText(`SCORE ${this.score}`, CANVAS_WIDTH / 2, y, COLORS.white, 'center', 1);
        r.drawText(`HI ${this.highScore}`, CANVAS_WIDTH - 4, y, COLORS.warn, 'right', 1);
        if (this.state === S_SLOTTED) {
            r.drawText(`+${this.lastValue}`, CANVAS_WIDTH / 2, y + 12, COLORS.accent, 'center', 1);
        }
    }

    _panel(title, subtitle) {
        const r = this.renderer;
        const cx = CANVAS_WIDTH / 2;
        const cy = PLAY_TOP + PLAY_HEIGHT / 2 - 30;
        r.rect(20, cy - 20, CANVAS_WIDTH - 40, 44, COLORS.lcdBg);
        r.strokeRect(20, cy - 20, CANVAS_WIDTH - 40, 44, COLORS.accent);
        r.drawText(title, cx, cy - 10, COLORS.accent, 'center', 1);
        r.drawText(subtitle, cx, cy + 4, COLORS.white, 'center', 1);
    }
}
