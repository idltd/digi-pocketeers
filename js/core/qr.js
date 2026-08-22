// Minimal QR encoder. Byte mode, EC level L, versions 1-5.
//
// Written out rather than pulled from npm because the host phone serves this
// with no internet: a CDN is impossible and a bundler is not worth adding.
//
// Scope is deliberately narrow. Versions 1-5 at level L are all single-block,
// which removes block splitting and interleaving - the fiddliest part of the
// spec - and still carries 108 bytes, several times the ~35 a join URL needs.

const VERSIONS = [
    // size, data codewords, ec codewords, alignment centre (0 = none)
    { size: 21, data: 19, ec: 7, align: 0 },
    { size: 25, data: 34, ec: 10, align: 18 },
    { size: 29, data: 55, ec: 15, align: 22 },
    { size: 33, data: 80, ec: 20, align: 26 },
    { size: 37, data: 108, ec: 26, align: 30 },
];

// --- GF(256) for Reed-Solomon, primitive polynomial 0x11D -----------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
    let x = 1;
    for (let i = 0; i < 255; i++) {
        EXP[i] = x;
        LOG[x] = i;
        x <<= 1;
        if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function mul(a, b) {
    return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

function generatorPoly(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
        const next = new Array(poly.length + 1).fill(0);
        for (let j = 0; j < poly.length; j++) {
            next[j] ^= poly[j];
            next[j + 1] ^= mul(poly[j], EXP[i]);
        }
        poly = next;
    }
    return poly;
}

function ecCodewords(data, count) {
    const gen = generatorPoly(count);
    const rem = new Array(count).fill(0);
    for (const byte of data) {
        const factor = byte ^ rem[0];
        rem.shift();
        rem.push(0);
        for (let i = 0; i < count; i++) rem[i] ^= mul(gen[i + 1], factor);
    }
    return rem;
}

// --- Bit stream -----------------------------------------------------------

function buildCodewords(bytes, version) {
    const spec = VERSIONS[version - 1];
    const bits = [];
    const push = (value, len) => {
        for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
    };

    push(0b0100, 4);        // byte mode
    push(bytes.length, 8);  // count indicator is 8 bits for versions 1-9
    for (const b of bytes) push(b, 8);

    const capacity = spec.data * 8;
    push(0, Math.min(4, capacity - bits.length)); // terminator
    while (bits.length % 8) bits.push(0);

    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
        codewords.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
    }

    // Fill the remainder with the spec's alternating pad bytes.
    const PAD = [0xec, 0x11];
    let padIndex = 0;
    while (codewords.length < spec.data) codewords.push(PAD[padIndex++ % 2]);

    return codewords.concat(ecCodewords(codewords, spec.ec));
}

// --- Matrix ---------------------------------------------------------------

function placeFinder(m, reserved, size, row, col) {
    for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
            const rr = row + r;
            const cc = col + c;
            if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
            const inRing = r >= 0 && r <= 6 && c >= 0 && c <= 6 &&
                (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
            m[rr][cc] = inRing;
            reserved[rr][cc] = true;
        }
    }
}

function buildMatrix(codewords, version, mask) {
    const spec = VERSIONS[version - 1];
    const size = spec.size;
    const m = Array.from({ length: size }, () => new Array(size).fill(false));
    const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

    placeFinder(m, reserved, size, 0, 0);
    placeFinder(m, reserved, size, 0, size - 7);
    placeFinder(m, reserved, size, size - 7, 0);

    // Timing patterns.
    for (let i = 8; i < size - 8; i++) {
        m[6][i] = i % 2 === 0;
        m[i][6] = i % 2 === 0;
        reserved[6][i] = true;
        reserved[i][6] = true;
    }

    // Alignment pattern. For versions 2-5 the only centre that doesn't collide
    // with a finder is the bottom-right one.
    if (spec.align) {
        const a = spec.align;
        for (let r = -2; r <= 2; r++) {
            for (let c = -2; c <= 2; c++) {
                m[a + r][a + c] = Math.max(Math.abs(r), Math.abs(c)) !== 1;
                reserved[a + r][a + c] = true;
            }
        }
    }

    // Dark module, plus reserving the format info areas.
    m[size - 8][8] = true;
    reserved[size - 8][8] = true;
    for (let i = 0; i < 9; i++) {
        if (!reserved[8][i]) reserved[8][i] = true;
        if (!reserved[i][8]) reserved[i][8] = true;
    }
    for (let i = 0; i < 8; i++) {
        reserved[8][size - 1 - i] = true;
        reserved[size - 1 - i][8] = true;
    }

    // Data placement: two-module-wide columns, right to left, zigzagging, and
    // skipping the vertical timing column.
    const maskFn = MASKS[mask];
    let bitIndex = 0;
    let upward = true;
    for (let right = size - 1; right > 0; right -= 2) {
        if (right === 6) right = 5;
        for (let step = 0; step < size; step++) {
            const row = upward ? size - 1 - step : step;
            for (let c = 0; c < 2; c++) {
                const col = right - c;
                if (reserved[row][col]) continue;
                const byte = codewords[bitIndex >> 3];
                let bit = byte === undefined ? 0 : (byte >> (7 - (bitIndex & 7))) & 1;
                if (maskFn(row, col)) bit ^= 1;
                m[row][col] = bit === 1;
                bitIndex++;
            }
        }
        upward = !upward;
    }

    placeFormat(m, size, mask);
    return m;
}

