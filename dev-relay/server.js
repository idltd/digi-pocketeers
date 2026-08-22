// Development stand-in for the relay that will live inside the Android host
// app. Same wire protocol (see js/core/net.js), so the browser side can be
// built and tested on a PC long before there's an APK.
//
// Deliberately dumb: it knows about rooms and players, and nothing about
// games. Game logic is authoritative on the host's browser, not here - that
// is what lets a new game ship without touching the relay or rebuilding the
// app.
//
// Lives in its own directory with its own package.json on purpose: devbuild's
// Find-ProjectType checks for package.json before index.html, so one at the
// repo root would make `devbuild` misdetect this project as a Node app.

const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8080;
const ROOT = path.resolve(__dirname, '..');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
};

// Serve the app itself as well as the relay, mirroring what the host app does
// - one origin for both means net.js's same-origin default URL just works.
const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const file = path.join(ROOT, rel);

    // Refuse anything that escapes the repo (../../etc/passwd and friends).
    if (!file.startsWith(ROOT)) {
        res.writeHead(403).end('forbidden');
        return;
    }
    fs.readFile(file, (err, buf) => {
        if (err) {
            res.writeHead(404).end('not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(buf);
    });
});

const wss = new WebSocketServer({ server, path: '/ws' });

/** room code -> { players: Map<id, {ws, name}>, hostId } */
const rooms = new Map();
let nextId = 1;

function playerList(room) {
    return [...room.players.entries()].map(([id, p]) => ({
        id,
        name: p.name,
        host: id === room.hostId,
    }));
}

function broadcast(room, obj) {
    const raw = JSON.stringify(obj);
    for (const p of room.players.values()) {
        if (p.ws.readyState === p.ws.OPEN) p.ws.send(raw);
    }
}

function send(ws, obj) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

wss.on('connection', (ws) => {
    let room = null;
    let roomCode = null;
    let id = null;

    ws.on('message', (raw) => {
        let m;
        try {
            m = JSON.parse(raw);
        } catch {
            return;
        }

        if (m.t === 'join') {
            roomCode = String(m.room || '').toUpperCase();
            if (!roomCode) {
                send(ws, { t: 'error', message: 'missing room code' });
                return;
            }
            if (!rooms.has(roomCode)) rooms.set(roomCode, { players: new Map(), hostId: null });
            room = rooms.get(roomCode);

            id = nextId++;
            room.players.set(id, { ws, name: String(m.name || `P${id}`).slice(0, 12) });
            // First one in owns the room; if they leave, the next player is
            // promoted rather than collapsing the game.
            if (room.hostId === null) room.hostId = id;

            send(ws, { t: 'welcome', id, host: id === room.hostId, players: playerList(room) });
            broadcast(room, { t: 'players', players: playerList(room) });
            console.log(`[${roomCode}] +${id} (${room.players.size} in room)`);
            return;
        }

        if (m.t === 'relay' && room) {
            const out = JSON.stringify({ t: 'msg', from: id, data: m.data });
            if (m.to === 'all') {
                for (const [pid, p] of room.players) {
                    if (pid !== id && p.ws.readyState === p.ws.OPEN) p.ws.send(out);
                }
            } else {
                const target = room.players.get(Number(m.to));
                if (target?.ws.readyState === target.ws.OPEN) target.ws.send(out);
            }
        }
    });

    ws.on('close', () => {
        if (!room || id === null) return;
        room.players.delete(id);
        if (room.hostId === id) {
            room.hostId = room.players.keys().next().value ?? null;
        }
        console.log(`[${roomCode}] -${id} (${room.players.size} left)`);
        if (room.players.size === 0) {
            rooms.delete(roomCode);
            return;
        }
        broadcast(room, { t: 'players', players: playerList(room) });
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`dev relay + app on http://localhost:${PORT}  (ws at /ws)`);
    for (const [name, addrs] of Object.entries(require('os').networkInterfaces())) {
        for (const a of addrs || []) {
            if (a.family === 'IPv4' && !a.internal) console.log(`  LAN: http://${a.address}:${PORT}  (${name})`);
        }
    }
});
