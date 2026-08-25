// Multiplayer transport.
//
// Everything is relayed through a dumb WebSocket server that knows nothing
// about games - it only keeps rooms and forwards messages. That server is the
// Android host app on the phone that made itself master (see host-app/), which
// serves these very files over its hotspot, so the whole thing works with no
// internet at all in a pub.
//
// Being deliberately dumb is what keeps this swappable: the relay never needs
// updating when a game is added, and a hosted relay could be dropped in later
// by changing nothing but the URL.
//
// Wire protocol (JSON both ways):
//   -> {t:'join', room, name, token, create}
//   <- {t:'welcome', id, host, players}      first joiner of a room is host
//   <- {t:'players', players}                 broadcast on any join/leave
//   -> {t:'relay', to:'all'|<id>, data}
//   <- {t:'msg', from:<id>, data}
//   <- {t:'error', message}

const RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 8000;

// Who this browser is, across a socket that keeps dropping.
//
// A phone at a pub table locks, takes a call, goes in a pocket, walks out of
// range of a hotspot that is sitting on a beermat. Every one of those closes
// the socket. Without a token the relay has no way to tell a returning player
// from a new one, so somebody who glanced at their phone comes back as a
// stranger with no pig - and the table has to start again.
//
// sessionStorage, not localStorage: it is per tab, so two tabs on one phone
// are honestly two players, and it survives the reload and the lock, which is
// the whole point. Where it is unavailable - a locked-down browser, private
// mode on an old iOS - the in-memory value still holds for the life of the
// page, which covers the reconnects that actually happen.
const TOKEN_KEY = 'pocketeers.clientToken';
let memoryToken = null;

function clientToken() {
    if (memoryToken) return memoryToken;
    let token = null;
    try {
        token = sessionStorage.getItem(TOKEN_KEY);
    } catch (_) {
        // Storage disabled. The in-memory token below still does the job.
    }
    if (!token) {
        token = (crypto.randomUUID ? crypto.randomUUID()
            : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
        try { sessionStorage.setItem(TOKEN_KEY, token); } catch (_) {}
    }
    memoryToken = token;
    return token;
}

export class Net {
    constructor() {
        this.ws = null;
        this.room = null;
        this.name = null;
        this.token = clientToken();
        this.create = false;
        this.id = null;
        this.isHost = false;
        this.players = [];
        this.connected = false;
        this.lastError = null;

        this._handlers = new Map();
        this._reconnectDelay = RECONNECT_DELAY;
        this._reconnectTimer = null;
        this._wantOpen = false;
    }

    // --- Event plumbing ---------------------------------------------------
    // Events: 'status' (connected/players/host changed), 'msg' ({from, data}).

    on(event, fn) {
        if (!this._handlers.has(event)) this._handlers.set(event, new Set());
        this._handlers.get(event).add(fn);
        return () => this._handlers.get(event).delete(fn);
    }

    _emit(event, payload) {
        const set = this._handlers.get(event);
        if (!set) return;
        for (const fn of set) fn(payload);
    }

    // --- Connection -------------------------------------------------------

    // Defaults to a relay on the same origin that served the page, which is
    // exactly right when the host app served it. ws: not wss: - the host app
    // has no certificate and installing one is out of scope, which is also
    // why tilt is unavailable in multiplayer.
    static defaultUrl() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${proto}//${location.host}/ws`;
    }

    // create: only the master opens a room. A guest who scans a stale code
    // must be told there is no game rather than silently opening an empty room
    // of their own and sitting in it as its host, which reads as the code
    // having simply been ignored.
    connect(room, name, { create = false, url = Net.defaultUrl() } = {}) {
        this.room = room;
        this.name = name;
        this.create = create;
        this._url = url;
        this._wantOpen = true;
        this._open();
    }

    _open() {
        if (!this._wantOpen) return;
        this._clearReconnect();

        let ws;
        try {
            ws = new WebSocket(this._url);
        } catch (err) {
            this._fail(err.message || String(err));
            return;
        }
        this.ws = ws;

        ws.onopen = () => {
            this.connected = true;
            this.lastError = null;
            this._reconnectDelay = RECONNECT_DELAY;
            // The name is omitted rather than sent as null: a JSON null
            // survives a relay's optString as the literal text "null", and a
            // table of players called null is nobody's idea of a good evening.
            const join = { t: 'join', room: this.room, token: this.token, create: this.create };
            if (this.name) join.name = this.name;
            this._sendRaw(join);
            this._emit('status', this);
        };

        ws.onmessage = (ev) => {
            let m;
            try {
                m = JSON.parse(ev.data);
            } catch {
                return;
            }
            this._onMessage(m);
        };

        // A dropped socket mid-race is normal on a phone hotspot (screen off,
        // walking out of range), so reconnect rather than ending the game. The
        // server keeps the room alive and re-sends state on rejoin.
        ws.onclose = () => {
            this.connected = false;
            this.ws = null;
            this._emit('status', this);
            if (this._wantOpen) this._scheduleReconnect();
        };

        ws.onerror = () => {
            // onclose always follows, which is where reconnect is handled.
            this.lastError = 'connection failed';
        };
    }

    _onMessage(m) {
        switch (m.t) {
            case 'welcome':
                this.id = m.id;
                this.isHost = !!m.host;
                this.players = m.players || [];
                this._emit('status', this);
                break;
            case 'players':
                this.players = m.players || [];
                // The host can change if the original one leaves, so trust the
                // server's view of it rather than the one-off welcome flag.
                const me = this.players.find((p) => p.id === this.id);
                if (me) this.isHost = !!me.host;
                this._emit('status', this);
                break;
            case 'msg':
                this._emit('msg', { from: m.from, data: m.data });
                break;
            case 'error':
                this.lastError = m.message || 'unknown error';
                this._emit('status', this);
                break;
        }
    }

    _scheduleReconnect() {
        this._clearReconnect();
        this._reconnectTimer = setTimeout(() => this._open(), this._reconnectDelay);
        this._reconnectDelay = Math.min(this._reconnectDelay * 2, MAX_RECONNECT_DELAY);
    }

    _clearReconnect() {
        if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
    }

    _fail(message) {
        this.lastError = message;
        this.connected = false;
        this._emit('status', this);
        if (this._wantOpen) this._scheduleReconnect();
    }

    disconnect() {
        this._wantOpen = false;
        this._clearReconnect();
        this.ws?.close();
        this.ws = null;
        this.connected = false;
        this.id = null;
        this.isHost = false;
        this.players = [];
        this._emit('status', this);
    }

    // --- Sending ----------------------------------------------------------

    _sendRaw(obj) {
        if (this.ws?.readyState !== WebSocket.OPEN) return false;
        this.ws.send(JSON.stringify(obj));
        return true;
    }

    send(data, to = 'all') {
        return this._sendRaw({ t: 'relay', to, data });
    }
}

export const net = new Net();
