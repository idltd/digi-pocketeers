// Shared constants for the Pocketeers hub and all games.

// Most phone screens are much taller/narrower than a fixed 3:4 box, so a
// hardcoded 240x320 canvas gets letterboxed (black bars) by object-fit:
// contain even outside fullscreen. Match the canvas height to the actual
// viewport's aspect ratio instead, keeping width fixed at 240 so every
// game's width-relative pixel tuning (ball radii, wall thickness, etc.)
// stays valid - only vertical layout needs to be aspect-ratio-agnostic,
// which PLAY_HEIGHT-derived game layouts already are. Clamped to a sane
// range so a desktop window or tablet doesn't produce a bizarre shape.
const viewportRatio = typeof window !== 'undefined' && window.innerWidth
    ? (window.visualViewport?.height || window.innerHeight) / (window.visualViewport?.width || window.innerWidth)
    : 320 / 240;
const CLAMPED_RATIO = Math.max(1.3, Math.min(2.3, viewportRatio));

// Kept in step with sw.js and the APK's versionName, so a phone can be asked
// which build it is actually running without guessing from behaviour.
export const APP_VERSION = '1.3.0';

export const CANVAS_WIDTH = 240;
export const CANVAS_HEIGHT = Math.round(CANVAS_WIDTH * CLAMPED_RATIO);

export const FRAME_TIME = 1000 / 60;

// Top status strip (back button, title, mute) reserved above every game's play area.
// Kept generously tall since the back button lives here and needs a real thumb target.
export const HUD_HEIGHT = 32;
export const BACK_BUTTON_W = 56;
export const PLAY_TOP = HUD_HEIGHT;
export const PLAY_HEIGHT = CANVAS_HEIGHT - HUD_HEIGHT;

// Bright candy-arcade palette: deep purple-navy background, hot-pink primary accent,
// cyan/lime as secondary accents for variety (slot symbols, pachinko pockets, etc).
export const COLORS = {
    bg: '#1a0b2e',
    lcdBg: '#2d1b4e',
    ink: '#4a2f7a',
    accent: '#ff3d81',
    accentDim: '#c9268f',
    accent2: '#00e5ff',
    accent2Dim: '#0098ad',
    accent3: '#7cff6b',
    accent3Dim: '#4fc73f',
    warn: '#ffd23f',
    danger: '#ff4757',
    white: '#fff9fb',
};

export const STATE_HUB = 'hub';
export const STATE_GAME = 'game';
export const STATE_TILT_PROMPT = 'tilt_prompt';

// Registered in build order. Each entry: id, title, subtitle, uses tilt?
export const GAME_LIST = [
    { id: 'amazing-maze', title: 'AMAZING MAZE', subtitle: 'TILT TO ROLL', tilt: true, multiplayer: false },
    { id: 'amazing-maze-race', title: 'MAZE RACE', subtitle: 'RACE THE MAZE', tilt: true, multiplayer: true, modes: ['race'] },
    { id: 'secret-passage', title: 'SECRET PASSAGE', subtitle: 'TILT TO ROLL', tilt: true, multiplayer: false },
    { id: 'pachinko', title: 'POCKET PACHINKO', subtitle: 'TILT TO DROP', tilt: true, multiplayer: false },
    { id: 'derby', title: 'DERBY', subtitle: 'TILT TO STEER', tilt: true, multiplayer: false },
    { id: 'target-range', title: 'TARGET RANGE', subtitle: 'TAP TO SHOOT', tilt: false, multiplayer: false },
    { id: 'target-range-own', title: 'TARGETS (OWN)', subtitle: 'YOUR OWN RANGE', tilt: false, multiplayer: true, modes: ['race'], mpMode: 'own' },
    { id: 'target-range-shared', title: 'TARGETS (SHARED)', subtitle: 'FIRST TO HIT', tilt: false, multiplayer: true, modes: ['custom'], mpMode: 'shared' },
    { id: 'baseball', title: 'BASEBALL', subtitle: 'SWIPE TO SWING', tilt: false, multiplayer: false },
    { id: 'pocket-slot', title: 'POCKET SLOT', subtitle: 'TAP TO SPIN', tilt: false, multiplayer: false },
    { id: 'racing-pigs', title: 'RACING PIGS', subtitle: 'PICK YOUR PIG', tilt: false, multiplayer: true, modes: ['custom'] },
];
