import { CANVAS_WIDTH, PLAY_TOP, PLAY_HEIGHT, COLORS } from '../core/constants.js';
import { getHighScore, setHighScore } from '../core/storage.js';
import { particles } from '../core/particles.js';

const GAME_ID = 'racing-pigs';

const LANE_COUNT = 5;
const PIG_COLORS = [COLORS.accent, COLORS.accent2, COLORS.accent3, COLORS.warn, COLORS.danger];

const TRACK_TOP = PLAY_TOP + 28;
const TRACK_BOTTOM = PLAY_TOP + PLAY_HEIGHT - 30;
const TRACK_DIST = TRACK_BOTTOM - TRACK_TOP;

const S_PICK = 'pick';
const S_READY = 'ready';
const S_RACING = 'racing';
const S_RESULT = 'result';

function randRange(min, max) {
    return min + Math.random() * (max - min);
}

export class RacingPigsGame {
    constructor(deps) {
        this.renderer = deps.renderer;
        this.audio = deps.audio;
        this.input = deps.input;
        this.wins = getHighScore(GAME_ID);
    }

    enter() {
        this.state = S_PICK;
        this.pickedLane = null;
        this._buildPigs();
    }

    // Which pigs this device is responsible for making noise about. Solo that is
    // just the picked lane; multiplayer will widen this to the lanes owned here.
    _isMine(pig) {
        return pig.lane === this.pickedLane;
    }

    _laneY(i) {
        const laneH = (CANVAS_WIDTH - 20) / LANE_COUNT;
        return { x: 10 + laneH * (i + 0.5), laneH };
    }

    _buildPigs() {
        this.pigs = [];
        for (let i = 0; i < LANE_COUNT; i++) {
            this.pigs.push({
                lane: i,
                color: PIG_COLORS[i],
                y: TRACK_BOTTOM,
                phase: 'stop',
                phaseTimer: Math.floor(randRange(20, 50)),
                snortTimer: 0,
                finished: false,
                place: 0,
            });
        }
        this._finishOrder = [];
    }

    _startRace() {
        this.state = S_READY;
        this._stateTimer = 50;
    }

    update() {
        if (this.state === S_PICK) {
            const tap = this.input.consumeTap();
            if (!tap) return;
            for (let i = 0; i < LANE_COUNT; i++) {
                const { x, laneH } = this._laneY(i);
                if (tap.x >= x - laneH / 2 && tap.x < x + laneH / 2 && tap.y >= TRACK_TOP && tap.y <= TRACK_BOTTOM + 20) {
                    this.pickedLane = i;
                    this.audio.select();
                    this._startRace();
                    return;
                }
            }
            return;
        }

        if (this.state === S_READY) {
            this._stateTimer--;
            if (this._stateTimer <= 0) {
                this.state = S_RACING;
                this.audio.tick();
            }
            return;
        }

        if (this.state === S_RESULT) {
            const tap = this.input.consumeTap();
            if (tap) this.enter();
            return;
        }

        // S_RACING
        for (const pig of this.pigs) {
            if (pig.finished) continue;

            pig.phaseTimer--;
            if (pig.phase === 'waddle') {
                pig.y -= randRange(0.35, 0.9);
                if (pig.phaseTimer <= 0) {
                    pig.phase = 'stop';
                    pig.phaseTimer = Math.floor(randRange(14, 34));
                    // Stopping is a snort: puff for every pig, but only ever hear
                    // your own - in multiplayer each device plays its own pig only.
                    pig.snortTimer = 12;
                    if (this._isMine(pig)) this.audio.honk();
                }
            } else {
                if (pig.phaseTimer <= 0) {
                    pig.phase = 'waddle';
                    pig.phaseTimer = Math.floor(randRange(16, 40));
                }
            }
            if (pig.snortTimer > 0) pig.snortTimer--;

            if (pig.y <= TRACK_TOP) {
                pig.y = TRACK_TOP;
                pig.finished = true;
                pig.place = this._finishOrder.length + 1;
                this._finishOrder.push(pig.lane);
                const { x } = this._laneY(pig.lane);
                particles.burst(x, TRACK_TOP, pig.color, 14, 2);
                if (pig.lane === this.pickedLane) this.audio.win();
                else this.audio.tick();
            }
        }

        if (this._finishOrder.length > 0) {
            this._finishRace(this._finishOrder[0]);
        }
    }

    _finishRace(winnerLane) {
        this.state = S_RESULT;
        this.won = winnerLane === this.pickedLane;
        if (this.won) {
            this.wins++;
            if (setHighScore(GAME_ID, this.wins)) this.audio.jackpot();
            this.input.vibrate([30, 20, 30, 20, 60]);
        } else {
            this.audio.lose();
        }
    }

    render() {
        const r = this.renderer;
        r.roundRect(6, TRACK_TOP - 14, CANVAS_WIDTH - 12, TRACK_BOTTOM - TRACK_TOP + 34, 8, COLORS.lcdBg);
        r.strokeRect(6, TRACK_TOP - 14, CANVAS_WIDTH - 12, TRACK_BOTTOM - TRACK_TOP + 34, COLORS.accent2);
        r.line(6, TRACK_TOP, CANVAS_WIDTH - 6, TRACK_TOP, COLORS.warn, 2);

        for (let i = 0; i < LANE_COUNT; i++) {
            const { x, laneH } = this._laneY(i);
            if (i > 0) r.line(x - laneH / 2, TRACK_TOP, x - laneH / 2, TRACK_BOTTOM + 16, COLORS.ink);
        }

        for (const pig of this.pigs) {
            const { x } = this._laneY(pig.lane);
            this._drawPig(x, pig);
            if (this.pickedLane === pig.lane) {
                r.drawText('*', x, TRACK_BOTTOM + 22, COLORS.warn, 'center', 1);
            }
        }

        if (this.state === S_PICK) this._panel('RACING PIGS', 'TAP A LANE TO PICK YOUR PIG');
        else if (this.state === S_READY) this._panel('ON YOUR MARKS...', 'RACE STARTING');
        else if (this.state === S_RESULT) {
            this._panel(this.won ? 'YOUR PIG WON!' : 'YOUR PIG LOST', `WINS ${this.wins} - TAP TO RACE AGAIN`);
        }
    }

    _drawPig(x, pig) {
        const r = this.renderer;
        const squash = pig.phase === 'stop' && pig.snortTimer > 0 ? 1.15 : 1;
        const bodyW = 9 * squash, bodyH = 7 / squash;
        r.circle(x, pig.y, bodyH, pig.color);
        r.circle(x - bodyW * 0.55, pig.y - 2, 3.2, pig.color);
        r.circle(x + bodyW * 0.55, pig.y - 2, 3.2, pig.color);
        r.circle(x, pig.y + bodyH * 0.5, 3, COLORS.white);
        r.circle(x - 1, pig.y + bodyH * 0.5, 0.7, COLORS.ink);
        r.circle(x + 1, pig.y + bodyH * 0.5, 0.7, COLORS.ink);
        if (pig.snortTimer > 5) {
            r.circle(x, pig.y + bodyH * 0.5 + 4, 1.5, COLORS.white);
        }
    }

    _panel(title, subtitle) {
        const r = this.renderer;
        const cx = CANVAS_WIDTH / 2;
        const cy = TRACK_TOP - 20;
        r.drawText(title, cx, cy - 8, COLORS.accent, 'center', 1);
        r.drawText(subtitle, cx, cy + 6, COLORS.white, 'center', 1);
    }
}
