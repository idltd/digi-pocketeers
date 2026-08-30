import { CANVAS_WIDTH, PLAY_TOP, PLAY_HEIGHT, COLORS } from '../core/constants.js';

class ComingSoonGame {
    constructor(deps, meta) {
        this.deps = deps;
        this.meta = meta;
    }
    enter() {}
    update() {}
    render() {
        const { renderer } = this.deps;
        const cy = PLAY_TOP + PLAY_HEIGHT / 2;
        renderer.drawText(this.meta.title, CANVAS_WIDTH / 2, cy - 10, COLORS.accent, 'center', 2);
        renderer.drawText('COMING SOON', CANVAS_WIDTH / 2, cy + 10, COLORS.white, 'center', 1);
        renderer.drawText('TAP TO GO BACK', CANVAS_WIDTH / 2, cy + 25, COLORS.accentDim, 'center', 1);
    }
}

const GAME_FILES = [
    './amazing-maze.js',
    './secret-passage.js',
    './pachinko.js',
    './derby.js',
    './target-range.js',
    './baseball.js',
    './pocket-slot.js',
    './racing-pigs.js',
];

const BUILT = {};
const entries = [];
for (const path of GAME_FILES) {
    const mod = await import(path);
    for (const entry of mod.manifest) {
        BUILT[entry.id] = mod.Game;
        entries.push(entry);
    }
}
entries.sort((a, b) => a.order - b.order);

export const GAME_LIST = entries;

export function createGame(id, deps) {
    const meta = GAME_LIST.find((g) => g.id === id);
    const GameClass = BUILT[id];
    if (GameClass) return new GameClass(deps, meta);
    return new ComingSoonGame(deps, meta);
}
