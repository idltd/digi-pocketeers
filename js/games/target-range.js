import { CANVAS_WIDTH, PLAY_TOP, PLAY_HEIGHT, COLORS } from '../core/constants.js';
import { getHighScore, setHighScore } from '../core/storage.js';
import { particles } from '../core/particles.js';

const GAME_ID = 'target-range';

const RANGE_X = 10;
const RANGE_Y = PLAY_TOP + 8;
const RANGE_W = CANVAS_WIDTH - 20;

const ROUND_TIME = 40 * 60;
const TARGET_TTL = 70;
const START_SPAWN_GAP = 55;
const MIN_SPAWN_GAP = 22;

const S_READY = 'ready';
const S_PLAYING = 'playing';
const S_GAMEOVER = 'gameover';

const MARKER_TTL = 15;
const MARKER_SIZE = 8;

export class TargetRangeGame {
    constructor(deps, meta) {
        this.renderer = deps.renderer;
        this.audio = deps.audio;
        this.input = deps.input;
        this.session = deps.session || null;
        this.meta = meta || {};
        this.highScore = getHighScore(meta?.id || GAME_ID);
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
        this._nextTargetId = 0;
        this._tapMarkers = [];

        this.mp = !!(this.session && this.session.connected && this.session.gameId);

        const effectivePlayH = this.mp
            ? this.session.groupHeight - PLAY_TOP
            : PLAY_HEIGHT;
        const playerCount = this.session?.players?.length || 0;
        const scoreboardH = this.mp ? 20 + playerCount * 11 : 20;
        this.rangeH = effectivePlayH - scoreboardH - 8;
        this.mpMode = this.meta.mpMode || null;
        this.scores = {};
        this._syncTick = 0;

        if (this.mp) {
            this._offMessage?.();
            this._offMessage = this.session.onGameMessage((from, msg) => this._onNet(from, msg));
            for (const p of this.session.players) this.scores[p.id] = 0;
            if (this.isHost) this._broadcastScores();
        }
    }

    get isHost() {
        return !!(this.session && this.session.isHost);
    }

    _difficulty() {
        return Math.min(1 + (ROUND_TIME - this.timeLeft) / 1400, 2.5);
    }

    _spawnTarget() {
        const r = Math.max(9, 16 - this._difficulty() * 3);
        const x = RANGE_X + r + Math.random() * (RANGE_W - r * 2);
        const y = RANGE_Y + r + Math.random() * (this.rangeH - r * 2);
        const bonus = Math.random() < 0.15;
        const id = this._nextTargetId++;
        this.targets.push({ id, x, y, r, ttl: TARGET_TTL, bonus });
        return { id, x, y, r, ttl: TARGET_TTL, bonus };
    }

    // --- Networking ----------------------------------------------------------

    _onNet(from, msg) {
        if (!msg) return;

        if (this.mpMode === 'shared') {
            this._onNetShared(from, msg);
        } else {
            this._onNetOwn(from, msg);
        }
    }

    // OWN mode: everyone runs their own targets independently.
    // Host broadcasts clock sync and collects scores.
    _onNetOwn(from, msg) {
        if (this.isHost) {
            if (msg.k === 'score') {
                this.scores[from] = msg.score;
                this._broadcastScores();
            }
            return;
        }

        switch (msg.k) {
            case 'clock':
                this.timeLeft = msg.timeLeft;
                if (msg.state) this.state = msg.state;
                break;
            case 'scores':
                this.scores = msg.scores;
                break;
            case 'gameover':
                this.scores = msg.scores;
                this._gameOver();
                break;
        }
    }

