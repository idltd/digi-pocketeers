import {
    CANVAS_WIDTH, CANVAS_HEIGHT, HUD_HEIGHT, BACK_BUTTON_W,
    FRAME_TIME, COLORS, GAME_LIST, STATE_HUB, STATE_GAME, STATE_TILT_PROMPT,
} from './constants.js';
import { Renderer } from './renderer.js';
import { input } from './input.js';
import { audio } from './audio.js';
import { particles } from './particles.js';
import { getHighScore, getFlag, setFlag } from './storage.js';
import { createGame } from '../games/index.js';
import { session, roomFromUrl, multiplayerGames, relayAvailable, PLAYING } from './multiplayer.js';
import { hostPhone } from './hostphone.js';
import { qrMatrix } from './qr.js';

// One front page, drawn in the game's own language. Nothing outside this
// canvas ever asks the player to choose anything - not the APK, which is a
// doorway with no controls on it, and not a menu behind a menu. Two panels,
// one tap, and you are in.
//
// There is deliberately no JOIN. A guest never taps their way in: they scan
// the master's code and arrive already in the room. A button here could only
// ever have explained that, and an in-page scanner cannot exist anyway - a
// camera needs a secure context, which the master's plain http is not.
const FRONT = 'front';
const SOLO = 'solo';
const MASTER = 'master';
// Not on the front page - only ever reached by scanning the master's code.
const JOIN = 'join';

const BACK_Y = 18;
const BACK_H = 20;
const LIST_TOP = 46;
const ROW_H = 44;

// Front panels: full width, tall enough to hit with a thumb across a table.
const PANEL_H = 52;
const PANEL_GAP = 12;
const PANEL_FOOTER = 82;
// Where the guest code starts on the second step of hosting.
const ROOM_QR_TOP = 70;
const TITLE_BOTTOM = 34;

class Hub {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.renderer = new Renderer(this.canvas);
        input.attach(this.canvas);
        this.canvas.addEventListener('pointerup', (e) => this._onRawGesture(e));

        this.state = STATE_HUB;
        this.screen = FRONT;
        // The master's screen runs in two numbered steps: join my wifi, then
        // scan to play. Latecomers can be sent back to step one from step two.
        this.masterStep = 'wifi';
        this.listScroll = 0;
        this._dragLastY = null;

        session.on('change', () => this._onSessionChange());
        hostPhone.detect();

