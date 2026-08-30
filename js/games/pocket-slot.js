import { CANVAS_WIDTH, PLAY_TOP, PLAY_HEIGHT, COLORS } from '../core/constants.js';
import { getHighScore, setHighScore } from '../core/storage.js';
import { particles } from '../core/particles.js';

const GAME_ID = 'pocket-slot';

// Weighted symbol table: earlier entries are more common, later ones pay more.
const SYMBOLS = [
    { id: 'CHERRY', color: COLORS.danger, pay3: 5, weight: 30 },
    { id: 'LEMON', color: COLORS.warn, pay3: 8, weight: 24 },
    { id: 'BELL', color: COLORS.accentDim, pay3: 15, weight: 16 },
    { id: 'BAR', color: COLORS.white, pay3: 25, weight: 10 },
    { id: 'SEVEN', color: COLORS.accent, pay3: 100, weight: 4 },
];
const WEIGHT_TOTAL = SYMBOLS.reduce((s, sym) => s + sym.weight, 0);

const START_CREDITS = 20;
const SPIN_COST = 1;
const REEL_COUNT = 3;
const REEL_STOP_GAP = 22;
const SPIN_MIN = 30;

const REEL_X = [50, 100, 150];
const REEL_Y = PLAY_TOP + PLAY_HEIGHT / 2 - 40;
const REEL_W = 46;
const REEL_H = 60;

const S_READY = 'ready';
const S_SPINNING = 'spinning';
const S_RESULT = 'result';
const S_GAMEOVER = 'gameover';

function pickSymbol() {
    let roll = Math.random() * WEIGHT_TOTAL;
    for (const sym of SYMBOLS) {
        if (roll < sym.weight) return sym;
        roll -= sym.weight;
    }
    return SYMBOLS[0];
}

export const manifest = [
    { id: 'pocket-slot', title: 'POCKET SLOT', subtitle: 'TAP TO SPIN', tilt: false, multiplayer: false, order: 70 },
];

export { PocketSlotGame as Game };

export class PocketSlotGame {
    constructor(deps) {
        this.renderer = deps.renderer;
        this.audio = deps.audio;
        this.input = deps.input;
        this.highScore = getHighScore(GAME_ID);
    }

    enter() {
        this.credits = START_CREDITS;
        this.reels = [SYMBOLS[0], SYMBOLS[1], SYMBOLS[2]];
        this.state = S_READY;
        this.lastPayout = 0;
    }

    _spin() {
        this.credits -= SPIN_COST;
        this.finalSymbols = [pickSymbol(), pickSymbol(), pickSymbol()];
        this.reelStopFrame = [SPIN_MIN, SPIN_MIN + REEL_STOP_GAP, SPIN_MIN + REEL_STOP_GAP * 2];
        this.spinFrame = 0;
        this.reelStopped = [false, false, false];
        this.state = S_SPINNING;
        this.audio.spin();
    }

    update() {
        if (this.state === S_READY) {
            const tap = this.input.consumeTap();
            if (tap && this.credits >= SPIN_COST) this._spin();
            return;
        }
        if (this.state === S_GAMEOVER) {
            const tap = this.input.consumeTap();
            if (tap) this.enter();
            return;
        }
        if (this.state === S_RESULT) {
            this._stateTimer--;
            const tap = this.input.consumeTap();
            if (tap || this._stateTimer <= 0) {
                if (this.credits < SPIN_COST) this._gameOver();
                else this.state = S_READY;
            }
            return;
        }

        // S_SPINNING
        this.spinFrame++;
        for (let i = 0; i < REEL_COUNT; i++) {
            if (!this.reelStopped[i] && this.spinFrame >= this.reelStopFrame[i]) {
                this.reelStopped[i] = true;
                this.reels[i] = this.finalSymbols[i];
                this.audio.reelStop();
                this.input.vibrate(15);
            }
        }
        if (this.reelStopped.every(Boolean)) {
            this._resolveSpin();
        }
    }

    _resolveSpin() {
        const [a, b, c] = this.reels;
        let payout = 0;
        if (a.id === b.id && b.id === c.id) payout = a.pay3;
        this.lastPayout = payout;
        if (payout > 0) {
            this.credits += payout;
            this.audio[payout >= 100 ? 'jackpot' : 'win']();
            this.input.vibrate(payout >= 100 ? [40, 30, 40, 30, 40, 30, 100] : [30, 20, 30]);
            const cx = REEL_X[1] + REEL_W / 2, cy = REEL_Y + REEL_H / 2;
            if (payout >= 100) this.renderer.shake(3, 14);
            particles.burst(cx, cy, payout >= 100 ? [COLORS.warn, COLORS.accent, COLORS.accent2] : COLORS.accent3, payout >= 100 ? 26 : 12, 2.6);
        } else {
            this.audio.tap();
        }
        if (setHighScore(GAME_ID, this.credits)) this.highScore = this.credits;
        this.state = S_RESULT;
        this._stateTimer = 55;
    }

