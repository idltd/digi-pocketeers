import { CANVAS_WIDTH, PLAY_TOP, PLAY_HEIGHT, COLORS } from '../core/constants.js';
import { getHighScore, setHighScore } from '../core/storage.js';
import { particles } from '../core/particles.js';

const GAME_ID = 'secret-passage';

const BOARD_X = 12;
const BOARD_Y = PLAY_TOP + 12;
const BOARD_W = CANVAS_WIDTH - 24;
const BOARD_H = PLAY_HEIGHT - 30;

const WALL_T = 4;
const BALL_R = 5;
const GOAL_R = 9;
const HOLE_R = 7;
const VISION_R = 46;

const ACCEL = 0.09;
const FRICTION = 0.992;
const MAX_SPEED = 2.6;

const START_TIME = 60 * 60;
const MIN_TIME = 30 * 60;

const S_READY = 'ready';
const S_PLAYING = 'playing';
const S_FALLING = 'falling';
const S_WIN = 'win';
const S_GAMEOVER = 'gameover';

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

export class SecretPassageGame {
    constructor(deps) {
        this.renderer = deps.renderer;
        this.audio = deps.audio;
        this.input = deps.input;
        this.cols = 5;
        this.rows = 6;
        this.level = 1;
        this.lives = 3;
        this.score = 0;
        this.highScore = getHighScore(GAME_ID);
        this._wallHitCooldown = 0;
        this._stateTimer = 0;
    }

    enter() {
        this.level = 1;
        this.lives = 3;
        this.score = 0;
        this._buildLevel();
        this.state = S_READY;
        this._stateTimer = 45;
    }

    _cellSize() {
        return { cw: BOARD_W / this.cols, ch: BOARD_H / this.rows };
    }

    _buildLevel() {
        this.cols = Math.min(5 + Math.floor(this.level / 2), 7);
        this.rows = Math.min(6 + Math.floor(this.level / 2), 8);
        const { cols, rows } = this;

        const cells = [];
        for (let y = 0; y < rows; y++) {
            const row = [];
            for (let x = 0; x < cols; x++) row.push({ N: true, E: true, S: true, W: true, visited: false });
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
            if (options.length === 0) { stack.pop(); continue; }
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
                if (!(x === 0 && y === rows - 1) && !(x === cols - 1 && y === 0)) holeCandidates.push([x, y]);
            }
        }
        shuffle(holeCandidates);
        this.holes = holeCandidates.slice(0, Math.min(1 + Math.floor(this.level / 3), 3));

        this.startCell = [0, rows - 1];
        this.goalCell = [cols - 1, 0];
        this._resetBall();

