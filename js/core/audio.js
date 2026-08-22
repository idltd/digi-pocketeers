// Procedural sound effects via Web Audio API. No sound files.

class PocketAudio {
    constructor() {
        this.ctx = null;
        this.muted = false;
        this._initialized = false;
    }

    init() {
        if (this._initialized) return;
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this._initialized = true;
    }

    resume() {
        if (this.ctx?.state === 'suspended') this.ctx.resume();
    }

    toggleMute() {
        this.muted = !this.muted;
        return this.muted;
    }

    _gain(volume = 0.2) {
        if (!this.ctx || this.muted) return null;
        const g = this.ctx.createGain();
        g.gain.value = volume;
        g.connect(this.ctx.destination);
        return g;
    }

    tone(freq, duration, type = 'square', volume = 0.15, freqEnd = null) {
        if (!this.ctx || this.muted) return;
        const g = this._gain(volume);
        if (!g) return;
        const osc = this.ctx.createOscillator();
        osc.type = type;
        const now = this.ctx.currentTime;
        osc.frequency.setValueAtTime(freq, now);
        if (freqEnd !== null) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), now + duration);
        }
        osc.connect(g);
        g.gain.setValueAtTime(volume, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + duration);
        osc.start(now);
        osc.stop(now + duration);
    }

    notes(freqs, noteDuration = 0.1, type = 'square', volume = 0.15) {
        if (!this.ctx || this.muted) return;
        freqs.forEach((f, i) => {
            setTimeout(() => this.tone(f, noteDuration, type, volume), i * noteDuration * 1000);
        });
    }

    noise(duration = 0.2, volume = 0.2, lowpass = 1200) {
        if (!this.ctx || this.muted) return;
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

        const src = this.ctx.createBufferSource();
        src.buffer = buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = lowpass;

        const g = this._gain(volume);
        if (!g) return;
        const now = this.ctx.currentTime;
        g.gain.setValueAtTime(volume, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + duration);

        src.connect(filter);
        filter.connect(g);
        src.start(now);
        src.stop(now + duration);
    }

    // === Named effects shared across games ===
    tick() { this.tone(1200, 0.04, 'square', 0.08); }
    tap() { this.tone(700, 0.05, 'square', 0.1); }
    wallHit() { this.tone(180, 0.06, 'triangle', 0.12); }
    fall() { this.tone(300, 0.35, 'sawtooth', 0.15, 40); }
    win() { this.notes([523, 659, 784, 1047], 0.09, 'square', 0.15); }
    lose() { this.notes([440, 349, 293, 220], 0.14, 'sawtooth', 0.15); }
    select() { this.tone(500, 0.05, 'square', 0.1, 900); }
    error() { this.tone(120, 0.1, 'triangle', 0.12); }
    shoot() { this.tone(900, 0.08, 'square', 0.1, 200); }
    hit() { this.noise(0.15, 0.18, 1800); }
    spin() { this.tone(220, 0.5, 'sawtooth', 0.06, 400); }
    reelStop() { this.tone(150, 0.08, 'square', 0.12); }
    jackpot() { this.notes([523, 659, 784, 1047, 1319], 0.08, 'square', 0.18); }
    // Pig snort: a short nasal squawk that drops in pitch, with a breathy noise tail.
    honk() {
        this.tone(420, 0.09, 'sawtooth', 0.13, 260);
        setTimeout(() => this.noise(0.07, 0.1, 900), 60);
    }
}

export const audio = new PocketAudio();
