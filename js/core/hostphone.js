// The master's own browser talking to the phone it is running on.
//
// A page cannot raise a Wi-Fi access point - no browser exposes one - so the
// APK does it, and the hub asks. The APK answers /host/status and takes
// /host/stop, both on loopback only, so a guest sitting on the access point
// cannot close the access point they are sitting on.
//
// Starting is the odd one out. Android will not let a background service start
// an activity, so a request made while the browser is in front stalls forever;
// a navigation to pocketeers://hotspot from a tap is a foreground start, and
// is allowed.

const POLL_MS = 700;
const START_TIMEOUT_MS = 25000;

class HostPhone {
    constructor() {
        // null while unknown, then true on a phone running the APK and false
        // on the public web build, where /host/status is a 404.
        this.present = null;
        this.server = null;
        this.hotspot = { state: 'off' };
        this.players = [];
        this.error = null;

        this._timer = null;
        this._watchers = new Set();
        this._askedAt = 0;
    }

    on(fn) {
        this._watchers.add(fn);
        return () => this._watchers.delete(fn);
    }

    _emit() {
        for (const fn of this._watchers) fn(this);
    }

    // Called once on load. A 404 is the answer "public web build", and so is a
    // failure to connect at all.
    async detect() {
        try {
            const response = await fetch('host/status', { cache: 'no-store' });
            if (response.status === 404) { this.present = false; this._emit(); return false; }
            this.present = true;
            this._absorb(await response.json());
            return true;
        } catch (_) {
            this.present = false;
            this._emit();
            return false;
        }
    }

    // Polled only while a screen is actually watching, so a phone sitting in a
    // game is not answering a request every second for nothing.
    watch() {
        if (this._timer || !this.present) return;
        this._timer = setInterval(() => this._poll(), POLL_MS);
        this._poll();
    }

    unwatch() {
        if (!this._timer) return;
        clearInterval(this._timer);
        this._timer = null;
    }

    async _poll() {
        try {
            const response = await fetch('host/status', { cache: 'no-store' });
            if (!response.ok) return;
            this._absorb(await response.json());
        } catch (_) {
            // A poll failing mid-session usually means the access point just
            // came up and reshuffled the interface. Say nothing and try again.
        }
    }

    _absorb(status) {
        this.server = status.server ?? null;
        this.hotspot = status.hotspot ?? { state: 'off' };
        this.players = status.players ?? [];
        if (this.hotspot.state === 'failed') this.error = this.hotspot.message || 'the phone refused';
        else if (this.hotspot.state === 'on') this.error = null;
        // Android can refuse without ever answering, so the wait is bounded
        // rather than open-ended: a readable message beats a spinner forever.
        if (this._askedAt && this.hotspot.state !== 'on' && Date.now() - this._askedAt > START_TIMEOUT_MS) {
            this._askedAt = 0;
            this.error = 'the phone did not open its wifi';
        }
        if (this.hotspot.state === 'on') this._askedAt = 0;
        this._emit();
    }

    get hosting() {
        return this.hotspot.state === 'on';
    }

    // Must be called straight out of a tap handler: it is a foreground start,
    // and that is the whole reason it is a navigation rather than a fetch.
    raiseHotspot() {
        if (!this.present) return;
        this._askedAt = Date.now();
        this.error = null;
        this.hotspot = { state: 'starting', message: 'opening the wifi' };
        this._emit();
        window.location.href = 'pocketeers://hotspot';
    }

    async dropHotspot() {
        if (!this.present) return;
        this._askedAt = 0;
        try { await fetch('host/stop', { cache: 'no-store' }); } catch (_) {}
        this._poll();
    }

    // The address a guest can actually reach. The master's own browser sits on
    // loopback, so its origin is useless to anybody else.
    guestOrigin() {
        if (this.hotspot.state === 'on' && this.hotspot.guestUrl) {
            return this.hotspot.guestUrl.replace(/\/$/, '');
        }
        return null;
    }

    // What a camera needs to join the access point. The APK cannot choose the
    // name or the password - Android generates both, per session - so nobody
    // reads them; they go straight into a QR the stock camera app understands.
    wifiQrPayload() {
        if (this.hotspot.state !== 'on') return null;
        const escape = (s) => String(s).replace(/([\;,":])/g, '\$1');
        return `WIFI:T:WPA;S:${escape(this.hotspot.ssid)};P:${escape(this.hotspot.password)};H:false;;`;
    }
}

export const hostPhone = new HostPhone();
