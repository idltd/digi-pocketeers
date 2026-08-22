// Procedural sound effects via Web Audio API. No sound files.

// Real recordings of a pig, used for the Racing Pigs snort. Synthesis never
// convincingly sounds like an animal, so drop files in at these paths and they
// take over automatically. Any that are missing are skipped, so one is enough
// and four sounds noticeably less repetitive - a burst picks at random.
//
// Deliberately NOT in sw.js's precache list: that uses cache.addAll, which
// rejects wholesale if any single entry 404s, and would take the whole service
// worker down when a file is absent. The fetch handler caches them on demand.
const SNORT_SAMPLES = [
    './assets/audio/oink1.mp3',
    './assets/audio/oink2.mp3',
    './assets/audio/oink3.mp3',
    './assets/audio/oink4.mp3',
];

class PocketAudio {
    constructor() {
        this.ctx = null;
        this.muted = false;
        this._initialized = false;
        this._snorts = [];
    }

    init() {
        if (this._initialized) return;
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this._initialized = true;
        this._loadSnorts();
    }

    // Fire-and-forget: the synth fallback covers the gap until these land, and
    // a missing or undecodable file must never break audio for everything else.
    async _loadSnorts() {
        const loaded = await Promise.all(SNORT_SAMPLES.map(async (url) => {
            try {
                const res = await fetch(url);
                if (!res.ok) return null;
                return await this.ctx.decodeAudioData(await res.arrayBuffer());
            } catch {
                return null;
            }
        }));
        this._snorts = loaded.filter(Boolean);
    }

    _playSample(buffer, at, volume = 0.9, rate = 1) {
        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = rate;
        const g = this.ctx.createGain();
        g.gain.value = volume;
        src.connect(g);
        g.connect(this.ctx.destination);
        src.start(at);
        return buffer.duration / rate;
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

    // Cached because an oink builds several nodes and a burst fires up to four
    // of them, on a phone, mid-race.
    _noiseBuffer() {
        if (this._noiseBuf) return this._noiseBuf;
        const len = this.ctx.sampleRate * 0.25;
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this._noiseBuf = buf;
        return buf;
    }

    // Soft clipping. A clean sawtooth sounds electronic; an animal voice is
    // driven and slightly broken up, and this is what supplies that rasp.
    _grindCurve() {
        if (this._grind) return this._grind;
        const n = 1024;
        const curve = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const x = (i / (n - 1)) * 2 - 1;
            curve[i] = Math.tanh(x * 4) / Math.tanh(4);
        }
        this._grind = curve;
        return curve;
    }

    // One grunt, scheduled at an absolute context time so a burst keeps its
    // rhythm (setTimeout drifts badly under a busy rAF loop).
    //
    // Three layers, and it needs all three: a low sawtooth for the vocal-fold
    // buzz, a bandpass swept up then down across it for the vowel - that
    // sweep is what makes it "oink" rather than beep - and a little filtered
    // noise for breath.
    _oink(at, base = 150, dur = 0.14, volume = 0.22) {
        const ctx = this.ctx;

        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        // Pitch arcs up then drops away, the shape of the call itself.
        osc.frequency.setValueAtTime(base * 0.85, at);
        osc.frequency.linearRampToValueAtTime(base * 1.45, at + dur * 0.22);
        osc.frequency.linearRampToValueAtTime(base * 0.6, at + dur);

        const shaper = ctx.createWaveShaper();
        shaper.curve = this._grindCurve();

        const formant = ctx.createBiquadFilter();
        formant.type = 'bandpass';
        formant.Q.value = 3.2;
        formant.frequency.setValueAtTime(420, at);
        formant.frequency.linearRampToValueAtTime(980, at + dur * 0.3);
        formant.frequency.linearRampToValueAtTime(360, at + dur);

        const env = ctx.createGain();
        // Snappy attack, quick fall - a grunt is a thump of air, not a note.
        env.gain.setValueAtTime(0.0001, at);
        env.gain.exponentialRampToValueAtTime(volume, at + 0.012);
        env.gain.exponentialRampToValueAtTime(0.0001, at + dur);

        osc.connect(shaper);
        shaper.connect(formant);
        formant.connect(env);
        env.connect(ctx.destination);
        osc.start(at);
        osc.stop(at + dur + 0.02);

        const breath = ctx.createBufferSource();
        breath.buffer = this._noiseBuffer();
        const bf = ctx.createBiquadFilter();
        bf.type = 'bandpass';
        bf.frequency.value = 1400;
        bf.Q.value = 0.8;
        const bg = ctx.createGain();
        bg.gain.setValueAtTime(volume * 0.35, at);
        bg.gain.exponentialRampToValueAtTime(0.0001, at + dur * 0.8);
        breath.connect(bf);
        bf.connect(bg);
        bg.connect(ctx.destination);
        breath.start(at);
        breath.stop(at + dur);
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
    // A pig stopping doesn't grunt once, it lets off a little burst - so fire
    // two to four, each a bit lower and quicker than the last, the way a real
    // one trails off. Returns how long the burst lasts so the caller can hold
    // the pig still (and its snort puff up) for exactly that long.
    honk() {
        if (!this.ctx || this.muted) return 0;
        const count = 2 + Math.floor(Math.random() * 3);
        const start = this.ctx.currentTime;
        let at = start;

        if (this._snorts.length > 0) {
            for (let i = 0; i < count; i++) {
                const buf = this._snorts[Math.floor(Math.random() * this._snorts.length)];
                // Vary the pitch a little per grunt, or a repeated sample gives
                // the game away immediately.
                const rate = 0.9 + Math.random() * 0.25;
                const dur = this._playSample(buf, at, 0.9 - i * 0.08, rate);
                at += dur + 0.05 + Math.random() * 0.06;
            }
            return at - start;
        }

        const base = 135 + Math.random() * 45;
        for (let i = 0; i < count; i++) {
            const dur = 0.15 - i * 0.02;
            this._oink(at, base * (1 - i * 0.09), dur, 0.22 - i * 0.02);
            at += dur + 0.055 + Math.random() * 0.04;
        }
        return at - start;
    }
}

export const audio = new PocketAudio();
