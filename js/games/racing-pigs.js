import { CANVAS_WIDTH, PLAY_TOP, PLAY_HEIGHT, COLORS } from '../core/constants.js';
import { getHighScore, setHighScore } from '../core/storage.js';
import { particles } from '../core/particles.js';

const GAME_ID = 'racing-pigs';

const LANE_COUNT = 5;
const PIG_COLORS = [COLORS.accent, COLORS.accent2, COLORS.accent3, COLORS.warn, COLORS.danger];

const TRACK_TOP = PLAY_TOP + 28;
const TRACK_BOTTOM = PLAY_TOP + PLAY_HEIGHT - 30;
const TRACK_DIST = TRACK_BOTTOM - TRACK_TOP;

// Race pacing. This is a spectator sport - the point is watching them dawdle,
// stop, oink and get overtaken, so it is deliberately slow. Roughly 40s over a
// typical screen. Tune the race length here rather than in the update loop.
const WADDLE_SPEED_MIN = 0.25;
const WADDLE_SPEED_MAX = 0.6;
const WADDLE_FRAMES_MIN = 16;
const WADDLE_FRAMES_MAX = 40;
const STOP_FRAMES_MIN = 30;
const STOP_FRAMES_MAX = 60;

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
        this.session = deps.session || null;
        this.wins = getHighScore(GAME_ID);
    }

    enter() {
        this.state = S_PICK;
        this.pickedLane = null;
        this._buildPigs();

        // Multiplayer only when the lobby started this; solo leaves the session
        // disconnected and every branch below falls through to local play.
        this.mp = !!(this.session && this.session.connected && this.session.gameId === GAME_ID);
        this.owners = {};      // lane -> player id
        this._syncTick = 0;

        if (this.mp) {
            this._offMessage?.();
            this._offMessage = this.session.onGameMessage((from, msg) => this._onNet(from, msg));
            if (this.isHost) {
                this._broadcastOwners();
                // Also pushes the reset back to S_PICK, which is how guests
                // leave the results screen after the host starts a new race.
                this._broadcastState(true);
            }
        }
    }

    get isHost() {
        return !!(this.session && this.session.isHost);
    }

    // Which pigs this device makes noise about. Solo that is the picked lane;
    // in multiplayer it is whichever lanes this player owns, so each phone only
    // ever hears its own pig oink.
    _isMine(pig) {
        if (!this.mp) return pig.lane === this.pickedLane;
        return this.session.isMine(this.owners[pig.lane]);
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

    // --- Networking -------------------------------------------------------
    // The host simulates and everyone else renders what it sends. Guests only
    // ever send an intent ("I want lane 3"), which keeps the two sides from
    // disagreeing about who owns what or who won.

    _onNet(from, msg) {
        if (!msg) return;

        if (this.isHost) {
            if (msg.k === 'claim') this._claimLane(msg.lane, from);
            return;
        }

        switch (msg.k) {
            case 'owners':
                this.owners = msg.owners;
                this.pickedLane = this._myLane();
                break;
            case 'state':
                this._applyState(msg);
                break;
            case 'result':
                this.owners = msg.owners ?? this.owners;
                this._finishRace(msg.winner);
                break;
        }
    }

    _myLane() {
        const me = this.session?.me;
        if (!me) return null;
        const found = Object.keys(this.owners).find((l) => this.owners[l] === me.id);
        return found === undefined ? null : Number(found);
    }

    _claimLane(lane, playerId) {
        if (lane < 0 || lane >= LANE_COUNT) return;
        if (this.owners[lane] !== undefined) return;        // first claim wins
        for (const l of Object.keys(this.owners)) {          // one pig each
            if (this.owners[l] === playerId) delete this.owners[l];
        }
        this.owners[lane] = playerId;
        this._broadcastOwners();

        // Off as soon as everyone has a pig - nobody wants to wait for a host
        // to press go when the table is ready.
        if (this.session.players.every((p) => Object.values(this.owners).includes(p.id))) {
            this._startRace();
        }
    }

    _broadcastOwners() {
        this.session.send({ k: 'owners', owners: this.owners });
        this.pickedLane = this._myLane();
    }

    _applyState(msg) {
        this.state = msg.state;
        msg.pigs.forEach((p, i) => {
            const pig = this.pigs[i];
            const wasStopped = pig.phase === 'stop';
            pig.y = p[0];
            pig.phase = p[1] ? 'stop' : 'waddle';
            pig.snortTimer = p[2];
            // The host doesn't tell anyone to make a noise - each device spots
            // its own pig stopping and oinks locally.
            if (!wasStopped && pig.phase === 'stop' && this._isMine(pig)) this.audio.honk();
        });
    }

    _broadcastState(force = false) {
        // Every third frame is plenty for pigs moving under 1px a frame, and
        // keeps traffic light enough for a phone hotspot with five players.
        if (!force && ++this._syncTick % 3) return;
        this.session.send({
            k: 'state',
            state: this.state,
            pigs: this.pigs.map((p) => [Math.round(p.y * 10) / 10, p.phase === 'stop' ? 1 : 0, p.snortTimer]),
        });
    }

    update() {
        if (this.state === S_PICK) {
            const tap = this.input.consumeTap();
            if (!tap) return;
            for (let i = 0; i < LANE_COUNT; i++) {
                const { x, laneH } = this._laneY(i);
                if (tap.x >= x - laneH / 2 && tap.x < x + laneH / 2 && tap.y >= TRACK_TOP && tap.y <= TRACK_BOTTOM + 20) {
                    if (this.mp) {
                        if (this.owners[i] !== undefined) return;   // taken
                        this.audio.select();
                        if (this.isHost) this._claimLane(i, this.session.me.id);
                        else this.session.send({ k: 'claim', lane: i });
                    } else {
                        this.pickedLane = i;
                        this.audio.select();
                        this._startRace();
                    }
                    return;
                }
            }
            return;
        }

        // Guests never simulate; they just play back what the host sends.
        // Taps are swallowed so they don't queue up behind the results screen.
        if (this.mp && !this.isHost) {
            this.input.consumeTap();
            return;
        }

        if (this.state === S_READY) {
            this._stateTimer--;
            if (this._stateTimer <= 0) {
                this.state = S_RACING;
                this.audio.tick();
            }
            if (this.mp) this._broadcastState();
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
                pig.y -= randRange(WADDLE_SPEED_MIN, WADDLE_SPEED_MAX);
                if (pig.phaseTimer <= 0) {
                    pig.phase = 'stop';
                    // Stopping is a snort: every pig puffs, but you only ever
                    // hear your own - in multiplayer each device plays its own.
                    // honk() returns how long its burst runs, and the pig holds
                    // still for at least that, so it never waddles off mid-oink.
                    const burst = this._isMine(pig) ? this.audio.honk() : 0;
                    pig.phaseTimer = Math.max(
                        Math.floor(randRange(STOP_FRAMES_MIN, STOP_FRAMES_MAX)),
                        Math.ceil(burst * 60),
                    );
                    pig.snortTimer = pig.phaseTimer;
                }
            } else {
                if (pig.phaseTimer <= 0) {
                    pig.phase = 'waddle';
                    pig.phaseTimer = Math.floor(randRange(WADDLE_FRAMES_MIN, WADDLE_FRAMES_MAX));
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

        if (this.mp) this._broadcastState();

        if (this._finishOrder.length > 0) {
            const winner = this._finishOrder[0];
            if (this.mp) this.session.send({ k: 'result', winner, owners: this.owners });
            this._finishRace(winner);
        }
    }

    _finishRace(winnerLane) {
        this.state = S_RESULT;
        this.winnerLane = winnerLane;
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
            } else if (this.mp && this.owners[pig.lane] !== undefined) {
                // Someone else's pig - show whose, so the table can see the
                // field fill up while picking.
                const name = this._ownerName(pig.lane);
                r.drawText(name.slice(0, 4), x, TRACK_BOTTOM + 22, COLORS.accentDim, 'center', 1);
            }
        }

        if (this.state === S_PICK) {
            if (this.mp) {
                const waiting = this.session.players.length - Object.keys(this.owners).length;
                this._panel(
                    this.pickedLane === null ? 'PICK YOUR PIG' : 'WAITING FOR OTHERS',
                    this.pickedLane === null ? 'TAP A FREE LANE' : `${waiting} STILL TO PICK`,
                );
            } else {
                this._panel('RACING PIGS', 'TAP A LANE TO PICK YOUR PIG');
            }
        } else if (this.state === S_READY) this._panel('ON YOUR MARKS...', 'RACE STARTING');
        else if (this.state === S_RESULT) {
            if (this.mp) {
                const winner = this._ownerName(this.winnerLane);
                this._panel(
                    this.won ? 'YOUR PIG WON!' : `${winner} WINS`,
                    this.isHost ? 'TAP TO RACE AGAIN' : 'WAITING FOR HOST',
                );
            } else {
                this._panel(this.won ? 'YOUR PIG WON!' : 'YOUR PIG LOST', `WINS ${this.wins} - TAP TO RACE AGAIN`);
            }
        }
    }

    _ownerName(lane) {
        const id = this.owners[lane];
        return this.session?.players.find((p) => p.id === id)?.name ?? 'NOBODY';
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
