// Does the QR encoder still produce the codes it produced when they were last
// proven readable?
//
// This exists because the previous encoder produced beautiful, structurally
// convincing, completely undecodable codes, and nothing noticed - not a test,
// not a screenshot, not a person looking at it. It was found only when a
// reference decoder was pointed at a perfect render of "HELLO WORLD".
//
//   node tools/qr-check.mjs
//
// The fingerprints below were taken from output confirmed decodable by
// OpenCV's QRCodeDetector. If this fails, the codes on the master's screen
// have almost certainly stopped meaning anything - do not ship it, and do not
// go looking at cameras, screen brightness or how big the code is drawn.
//
// To re-prove readability rather than just stability (needs opencv-python):
//   py -c "import cv2,numpy;..." - render the matrix at ~12px per module with
//   a 4-module quiet zone and run cv2.QRCodeDetector().detectAndDecode on it.

import { createHash } from 'node:crypto';
import { qrMatrix } from '../js/core/qr.js';

const CASES = [
    { text: 'HELLO WORLD', modules: 21, sha: '1e387bd8b7a170bfa73b461bab560d96940b4421c42ed9c4d787a62c0a0166fa' },
    { text: 'http://192.0.2.1:8090/?room=ABCD', modules: 29, sha: '6a2573bbb00b14fc638ab99500cca521606aa8288d98b592d830b1e1689a9589' },
    { text: 'WIFI:T:WPA;S:ExampleNetwork;P:example-password;H:false;;', modules: 33, sha: 'af8b4234929c7b9c96e7e738c15d3e83fb973b559fd186e3e96c15c42f9d7ecd' },
];

function fingerprint(matrix) {
    const rows = matrix.map((row) => row.map((dark) => (dark ? '1' : '0')).join(''));
    return createHash('sha256').update(rows.join('\n')).digest('hex');
}

let failed = 0;
for (const test of CASES) {
    const matrix = qrMatrix(test.text);
    const sha = fingerprint(matrix);
    const sizeOk = matrix.length === test.modules;
    const shaOk = !test.sha || sha === test.sha;
    if (!sizeOk || !shaOk) {
        failed++;
        console.log(`FAIL  ${test.text.slice(0, 40)}`);
        if (!sizeOk) console.log(`      expected ${test.modules} modules, got ${matrix.length}`);
        if (!shaOk) console.log(`      expected ${test.sha}\n           got ${sha}`);
    } else {
        console.log(`ok    ${matrix.length} modules  ${sha.slice(0, 16)}  ${test.text.slice(0, 40)}`);
    }
}

if (failed) {
    console.log(`\n${failed} of ${CASES.length} failed.`);
    process.exit(1);
}
console.log(`\n${CASES.length} codes unchanged.`);