const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function placeFormat(m, size, mask) {
    // EC level L is 0b01. BCH(15,5) with generator 0x537, then the spec's mask.
    let value = (0b01 << 3) | mask;
    let bch = value << 10;
    for (let i = 4; i >= 0; i--) {
        if (bch & (1 << (i + 10))) bch ^= 0x537 << i;
    }
    const bits = ((value << 10) | bch) ^ 0x5412;

    for (let i = 0; i < 15; i++) {
        const bit = ((bits >> i) & 1) === 1;
        // Copy one: around the top-left finder.
        if (i < 6) m[8][i] = bit;
        else if (i < 8) m[8][i + 1] = bit;
        else if (i === 8) m[7][8] = bit;
        else m[14 - i][8] = bit;
        // Copy two: split between the other two finders.
        if (i < 8) m[size - 1 - i][8] = bit;
        else m[8][size - 15 + i] = bit;
    }
}

// --- Mask selection -------------------------------------------------------

function penalty(m) {
    const size = m.length;
    let score = 0;

    // Rule 1: runs of five or more of the same colour.
    for (let i = 0; i < size; i++) {
        for (const horizontal of [true, false]) {
            let run = 1;
            for (let j = 1; j < size; j++) {
                const a = horizontal ? m[i][j] : m[j][i];
                const b = horizontal ? m[i][j - 1] : m[j - 1][i];
                if (a === b) {
                    run++;
                } else {
                    if (run >= 5) score += run - 2;
                    run = 1;
                }
            }
            if (run >= 5) score += run - 2;
        }
    }

    // Rule 2: 2x2 blocks of one colour.
    for (let r = 0; r < size - 1; r++) {
        for (let c = 0; c < size - 1; c++) {
            const v = m[r][c];
            if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
        }
    }

    // Rule 3: finder-like 1:1:3:1:1 patterns.
    const A = [true, false, true, true, true, false, true, false, false, false, false];
    const B = [false, false, false, false, true, false, true, true, true, false, true];
    for (let r = 0; r < size; r++) {
        for (let c = 0; c <= size - 11; c++) {
            let ha = true, hb = true, va = true, vb = true;
            for (let k = 0; k < 11; k++) {
                if (m[r][c + k] !== A[k]) ha = false;
                if (m[r][c + k] !== B[k]) hb = false;
                if (m[c + k][r] !== A[k]) va = false;
                if (m[c + k][r] !== B[k]) vb = false;
            }
            if (ha) score += 40;
            if (hb) score += 40;
            if (va) score += 40;
            if (vb) score += 40;
        }
    }

    // Rule 4: deviation from an even split of dark and light.
    let dark = 0;
    for (const row of m) for (const v of row) if (v) dark++;
    const pct = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;

    return score;
}

// --- Public ---------------------------------------------------------------

/**
 * Encode text as a QR matrix.
 * @returns {boolean[][]} rows of modules, true = dark. Caller adds the quiet zone.
 */
export function qrMatrix(text) {
    const bytes = [...new TextEncoder().encode(text)];

    // Byte mode overhead is 4 bits of mode plus an 8-bit count, so 2 codewords.
    const version = VERSIONS.findIndex((v) => bytes.length + 2 <= v.data) + 1;
    if (version === 0) throw new Error(`QR: ${bytes.length} bytes is too long for version 5`);

    const codewords = buildCodewords(bytes, version);

    let best = null;
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
        const m = buildMatrix(codewords, version, mask);
        const score = penalty(m);
        if (score < bestScore) {
            bestScore = score;
            best = m;
        }
    }
    return best;
}
