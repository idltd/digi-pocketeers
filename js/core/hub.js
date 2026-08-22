import {
    CANVAS_WIDTH, CANVAS_HEIGHT, HUD_HEIGHT, BACK_BUTTON_W, PLAY_TOP, PLAY_HEIGHT,
    FRAME_TIME, COLORS, GAME_LIST, STATE_HUB, STATE_GAME, STATE_TILT_PROMPT,
} from './constants.js';
import { Renderer } from './renderer.js';
import { input } from './input.js';
import { audio } from './audio.js';
import { particles } from './particles.js';
import { getHighScore, getFlag, setFlag } from './storage.js';
import { createGame } from '../games/index.js';

// Sized generously for the real (taller) font metrics of Fredoka, not the old
// tight 5px bitmap font this layout originally assumed.
const TAB_Y = 18;
const TAB_H = 22;
const STATUS_Y = 50;
const LIST_TOP = 66;
const ROW_H = 44;

class Hub {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.renderer = new Renderer(this.canvas);
        input.attach(this.canvas);
        this.canvas.addEventListener('pointerup', (e) => this._onRawGesture(e));

        this.state = STATE_HUB;
        this.tab = 'solo';
        this.listScroll = 0;
        this._dragLastY = null;
        this.multiplayStub = null;
        this.activeMeta = null;
        this.activeGame = null;
        this.pendingMeta = null;
        this.rotateTipDismissed = getFlag('rotateTipDismissed') === 'true';

        this._lastTime = 0;
        this._accumulator = 0;

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

    // Handled directly on the raw DOM event (not the one-frame-deferred tap
    // system) because gesture-gated browser APIs (Fullscreen, tilt permission
    // on iOS) must be invoked synchronously within the user gesture or some
    // browsers silently reject the call.
    _onRawGesture(e) {
        const p = input.toCanvasCoords(e.clientX, e.clientY);
        if (this.state === STATE_HUB && p.x > CANVAS_WIDTH - 22 && p.y < 14) {
            audio.tick();
            this._toggleFullscreen();
            return;
        }
        if (this.state === STATE_TILT_PROMPT) {
            const cy = CANVAS_HEIGHT / 2;
            if (p.y >= cy + 24 && p.y <= cy + 48 && p.x >= 40 && p.x <= CANVAS_WIDTH - 40) {
                this._requestTiltGesture();
            }
        }
    }

    _toggleFullscreen() {
        this._fullscreenError = null;
        if (!document.fullscreenElement) {
            if (typeof document.documentElement.requestFullscreen !== 'function') {
                this._fullscreenError = 'requestFullscreen() unavailable';
                return;
            }
            document.documentElement.requestFullscreen()
                .then(() => screen.orientation?.lock?.('portrait').catch(() => {}))
                .catch((err) => {
                    this._fullscreenError = (err && err.message) || String(err);
                });
        } else {
            document.exitFullscreen?.().catch(() => {});
        }
    }

    _requestTiltGesture() {
        input.requestTiltPermission().then((result) => {
            if (result === 'granted') input.calibrateTilt();
            this._enterGame(this.pendingMeta);
        });
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
        particles.update();
        if (this.state === STATE_HUB) this._updateHub();
        else if (this.state === STATE_TILT_PROMPT) this._updateTiltPrompt();
        else if (this.state === STATE_GAME) this._updateGame(dt);
    }

    _listMaxScroll() {
        const contentH = GAME_LIST.length * ROW_H;
        const viewportH = CANVAS_HEIGHT - LIST_TOP;
        return Math.max(0, contentH - viewportH);
    }

    _updateHub() {
        // Drag-to-scroll runs every frame regardless of tap state, since a real
        // drag exceeds the tap-distance threshold and never sets input.tapped.
        if (this.tab === 'solo') this._updateListScroll();

        const tap = input.tapped ? { x: input.tapX, y: input.tapY } : null;
        if (!tap) return;

        // Fullscreen icon is handled in _onRawGesture; just swallow the tap here
        // so it doesn't fall through to tab/list hit-testing below.
        if (tap.x > CANVAS_WIDTH - 22 && tap.y < 14) {
            input.consumeTap();
            return;
        }

        // Tab bar.
        if (tap.y >= TAB_Y && tap.y < TAB_Y + TAB_H) {
            input.consumeTap();
            audio.tick();
            this.tab = tap.x < CANVAS_WIDTH / 2 ? 'solo' : 'multiplay';
            this.multiplayStub = null;
            return;
        }

        if (this.tab === 'solo') this._updateSoloList(tap);
        else this._updateMultiplay(tap);
    }

    _updateListScroll() {
        if (input.pointerDown && input.pointerY >= LIST_TOP) {
            if (this._dragLastY === null) this._dragLastY = input.pointerY;
            const dy = input.pointerY - this._dragLastY;
            this.listScroll = Math.max(0, Math.min(this._listMaxScroll(), this.listScroll - dy));
            this._dragLastY = input.pointerY;
        } else {
            this._dragLastY = null;
        }
    }