        this.timeLeft = Math.max(MIN_TIME, START_TIME - this.level * 60);
        this._cachedWalls = null;
    }

    _cellCenter(cx, cy) {
        const { cw, ch } = this._cellSize();
        return { x: BOARD_X + cw * (cx + 0.5), y: BOARD_Y + ch * (cy + 0.5) };
    }

    _resetBall() {
        const c = this._cellCenter(...this.startCell);
        this.ballX = c.x;
        this.ballY = c.y;
        this.velX = 0;
        this.velY = 0;
    }

    update(dt) {
        if (this.state === S_READY) {
            this._stateTimer--;
            const tap = this.input.consumeTap();
            if (tap || this._stateTimer <= 0) this.state = S_PLAYING;
            return;
        }
        if (this.state === S_WIN || this.state === S_GAMEOVER) {
            this._stateTimer--;
            const tap = this.input.consumeTap();
            if (this.state === S_GAMEOVER && (tap || this._stateTimer <= 0)) {
                this.enter();
            } else if (this.state === S_WIN && (tap || this._stateTimer <= 0)) {
                this.level++;
                this._buildLevel();
                this.state = S_READY;
                this._stateTimer = 45;
            }
            return;
        }
        if (this.state === S_FALLING) {
            this._stateTimer--;
            if (this._stateTimer <= 0) {
                this.lives--;
                if (this.lives <= 0) this._gameOver();
                else { this._resetBall(); this.state = S_PLAYING; }
            }
            return;
        }

        this.timeLeft--;
        if (this.timeLeft <= 0) { this._gameOver(); return; }

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
    }

    _wallRects() {
        const { cw, ch } = this._cellSize();
        const rects = [];
        const { cols, rows } = this;
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const cell = this.cells[y][x];
                const px = BOARD_X + x * cw;
                const py = BOARD_Y + y * ch;
                if (cell.N) rects.push({ x: px - WALL_T / 2, y: py - WALL_T / 2, w: cw + WALL_T, h: WALL_T });
                if (cell.W) rects.push({ x: px - WALL_T / 2, y: py - WALL_T / 2, w: WALL_T, h: ch + WALL_T });
                if (x === cols - 1 && cell.E) rects.push({ x: px + cw - WALL_T / 2, y: py - WALL_T / 2, w: WALL_T, h: ch + WALL_T });
                if (y === rows - 1 && cell.S) rects.push({ x: px - WALL_T / 2, y: py + ch - WALL_T / 2, w: cw + WALL_T, h: WALL_T });
            }
        }
        return rects;
    }

    _resolveWallCollisions() {
        if (!this._cachedWalls) this._cachedWalls = this._wallRects();
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
            }
        }
    }

    _checkGoalAndHoles() {
        const goal = this._cellCenter(...this.goalCell);
        if (Math.hypot(this.ballX - goal.x, this.ballY - goal.y) < GOAL_R) {
            const bonus = Math.floor(this.timeLeft / 6) + this.level * 60;
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

    render() {
        const r = this.renderer;
        this._renderFoggedBoard();
        this._renderCompass();
        this._renderHud();

        if (this.state === S_READY) this._panel(`LEVEL ${this.level}`, 'FIND THE HIDDEN EXIT');
        else if (this.state === S_WIN) this._panel('PASSAGE FOUND!', 'TAP TO CONTINUE');
        else if (this.state === S_GAMEOVER) this._panel('GAME OVER', `SCORE ${this.score}`);
    }

    _renderFoggedBoard() {
        const r = this.renderer;
        r.rect(BOARD_X, BOARD_Y, BOARD_W, BOARD_H, COLORS.bg);

        const walls = this._cachedWalls || this._wallRects();
        for (const w of walls) {
            const wx = w.x + w.w / 2, wy = w.y + w.h / 2;
            if (Math.hypot(wx - this.ballX, wy - this.ballY) <= VISION_R) {
                r.rect(w.x, w.y, w.w, w.h, COLORS.ink);
            }
        }

        for (const [hx, hy] of this.holes) {
            const c = this._cellCenter(hx, hy);
            if (Math.hypot(c.x - this.ballX, c.y - this.ballY) <= VISION_R) {
                r.circle(c.x, c.y, HOLE_R, COLORS.bg);
                r.strokeCircle(c.x, c.y, HOLE_R, COLORS.danger);
            }
        }

        const goal = this._cellCenter(...this.goalCell);
        if (Math.hypot(goal.x - this.ballX, goal.y - this.ballY) <= VISION_R) {
            r.strokeCircle(goal.x, goal.y, GOAL_R, COLORS.accent, 2);
            r.circle(goal.x, goal.y, GOAL_R - 3, COLORS.accentDim);
        }

        r.strokeRect(BOARD_X, BOARD_Y, BOARD_W, BOARD_H, COLORS.accentDim);
        if (this.state !== S_FALLING || Math.floor(this._stateTimer / 4) % 2 === 0) {
            r.circle(this.ballX, this.ballY, BALL_R, COLORS.white);
        }
    }

    _renderCompass() {
        const r = this.renderer;
        const goal = this._cellCenter(...this.goalCell);
        const dx = goal.x - this.ballX, dy = goal.y - this.ballY;
        const dist = Math.hypot(dx, dy);
        if (dist < 1) return;
        const nx = dx / dist, ny = dy / dist;
        const cx = this.ballX + nx * (VISION_R - 4);
        const cy = this.ballY + ny * (VISION_R - 4);
        if (cx < BOARD_X || cx > BOARD_X + BOARD_W || cy < BOARD_Y || cy > BOARD_Y + BOARD_H) return;
        r.circle(cx, cy, 1.5, COLORS.warn);
    }

    _renderHud() {
        const r = this.renderer;
        const y = BOARD_Y + BOARD_H + 6;
        r.drawText(`LV${this.level}`, 4, y, COLORS.white, 'left', 1);
        r.drawText(`SCORE ${this.score}`, CANVAS_WIDTH / 2, y, COLORS.white, 'center', 1);
        r.drawText('*'.repeat(Math.max(0, this.lives)), CANVAS_WIDTH - 4, y, COLORS.warn, 'right', 1);

        const seconds = Math.ceil(this.timeLeft / 60);
        r.rect(BOARD_X, y + 10, BOARD_W, 3, COLORS.ink);
        r.rect(BOARD_X, y + 10, BOARD_W * Math.max(0, this.timeLeft) / START_TIME, 3, seconds < 10 ? COLORS.danger : COLORS.accent);
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
