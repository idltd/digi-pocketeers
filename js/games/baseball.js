import { CANVAS_WIDTH, PLAY_TOP, PLAY_HEIGHT, COLORS } from '../core/constants.js';
import { getHighScore, setHighScore } from '../core/storage.js';

const GAME_ID = 'baseball';

const FIELD_X = 20;
const FIELD_Y = PLAY_TOP + 10;
const FIELD_W = CANVAS_WIDTH - 40;
const FIELD_H = PLAY_HEIGHT - 60;

const HIT_ZONE_Y_RATIO = 0.82;
const HIT_WINDOW = 16;
const MAX_OUTS = 3;
const MAX_STRIKES = 3;

const S_READY = 'ready';
const S_PITCHING = 'pitching';
const S_RESULT = 'result';
const S_GAMEOVER = 'gameover';

export class BaseballGame {
    constructor(deps) {
        this.renderer = deps.renderer;
        this.audio = deps.audio;
        this.input = deps.input;
        this.highScore = getHighScore(GAME_ID);
    }

    enter() {
        this.runs = 0;
        this.outs = 0;
        this.strikes = 0;
        this.pitchCount = 0;
        this.state = S_READY;
        this._stateTimer = 40;
    }

    _hitZoneY() {
        return FIELD_Y + FIELD_H * HIT_ZONE_Y_RATIO;
    }

    _startPitch() {
        this.pitchCount++;
        const speed = 1.6 + Math.min(this.pitchCount * 0.05, 1.8);
        this.ballX = FIELD_X + FIELD_W / 2 + (Math.random() * 40 - 20);
        this.ballDriftX = (Math.random() - 0.5) * 0.6;
        this.ballY = FIELD_Y + 6;
        this.ballSpeed = speed;
        this.state = S_PITCHING;
    }

    update() {
        if (this.state === S_READY) {
            this._stateTimer--;
            const tap = this.input.consumeTap();
            if (tap || this._stateTimer <= 0) this._startPitch();
            return;
        }
        if (this.state === S_GAMEOVER) {
            const tap = this.input.consumeTap();
            if (tap) this.enter();
            return;
        }
        if (this.state === S_RESULT) {
            this._stateTimer--;
            if (this._stateTimer <= 0) {
                if (this.outs >= MAX_OUTS) this._gameOver();
                else this._startPitch();
            }
            return;
        }

        // S_PITCHING
        this.ballY += this.ballSpeed;
        this.ballX += this.ballDriftX;

        const swing = this.input.consumeSwipe() || this.input.consumeTap();
        const zoneY = this._hitZoneY();

        if (swing) {
            const diff = Math.abs(this.ballY - zoneY);
            if (diff < HIT_WINDOW) {
                this._resolveHit(diff);
            } else {
                this._strike('SWING AND MISS');
            }
            return;
        }

        if (this.ballY > zoneY + HIT_WINDOW) {
            this._strike('CALLED STRIKE');
        }
    }

    _resolveHit(diff) {
        let label, runs;
        if (diff < HIT_WINDOW * 0.25) { label = 'HOME RUN!'; runs = 4; }
        else if (diff < HIT_WINDOW * 0.55) { label = 'DOUBLE!'; runs = 2; }
        else { label = 'SINGLE'; runs = 1; }
        this.runs += runs;
        this.strikes = 0;
        this.resultLabel = label;
        this.state = S_RESULT;
        this._stateTimer = 55;
        this.audio.win();
        this.input.vibrate(runs >= 4 ? [30, 20, 30, 20, 60] : 30);
        if (setHighScore(GAME_ID, this.runs)) this.highScore = this.runs;
    }

    _strike(label) {
        this.strikes++;
        this.resultLabel = label;
        this.audio.error();
        if (this.strikes >= MAX_STRIKES) {
            this.outs++;
            this.strikes = 0;
            this.resultLabel += ' - OUT!';
            this.input.vibrate(60);
        }
        this.state = S_RESULT;
        this._stateTimer = 55;
    }

    _gameOver() {
        this.state = S_GAMEOVER;
        this.audio.lose();
        if (setHighScore(GAME_ID, this.runs)) this.highScore = this.runs;
    }

    render() {
        const r = this.renderer;
        r.rect(FIELD_X, FIELD_Y, FIELD_W, FIELD_H, COLORS.lcdBg);
        r.strokeRect(FIELD_X, FIELD_Y, FIELD_W, FIELD_H, COLORS.accentDim);

        const zoneY = this._hitZoneY();
        r.rect(FIELD_X, zoneY - HIT_WINDOW, FIELD_W, HIT_WINDOW * 2, COLORS.ink);
        r.line(FIELD_X, zoneY, FIELD_X + FIELD_W, zoneY, COLORS.accentDim);

        if (this.state === S_PITCHING) {
            r.circle(this.ballX, this.ballY, 4, COLORS.white);
        }

        this._renderHud();

        if (this.state === S_READY) this._panel('BASEBALL', 'SWIPE UP TO SWING');
        else if (this.state === S_RESULT) this._panel(this.resultLabel, `RUNS ${this.runs}`);
        else if (this.state === S_GAMEOVER) this._panel('GAME OVER', `FINAL SCORE ${this.runs}`);
    }

    _renderHud() {
        const r = this.renderer;
        const y = FIELD_Y + FIELD_H + 6;
        r.drawText(`RUNS ${this.runs}`, 4, y, COLORS.white, 'left', 1);
        r.drawText(`OUT ${this.outs}`, CANVAS_WIDTH / 2, y, COLORS.warn, 'center', 1);
        r.drawText(`HI ${this.highScore}`, CANVAS_WIDTH - 4, y, COLORS.warn, 'right', 1);
        r.drawText('K'.repeat(this.strikes) + '-'.repeat(MAX_STRIKES - this.strikes), CANVAS_WIDTH / 2, y + 12, COLORS.danger, 'center', 1);
    }

    _panel(title, subtitle) {
        const r = this.renderer;
        const cx = CANVAS_WIDTH / 2;
        const cy = PLAY_TOP + PLAY_HEIGHT / 2 - 20;
        r.rect(16, cy - 20, CANVAS_WIDTH - 32, 44, COLORS.lcdBg);
        r.strokeRect(16, cy - 20, CANVAS_WIDTH - 32, 44, COLORS.accent);
        r.drawText(title, cx, cy - 10, COLORS.accent, 'center', 1);
        r.drawText(subtitle, cx, cy + 4, COLORS.white, 'center', 1);
    }
}