    _updateSoloList(tap) {
        if (!this.rotateTipDismissed && tap.y >= STATUS_Y - 8 && tap.y < STATUS_Y + 6) {
            input.consumeTap();
            this.rotateTipDismissed = true;
            setFlag('rotateTipDismissed', true);
            return;
        }

        const index = Math.floor((tap.y - LIST_TOP + this.listScroll) / ROW_H);
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

    _updateMultiplay(tap) {
        input.consumeTap();
        if (this.multiplayStub) {
            this.multiplayStub = null;
            return;
        }
        if (tap.y >= 60 && tap.y < 100) {
            audio.select();
            this.multiplayStub = 'master';
        } else if (tap.y >= 110 && tap.y < 150) {
            audio.select();
            this.multiplayStub = 'join';
        }
    }

    async _updateTiltPrompt() {
        const tap = input.consumeTap();
        if (!tap) return;
        if (tap.y > CANVAS_HEIGHT - 60) {
            // Skip / play with drag-to-steer fallback instead.
            this._enterGame(this.pendingMeta);
        }
        // The ALLOW TILT button itself is handled in _onRawGesture.
    }

    _enterGame(meta) {
        particles.clear();
        this.activeMeta = meta;
        this._framesInGame = 0;
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
            if (tap.x < BACK_BUTTON_W) {
                input.consumeTap();
                audio.tick();
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
        this._framesInGame++;
        this.activeGame.update(dt);
    }

    _render() {
        const r = this.renderer;
        r.clear(COLORS.bg);
        if (this.state === STATE_HUB) this._renderHub();
        else if (this.state === STATE_TILT_PROMPT) this._renderTiltPrompt();
        else if (this.state === STATE_GAME) this._renderGame();
        particles.render(r);
    }

    _renderHub() {
        const r = this.renderer;
        r.drawText('DIGI POCKETEERS', CANVAS_WIDTH / 2, 4, COLORS.accent, 'center', 2);
        r.drawText('[ ]', CANVAS_WIDTH - 24, 3, COLORS.accent2, 'left', 1);
        if (this._fullscreenError) {
            r.drawText('FS ERROR: ' + this._fullscreenError, CANVAS_WIDTH / 2, 42, COLORS.danger, 'center', 1);
        }

        const soloOn = this.tab === 'solo';
        r.roundRect(4, TAB_Y, CANVAS_WIDTH / 2 - 6, TAB_H, 4, soloOn ? COLORS.accent : COLORS.lcdBg);
        r.roundRect(CANVAS_WIDTH / 2 + 2, TAB_Y, CANVAS_WIDTH / 2 - 6, TAB_H, 4, !soloOn ? COLORS.accent2 : COLORS.lcdBg);
        r.drawText('SOLO', CANVAS_WIDTH / 4, TAB_Y + 6, soloOn ? COLORS.bg : COLORS.white, 'center', 1);
        r.drawText('MULTIPLAY', (CANVAS_WIDTH * 3) / 4, TAB_Y + 6, !soloOn ? COLORS.bg : COLORS.white, 'center', 1);

        if (this.tab === 'solo') this._renderSoloList();
        else this._renderMultiplay();
    }

    _renderSoloList() {
        const r = this.renderer;
        if (!this.rotateTipDismissed) {
            r.drawText('TIP: TURN OFF AUTO-ROTATE (TAP TO HIDE)', CANVAS_WIDTH / 2, STATUS_Y, COLORS.warn, 'center', 1);
        } else {
            r.drawText('TAP A GAME TO PLAY', CANVAS_WIDTH / 2, STATUS_Y, COLORS.accentDim, 'center', 1);
        }

        const ctx = r.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, LIST_TOP, CANVAS_WIDTH, CANVAS_HEIGHT - LIST_TOP);
        ctx.clip();

        GAME_LIST.forEach((meta, i) => {
            const y = LIST_TOP + i * ROW_H - this.listScroll;
            if (y + ROW_H < LIST_TOP || y > CANVAS_HEIGHT) return;
            const glow = Math.sin(performance.now() / 500 + i) * 0.5 + 0.5;
            const rowColor = i % 3 === 0 ? COLORS.accent : i % 3 === 1 ? COLORS.accent2 : COLORS.accent3;
            r.roundRect(4, y, CANVAS_WIDTH - 8, ROW_H - 6, 6, COLORS.lcdBg);
            r.strokeRect(4, y, CANVAS_WIDTH - 8, ROW_H - 6, rowColor, 1 + glow);
            r.drawText(meta.title, 10, y + 6, COLORS.white, 'left', 1);
            r.drawText(meta.subtitle, 10, y + 22, rowColor, 'left', 1);
            const hs = getHighScore(meta.id);
            if (hs > 0) {
                r.drawText('HI ' + hs, CANVAS_WIDTH - 10, y + 6, COLORS.warn, 'right', 1);
            }
        });
        ctx.restore();

        const maxScroll = this._listMaxScroll();
        if (maxScroll > 0) {
            const viewportH = CANVAS_HEIGHT - LIST_TOP;
            const trackH = viewportH - 4;
            const thumbH = Math.max(16, (viewportH / (viewportH + maxScroll)) * trackH);
            const thumbY = LIST_TOP + 2 + (this.listScroll / maxScroll) * (trackH - thumbH);
            r.roundRect(CANVAS_WIDTH - 4, LIST_TOP + 2, 3, trackH, 1.5, COLORS.ink);
            r.roundRect(CANVAS_WIDTH - 4, thumbY, 3, thumbH, 1.5, COLORS.accent2);
        }
    }

    _renderMultiplay() {
        const r = this.renderer;
        r.roundRect(20, 60, CANVAS_WIDTH - 40, 40, 6, COLORS.lcdBg);
        r.strokeRect(20, 60, CANVAS_WIDTH - 40, 40, COLORS.accent2);
        r.drawText('BECOME MASTER', CANVAS_WIDTH / 2, 76, COLORS.accent2, 'center', 1);
        r.drawText('HOST A LOCAL GAME', CANVAS_WIDTH / 2, 88, COLORS.accentDim, 'center', 1);

        r.roundRect(20, 110, CANVAS_WIDTH - 40, 40, 6, COLORS.lcdBg);
        r.strokeRect(20, 110, CANVAS_WIDTH - 40, 40, COLORS.accent3);
        r.drawText('JOIN GAME', CANVAS_WIDTH / 2, 126, COLORS.accent3, 'center', 1);
        r.drawText('SCAN A HOST QR CODE', CANVAS_WIDTH / 2, 138, COLORS.accentDim, 'center', 1);

        const readyCount = GAME_LIST.filter((g) => g.multiplayer).length;
        r.drawText(`${readyCount} OF ${GAME_LIST.length} GAMES`, CANVAS_WIDTH / 2, 175, COLORS.white, 'center', 1);
        r.drawText('MULTIPLAYER-READY', CANVAS_WIDTH / 2, 187, COLORS.white, 'center', 1);
        r.drawText('MORE ADDED AS GAMES', CANVAS_WIDTH / 2, 203, COLORS.accentDim, 'center', 1);
        r.drawText('ARE CONVERTED', CANVAS_WIDTH / 2, 215, COLORS.accentDim, 'center', 1);

        if (this.multiplayStub) {
            r.rect(16, 230, CANVAS_WIDTH - 32, 60, COLORS.lcdBg);
            r.strokeRect(16, 230, CANVAS_WIDTH - 32, 60, COLORS.warn);
            r.drawText('COMING SOON', CANVAS_WIDTH / 2, 244, COLORS.warn, 'center', 1);
            r.drawText('LOCAL MULTIPLAYER ISN\'T', CANVAS_WIDTH / 2, 258, COLORS.white, 'center', 1);
            r.drawText('BUILT YET - TAP TO CLOSE', CANVAS_WIDTH / 2, 270, COLORS.white, 'center', 1);
        }
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
        r.drawText('TAP HERE TO USE', CANVAS_WIDTH / 2, CANVAS_HEIGHT - 60, COLORS.accentDim, 'center', 1);
        r.drawText('DRAG-TO-STEER INSTEAD', CANVAS_WIDTH / 2, CANVAS_HEIGHT - 48, COLORS.accentDim, 'center', 1);

        const secure = input.secureContext ? 'YES' : 'NO - TILT WILL FAIL';
        r.drawText(`SECURE PAGE: ${secure}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT - 20, input.secureContext ? COLORS.accent3 : COLORS.danger, 'center', 1);
    }

    _renderGame() {
        const r = this.renderer;
        r.rect(0, 0, CANVAS_WIDTH, HUD_HEIGHT, COLORS.lcdBg);
        r.roundRect(3, 4, BACK_BUTTON_W - 8, HUD_HEIGHT - 8, 5, COLORS.ink);
        r.drawText('< BACK', 8, 11, COLORS.white, 'left', 1);
        r.drawText(this.activeMeta.title, CANVAS_WIDTH / 2, 11, COLORS.white, 'center', 1);
        r.drawText(audio.muted ? 'X' : ')', CANVAS_WIDTH - 16, 11, COLORS.white, 'left', 1);
        this.activeGame.render();

        if (this.activeMeta.tilt) {
            const blocked = input.tiltPermission === 'granted' && input.tiltSupported
                && !input.tiltEventReceived && this._framesInGame > 90;
            if (blocked) {
                r.drawText('TILT BLOCKED - CHECK SITE PERMS', 2, CANVAS_HEIGHT - 8, COLORS.danger, 'left', 1);
            } else {
                const t = input.getTilt();
                r.drawText(`T ${t.x.toFixed(2)},${t.y.toFixed(2)}`, 2, CANVAS_HEIGHT - 8, COLORS.accentDim, 'left', 1);
            }
        }
    }
}

new Hub();
