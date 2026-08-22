import { CANVAS_WIDTH, PLAY_TOP, PLAY_HEIGHT, COLORS } from '../core/constants.js';
import { getHighScore, setHighScore } from '../core/storage.js';
import { particles } from '../core/particles.js';

const GAME_ID = 'derby';

const TRACK_X = 20;
const TRACK_Y = PLAY_TOP + 6;
const TRACK_W = CANVAS_WIDTH - 40;
const TRACK_H = PLAY_HEIGHT - 32;

const RUNNER_R = 6;
const STEER_ACCEL = 0.5;
const STEER_FRICTION = 0.85;

const BASE_SCROLL = 1.6;
const BOOST_SCROLL = 3.2;
const BOOST_FRAMES = 20;
const BOOST_COOLDOWN = 50;

const S_READY = 'ready';
const S_PLAYING = 'playing';
const S_HIT = 'hit';
const S_GAMEOVER = 'gameover';

export class DerbyGame {
    constructor(deps) {
        this.renderer = deps.renderer;
        this.audio = deps.audio;
        this.input = deps.input;
        this.highScore = getHighScore(GAME_ID);
    }

    enter() {
        this.runnerX = TRACK_X + TRACK_W / 2;
        this.runnerVX = 0;
        this.distance = 0;
        this.obstacles = [];
        this._spawnTimer = 60;
        this.boostTimer = 0;
        this.boostCooldown = 0;
        this.state = S_READY;
        this._stateTimer = 40;
    }

    _difficulty() {
        return 1 + this.distance / 4000;
    }

    _spawnObstacle() {
        const w = 18 + Math.random() * 10;
        const x = TRACK_X + Math.random() * (TRACK_W - w);
        this.obstacles.push({ x, y: TRACK_Y - 12, w, h: 10 });
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
        if (this.state === S_HIT) {
            this._stateTimer--;
            if (this._stateTimer <= 0) this._gameOver();
            return;
        }

        // S_PLAYING
        const tap = this.input.consumeTap();
        if (tap && this.boostCooldown <= 0) {
            this.boostTimer = BOOST_FRAMES;
            this.boostCooldown = BOOST_COOLDOWN;
            particles.burst(this.runnerX, TRACK_Y + TRACK_H - 30, COLORS.warn, 8, 1.4);
            this.audio.tick();
        }
        if (this.boostTimer > 0) this.boostTimer--;
        if (this.boostCooldown > 0) this.boostCooldown--;

        const tilt = this.input.getTilt();
        this.runnerVX += tilt.x * STEER_ACCEL;
        this.runnerVX *= STEER_FRICTION;
        this.runnerX += this.runnerVX;
        if (this.runnerX < TRACK_X + RUNNER_R) { this.runnerX = TRACK_X + RUNNER_R; this.runnerVX = 0; }
        if (this.runnerX > TRACK_X + TRACK_W - RUNNER_R) { this.runnerX = TRACK_X + TRACK_W - RUNNER_R; this.runnerVX = 0; }

        const scroll = (this.boostTimer > 0 ? BOOST_SCROLL : BASE_SCROLL) * this._difficulty();
        this.distance += scroll;

        this._spawnTimer -= this._difficulty();
        if (this._spawnTimer <= 0) {
            this._spawnObstacle();
            this._spawnTimer = Math.max(24, 60 - this._difficulty() * 6);
        }

        for (const ob of this.obstacles) ob.y += scroll;
        this.obstacles = this.obstacles.filter((ob) => ob.y < TRACK_Y + TRACK_H + 20);

        for (const ob of this.obstacles) {
            if (this.runnerX + RUNNER_R > ob.x && this.runnerX - RUNNER_R < ob.x + ob.w &&
                TRACK_Y + TRACK_H - 30 + RUNNER_R > ob.y && TRACK_Y + TRACK_H - 30 - RUNNER_R < ob.y + ob.h) {
                this.state = S_HIT;
                this._stateTimer = 40;
                this.audio.wallHit();
                this.input.vibrate(100);
                this.renderer.shake(4, 12);
                particles.burst(this.runnerX, TRACK_Y + TRACK_H - 30, COLORS.danger, 16, 2.6);
                if (setHighScore(GAME_ID, Math.floor(this.distance))) this.highScore = Math.floor(this.distance);
                return;
            }
        }
    }

    _gameOver() {
        this.state = S_GAMEOVER;
        this.audio.lose();
        if (setHighScore(GAME_ID, Math.floor(this.distance))) this.highScore = Math.floor(this.distance);
    }

    render() {
        const r = this.renderer;
        r.rect(TRACK_X, TRACK_Y, TRACK_W, TRACK_H, COLORS.lcdBg);
        r.strokeRect(TRACK_X, TRACK_Y, TRACK_W, TRACK_H, COLORS.accentDim);

        const laneCount = 3;
        for (let i = 1; i < laneCount; i++) {
            const lx = TRACK_X + (TRACK_W / laneCount) * i;
            for (let y = TRACK_Y; y < TRACK_Y + TRACK_H; y += 10) {
                r.rect(lx, (y + Math.floor(this.distance)) % TRACK_H + TRACK_Y - TRACK_H, 1, 4, COLORS.ink);
            }
        }

        for (const ob of this.obstacles) r.rect(ob.x, ob.y, ob.w, ob.h, COLORS.danger);

        const runnerY = TRACK_Y + TRACK_H - 30;
        if (this.state !== S_HIT || Math.floor(this._stateTimer / 3) % 2 === 0) {
            r.circle(this.runnerX, runnerY, RUNNER_R, this.boostTimer > 0 ? COLORS.warn : COLORS.white);
        }

        this._renderHud();

        if (this.state === S_READY) this._panel('DERBY', 'TILT TO STEER, TAP TO DASH');
        else if (this.state === S_GAMEOVER) this._panel('YOU FELL!', `DISTANCE ${Math.floor(this.distance)}`);
    }

    _renderHud() {
        const r = this.renderer;
        const y = TRACK_Y + TRACK_H + 6;
        r.drawText(`DIST ${Math.floor(this.distance)}`, 4, y, COLORS.white, 'left', 1);
        r.drawText(`HI ${this.highScore}`, CANVAS_WIDTH - 4, y, COLORS.warn, 'right', 1);
        const barW = TRACK_W;
        r.rect(TRACK_X, y + 10, barW, 3, COLORS.ink);
        if (this.boostCooldown > 0) {
            r.rect(TRACK_X, y + 10, barW * (1 - this.boostCooldown / BOOST_COOLDOWN), 3, COLORS.accentDim);
        } else {
            r.rect(TRACK_X, y + 10, barW, 3, COLORS.accent);
        }
    }

    _panel(title, subtitle) {
        const r = this.renderer;
        const cx = CANVAS_WIDTH / 2;
        const cy = PLAY_TOP + PLAY_HEIGHT / 2 - 10;
        r.rect(16, cy - 20, CANVAS_WIDTH - 32, 44, COLORS.lcdBg);
        r.strokeRect(16, cy - 20, CANVAS_WIDTH - 32, 44, COLORS.accent);
        r.drawText(title, cx, cy - 10, COLORS.accent, 'center', 1);
        r.drawText(subtitle, cx, cy + 4, COLORS.white, 'center', 1);
    }
}