    // SHARED mode: host owns all targets, broadcasts positions.
    // Guests send tap intents, host validates.
    _onNetShared(from, msg) {
        if (this.isHost) {
            if (msg.k === 'tap') {
                if (!this.session.isMine(from)) {
                    this._addMarker(msg.x, msg.y, COLORS.accent2Dim);
                }
                const hitIdx = this.targets.findIndex(
                    (t) => Math.hypot(msg.x - t.x, msg.y - t.y) < t.r
                );
                if (hitIdx >= 0) {
                    const t = this.targets[hitIdx];
                    const value = t.bonus ? 100 : 25;
                    this.scores[from] = (this.scores[from] || 0) + value;
                    this.targets.splice(hitIdx, 1);
                    this.session.send({ k: 'hit', tid: t.id, by: from, x: t.x, y: t.y, bonus: t.bonus });
                    this._broadcastScores();
                    if (this.session.isMine(from)) {
                        this.audio.hit();
                        this.input.vibrate(t.bonus ? [20, 20, 20] : 25);
                        particles.burst(t.x, t.y, t.bonus ? [COLORS.warn, COLORS.accent2] : COLORS.accent, t.bonus ? 18 : 10, 2.2);
                    }
                } else {
                    this.session.send({ k: 'miss', by: from }, from);
                }
            }
            return;
        }

        switch (msg.k) {
            case 'targets':
                this.targets = msg.targets;
                this.timeLeft = msg.timeLeft;
                if (msg.state) this.state = msg.state;
                break;
            case 'hit': {
                const idx = this.targets.findIndex((t) => t.id === msg.tid);
                if (idx >= 0) this.targets.splice(idx, 1);
                if (this.session.isMine(msg.by)) {
                    this.audio.hit();
                    this.input.vibrate(msg.bonus ? [20, 20, 20] : 25);
                } else {
                    this._addMarker(msg.x, msg.y, COLORS.accent2Dim);
                }
                particles.burst(msg.x, msg.y, msg.bonus ? [COLORS.warn, COLORS.accent2] : COLORS.accent, msg.bonus ? 18 : 10, 2.2);
                break;
            }
            case 'miss':
                this.audio.error();
                break;
            case 'scores':
                this.scores = msg.scores;
                break;
            case 'gameover':
                this.scores = msg.scores;
                this._gameOver();
                break;
        }
    }

    _broadcastScores() {
        this.session.send({ k: 'scores', scores: this.scores });
    }

    // --- Update --------------------------------------------------------------

    update() {
        if (this.state === S_READY) {
            this._stateTimer--;
            const tap = this.input.consumeTap();
            if (tap || this._stateTimer <= 0) {
                this.state = S_PLAYING;
                if (this.mp && this.isHost) {
                    this.session.send({ k: 'clock', timeLeft: this.timeLeft, state: S_PLAYING });
                }
            }
            return;
        }
        if (this.state === S_GAMEOVER) {
            const tap = this.input.consumeTap();
            if (tap) {
                if (this.mp && !this.isHost) return;
                this.enter();
                if (this.mp) {
                    for (const p of this.session.players) this.scores[p.id] = 0;
                    this._broadcastScores();
                }
            }
            return;
        }

        for (const m of this._tapMarkers) m.ttl--;
        this._tapMarkers = this._tapMarkers.filter(m => m.ttl > 0);

        if (this.mp) {
            if (this.mpMode === 'shared') this._updateShared();
            else this._updateOwn();
        } else {
            this._updateSolo();
        }
    }

    _updateSolo() {
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
        if (tap) this._handleTap(tap);
    }

    _updateOwn() {
        if (this.isHost) {
            this.timeLeft--;
            if (++this._syncTick % 30 === 0) {
                this.session.send({ k: 'clock', timeLeft: this.timeLeft });
            }
            if (this.timeLeft <= 0) {
                this.scores[this.session.me.id] = this.score;
                this.session.send({ k: 'gameover', scores: this.scores });
                this._gameOver();
                return;
            }
        } else if (this.timeLeft <= 0) {
            return;
        }

        this._spawnTimer -= this._difficulty();
        if (this._spawnTimer <= 0 && this.targets.length < 5) {
            this._spawnTarget();
            this._spawnTimer = Math.max(MIN_SPAWN_GAP, START_SPAWN_GAP - this._difficulty() * 10);
        }

        for (const t of this.targets) t.ttl--;
        this.targets = this.targets.filter((t) => t.ttl > 0);

        const tap = this.input.consumeTap();
        if (tap) {
            this._handleTap(tap);
            if (this.mp) {
                this.scores[this.session.me.id] = this.score;
                this.session.send({ k: 'score', score: this.score });
            }
        }
    }

    _updateShared() {
        if (!this.isHost) {
            const tap = this.input.consumeTap();
            if (tap && tap.y >= RANGE_Y && tap.y <= RANGE_Y + this.rangeH) {
                this._addMarker(tap.x, tap.y, COLORS.white);
                this.session.send({ k: 'tap', x: tap.x, y: tap.y });
            }
            return;
        }

        this.timeLeft--;
        if (this.timeLeft <= 0) {
            this.session.send({ k: 'gameover', scores: this.scores });
            this._gameOver();
            return;
        }

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
        if (tap && tap.y >= RANGE_Y && tap.y <= RANGE_Y + this.rangeH) {
            this._addMarker(tap.x, tap.y, COLORS.white);
            this._onNetShared(this.session.me.id, { k: 'tap', x: tap.x, y: tap.y });
        }

        if (++this._syncTick % 3 === 0) {
            this.session.send({
                k: 'targets',
                targets: this.targets.map((t) => ({ id: t.id, x: t.x, y: t.y, r: t.r, ttl: t.ttl, bonus: t.bonus })),
                timeLeft: this.timeLeft,
            });
        }
    }

