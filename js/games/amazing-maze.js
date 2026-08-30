import { CANVAS_WIDTH, PLAY_TOP, PLAY_HEIGHT, COLORS } from '../core/constants.js';
import { getHighScore, setHighScore } from '../core/storage.js';
import { particles } from '../core/particles.js';

const GAME_ID = 'amazing-maze';

const WALL_T = 4;
const BALL_R = 5;
const GOAL_R = 9;
const HOLE_R = 7;

const ACCEL = 0.09;
const FRICTION = 0.992;
const MAX_SPEED = 2.6;

const START_TIME = 45 * 60;
const MIN_TIME = 22 * 60;

const S_READY = 'ready';
const S_PLAYING = 'playing';
const S_FALLING = 'falling';
const S_WIN = 'win';
const S_GAMEOVER = 'gameover';
const S_WATCHING = 'watching';
const S_RESULTS = 'results';

const GHOST_COLORS = [COLORS.accent2, COLORS.accent3, COLORS.warn];

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

export const manifest = [
    { id: 'amazing-maze', title: 'AMAZING MAZE', subtitle: 'TILT TO ROLL', tilt: true, multiplayer: false, order: 10 },
    { id: 'amazing-maze-race', title: 'MAZE RACE', subtitle: 'RACE THE MAZE', tilt: true, multiplayer: true, modes: ['race'], order: 11 },
];

export { AmazingMazeGame as Game };

export class AmazingMazeGame {
    constructor(deps, meta) {
        this.renderer = deps.renderer;
        this.audio = deps.audio;
        this.input = deps.input;
        this.session = deps.session || null;
        this.meta = meta || {};
        this.cols = 5;
        this.rows = 6;
        this.level = 1;
        this.lives = 3;
        this.score = 0;
        this.highScore = getHighScore(meta?.id || GAME_ID);
        this._wallHitCooldown = 0;
        this._stateTimer = 0;
    }

    enter() {
        this.level = 1;
        this.lives = 3;
        this.score = 0;
        this.mp = !!(this.session && this.session.connected && this.session.gameId);

        const effectivePlayH = this.mp
            ? this.session.groupHeight - PLAY_TOP
            : PLAY_HEIGHT;

        this._boardX = 12;
        this._boardY = PLAY_TOP + 12;
        this._boardW = CANVAS_WIDTH - 24;
        this._boardH = effectivePlayH - 30;

        if (this.mp) {
            this._offMessage?.();
            this._offMessage = this.session.onGameMessage((from, msg) => this._onNet(from, msg));
            this._ghosts = {};
            this._ghostTargets = {};
            this._syncTick = 0;
            this._roundWinner = null;
            this._roundTime = 0;
        }

        this._buildLevel();
        this.state = S_READY;
        this._stateTimer = 45;

        if (this.mp && this.isHost) {
            this._broadcastMaze();
        }
    }

    get isHost() {
        return !!(this.session && this.session.isHost);
    }

    _cellSize() {
        return { cw: this._boardW / this.cols, ch: this._boardH / this.rows };
    }

