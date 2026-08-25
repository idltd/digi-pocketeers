// Turning a string into a grid of black and white squares.
//
// This was a hand-rolled encoder until it was tested. It produced codes that
// looked perfect - three finder patterns, sane timing, believable data - and
// that no reader on earth could decode, including a reference decoder handed a
// flawless 12-pixels-per-module render of a version 1 "HELLO WORLD". An
// encoder gets format info or the error-correction polynomials slightly wrong
// and this is exactly what you get: a structurally convincing code carrying
// nothing. It cost an evening of blaming cameras, screen brightness, code
// size and canvas scaling, in that order.
//
// So the encoding is now Kazuhiko Arase's qrcode-generator - the same MIT
// library already vendored in VBB and rctraining, which has scanned on this
// hardware. Vendored as a file rather than fetched: nothing here may depend on
// a network that, in a pub, will not exist.
//
// Everything above this line stays the drawing's problem; this file only says
// which squares are dark.

import qrcode from './qrcode-generator.js';

// M corrects about 15% and is what phone cameras are tuned for. Higher levels
// buy resilience this does not need - the code is on a bright screen a foot
// away, not printed on a crate in a warehouse - and cost modules, which makes
// each one smaller and is the thing that actually loses a scan.
const ERROR_CORRECTION = 'M';

// Type 0 asks the library for the smallest version the payload fits in, which
// keeps the modules as large as they can be for that string.
const SMALLEST_THAT_FITS = 0;

/**
 * The module grid for a payload: matrix[row][col] is true where the code is
 * dark. Includes no quiet zone - whoever draws it adds that, because how much
 * white to leave depends on what it is being drawn onto.
 */
export function qrMatrix(text) {
    if (typeof text !== 'string' || text.length === 0) {
        throw new Error('nothing to encode');
    }
    const qr = qrcode(SMALLEST_THAT_FITS, ERROR_CORRECTION);
    qr.addData(text);
    qr.make();

    const count = qr.getModuleCount();
    const matrix = [];
    for (let row = 0; row < count; row++) {
        const line = new Array(count);
        for (let col = 0; col < count; col++) {
            line[col] = qr.isDark(row, col);
        }
        matrix.push(line);
    }
    return matrix;
}
