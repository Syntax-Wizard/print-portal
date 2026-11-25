/**
 * A live drawing of the printed result: paper proportion, sides and binding edge,
 * black & white versus colour, number of copies, and special job types.
 * It is the one expressive element of the UI; everything around it stays quiet.
 */

import type { PrintOptions } from "../../printer/types";

/** Height / width for each paper size. "default" is drawn as A4. */
const RATIO: Record<PrintOptions["paperSize"], number> = {
  default: Math.SQRT2,
  A3: Math.SQRT2,
  A4: Math.SQRT2,
  A5: Math.SQRT2,
  B4: Math.SQRT2,
  B5: Math.SQRT2,
  letter: 11 / 8.5,
  folio: 13 / 8.5,
  legal: 14 / 8.5,
  "11x15": 15 / 11,
  ledger: 17 / 11,
};

/** Paper is white in real life, so the preview ignores the UI theme. */
const PAPER = { sheet: "#ffffff", back: "#f1f2f0", edge: "#cfd3d6", ink: "#1e2226", line: "#a3aab0", gray: "#6b737b", accent: "#0077b6", k: "#231815" };

const VIEW_W = 220;
const VIEW_H = 250;
const MAX_SHEET_W = 132;
const MAX_SHEET_H = 186;

interface SheetBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function Content({ box, colorMode, faded }: { box: SheetBox; colorMode: PrintOptions["color"]; faded?: boolean }) {
  const { x, y, w } = box;
  const pad = w * 0.12;
  const inner = w - pad * 2;
  const colorful = colorMode !== "bw";
  const ink = PAPER.ink;
  const soft = PAPER.line;
  const lines = [0.92, 1, 0.97, 0.7];
  const chartY = y + pad + 44;
  const bars = [
    { h: 0.55, c: "var(--color-process-c)" },
    { h: 0.85, c: "var(--color-process-m)" },
    { h: 0.4, c: "var(--color-process-y)" },
    { h: 0.7, c: PAPER.k },
  ];
  return (
    <g opacity={faded ? 0.45 : 1}>
      <rect x={x + pad} y={y + pad} width={inner * 0.62} height={7} rx={1.5} fill={colorful ? PAPER.accent : ink} />
      {lines.map((len, i) => (
        <rect key={i} x={x + pad} y={y + pad + 16 + i * 7} width={inner * len} height={3} rx={1.5} fill={soft} />
      ))}
      {bars.map((b, i) => {
        const bw = inner / 6;
        const bh = 34 * b.h;
        return (
          <rect
            key={i}
            x={x + pad + i * (bw * 1.45)}
            y={chartY + 34 - bh}
            width={bw}
            height={bh}
            rx={1}
            fill={colorful ? b.c : i % 2 ? PAPER.gray : PAPER.line}
          />
        );
      })}
      {[0, 1, 2].map((i) => (
        <rect key={`t${i}`} x={x + pad} y={chartY + 46 + i * 7} width={inner * (i === 2 ? 0.55 : 1)} height={3} rx={1.5} fill={soft} />
      ))}
    </g>
  );
}

function Sheet({ box, shadow, back }: { box: SheetBox; shadow?: boolean; back?: boolean }) {
  return (
    <rect
      x={box.x}
      y={box.y}
      width={box.w}
      height={box.h}
      rx={2}
      fill={back ? PAPER.back : PAPER.sheet}
      stroke={PAPER.edge}
      stroke-width={1}
      style={shadow ? { filter: "drop-shadow(0 6px 10px rgb(30 34 38 / 0.10))" } : undefined}
    />
  );
}

export function SheetPreview({ options, label }: { options: PrintOptions; label: string }) {
  const ratio = RATIO[options.paperSize];
  let w = MAX_SHEET_W;
  let h = w * ratio;
  if (h > MAX_SHEET_H) {
    h = MAX_SHEET_H;
    w = h / ratio;
  }
  const duplex = options.duplex !== "none";
  const stack = options.delivery.type === "sample" ? 1 : Math.min(options.copies, 3);
  // Leave room for the stack and the back side peeking out.
  const front: SheetBox = { x: (VIEW_W - w) / 2 - 8, y: (VIEW_H - h) / 2 - 4, w, h };
  const back: SheetBox = { ...front, x: front.x + 14, y: front.y + 10 };
  const bindingLong = options.duplex === "long-edge";

  return (
    <figure class="m-0">
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} class="block h-auto w-full" role="img" aria-label={label}>
        {/* Extra copies, drawn as a stack behind everything else. */}
        {Array.from({ length: stack - 1 }, (_, i) => {
          const off = (stack - 1 - i) * 5;
          return <Sheet key={`copy${i}`} box={{ ...(duplex ? back : front), x: (duplex ? back.x : front.x) + off, y: (duplex ? back.y : front.y) + off }} />;
        })}

        {duplex && (
          <g>
            <Sheet box={back} shadow back />
            {/* The back side reads mirrored and lighter, like seeing through the sheet. */}
            <g transform={bindingLong ? `translate(${2 * back.x + back.w} 0) scale(-1 1)` : `translate(0 ${2 * back.y + back.h}) scale(1 -1)`}>
              <Content box={back} colorMode={options.color} faded />
            </g>
          </g>
        )}

        <Sheet box={front} shadow />
        <Content box={front} colorMode={options.color} />

        {duplex && (
          // Binding edge: a row of ticks along the edge the pages turn on.
          <g stroke={PAPER.accent} stroke-width={2} stroke-linecap="round">
            {Array.from({ length: 7 }, (_, i) => {
              if (bindingLong) {
                const y = front.y + 14 + i * ((front.h - 28) / 6);
                return <line key={i} x1={front.x + 4} y1={y} x2={front.x + 8} y2={y} />;
              }
              const x = front.x + 12 + i * ((front.w - 24) / 6);
              return <line key={i} x1={x} y1={front.y + 4} x2={x} y2={front.y + 8} />;
            })}
          </g>
        )}

        {options.delivery.type === "secure" && (
          <g transform={`translate(${front.x + front.w / 2 - 14} ${front.y + front.h / 2 - 16})`}>
            <rect x={-6} y={-6} width={40} height={44} rx={8} fill={PAPER.sheet} stroke={PAPER.edge} />
            <path d="M8 13 v-5 a6 6 0 0 1 12 0 v5" fill="none" stroke={PAPER.ink} stroke-width={2.5} />
            <rect x={4} y={13} width={20} height={16} rx={2.5} fill={PAPER.ink} />
          </g>
        )}
        {options.delivery.type === "delayed" && (
          <g transform={`translate(${front.x + front.w / 2} ${front.y + front.h / 2})`}>
            <circle r={20} fill={PAPER.sheet} stroke={PAPER.ink} stroke-width={2.5} />
            <path d="M0 -11 V0 L8 6" fill="none" stroke={PAPER.ink} stroke-width={2.5} stroke-linecap="round" />
          </g>
        )}

        {options.copies > 1 && (
          <g transform={`translate(${front.x + front.w - 4} ${front.y + front.h - 4})`}>
            <rect x={-6} y={-14} width={options.copies > 99 ? 50 : options.copies > 9 ? 42 : 34} height={26} rx={13} fill={PAPER.ink} />
            <text x={options.copies > 99 ? 19 : options.copies > 9 ? 15 : 11} y={4.5} text-anchor="middle" font-size={14} font-weight={700} fill="#ffffff" class="tabular">
              ×{options.delivery.type === "sample" ? 1 : options.copies}
            </text>
          </g>
        )}
      </svg>
    </figure>
  );
}
