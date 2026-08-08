"use client";

const CONFETTI_COLORS = ["var(--brand-green)", "var(--chart-amber)", "var(--chart-blue)", "var(--chart-pink)", "var(--chart-violet)"];

/**
 * CSS-only celebration burst — ~24 particles fired from center, each with a
 * randomized angle/distance/delay baked into its own inline transform, so no
 * JS animation loop or canvas library is needed. Fixed, full-screen,
 * pointer-events-none, and self-removing is the caller's job (mount it only
 * while `active`, same lifecycle as any other conditional overlay here).
 */
export function PracticeConfetti() {
  const particles = Array.from({ length: 28 }, (_, i) => i);
  return (
    <div className="fixed inset-0 z-[110] pointer-events-none overflow-hidden" aria-hidden="true">
      {particles.map((i) => {
        const angle = (i / particles.length) * 360 + (i % 3) * 11;
        const distance = 160 + (i % 5) * 40;
        const dx = Math.cos((angle * Math.PI) / 180) * distance;
        const dy = Math.sin((angle * Math.PI) / 180) * distance - 80;
        const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
        const delay = (i % 6) * 0.03;
        const size = 6 + (i % 4) * 2;
        return (
          <span
            key={i}
            className="absolute top-1/2 left-1/2 rounded-sm animate-[practice-confetti_1.1s_ease-out_forwards]"
            style={{
              width: size,
              height: size * 2.2,
              backgroundColor: color,
              animationDelay: `${delay}s`,
              // Custom properties read by the @keyframes in globals.css — lets one
              // keyframe drive 28 different trajectories instead of 28 keyframes.
              // @ts-expect-error -- CSS custom properties aren't in CSSProperties
              "--dx": `${dx}px`,
              "--dy": `${dy}px`,
              "--rot": `${angle * 4}deg`,
            }}
          />
        );
      })}
    </div>
  );
}
