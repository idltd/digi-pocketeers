import { CANVAS_WIDTH, PLAY_TOP, PLAY_HEIGHT, COLORS } from '../core/constants.js';
import { getHighScore, setHighScore } from '../core/storage.js';

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
        r.circle(cx, cy, 14, sym.color);
        r.circle(cx, cy, 14, COLORS.lcdBg);
        r.strokeCircle(cx, cy, 12, sym.color, 2);
        r.drawText(sym.id[0], cx, cy - 3, sym.color, 'center', 1);
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
