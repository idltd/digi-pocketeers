// Shared constants for the Pocketeers hub and all games.

export const CANVAS_WIDTH = 240;
export const CANVAS_HEIGHT = 320;

export const FRAME_TIME = 1000 / 60;

// Top status strip (back button, title, mute) reserved above every game's play area.
export const HUD_HEIGHT = 20;
export const PLAY_TOP = HUD_HEIGHT;
export const PLAY_HEIGHT = CANVAS_HEIGHT - HUD_HEIGHT;

export const COLORS = {
    bg: '#0c1210',
    lcdBg: '#1a2b22',
    ink: '#0f3d24',
    accent: '#3ddc84',
    accentDim: '#1f8f52',
    warn: '#e8c547',
    danger: '#d84545',
    white: '#eaf5ee',
};

export const STATE_HUB = 'hub';
export const STATE_GAME = 'game';
export const STATE_TILT_PROMPT = 'tilt_prompt';

// Registered in build order. Each entry: id, title, subtitle, uses tilt?
export const GAME_LIST = [
    { id: 'amazing-maze', title: 'AMAZING MAZE', subtitle: 'TILT TO ROLL', tilt: true },
    { id: 'secret-passage', title: 'SECRET PASSAGE', subtitle: 'TILT TO ROLL', tilt: true },
    { id: 'pachinko', title: 'POCKET PACHINKO', subtitle: 'TILT TO DROP', tilt: true },
    { id: 'derby', title: 'DERBY', subtitle: 'TILT TO STEER', tilt: true },
    { id: 'target-range', title: 'TARGET RANGE', subtitle: 'TAP TO SHOOT', tilt: false },
    { id: 'baseball', title: 'BASEBALL', subtitle: 'SWIPE TO SWING', tilt: false },
    { id: 'pocket-slot', title: 'POCKET SLOT', subtitle: 'TAP TO SPIN', tilt: false },
];