        // Arriving with ?room=ABCD means this device just scanned the master's
        // QR with its native camera. It is a guest: no front page, no choice,
        // straight into the room. That is the whole promise of the QR.
        const invited = roomFromUrl();
        if (invited) {
            this.screen = JOIN;
            session.join(invited, null);
        }

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
        // Raising the access point belongs here for the same reason fullscreen
        // does. Android will not let a background service start an activity,
        // so a request made while the browser is in front stalls forever; a
        // navigation out of a real tap is a foreground start, and is allowed.
        if (this.state === STATE_HUB && this.screen === FRONT && this._frontHit(p) === 1
            && hostPhone.present && !hostPhone.hosting) {
            hostPhone.raiseHotspot();
            return;
        }
        if (this.state === STATE_HUB && this.screen === MASTER && this.masterStep === 'wifi'
            && hostPhone.error && p.y > CANVAS_HEIGHT - 40) {
            hostPhone.raiseHotspot();
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

    // --- Front page -------------------------------------------------------

    // Centred in whatever is left under the title rather than pinned to a
    // number. Phone screens run from square-ish to very tall, and three panels
    // hugging the top of a tall one leaves the bottom third looking like the
    // page failed to finish loading.
    _panelTop() {
        const block = 2 * PANEL_H + PANEL_GAP + PANEL_FOOTER;
        return Math.max(TITLE_BOTTOM + 12, TITLE_BOTTOM + (CANVAS_HEIGHT - TITLE_BOTTOM - block) / 2);
    }

    _panelY(i) {
        return this._panelTop() + i * (PANEL_H + PANEL_GAP);
    }

    _frontHit(p) {
        if (p.x < 8 || p.x > CANVAS_WIDTH - 8) return -1;
        for (let i = 0; i < 2; i++) {
            const y = this._panelY(i);
            if (p.y >= y && p.y < y + PANEL_H) return i;
        }
        return -1;
    }

    _updateHub() {
        // Drag-to-scroll runs every frame regardless of tap state, since a real
        // drag exceeds the tap-distance threshold and never sets input.tapped.
        if (this.screen === SOLO) this._updateListScroll();

        const tap = input.tapped ? { x: input.tapX, y: input.tapY } : null;
        if (!tap) return;

        // Fullscreen icon is handled in _onRawGesture; just swallow the tap
        // here so it doesn't fall through to the screens below.
        if (tap.x > CANVAS_WIDTH - 22 && tap.y < 14) {
            input.consumeTap();
            return;
        }

        if (this.screen === FRONT) this._updateFront(tap);
        else if (this.screen === SOLO) this._updateSolo(tap);
        else if (this.screen === MASTER) this._updateMaster(tap);
        else if (this.screen === JOIN) this._updateJoin(tap);
    }

    _updateFront(tap) {
        const hit = this._frontHit(tap);
        if (hit < 0) return;
        input.consumeTap();
        audio.select();
        if (hit === 0) {
            this.screen = SOLO;
            return;
        }
        // The access point itself was already asked for in _onRawGesture,
        // where a tap still counts as the foreground.
        this.screen = MASTER;
        this.masterStep = 'wifi';
        hostPhone.watch();
        if (relayAvailable() && !session.room) session.host(null);
    }

    _backHit(tap) {
        return tap.y >= BACK_Y && tap.y < BACK_Y + BACK_H && tap.x < 64;
    }

    _toFront() {
        audio.tick();
        hostPhone.unwatch();
        this.screen = FRONT;
    }

    // --- Solo -------------------------------------------------------------

    _listMaxScroll() {
        const contentH = GAME_LIST.length * ROW_H;
        const viewportH = CANVAS_HEIGHT - LIST_TOP;
        return Math.max(0, contentH - viewportH);
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

    _updateSolo(tap) {
        if (this._backHit(tap)) {
            input.consumeTap();
            this._toFront();
            return;
        }
        if (!this.rotateTipDismissed && tap.y >= BACK_Y && tap.y < BACK_Y + BACK_H) {
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

    // --- Master -----------------------------------------------------------

    _updateMaster(tap) {
        if (this._backHit(tap)) {
            input.consumeTap();
            session.leave();
            hostPhone.dropHotspot();
            this._toFront();
            return;
        }
        if (!hostPhone.present || !relayAvailable()) return;

        if (this.masterStep === 'wifi') {
            // One button the width of the screen: everyone is on the wifi,
            // move on. A failure puts TRY AGAIN in the same place, and that
            // one is handled in _onRawGesture because it starts an activity.
            if (hostPhone.hosting && !hostPhone.error && tap.y > CANVAS_HEIGHT - 40) {
                input.consumeTap();
                audio.select();
                this.masterStep = 'room';
            }
            return;
        }

        // Step two. The WIFI chip brings step one back for a latecomer.
        if (tap.y >= BACK_Y && tap.y < BACK_Y + BACK_H && tap.x > CANVAS_WIDTH - 64) {
            input.consumeTap();
            audio.tick();
            this.masterStep = 'wifi';
            return;
        }

        const games = multiplayerGames();
        const top = this._gameListTop();
        const i = Math.floor((tap.y - top) / 26);
        if (i >= 0 && i < games.length && session.isHost) {
            input.consumeTap();
            audio.select();
            const game = games[i];
            session.startGame(game.id, game.modes?.[0] ?? 'custom');
        }
    }

    // The guest code takes whatever is left once the address, the sign-up list
    // and the startable games have their room - so those keep their places on
    // any screen and the code grows into the rest.
    _roomQrSize() {
        const games = multiplayerGames().length;
        const below = 36 + Math.min(session.players.length, 4) * 12 + 14 + games * 26 + 6;
        return this._qrSize(ROOM_QR_TOP, below);
    }

    _gameListTop() {
        const players = Math.min(session.players.length, 4);
        return ROOM_QR_TOP + this._roomQrSize() + 36 + players * 12 + 14;
    }

    // --- Join -------------------------------------------------------------

    _updateJoin(tap) {
        if (this._backHit(tap)) {
            input.consumeTap();
            session.leave();
            this._toFront();
        }
    }

    // The master starting a game pulls every other device into it, so react to
    // the session rather than waiting for a tap.
    _onSessionChange() {
        if (session.phase === PLAYING && this.state === STATE_HUB && session.gameId) {
            const meta = GAME_LIST.find((g) => g.id === session.gameId);
            // Multiplayer is served over plain http, so tilt is unavailable -
            // never show the tilt prompt here, just enter.
            if (meta) this._enterGame(meta);
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
        hostPhone.unwatch();
        this.activeMeta = meta;
        this._framesInGame = 0;
        // session is passed always, but a game only looks at it when started
        // from the lobby - solo play leaves it disconnected and unused.
        session.clearGameHandlers();
        this.activeGame = createGame(meta.id, {
            renderer: this.renderer,
            audio,
            input,
            session,
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
                if (this.screen === MASTER) hostPhone.watch();
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

    // --- Drawing ----------------------------------------------------------

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

        if (this.screen === FRONT) this._renderFront();
        else if (this.screen === SOLO) this._renderSolo();
        else if (this.screen === MASTER) this._renderMaster();
        else if (this.screen === JOIN) this._renderJoin();
    }

    // A panel in the same language as the game rows: dark slab, a stroke that
    // breathes, big label, small line underneath saying what it is for.
    _panel(i, label, hint, color, enabled = true) {
        const r = this.renderer;
        const y = this._panelY(i);
        const glow = enabled ? Math.sin(performance.now() / 500 + i * 1.6) * 0.5 + 0.5 : 0;
        r.roundRect(8, y, CANVAS_WIDTH - 16, PANEL_H, 7, COLORS.lcdBg);
        r.strokeRect(8, y, CANVAS_WIDTH - 16, PANEL_H, enabled ? color : COLORS.ink, 1 + glow);
        r.drawText(label, CANVAS_WIDTH / 2, y + 12, enabled ? color : COLORS.ink, 'center', 2);
        r.drawText(hint, CANVAS_WIDTH / 2, y + 36, enabled ? COLORS.accentDim : COLORS.ink, 'center', 1);
    }

    _renderFront() {
        const r = this.renderer;
        const canHost = relayAvailable() && hostPhone.present !== false;

        this._panel(0, 'PLAY SOLO', GAME_LIST.length + ' GAMES ON THIS PHONE', COLORS.accent);
        this._panel(1, 'BE MASTER', canHost ? 'RUN THE TABLE' : 'NEEDS THE HOST APP', COLORS.accent2, canHost);

        // Joining is not a button, so say where it does happen. Somebody
        // holding this phone is either playing alone or running the table;
        // everybody else is at the far end of a camera.
        const footer = this._panelY(1) + PANEL_H + 24;
        r.drawText('JOINING SOMEONE ELSE?', CANVAS_WIDTH / 2, footer, COLORS.accent3, 'center', 1);
        r.drawText('JUST SCAN THEIR CODE', CANVAS_WIDTH / 2, footer + 12, COLORS.accent3, 'center', 1);
        r.drawText('WITH YOUR CAMERA.', CANVAS_WIDTH / 2, footer + 24, COLORS.accent3, 'center', 1);
        if (canHost) {
            r.drawText('NO INTERNET NEEDED.', CANVAS_WIDTH / 2, footer + 44, COLORS.accentDim, 'center', 1);
            r.drawText('GUESTS INSTALL NOTHING.', CANVAS_WIDTH / 2, footer + 56, COLORS.accentDim, 'center', 1);
        } else {
            r.drawText('TO RUN A TABLE YOURSELF,', CANVAS_WIDTH / 2, footer + 44, COLORS.warn, 'center', 1);
            r.drawText('ONE PHONE NEEDS THE APP.', CANVAS_WIDTH / 2, footer + 56, COLORS.warn, 'center', 1);
        }
    }

    _renderBack(label) {
        const r = this.renderer;
        r.roundRect(4, BACK_Y, 58, BACK_H, 5, COLORS.lcdBg);
        r.strokeRect(4, BACK_Y, 58, BACK_H, COLORS.ink);
        r.drawText(label || '< BACK', 33, BACK_Y + 6, COLORS.white, 'center', 1);
    }

    _renderSolo() {
        const r = this.renderer;
        this._renderBack();
        if (!this.rotateTipDismissed) {
            r.drawText('TURN OFF AUTO-ROTATE', CANVAS_WIDTH - 6, BACK_Y + 6, COLORS.warn, 'right', 1);
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

    _renderMaster() {
        this._renderBack('< STOP');

        if (!relayAvailable() || hostPhone.present === false) {
            this._renderNeedsHostApp();
            return;
        }
        if (this.masterStep === 'wifi') this._renderWifiStep();
        else this._renderRoomStep();
    }

    // Shown on the public web build, where nothing is serving these files off a
    // phone and so there is no access point and no relay to talk to.
    _renderNeedsHostApp() {
        const r = this.renderer;
        r.roundRect(16, 70, CANVAS_WIDTH - 32, 108, 6, COLORS.lcdBg);
        r.strokeRect(16, 70, CANVAS_WIDTH - 32, 108, COLORS.warn);
        r.drawText('NEEDS THE HOST APP', CANVAS_WIDTH / 2, 84, COLORS.warn, 'center', 1);
        r.drawText('ONE PHONE AT THE TABLE', CANVAS_WIDTH / 2, 106, COLORS.white, 'center', 1);
        r.drawText('RUNS IT AND SHARES', CANVAS_WIDTH / 2, 118, COLORS.white, 'center', 1);
        r.drawText('ITS OWN WIFI.', CANVAS_WIDTH / 2, 130, COLORS.white, 'center', 1);
        r.drawText('NOBODY ELSE INSTALLS', CANVAS_WIDTH / 2, 152, COLORS.accentDim, 'center', 1);
        r.drawText('ANYTHING AT ALL.', CANVAS_WIDTH / 2, 164, COLORS.accentDim, 'center', 1);
        r.drawText('WORKS WITH NO INTERNET', CANVAS_WIDTH / 2, 196, COLORS.accent3, 'center', 1);
    }

    // Lay a sentence out across as many lines as it needs, breaking on spaces.
    _wrapped(text, top, colour, width = CANVAS_WIDTH - 24, lineHeight = 13) {
        const r = this.renderer;
        const lines = [];
        let line = '';
        for (const word of text.split(/\s+/)) {
            const candidate = line ? line + ' ' + word : word;
            if (line && r.textWidth(candidate, 1) > width) {
                lines.push(line);
                line = word;
            } else {
                line = candidate;
            }
        }
        if (line) lines.push(line);
        lines.forEach((each, i) => {
            r.drawText(each, CANVAS_WIDTH / 2, top + i * lineHeight, colour, 'center', 1);
        });
        return top + lines.length * lineHeight;
    }

    _stepHeading(number, title, color) {
        const r = this.renderer;
        r.drawText('STEP ' + number, CANVAS_WIDTH / 2, 44, COLORS.accentDim, 'center', 1);
        r.drawText(title, CANVAS_WIDTH / 2, 56, color, 'center', 2);
    }

    _bigButton(label, color) {
        const r = this.renderer;
        const y = CANVAS_HEIGHT - 36;
        const glow = Math.sin(performance.now() / 400) * 0.5 + 0.5;
        r.roundRect(16, y, CANVAS_WIDTH - 32, 26, 6, COLORS.lcdBg);
        r.strokeRect(16, y, CANVAS_WIDTH - 32, 26, color, 1 + glow);
        r.drawText(label, CANVAS_WIDTH / 2, y + 9, color, 'center', 1);
    }

    _renderWifiStep() {
        const r = this.renderer;
        this._stepHeading(1, 'JOIN MY WIFI', COLORS.accent2);

        if (hostPhone.error) {
            r.drawText('THE WIFI DID NOT OPEN', CANVAS_WIDTH / 2, 96, COLORS.danger, 'center', 1);
            // Wrapped, not cut. A message chopped mid-word - "could not be
            // reac" - tells somebody standing in a pub nothing at all, and
            // reads as a second bug on top of the first.
            this._wrapped(String(hostPhone.error).toUpperCase(), 114, COLORS.white);
            this._bigButton('TRY AGAIN', COLORS.warn);
            return;
        }
        if (!hostPhone.hosting) {
            const dots = '.'.repeat(1 + Math.floor(performance.now() / 400) % 3);
            r.drawText('OPENING THE WIFI' + dots, CANVAS_WIDTH / 2, 104, COLORS.warn, 'center', 1);
            r.drawText('THIS PHONE STOPS USING', CANVAS_WIDTH / 2, 136, COLORS.accentDim, 'center', 1);
            r.drawText('ANY OTHER WIFI WHILE IT', CANVAS_WIDTH / 2, 148, COLORS.accentDim, 'center', 1);
            r.drawText('IS RUNNING THE TABLE.', CANVAS_WIDTH / 2, 160, COLORS.accentDim, 'center', 1);
            return;
        }

        r.drawText('POINT A CAMERA AT THIS', CANVAS_WIDTH / 2, 74, COLORS.accentDim, 'center', 1);
        const wifiTop = 86;
        const wifiBottom = this._renderQr(hostPhone.wifiQrPayload(), wifiTop, this._qrSize(wifiTop, 76));
        // Android picks the name and the password itself and changes them every
        // session, so these are never read out - they are here only for a
        // camera that will not play and a guest willing to type.
        r.drawText('OR TYPE IT', CANVAS_WIDTH / 2, wifiBottom + 8, COLORS.ink, 'center', 1);
        r.drawText(hostPhone.hotspot.ssid || '', CANVAS_WIDTH / 2, wifiBottom + 20, COLORS.accent2, 'center', 1);
        r.drawText(hostPhone.hotspot.password || '', CANVAS_WIDTH / 2, wifiBottom + 32, COLORS.warn, 'center', 1);
        this._bigButton('EVERYONE ON? NEXT >', COLORS.accent3);
    }

    _renderRoomStep() {
        const r = this.renderer;
        this._stepHeading(2, 'SCAN TO PLAY', COLORS.accent3);
        r.roundRect(CANVAS_WIDTH - 62, BACK_Y, 58, BACK_H, 5, COLORS.lcdBg);
        r.strokeRect(CANVAS_WIDTH - 62, BACK_Y, 58, BACK_H, COLORS.ink);
        r.drawText('WIFI >', CANVAS_WIDTH - 33, BACK_Y + 6, COLORS.accent2, 'center', 1);

        if (!session.connected) {
            r.drawText(session.error ? 'RELAY UNREACHABLE' : 'STARTING THE ROOM...', CANVAS_WIDTH / 2, 110,
                session.error ? COLORS.danger : COLORS.warn, 'center', 1);
            return;
        }

        const roomBottom = this._renderQr(session.joinUrl(), ROOM_QR_TOP, this._roomQrSize());
        // Under the QR so it can be read out if somebody's camera plays up.
        r.drawText(session.joinUrl().replace(/^https?:\/\//, ''), CANVAS_WIDTH / 2, roomBottom + 6, COLORS.accent2, 'center', 1);

        r.drawText('PLAYERS (' + session.players.length + ')', CANVAS_WIDTH / 2, roomBottom + 22, COLORS.accentDim, 'center', 1);
        session.players.slice(0, 4).forEach((p, i) => {
            const mine = session.me && p.id === session.me.id;
            const label = p.name + (p.host ? ' *' : '') + (mine ? ' (YOU)' : '');
            const colour = p.present === false ? COLORS.ink : mine ? COLORS.white : COLORS.accentDim;
            r.drawText(label, CANVAS_WIDTH / 2, roomBottom + 36 + i * 12, colour, 'center', 1);
        });

        this._renderHostGameList();
    }

    _renderJoin() {
        const r = this.renderer;
        this._renderBack();

        // Only ever reached with a room already in hand, from a scanned code.
        r.drawText('ROOM', CANVAS_WIDTH / 2, 48, COLORS.accentDim, 'center', 1);
        r.drawText(session.room, CANVAS_WIDTH / 2, 60, COLORS.warn, 'center', 2);
        if (!session.connected) {
            r.drawText(session.error ? 'CONNECTION FAILED' : 'CONNECTING...', CANVAS_WIDTH / 2, 96,
                session.error ? COLORS.danger : COLORS.warn, 'center', 1);
            return;
        }

        r.drawText('PLAYERS (' + session.players.length + ')', CANVAS_WIDTH / 2, 96, COLORS.accentDim, 'center', 1);
        session.players.slice(0, 6).forEach((p, i) => {
            const mine = session.me && p.id === session.me.id;
            const label = p.name + (p.host ? ' *' : '') + (mine ? ' (YOU)' : '');
            const colour = p.present === false ? COLORS.ink : mine ? COLORS.white : COLORS.accentDim;
            r.drawText(label, CANVAS_WIDTH / 2, 112 + i * 12, colour, 'center', 1);
        });
        r.drawText('WAITING FOR THE MASTER', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 40, COLORS.warn, 'center', 1);
        r.drawText('TO PICK A GAME', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 52, COLORS.warn, 'center', 1);
    }

    // How big a code can be here. It is read across a table, sometimes at arm
    // length by somebody holding a phone at an angle in bad light, so it takes
    // every pixel the screen can spare rather than a polite fixed square.
    _qrSize(top, reserveBelow) {
        const available = CANVAS_HEIGHT - top - reserveBelow;
        return Math.max(72, Math.min(CANVAS_WIDTH - 16, available));
    }

    // A phone screen is emissive, so a QR on it scans easily even in a dim pub -
    // but it still needs true white behind it and a quiet zone, or the dark
    // theme bleeds into the finder patterns and readers give up.
    //
    // Returns the y it finished at, so whatever follows sits under the code
    // that was actually drawn rather than under one assumed to be a fixed size.
    _renderQr(payload, top, size) {
        const r = this.renderer;
        if (!payload) return top;
        if (this._qrPayload !== payload) {
            try {
                this._qr = qrMatrix(payload);
                this._qrError = null;
            } catch (err) {
                this._qr = null;
                this._qrError = (err && err.message) || String(err);
            }
            this._qrPayload = payload;
        }
        if (!this._qr) {
            r.drawText(this._qrError || 'QR UNAVAILABLE', CANVAS_WIDTH / 2, top + 40, COLORS.danger, 'center', 1);
            return top + 56;
        }

        const modules = this._qr.length;
        const QUIET = 4;
        // Whole pixels per module: a fractional scale smears module edges into
        // each other and a reader that would have coped gives up instead.
        const scale = Math.max(2, Math.floor(size / (modules + QUIET * 2)));
        const box = (modules + QUIET * 2) * scale;
        const x0 = Math.round((CANVAS_WIDTH - box) / 2);

        r.rect(x0, top, box, box, '#ffffff');
        const off = QUIET * scale;
        for (let row = 0; row < modules; row++) {
            for (let col = 0; col < modules; col++) {
                if (this._qr[row][col]) {
                    r.rect(x0 + off + col * scale, top + off + row * scale, scale, scale, '#000000');
                }
            }
        }
        return top + box;
    }

    _renderHostGameList() {
        const r = this.renderer;
        const games = multiplayerGames();
        const top = this._gameListTop();

        if (games.length === 0) {
            r.drawText('NO MULTIPLAYER GAMES YET', CANVAS_WIDTH / 2, top, COLORS.warn, 'center', 1);
            return;
        }

        r.drawText('TAP A GAME TO START', CANVAS_WIDTH / 2, top - 14, COLORS.accentDim, 'center', 1);
        games.forEach((g, i) => {
            const y = top + i * 26;
            if (y + 22 > CANVAS_HEIGHT) return;
            const glow = Math.sin(performance.now() / 500 + i) * 0.5 + 0.5;
            r.roundRect(16, y, CANVAS_WIDTH - 32, 22, 4, COLORS.lcdBg);
            r.strokeRect(16, y, CANVAS_WIDTH - 32, 22, COLORS.accent, 1 + glow);
            r.drawText(g.title, CANVAS_WIDTH / 2, y + 6, COLORS.white, 'center', 1);
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
        r.drawText('TAP HERE TO USE', CANVAS_WIDTH / 2, CANVAS_HEIGHT - 60, COLORS.accentDim, 'center', 1);
        r.drawText('DRAG-TO-STEER INSTEAD', CANVAS_WIDTH / 2, CANVAS_HEIGHT - 48, COLORS.accentDim, 'center', 1);

        const secure = input.secureContext ? 'YES' : 'NO - TILT WILL FAIL';
        r.drawText('SECURE PAGE: ' + secure, CANVAS_WIDTH / 2, CANVAS_HEIGHT - 20, input.secureContext ? COLORS.accent3 : COLORS.danger, 'center', 1);
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
                r.drawText('T ' + t.x.toFixed(2) + ',' + t.y.toFixed(2), 2, CANVAS_HEIGHT - 8, COLORS.accentDim, 'left', 1);
            }
        }
    }
}

new Hub();
