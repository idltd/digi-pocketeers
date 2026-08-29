import { GAME_LIST, CANVAS_WIDTH, PLAY_TOP, PLAY_HEIGHT, COLORS } from '../core/constants.js';
import { AmazingMazeGame } from './amazing-maze.js';
import { SecretPassageGame } from './secret-passage.js';
import { PachinkoGame } from './pachinko.js';
import { DerbyGame } from './derby.js';
import { TargetRangeGame } from './target-range.js';
import { BaseballGame } from './baseball.js';
import { PocketSlotGame } from './pocket-slot.js';
import { RacingPigsGame } from './racing-pigs.js';

// Games not yet built fall back to this placeholder so the hub never breaks.
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

const BUILT = {
    'amazing-maze': AmazingMazeGame,
    'amazing-maze-race': AmazingMazeGame,
    'secret-passage': SecretPassageGame,
    'pachinko': PachinkoGame,
    'derby': DerbyGame,
    'target-range': TargetRangeGame,
    'target-range-own': TargetRangeGame,
    'target-range-shared': TargetRangeGame,
    'baseball': BaseballGame,
    'pocket-slot': PocketSlotGame,
    'racing-pigs': RacingPigsGame,
};

export function createGame(id, deps) {
    const meta = GAME_LIST.find((g) => g.id === id);
    const GameClass = BUILT[id];
    if (GameClass) return new GameClass(deps, meta);
    return new ComingSoonGame(deps, meta);
}
