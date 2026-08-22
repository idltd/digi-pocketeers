// Lightweight shared particle burst system for hit/win feedback across all games.

class Particles {
    constructor() {
        this.list = [];
    }

    clear() {
        this.list.length = 0;
    }

    burst(x, y, colors, count = 14, speed = 2.4, life = 26) {
        const palette = Array.isArray(colors) ? colors : [colors];
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const s = speed * (0.4 + Math.random() * 0.9);
            this.list.push({
                x, y,
                vx: Math.cos(angle) * s,
                vy: Math.sin(angle) * s,
                life,
                maxLife: life,
                size: 1.5 + Math.random() * 1.5,
                color: palette[Math.floor(Math.random() * palette.length)],
            });
        }
    }

    update() {
        for (const p of this.list) {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.05;
            p.vx *= 0.97;
            p.vy *= 0.97;
            p.life--;
        }
        if (this.list.length) this.list = this.list.filter((p) => p.life > 0);
    }

    render(renderer) {
        for (const p of this.list) {
            const t = p.life / p.maxLife;
            renderer.circle(p.x, p.y, Math.max(0.5, p.size * t), p.color);
        }
    }
}

export const particles = new Particles();
