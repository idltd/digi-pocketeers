// The multiplayer session: who is playing, which game, and which of the four
// modes it runs in. Sits between net.js (dumb message transport) and the games.
//
// The host's browser is authoritative for everything. Guests send intents
// ("I pick lane 3", "I tapped") and render whatever state the host broadcasts.
// Guests install nothing - they join the host phone's hotspot and open a page
// - so all game code must arrive over the wire from the host, which is exactly
// what keeps new games from requiring an APK rebuild.

import { GAME_LIST } from './constants.js';
import { net } from './net.js';

// The four modes from the README. A game declares which it supports; the host
// picks one when starting.
export const MODE_TURNS = 'turns';   // one shared state, screen passes round
export const MODE_RACE = 'race';     // same game at once, best outcome wins
export const MODE_MEGA = 'mega';     // at once, and you see everyone's screen
export const MODE_CUSTOM = 'custom'; // bespoke per-game logic

export const LOBBY = 'lobby';       // gathering players, host choosing a game
export const PLAYING = 'playing';
export const RESULTS = 'results';

// Room codes are read off a QR by the guest's native camera app, so they never
// get typed - but they do get read aloud across a noisy pub table, so drop the
// letters that sound or look alike (I/1, O/0, S/5).
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ';
const CODE_LENGTH = 4;

export function makeRoomCode() {
    let out = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
        out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return out;
}

export function multiplayerGames() {
    return GAME_LIST.filter((g) => g.multiplayer);
}

// Multiplayer only exists when the host app is serving these files off its own
// hotspot, which it does over plain http (it has no certificate). The public
// GitHub Pages build is https and has no relay behind it, so offer multiplayer
// only where it can actually work rather than letting it fail on-screen.
export function relayAvailable() {
    return location.protocol !== 'https:';
}

// Read on load: a guest arrives at http://<host-ip>:8080/?room=ABCD having
// scanned the host's QR, so joining needs no typing and no in-page scanner
// (a camera needs a secure context, which http:// is not).
export function roomFromUrl() {
    const code = new URLSearchParams(location.search).get('room');
    return code ? code.toUpperCase() : null;
}

export class Session {
    constructor() {
        this.phase = LOBBY;
        this.room = null;
        this.mode = null;
        this.gameId = null;
        this.players = [];
        this.me = null;
        this.isHost = false;
        this.connected = false;
        this.error = null;

        this._handlers = new Map();
        this._gameHandlers = new Set();

        net.on('status', () => this._onStatus());
        net.on('msg', (m) => this._onMessage(m));
    }

    on(event, fn) {
        if (!this._handlers.has(event)) this._handlers.set(event, new Set());
        this._handlers.get(event).add(fn);
        return () => this._handlers.get(event).delete(fn);
    }

    _emit(event, payload) {
        const set = this._handlers.get(event);
        if (set) for (const fn of set) fn(payload);
    }

    // --- Joining ----------------------------------------------------------

    host(name) {
        this.room = makeRoomCode();
        this.isHost = true;
        net.connect(this.room, name);
        return this.room;
    }

    join(room, name) {
        this.room = room.toUpperCase();
        this.isHost = false;
        net.connect(this.room, name);
    }

    leave() {
        net.disconnect();
        this.phase = LOBBY;
        this.gameId = null;
        this.mode = null;
        this._emit('change', this);
    }

    // The URL a guest's camera should land on. Uses the address they actually
    // reached the host at, so it is right whatever IP the hotspot handed out.
    joinUrl() {
        return `${location.origin}${location.pathname}?room=${this.room}`;
    }

    _onStatus() {
        this.connected = net.connected;
        this.isHost = net.isHost;
        this.players = net.players;
        this.me = net.players.find((p) => p.id === net.id) || null;
        this.error = net.lastError;
        this._emit('change', this);
    }

    // --- Starting a game --------------------------------------------------

    startGame(gameId, mode) {
        if (!this.isHost) return;
        this.gameId = gameId;
        this.mode = mode;
        this.phase = PLAYING;
        // Guests hold no game list of their own worth trusting; the host names
        // the game and the mode, and everyone follows.
        net.send({ k: 'start', gameId, mode });
        this._emit('change', this);
    }

    endGame(results) {
        if (!this.isHost) return;
        this.phase = RESULTS;
        this.results = results;
        net.send({ k: 'end', results });
        this._emit('change', this);
    }

    _onMessage({ from, data }) {
        if (!data || typeof data !== 'object') return;

        switch (data.k) {
            case 'start':
                // Only the host may start; ignore anything else claiming to.
                if (from !== this._hostId()) return;
                this.gameId = data.gameId;
                this.mode = data.mode;
                this.phase = PLAYING;
                this._emit('change', this);
                return;
            case 'end':
                if (from !== this._hostId()) return;
                this.phase = RESULTS;
                this.results = data.results;
                this._emit('change', this);
                return;
            case 'game':
                // Anything game-specific goes straight to the running game.
                for (const fn of this._gameHandlers) fn(from, data.payload);
                return;
        }
    }

    _hostId() {
        return this.players.find((p) => p.host)?.id ?? null;
    }

    // --- Game-facing API --------------------------------------------------
    // A multiplayer game gets this as deps.session and needs nothing else:
    // send() to push, onGameMessage() to receive, and the player list.

    send(payload, to = 'all') {
        net.send({ k: 'game', payload }, to);
    }

    onGameMessage(fn) {
        this._gameHandlers.add(fn);
        return () => this._gameHandlers.delete(fn);
    }

    clearGameHandlers() {
        this._gameHandlers.clear();
    }

    // Which players this device speaks for. Games use it to decide what to
    // render as "yours" and - the reason it exists - which sounds to play, so
    // each phone only ever honks for its own pig.
    isMine(playerId) {
        return this.me !== null && playerId === this.me.id;
    }
}

export const session = new Session();