    _addMarker(x, y, color) {
        this._tapMarkers.push({ x, y, ttl: MARKER_TTL, color });
    }

    _handleTap(tap) {
        this._addMarker(tap.x, tap.y, COLORS.white);
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
            particles.burst(t.x, t.y, t.bonus ? [COLORS.warn, COLORS.accent2] : COLORS.accent, t.bonus ? 18 : 10, 2.2);
        } else {
            this.audio.error();
        }
    }

    _gameOver() {
        this.state = S_GAMEOVER;
        this.audio.lose();
        const scoreId = this.meta?.id || GAME_ID;
        if (this.mp) {
            const me = this.session.me;
            if (me) this.score = this.scores[me.id] || this.score;
        }
        if (setHighScore(scoreId, this.score)) this.highScore = this.score;
    }

    // --- Render --------------------------------------------------------------

    render() {
        const r = this.renderer;
        r.rect(RANGE_X, RANGE_Y, RANGE_W, this.rangeH, COLORS.lcdBg);
        r.strokeRect(RANGE_X, RANGE_Y, RANGE_W, this.rangeH, COLORS.accentDim);

        for (const t of this.targets) {
            const flashing = t.ttl < 20 && Math.floor(t.ttl / 4) % 2 === 0;
            const color = t.bonus ? COLORS.warn : COLORS.accent;
            r.circle(t.x, t.y, t.r, flashing ? COLORS.danger : color);
            r.circle(t.x, t.y, t.r * 0.55, COLORS.lcdBg);
            r.circle(t.x, t.y, t.r * 0.2, flashing ? COLORS.danger : color);
        }

        this._renderMarkers();
        this._renderHud();

        if (this.state === S_READY) this._panel('TARGET RANGE', this.mp ? (this.mpMode === 'shared' ? 'SHARED TARGETS' : 'OWN TARGETS') : 'TAP TARGETS TO SCORE');
        else if (this.state === S_GAMEOVER) {
            if (this.mp) {
                const winner = this._mpWinner();
                const me = this.session.me;
                const won = winner && me && winner.id === me.id;
                this._panel(won ? 'YOU WON!' : `${winner?.name || 'NOBODY'} WINS`, `SCORE ${this.score}`);
            } else {
                this._panel('TIME UP', `SCORE ${this.score}`);
            }
        }
    }

    _mpWinner() {
        let best = null;
        let bestScore = -1;
        for (const p of this.session.players) {
            const s = this.scores[p.id] || 0;
            if (s > bestScore) { bestScore = s; best = p; }
        }
        return best;
    }

    _renderMarkers() {
        const r = this.renderer;
        const ctx = r.ctx;
        for (const m of this._tapMarkers) {
            const alpha = m.ttl / MARKER_TTL;
            const prevAlpha = ctx.globalAlpha;
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = m.color;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(m.x - MARKER_SIZE, m.y);
            ctx.lineTo(m.x + MARKER_SIZE, m.y);
            ctx.moveTo(m.x, m.y - MARKER_SIZE);
            ctx.lineTo(m.x, m.y + MARKER_SIZE);
            ctx.stroke();
            ctx.globalAlpha = prevAlpha;
        }
    }

    _renderHud() {
        const r = this.renderer;
        const y = RANGE_Y + this.rangeH + 6;
        const seconds = Math.ceil(this.timeLeft / 60);

        if (this.mp) {
            r.drawText(`TIME ${seconds}`, 4, y, COLORS.white, 'left', 1);
            const sorted = this.session.players
                .map((p) => ({ name: p.name || 'P' + p.id.slice(0, 2), score: this.scores[p.id] || 0, mine: this.session.isMine(p.id) }))
                .sort((a, b) => b.score - a.score);
            const scoreY = y + 14;
            sorted.forEach((p, i) => {
                const col = p.mine ? COLORS.warn : COLORS.accentDim;
                r.drawText(`${p.name} ${p.score}`, CANVAS_WIDTH / 2, scoreY + i * 11, col, 'center', 1);
            });
        } else {
            r.drawText(`TIME ${seconds}`, 4, y, COLORS.white, 'left', 1);
            r.drawText(`SCORE ${this.score}`, CANVAS_WIDTH / 2, y, COLORS.white, 'center', 1);
            r.drawText(`HI ${this.highScore}`, CANVAS_WIDTH - 4, y, COLORS.warn, 'right', 1);
        }
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