    _buildLevel() {
        this.cols = Math.min(5 + Math.floor(this.level / 2), 8);
        this.rows = Math.min(6 + Math.floor(this.level / 2), 9);
        const { cols, rows } = this;

        const cells = [];
        for (let y = 0; y < rows; y++) {
            const row = [];
            for (let x = 0; x < cols; x++) {
                row.push({ N: true, E: true, S: true, W: true, visited: false });
            }
            cells.push(row);
        }
        const stack = [[0, rows - 1]];
        cells[rows - 1][0].visited = true;
        const dirs = [['N', 0, -1, 'S'], ['E', 1, 0, 'W'], ['S', 0, 1, 'N'], ['W', -1, 0, 'E']];
        while (stack.length) {
            const [cx, cy] = stack[stack.length - 1];
            const options = shuffle(dirs.slice()).filter(([, dx, dy]) => {
                const nx = cx + dx, ny = cy + dy;
                return nx >= 0 && nx < cols && ny >= 0 && ny < rows && !cells[ny][nx].visited;
            });
            if (options.length === 0) {
                stack.pop();
                continue;
            }
            const [dir, dx, dy, opposite] = options[0];
            const nx = cx + dx, ny = cy + dy;
            cells[cy][cx][dir] = false;
            cells[ny][nx][opposite] = false;
            cells[ny][nx].visited = true;
            stack.push([nx, ny]);
        }
        this.cells = cells;

        const holeCandidates = [];
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                if (!(x === 0 && y === rows - 1) && !(x === cols - 1 && y === 0)) {
                    holeCandidates.push([x, y]);
                }
            }
        }
        shuffle(holeCandidates);
        const holeCount = Math.min(2 + Math.floor(this.level / 2), 6);
        this.holes = holeCandidates.slice(0, holeCount);

        this.startCell = [0, rows - 1];
        this.goalCell = [cols - 1, 0];
        this._resetBall();
        this._cachedWalls = null;
        this._cachedWallsLevel = null;

        this.timeLeft = Math.max(MIN_TIME, START_TIME - this.level * 60);
    }

    _cellCenter(cx, cy) {
        const { cw, ch } = this._cellSize();
        return { x: this._boardX + cw * (cx + 0.5), y: this._boardY + ch * (cy + 0.5) };
    }

    _resetBall() {
        const c = this._cellCenter(...this.startCell);
        this.ballX = c.x;
        this.ballY = c.y;
        this.velX = 0;
        this.velY = 0;
    }

    // --- Multiplayer networking ---

    _serializeMaze() {
        const wallData = [];
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                const c = this.cells[y][x];
                wallData.push(c.N ? 1 : 0, c.E ? 1 : 0, c.S ? 1 : 0, c.W ? 1 : 0);
            }
        }
        return {
            cols: this.cols, rows: this.rows,
            walls: wallData,
            holes: this.holes,
            goalCell: this.goalCell,
            startCell: this.startCell,
            level: this.level,
        };
    }

    _loadMaze(data) {
        this.cols = data.cols;
        this.rows = data.rows;
        this.level = data.level;
        const cells = [];
        let idx = 0;
        for (let y = 0; y < data.rows; y++) {
            const row = [];
            for (let x = 0; x < data.cols; x++) {
                row.push({
                    N: !!data.walls[idx], E: !!data.walls[idx + 1],
                    S: !!data.walls[idx + 2], W: !!data.walls[idx + 3],
                    visited: true,
                });
                idx += 4;
            }
            cells.push(row);
        }
        this.cells = cells;
        this.holes = data.holes;
        this.goalCell = data.goalCell;
        this.startCell = data.startCell;
        this._cachedWalls = null;
        this._cachedWallsLevel = null;
        this._resetBall();
        this.timeLeft = Math.max(MIN_TIME, START_TIME - this.level * 60);
    }

    _broadcastMaze() {
        this.session.send({ k: 'maze', maze: this._serializeMaze() });
    }

    _onNet(from, msg) {
        if (!msg) return;

        if (this.isHost) {
            if (msg.k === 'pos') {
                this._ghostTargets[from] = { x: msg.x, y: msg.y, alive: msg.alive };
                this._relayGhosts();
            } else if (msg.k === 'goal') {
                if (!this._roundWinner) {
                    this._roundWinner = from;
                    const player = this.session.players.find(p => p.id === from);
                    const bonus = Math.floor(this.timeLeft / 6) + this.level * 50;
                    this.session.send({ k: 'win', winner: from, name: player?.name || '?', bonus, time: this._roundTime });
                    if (this.session.isMine(from)) {
                        this.score += bonus;
                    }
                    this.state = S_RESULTS;
                    this._stateTimer = 120;
                    this.audio.win();
                    const goal = this._cellCenter(...this.goalCell);
                    particles.burst(goal.x, goal.y, [COLORS.accent, COLORS.accent2, COLORS.warn], 22, 2.8);
                }
            } else if (msg.k === 'eliminated') {
                this._ghostTargets[from] = { x: 0, y: 0, alive: false };
                this._relayGhosts();
                this._checkAllEliminated();
            }
            return;
        }

        switch (msg.k) {
            case 'maze':
                this._loadMaze(msg.maze);
                this._ghosts = {};
                this._ghostTargets = {};
                this.lives = 3;
                this.state = S_READY;
                this._stateTimer = 45;
                break;
            case 'go':
                this.state = S_PLAYING;
                this._roundTime = 0;
                break;
            case 'ghosts':
                for (const [id, g] of Object.entries(msg.g)) {
                    if (!this.session.isMine(id)) {
                        if (!this._ghosts[id]) this._ghosts[id] = { x: g.x, y: g.y, alive: g.alive };
                        this._ghostTargets[id] = { x: g.x, y: g.y, alive: g.alive };
                    }
                }
                break;
            case 'win': {
                this._roundWinner = msg.winner;
                if (this.session.isMine(msg.winner)) {
                    this.score += msg.bonus;
                }
                this.state = S_RESULTS;
                this._stateTimer = 120;
                this.audio.win();
                const goal = this._cellCenter(...this.goalCell);
                particles.burst(goal.x, goal.y, [COLORS.accent, COLORS.accent2, COLORS.warn], 22, 2.8);
                break;
            }
            case 'nowin':
                this.state = S_RESULTS;
                this._stateTimer = 120;
                this._roundWinner = null;
                break;
            case 'nextlevel':
                this._loadMaze(msg.maze);
                this._ghosts = {};
                this._ghostTargets = {};
                this.lives = 3;
                this.state = S_READY;
                this._stateTimer = 45;
                break;
        }
    }

    _relayGhosts() {
        const g = {};
        if (this.session.me) {
            g[this.session.me.id] = { x: this.ballX, y: this.ballY, alive: this.state !== S_WATCHING };
        }
        for (const [id, pos] of Object.entries(this._ghostTargets)) {
            g[id] = pos;
        }
        this.session.send({ k: 'ghosts', g });
    }

    _checkAllEliminated() {
        if (this._roundWinner) return;
        const alive = [];
        if (this.state !== S_WATCHING) alive.push(this.session.me?.id);
        for (const [id, g] of Object.entries(this._ghostTargets)) {
            if (g.alive) alive.push(id);
        }
        if (alive.length === 0) {
            this.session.send({ k: 'nowin' });
            this.state = S_RESULTS;
            this._stateTimer = 120;
            this._roundWinner = null;
        }
    }

    // --- Update ---

    update(dt) {
        if (this.mp) {
            this._interpolateGhosts();
        }

        if (this.state === S_READY) {
            this._stateTimer--;
            const tap = this.input.consumeTap();
            if (tap || this._stateTimer <= 0) {
                this.state = S_PLAYING;
                this._roundTime = 0;
                if (this.mp && this.isHost) {
                    this.session.send({ k: 'go' });
                }
            }
            return;
        }
        if (this.state === S_WATCHING) {
            this.input.consumeTap();
            return;
        }
        if (this.state === S_RESULTS) {
            this._stateTimer--;
            const tap = this.input.consumeTap();
            if (this.mp) {
                if ((tap || this._stateTimer <= 0) && this.isHost) {
                    this.level++;
                    this._buildLevel();
                    this._ghosts = {};
                    this._ghostTargets = {};
                    this._roundWinner = null;
                    this.lives = 3;
                    this.state = S_READY;
                    this._stateTimer = 45;
                    this.session.send({ k: 'nextlevel', maze: this._serializeMaze() });
                }
                return;
            }
            // solo win
            if (tap || this._stateTimer <= 0) {
                this.level++;
                this._buildLevel();
                this.state = S_READY;
                this._stateTimer = 45;
            }
            return;
        }
        if (this.state === S_WIN) {
            this._stateTimer--;
            const tap = this.input.consumeTap();
            if (tap || this._stateTimer <= 0) {
                this.level++;
                this._buildLevel();
                this.state = S_READY;
                this._stateTimer = 45;
            }
            return;
        }
        if (this.state === S_GAMEOVER) {
            this._stateTimer--;
            const tap = this.input.consumeTap();
            if (tap || this._stateTimer <= 0) {
                this.enter();
            }
            return;
        }
        if (this.state === S_FALLING) {
            this._stateTimer--;
            if (this._stateTimer <= 0) {
                this.lives--;
                if (this.lives <= 0) {
                    if (this.mp) {
                        this.state = S_WATCHING;
                        this.session.send({ k: 'eliminated' });
                    } else {
                        this._gameOver();
                    }
                } else {
                    this._resetBall();
                    this.state = S_PLAYING;
                }
            }
            return;
        }

        // S_PLAYING
        if (this.mp) {
            this._roundTime++;
        }

        if (!this.mp) {
            this.timeLeft--;
            if (this.timeLeft <= 0) {
                this._gameOver();
                return;
            }
        }

        const tilt = this.input.getTilt();
        this.velX += tilt.x * ACCEL;
        this.velY += tilt.y * ACCEL;
        this.velX *= FRICTION;
        this.velY *= FRICTION;
        const speed = Math.hypot(this.velX, this.velY);
        if (speed > MAX_SPEED) {
            this.velX = (this.velX / speed) * MAX_SPEED;
            this.velY = (this.velY / speed) * MAX_SPEED;
        }

        this.ballX += this.velX;
        this.ballY += this.velY;
        if (this._wallHitCooldown > 0) this._wallHitCooldown--;

        this._resolveWallCollisions();
        this._checkGoalAndHoles();

        if (this.mp && ++this._syncTick % 3 === 0) {
            this.session.send({ k: 'pos', x: this.ballX, y: this.ballY, alive: true });
        }
    }

    _interpolateGhosts() {
        for (const [id, target] of Object.entries(this._ghostTargets)) {
            if (this.session.isMine(id)) continue;
            if (!this._ghosts[id]) {
                this._ghosts[id] = { ...target };
                continue;
            }
            const g = this._ghosts[id];
            g.x += (target.x - g.x) * 0.3;
            g.y += (target.y - g.y) * 0.3;
            g.alive = target.alive;
        }
    }

    _wallRects() {
        const { cw, ch } = this._cellSize();
        const rects = [];
        const { cols, rows } = this;
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const cell = this.cells[y][x];
                const px = this._boardX + x * cw;
                const py = this._boardY + y * ch;
                if (cell.N) rects.push({ x: px - WALL_T / 2, y: py - WALL_T / 2, w: cw + WALL_T, h: WALL_T });
                if (cell.W) rects.push({ x: px - WALL_T / 2, y: py - WALL_T / 2, w: WALL_T, h: ch + WALL_T });
                if (x === cols - 1 && cell.E) rects.push({ x: px + cw - WALL_T / 2, y: py - WALL_T / 2, w: WALL_T, h: ch + WALL_T });
                if (y === rows - 1 && cell.S) rects.push({ x: px - WALL_T / 2, y: py + ch - WALL_T / 2, w: cw + WALL_T, h: WALL_T });
            }
        }
        return rects;
    }

    _resolveWallCollisions() {
        if (!this._cachedWalls || this._cachedWallsLevel !== this.level) {
            this._cachedWalls = this._wallRects();
            this._cachedWallsLevel = this.level;
        }
        for (const rect of this._cachedWalls) {
            const closestX = Math.max(rect.x, Math.min(this.ballX, rect.x + rect.w));
            const closestY = Math.max(rect.y, Math.min(this.ballY, rect.y + rect.h));
            const dx = this.ballX - closestX;
            const dy = this.ballY - closestY;
            const distSq = dx * dx + dy * dy;
            if (distSq < BALL_R * BALL_R && distSq > 0.0001) {
                const dist = Math.sqrt(distSq);
                const nx = dx / dist, ny = dy / dist;
                const overlap = BALL_R - dist;
                this.ballX += nx * overlap;
                this.ballY += ny * overlap;
                const vn = this.velX * nx + this.velY * ny;
                if (vn < 0) {
                    this.velX -= vn * nx * 1.4;
                    this.velY -= vn * ny * 1.4;
                    if (this._wallHitCooldown === 0 && Math.hypot(this.velX, this.velY) > 0.3) {
                        this.audio.wallHit();
                        this._wallHitCooldown = 8;
                    }
                }
            } else if (distSq === 0) {
                this.ballX += WALL_T;
            }
        }
    }

    _checkGoalAndHoles() {
        const goal = this._cellCenter(...this.goalCell);
        if (Math.hypot(this.ballX - goal.x, this.ballY - goal.y) < GOAL_R) {
            if (this.mp) {
                this.session.send({ k: 'goal' });
                if (this.isHost) {
                    this._onNet(this.session.me.id, { k: 'goal' });
                }
                return;
            }
            const bonus = Math.floor(this.timeLeft / 6) + this.level * 50;
            this.score += bonus;
            this.state = S_WIN;
            this._stateTimer = 90;
            this.audio.win();
            particles.burst(goal.x, goal.y, [COLORS.accent, COLORS.accent2, COLORS.warn], 22, 2.8);
            if (setHighScore(GAME_ID, this.score)) this.highScore = this.score;
            return;
        }
        for (const [hx, hy] of this.holes) {
            const c = this._cellCenter(hx, hy);
            if (Math.hypot(this.ballX - c.x, this.ballY - c.y) < HOLE_R) {
                this.state = S_FALLING;
                this._stateTimer = 40;
                this.ballX = c.x;
                this.ballY = c.y;
                this.audio.fall();
                this.input.vibrate(80);
                this.renderer.shake(2, 8);
                particles.burst(c.x, c.y, COLORS.danger, 10, 1.8);
                return;
            }
        }
    }

    _gameOver() {
        this.state = S_GAMEOVER;
        this._stateTimer = 120;
        this.audio.lose();
        if (setHighScore(GAME_ID, this.score)) this.highScore = this.score;
    }

    // --- Render ---

    render() {
        this._renderBoard();
        this._renderHud();

        if (this.state === S_READY) {
            this._panel(`LEVEL ${this.level}`, this.mp ? 'RACE TO THE GOAL' : 'TAP OR TILT TO START');
        } else if (this.state === S_WIN) {
            this._panel('MAZE CLEARED!', 'TAP TO CONTINUE');
        } else if (this.state === S_GAMEOVER) {
            this._panel('GAME OVER', `SCORE ${this.score}`);
        } else if (this.state === S_WATCHING) {
            this._panel('ELIMINATED', 'WATCHING...');
        } else if (this.state === S_RESULTS) {
            if (this.mp) {
                if (this._roundWinner) {
                    const player = this.session.players.find(p => p.id === this._roundWinner);
                    const won = this.session.isMine(this._roundWinner);
                    this._panel(won ? 'YOU WON!' : `${player?.name || '?'} WINS`, this.isHost ? 'TAP FOR NEXT' : 'NEXT ROUND...');
                } else {
                    this._panel('NO WINNER', this.isHost ? 'TAP FOR NEXT' : 'NEXT ROUND...');
                }
            }
        }
    }

    _renderBoard() {
        const r = this.renderer;
        r.rect(this._boardX, this._boardY, this._boardW, this._boardH, COLORS.lcdBg);

        const rects = this._cachedWallsLevel === this.level ? this._cachedWalls : this._wallRects();
        for (const w of rects) r.rect(w.x, w.y, w.w, w.h, COLORS.ink);

        for (const [hx, hy] of this.holes) {
            const c = this._cellCenter(hx, hy);
            r.circle(c.x, c.y, HOLE_R, COLORS.bg);
            r.strokeCircle(c.x, c.y, HOLE_R, COLORS.danger);
        }

        const goal = this._cellCenter(...this.goalCell);
        const pulse = 2 + Math.sin(performance.now() / 200) * 2;
        r.strokeCircle(goal.x, goal.y, GOAL_R + pulse, COLORS.accent2, 2);
        r.glowCircle(goal.x, goal.y, GOAL_R - 3, COLORS.accent, 6);

        if (this.mp) {
            this._renderGhosts();
        }

        if (this.state !== S_FALLING || Math.floor(this._stateTimer / 4) % 2 === 0) {
            if (this.state !== S_WATCHING) {
                r.glowCircle(this.ballX, this.ballY, BALL_R, COLORS.white, 5);
            }
        }
    }

    _renderGhosts() {
        const r = this.renderer;
        const ctx = r.ctx;
        let colorIdx = 0;
        for (const [id, g] of Object.entries(this._ghosts)) {
            if (this.session.isMine(id)) continue;
            if (!g.alive) continue;
            const color = GHOST_COLORS[colorIdx % GHOST_COLORS.length];
            colorIdx++;
            const prevAlpha = ctx.globalAlpha;
            ctx.globalAlpha = 0.4;
            r.glowCircle(g.x, g.y, BALL_R, color, 5);
            ctx.globalAlpha = prevAlpha;
        }
    }

    _renderHud() {
        const r = this.renderer;
        const y = this._boardY + this._boardH + 6;

        if (this.mp) {
            r.drawText(`LV${this.level}`, 4, y, COLORS.white, 'left', 1);
            r.drawText(`SCORE ${this.score}`, CANVAS_WIDTH / 2, y, COLORS.white, 'center', 1);
            r.drawText('*'.repeat(Math.max(0, this.lives)), CANVAS_WIDTH - 4, y, COLORS.warn, 'right', 1);
        } else {
            r.drawText(`LV${this.level}`, 4, y, COLORS.white, 'left', 1);
            r.drawText(`SCORE ${this.score}`, CANVAS_WIDTH / 2, y, COLORS.white, 'center', 1);
            r.drawText('*'.repeat(Math.max(0, this.lives)), CANVAS_WIDTH - 4, y, COLORS.warn, 'right', 1);

            const seconds = Math.ceil(this.timeLeft / 60);
            const barW = this._boardW;
            r.rect(this._boardX, y + 10, barW, 3, COLORS.ink);
            r.rect(this._boardX, y + 10, barW * Math.max(0, this.timeLeft) / (45 * 60), 3, seconds < 10 ? COLORS.danger : COLORS.accent);
        }
    }

    _panel(title, subtitle) {
        const r = this.renderer;
        const cx = CANVAS_WIDTH / 2;
        const cy = PLAY_TOP + PLAY_HEIGHT / 2 - 10;
        r.rect(20, cy - 20, CANVAS_WIDTH - 40, 44, COLORS.lcdBg);
        r.strokeRect(20, cy - 20, CANVAS_WIDTH - 40, 44, COLORS.accent);
        r.drawText(title, cx, cy - 10, COLORS.accent, 'center', 1);
        r.drawText(subtitle, cx, cy + 4, COLORS.white, 'center', 1);
    }
}
