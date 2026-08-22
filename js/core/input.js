import { CANVAS_WIDTH, CANVAS_HEIGHT } from './constants.js';

// Unified touch/pointer + device-tilt input for all games.
class Input {
    constructor() {
        this.canvas = null;

        // Pointer state (canvas-space coordinates)
        this.pointerDown = false;
        this.pointerX = 0;
        this.pointerY = 0;

        // One-shot tap (down+up within threshold), consumed by whoever reads it first
        this.tapped = false;
        this.tapX = 0;
        this.tapY = 0;

        // Swipe: set on pointerup if the drag exceeded a distance threshold
        this.swiped = false;
        this.swipeDX = 0;
        this.swipeDY = 0;

        // Tilt state, smoothed. x: left(-1)/right(+1), y: back(-1)/forward(+1)
        this.tiltX = 0;
        this.tiltY = 0;
        this.tiltSupported = 'ondeviceorientation' in window;
        this.secureContext = window.isSecureContext;
        this.tiltPermission = 'unknown'; // unknown | granted | denied | unsupported | not-needed
        this._tiltCalibration = null; // { beta, gamma } captured at calibration time

        // Some browsers (e.g. Brave, via its Motion Sensors site setting) block
        // deviceorientation events entirely with no permission prompt and no
        // error - tiltPermission just reports 'granted' and events never fire.
        // Track whether we've ever actually received one so games/hub can tell
        // "granted but silently blocked" apart from "granted and working".
        this.tiltEventReceived = false;

        this._downX = 0;
        this._downY = 0;
        this._downTime = 0;

        this._onOrientation = this._onOrientation.bind(this);
    }

    // Public coordinate transform for callers that need canvas-space coords
    // directly inside a raw DOM event handler (e.g. to call a gesture-gated
    // browser API like requestFullscreen synchronously, before our one-frame-
    // deferred tap processing would otherwise reach it).
    toCanvasCoords(clientX, clientY) {
        return this._toCanvas(clientX, clientY);
    }

    attach(canvas) {
        this.canvas = canvas;
        canvas.addEventListener('pointerdown', (e) => this._onDown(e));
        canvas.addEventListener('pointermove', (e) => this._onMove(e));
        canvas.addEventListener('pointerup', (e) => this._onUp(e));
        canvas.addEventListener('pointerleave', (e) => this._onUp(e));
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    _toCanvas(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const canvasAspect = CANVAS_WIDTH / CANVAS_HEIGHT;
        const rectAspect = rect.width / rect.height;
        let renderWidth, renderHeight, offsetX, offsetY;

        if (rectAspect > canvasAspect) {
            renderHeight = rect.height;
            renderWidth = rect.height * canvasAspect;
            offsetX = (rect.width - renderWidth) / 2;
            offsetY = 0;
        } else {
            renderWidth = rect.width;
            renderHeight = rect.width / canvasAspect;
            offsetX = 0;
            offsetY = (rect.height - renderHeight) / 2;
        }

        return {
            x: ((clientX - rect.left - offsetX) / renderWidth) * CANVAS_WIDTH,
            y: ((clientY - rect.top - offsetY) / renderHeight) * CANVAS_HEIGHT,
        };
    }

    _onDown(e) {
        e.preventDefault();
        const p = this._toCanvas(e.clientX, e.clientY);
        this.pointerDown = true;
        this.pointerX = p.x;
        this.pointerY = p.y;
        this._downX = p.x;
        this._downY = p.y;
        this._downTime = performance.now();
    }

    _onMove(e) {
        if (!this.pointerDown) return;
        e.preventDefault();
        const p = this._toCanvas(e.clientX, e.clientY);
        this.pointerX = p.x;
        this.pointerY = p.y;
    }

    _onUp(e) {
        if (!this.pointerDown) return;
        e.preventDefault();
        const p = this._toCanvas(e.clientX, e.clientY);
        this.pointerDown = false;
        const dx = p.x - this._downX;
        const dy = p.y - this._downY;
        const dist = Math.hypot(dx, dy);
        const elapsed = performance.now() - this._downTime;

        if (dist < 10 && elapsed < 400) {
            this.tapped = true;
            this.tapX = p.x;
            this.tapY = p.y;
        } else if (dist >= 10) {
            this.swiped = true;
            this.swipeDX = dx;
            this.swipeDY = dy;
        }
    }

    // Call once per frame after game logic has read the one-shot flags.
    endFrame() {
        this.tapped = false;
        this.swiped = false;
    }

    consumeTap() {
        if (!this.tapped) return null;
        this.tapped = false;
        return { x: this.tapX, y: this.tapY };
    }

    consumeSwipe() {
        if (!this.swiped) return null;
        this.swiped = false;
        return { dx: this.swipeDX, dy: this.swipeDY };
    }

    // === Tilt ===

    async requestTiltPermission() {
        if (!this.tiltSupported) {
            this.tiltPermission = 'unsupported';
            return 'unsupported';
        }
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                const result = await DeviceOrientationEvent.requestPermission();
                this.tiltPermission = result === 'granted' ? 'granted' : 'denied';
            } catch {
                this.tiltPermission = 'denied';
            }
        } else {
            // Android / desktop: no permission gate needed.
            this.tiltPermission = 'granted';
        }
        if (this.tiltPermission === 'granted') {
            window.addEventListener('deviceorientation', this._onOrientation);
        }
        return this.tiltPermission;
    }

    calibrateTilt() {
        // Zero out current phone rest angle as "neutral" — lets the player hold
        // the phone at a comfortable angle rather than perfectly flat.
        this._tiltCalibration = 'pending';
    }

    _onOrientation(e) {
        this.tiltEventReceived = true;
        if (e.beta === null || e.gamma === null) return;
        if (this._tiltCalibration === 'pending') {
            this._tiltCalibration = { beta: e.beta, gamma: e.gamma };
        }
        const cal = this._tiltCalibration && this._tiltCalibration !== 'pending'
            ? this._tiltCalibration : { beta: 0, gamma: 0 };

        const rawX = (e.gamma - cal.gamma) / 25; // ~25deg = full tilt
        const rawY = (e.beta - cal.beta) / 25;
        const targetX = Math.max(-1, Math.min(1, rawX));
        const targetY = Math.max(-1, Math.min(1, rawY));

        // Light smoothing to tame sensor noise.
        this.tiltX += (targetX - this.tiltX) * 0.35;
        this.tiltY += (targetY - this.tiltY) * 0.35;
    }

    // Tilt-style control for any game: real device tilt when granted, otherwise
    // a drag-to-steer fallback (desktop testing, or permission denied) using
    // pointer position relative to canvas center.
    getTilt() {
        if (this.tiltPermission === 'granted') {
            return { x: this.tiltX, y: this.tiltY };
        }
        if (this.pointerDown) {
            const cx = CANVAS_WIDTH / 2;
            const cy = CANVAS_HEIGHT / 2;
            const x = Math.max(-1, Math.min(1, (this.pointerX - cx) / (CANVAS_WIDTH / 2)));
            const y = Math.max(-1, Math.min(1, (this.pointerY - cy) / (CANVAS_HEIGHT / 2)));
            return { x, y };
        }
        return { x: 0, y: 0 };
    }

    vibrate(pattern) {
        if (navigator.vibrate) navigator.vibrate(pattern);
    }
}

export const input = new Input();
