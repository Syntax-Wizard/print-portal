/**
 * Geometry for printing several pages on one sheet ("2 in 1", "4 in 1").
 * Pure functions so they can be unit tested without a PDF library.
 */

export type PagesPerSheet = 1 | 2 | 4;

export interface Size {
  width: number;
  height: number;
}

export interface Cell {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SheetLayout {
  sheet: Size;
  /** Cells in reading order: left to right, then top to bottom. PDF origin is bottom-left. */
  cells: Cell[];
}

/** Paper sizes in PDF points (1/72 inch). B sizes are JIS, as used in Japan. */
export const PAPER_POINTS: Record<string, Size> = {
  A3: { width: 842, height: 1191 },
  A4: { width: 595, height: 842 },
  A5: { width: 420, height: 595 },
  B4: { width: 729, height: 1032 },
  B5: { width: 516, height: 729 },
  letter: { width: 612, height: 792 },
  legal: { width: 612, height: 1008 },
  ledger: { width: 792, height: 1224 },
  folio: { width: 612, height: 936 },
  "11x15": { width: 792, height: 1080 },
};

const MARGIN = 18; // about 6 mm, inside most printers' unprintable area
const GAP = 12;

function grid(sheet: Size, cols: number, rows: number): Cell[] {
  const w = (sheet.width - 2 * MARGIN - (cols - 1) * GAP) / cols;
  const h = (sheet.height - 2 * MARGIN - (rows - 1) * GAP) / rows;
  const cells: Cell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ x: MARGIN + c * (w + GAP), y: sheet.height - MARGIN - (r + 1) * h - r * GAP, width: w, height: h });
    }
  }
  return cells;
}

export function fitScale(page: Size, cell: Size): number {
  return Math.min(cell.width / page.width, cell.height / page.height);
}

/**
 * Choose the sheet orientation and grid that make `page` (the first page, as displayed)
 * as large as possible: portrait pages go side by side on a landscape sheet for 2-up,
 * while landscape pages such as slides stack on a portrait sheet.
 */
export function chooseLayout(pagesPerSheet: PagesPerSheet, paper: Size, page: Size): SheetLayout {
  const portrait = { width: Math.min(paper.width, paper.height), height: Math.max(paper.width, paper.height) };
  const landscape = { width: portrait.height, height: portrait.width };
  if (pagesPerSheet === 1) {
    const sheet = page.width > page.height ? landscape : portrait;
    return { sheet, cells: grid(sheet, 1, 1) };
  }
  const candidates: SheetLayout[] =
    pagesPerSheet === 2
      ? [
          { sheet: landscape, cells: grid(landscape, 2, 1) },
          { sheet: portrait, cells: grid(portrait, 1, 2) },
        ]
      : [
          { sheet: portrait, cells: grid(portrait, 2, 2) },
          { sheet: landscape, cells: grid(landscape, 2, 2) },
        ];
  return candidates.reduce((best, c) => (fitScale(page, c.cells[0]!) > fitScale(page, best.cells[0]!) ? c : best));
}

export interface Placement {
  x: number;
  y: number;
  scale: number;
  /** Counter-clockwise rotation in degrees, as pdf-lib's drawPage expects. */
  rotate: number;
}

/**
 * Where to draw an embedded page (unrotated size `w` x `h`, page rotation `angle` clockwise)
 * so that it appears upright, scaled to fit and centred in `cell`.
 */
export function placePage(w: number, h: number, angle: number, cell: Cell): Placement {
  const a = ((angle % 360) + 360) % 360;
  const sideways = a === 90 || a === 270;
  const shown = sideways ? { width: h, height: w } : { width: w, height: h };
  const scale = fitScale(shown, cell);
  const bx = cell.x + (cell.width - shown.width * scale) / 2;
  const by = cell.y + (cell.height - shown.height * scale) / 2;
  switch (a) {
    case 90:
      return { x: bx, y: by + w * scale, scale, rotate: -90 };
    case 180:
      return { x: bx + w * scale, y: by + h * scale, scale, rotate: 180 };
    case 270:
      return { x: bx + h * scale, y: by, scale, rotate: 90 };
    default:
      return { x: bx, y: by, scale, rotate: 0 };
  }
}

/** Sheets of paper used for `pages` pages (approximate when copies are collated by the printer). */
export function sheetsNeeded(pages: number, pagesPerSheet: PagesPerSheet, duplex: boolean, copies: number): number {
  const sides = Math.ceil(pages / pagesPerSheet);
  return (duplex ? Math.ceil(sides / 2) : sides) * copies;
}
