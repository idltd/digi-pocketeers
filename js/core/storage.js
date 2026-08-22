// localStorage wrapper for high scores, keyed per game.

const PREFIX = 'pocketeers.';

export function getHighScore(gameId) {
    try {
        const raw = localStorage.getItem(PREFIX + gameId + '.highscore');
        return raw ? parseInt(raw, 10) || 0 : 0;
    } catch {
        return 0;
    }
}

export function setHighScore(gameId, score) {
    try {
        const current = getHighScore(gameId);
        if (score > current) {
            localStorage.setItem(PREFIX + gameId + '.highscore', String(score));
            return true;
        }
        return false;
    } catch {
        return false;
    }
}

export function getFlag(key, fallback = null) {
    try {
        const raw = localStorage.getItem(PREFIX + key);
        return raw === null ? fallback : raw;
    } catch {
        return fallback;
    }
}

export function setFlag(key, value) {
    try {
        localStorage.setItem(PREFIX + key, String(value));
    } catch {
        // ignore
    }
}