    _gameOver() {
        this.state = S_GAMEOVER;
        this.audio.lose();
    }

    render() {
        const r = this.renderer;
        const panelX = REEL_X[0] - 14, panelW = REEL_X[2] + REEL_W + 14 - panelX;
        r.rect(panelX, REEL_Y - 14, panelW, REEL_H + 28, COLORS.lcdBg);
        r.strokeRect(panelX, REEL_Y - 14, panelW, REEL_H + 28, COLORS.accentDim);

        for (let i = 0; i < REEL_COUNT; i++) {
            const x = REEL_X[i];
            r.strokeRect(x, REEL_Y, REEL_W, REEL_H, COLORS.ink);
            const spinning = this.state === S_SPINNING && !this.reelStopped[i];
            const sym = spinning ? SYMBOLS[Math.floor((this.spinFrame + i * 3) / 2) % SYMBOLS.length] : this.reels[i];
            this._drawSymbol(x + REEL_W / 2, REEL_Y + REEL_H / 2, sym);
        }

        this._renderHud();

        if (this.state === S_READY) this._panel('POCKET SLOT', this.credits >= SPIN_COST ? 'TAP TO SPIN' : '');
        else if (this.state === S_RESULT) {
            this._panel(this.lastPayout > 0 ? `WIN +${this.lastPayout}` : 'NO WIN', 'TAP TO CONTINUE');
        } else if (this.state === S_GAMEOVER) this._panel('OUT OF CREDITS', `BEST ${this.highScore}`);
    }

    _drawSymbol(cx, cy, sym) {
        const r = this.renderer;
        const ctx = r.ctx;
        r.circle(cx, cy, 14, COLORS.lcdBg);
        r.strokeCircle(cx, cy, 13, sym.color, 2);

        if (sym.id === 'CHERRY') {
            ctx.strokeStyle = COLORS.accent3;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx, cy - 9);
            ctx.quadraticCurveTo(cx - 6, cy - 10, cx - 4, cy - 3);
            ctx.moveTo(cx, cy - 9);
            ctx.quadraticCurveTo(cx + 4, cy - 10, cx + 4, cy - 2);
            ctx.stroke();
            r.circle(cx - 5, cy + 4, 4.5, sym.color);
            r.circle(cx + 4, cy + 5, 4.5, sym.color);
        } else if (sym.id === 'LEMON') {
            ctx.fillStyle = sym.color;
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(-0.4);
            ctx.beginPath();
            ctx.ellipse(0, 0, 9, 6, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        } else if (sym.id === 'BELL') {
            ctx.fillStyle = sym.color;
            ctx.beginPath();
            ctx.arc(cx, cy - 2, 7, Math.PI, 0);
            ctx.lineTo(cx + 9, cy + 6);
            ctx.lineTo(cx - 9, cy + 6);
            ctx.closePath();
            ctx.fill();
            r.rect(cx - 2, cy - 11, 4, 3, sym.color);
            r.circle(cx, cy + 9, 2.5, sym.color);
        } else if (sym.id === 'BAR') {
            r.roundRect(cx - 12, cy - 7, 24, 14, 3, sym.color);
            r.drawText('BAR', cx, cy - 3, COLORS.bg, 'center', 1);
        } else if (sym.id === 'SEVEN') {
            r.drawText('7', cx, cy - 6, sym.color, 'center', 2);
        }
    }

    _renderHud() {
        const r = this.renderer;
        const y = REEL_Y + REEL_H + 30;
        r.drawText(`CREDITS ${this.credits}`, CANVAS_WIDTH / 2, y, COLORS.white, 'center', 1);
        r.drawText(`BEST ${this.highScore}`, CANVAS_WIDTH / 2, y + 12, COLORS.warn, 'center', 1);
    }

    _panel(title, subtitle) {
        const r = this.renderer;
        const cx = CANVAS_WIDTH / 2;
        const cy = REEL_Y + REEL_H + 70;
        r.drawText(title, cx, cy, COLORS.accent, 'center', 1);
        if (subtitle) r.drawText(subtitle, cx, cy + 12, COLORS.white, 'center', 1);
    }
}
