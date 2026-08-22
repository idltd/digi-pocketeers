// Procedurally generates PWA icons (192x192, 512x512) using only Node's built-in zlib.
// Draws a rounded green square with a white maze-ball motif.

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function crc32(buf) {
    let c;
    const table = crc32.table || (crc32.table = (() => {
        const t = [];
        for (let n = 0; n < 256; n++) {
            c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[n] = c;
        }
        return t;
    })());
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function makePNG(size, pixels) {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(size, 0);
    ihdrData.writeUInt32BE(size, 4);
    ihdrData.writeUInt8(8, 8);   // bit depth
    ihdrData.writeUInt8(6, 9);   // color type RGBA
    ihdrData.writeUInt8(0, 10);
    ihdrData.writeUInt8(0, 11);
    ihdrData.writeUInt8(0, 12);
    const ihdr = chunk('IHDR', ihdrData);

    const raw = Buffer.alloc((size * 4 + 1) * size);
    for (let y = 0; y < size; y++) {
        raw[y * (size * 4 + 1)] = 0; // filter: none
        for (let x = 0; x < size; x++) {
            const [r, g, b, a] = pixels(x, y);
            const off = y * (size * 4 + 1) + 1 + x * 4;
            raw[off] = r; raw[off + 1] = g; raw[off + 2] = b; raw[off + 3] = a;
        }
    }
    const idat = chunk('IDAT', zlib.deflateSync(raw, { level: 9 }));
    const iend = chunk('IEND', Buffer.alloc(0));
    return Buffer.concat([signature, ihdr, idat, iend]);
}

function drawIcon(size) {
    const bg = [12, 18, 16, 255];
    const panel = [26, 43, 34, 255];
    const accent = [61, 220, 132, 255];
    const white = [234, 245, 238, 255];

    const margin = size * 0.08;
    const radius = size * 0.18;
    const cx = size / 2, cy = size / 2;

    // Maze-ball motif: a ball at bottom-left rolling toward a goal square at top-right,
    // with two simple wall strokes suggesting a labyrinth corridor.
    const ballR = size * 0.09;
    const ballX = size * 0.32, ballY = size * 0.68;
    const goalX = size * 0.72, goalY = size * 0.3, goalS = size * 0.14;

    function insideRoundedSquare(x, y) {
        const rx = Math.max(margin, Math.min(size - margin, x));
        const ry = Math.max(margin, Math.min(size - margin, y));
        if (x < margin || x > size - margin || y < margin || y > size - margin) {
            const cornerX = x < margin + radius ? margin + radius : (x > size - margin - radius ? size - margin - radius : x);
            const cornerY = y < margin + radius ? margin + radius : (y > size - margin - radius ? size - margin - radius : y);
            const dx = x - cornerX, dy = y - cornerY;
            if (x < margin + radius || x > size - margin - radius) {
                if (y < margin + radius || y > size - margin - radius) {
                    return (dx * dx + dy * dy) <= radius * radius;
                }
            }
            return x >= margin && x <= size - margin && y >= margin && y <= size - margin;
        }
        return true;
    }

    function wallSegment(x, y, x1, y1, x2, y2, thickness) {
        const dx = x2 - x1, dy = y2 - y1;
        const len2 = dx * dx + dy * dy;
        let t = ((x - x1) * dx + (y - y1) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const px = x1 + t * dx, py = y1 + t * dy;
        const distX = x - px, distY = y - py;
        return (distX * distX + distY * distY) <= (thickness * thickness) / 4;
    }

    return (x, y) => {
        if (!insideRoundedSquare(x, y)) return [0, 0, 0, 0];

        const distBall = Math.hypot(x - ballX, y - ballY);
        if (distBall <= ballR) return white;

        if (x >= goalX - goalS / 2 && x <= goalX + goalS / 2 && y >= goalY - goalS / 2 && y <= goalY + goalS / 2) {
            return accent;
        }

        const wallThickness = size * 0.045;
        if (wallSegment(x, y, size * 0.18, size * 0.5, size * 0.55, size * 0.5, wallThickness)) return panel;
        if (wallSegment(x, y, size * 0.55, size * 0.22, size * 0.55, size * 0.5, wallThickness)) return panel;

        return bg;
    };
}

const outDir = path.join(__dirname, 'assets', 'icons');
fs.mkdirSync(outDir, { recursive: true });

for (const size of [192, 512]) {
    const png = makePNG(size, drawIcon(size));
    fs.writeFileSync(path.join(outDir, `icon-${size}.png`), png);
    console.log(`Wrote icon-${size}.png`);
}
