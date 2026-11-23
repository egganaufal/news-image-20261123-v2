// news-image-20261123 — "THE WORLD": one day's world news, Monday 23 November 2026.
// Pure Node 22 stdlib. Draws a 1024x1024 newsprint front page entirely in code
// (RGB buffer + hand-rolled PNG encoder) and writes it to /output/entry.png.
// Deterministic: no Date, no randomness, no network, no file reads.

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const W = 1024;
const H = 1024;

// ---- palette ---------------------------------------------------------------
const PAPER = [246, 241, 227];
const INK = [25, 23, 19];
const RED = [164, 31, 36];
const BLUE = [31, 78, 121];
const TEAL = [15, 118, 110];
const SKY = [220, 233, 242];
const OCEAN = [47, 111, 178];
const LAND = [61, 139, 79];
const FLAME = [232, 98, 27];
const EMBER = [198, 44, 28];
const GREY = [138, 133, 120];
const WHITE = [255, 255, 255];
const SAFFRON = [255, 153, 51];
const CRIMSON = [220, 20, 60];
const DARKSEA = [16, 42, 67];

type RGB = [number, number, number];

const buf = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) {
  buf[i * 3] = PAPER[0];
  buf[i * 3 + 1] = PAPER[1];
  buf[i * 3 + 2] = PAPER[2];
}

function px(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = (y * W + x) * 3;
  buf[o] = c[0];
  buf[o + 1] = c[1];
  buf[o + 2] = c[2];
}

function rect(x: number, y: number, w: number, h: number, c: RGB): void {
  for (let j = y; j < y + h; j++)
    for (let i = x; i < x + w; i++) px(i, j, c);
}

function hline(x: number, y: number, w: number, c: RGB, t = 1): void {
  for (let k = 0; k < t; k++) rect(x, y + k, w, 1, c);
}

function vline(x: number, y: number, h: number, c: RGB, t = 1): void {
  for (let k = 0; k < t; k++) rect(x + k, y, 1, h, c);
}

function frame(x: number, y: number, w: number, h: number, c: RGB, t = 1): void {
  hline(x, y, w, c, t);
  hline(x, y + h - t, w, c, t);
  vline(x, y, h, c, t);
  vline(x + w - t, y, h, c, t);
}

function line(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    px(x, y, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

function thickLine(x0: number, y0: number, x1: number, y1: number, c: RGB, t: number): void {
  for (let a = 0; a < t; a++)
    for (let b = 0; b < t; b++) line(x0 + a, y0 + b, x1 + a, y1 + b, c);
}

function circle(cx: number, cy: number, r: number, c: RGB): void {
  for (let y = cy - r; y <= cy + r; y++) {
    const dy = y - cy;
    const dx = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
    for (let x = cx - dx; x <= cx + dx; x++) px(x, y, c);
  }
}

function ring(cx: number, cy: number, r: number, c: RGB, t: number): void {
  for (let k = 0; k < t; k++) {
    const rr = r - k;
    for (let a = 0; a < 360; a++) {
      const rad = (a * Math.PI) / 180;
      px(Math.round(cx + rr * Math.cos(rad)), Math.round(cy + rr * Math.sin(rad)), c);
    }
  }
}

function ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
  for (let y = cy - ry; y <= cy + ry; y++) {
    const dy = (y - cy) / ry;
    const dx = Math.floor(rx * Math.sqrt(Math.max(0, 1 - dy * dy)));
    for (let x = cx - dx; x <= cx + dx; x++) px(x, y, c);
  }
}

function tri(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB): void {
  const minX = Math.min(x0, x1, x2);
  const maxX = Math.max(x0, x1, x2);
  const minY = Math.min(y0, y1, y2);
  const maxY = Math.max(y0, y1, y2);
  const d = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
  if (d === 0) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const a = ((x1 - x) * (y2 - y) - (y1 - y) * (x2 - x)) / d;
      const b = ((x2 - x) * (y0 - y) - (y2 - y) * (x0 - x)) / d;
      const g = 1 - a - b;
      if (a >= 0 && b >= 0 && g >= 0) px(x, y, c);
    }
  }
}

// ---- 5x7 bitmap font -------------------------------------------------------
// Each glyph: 7 rows of 5 chars, '#' = ink. Uppercase + digits + punctuation.
const FONT: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".####", "#....", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "##..#", "#.#.#", "#..##", "#..##", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "...#.", "..#..", "..#..", "..#.."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
  ".": [".....", ".....", ".....", ".....", ".....", ".....", "..#.."],
  ",": [".....", ".....", ".....", ".....", ".....", "..#..", ".#..."],
  ":": [".....", "..#..", ".....", ".....", ".....", "..#..", "....."],
  ";": [".....", "..#..", ".....", ".....", ".....", "..#..", ".#..."],
  "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  "'": ["..#..", "..#..", ".....", ".....", ".....", ".....", "....."],
  '"': [".#.#.", ".#.#.", ".....", ".....", ".....", ".....", "....."],
  "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
  "(": ["...#.", "..#..", ".#...", ".#...", ".#...", "..#..", "...#."],
  ")": [".#...", "..#..", "...#.", "...#.", "...#.", "..#..", ".#..."],
  "&": [".###.", "#...#", "#.#..", ".#...", "#.#.#", "#..#.", ".##.#"],
  "%": ["#...#", "#..#.", "...#.", "..#..", ".#...", ".#..#", "#...#"],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
  "=": [".....", ".....", "#####", ".....", "#####", ".....", "....."],
  "\u2022": [".....", ".....", ".###.", ".###.", ".###.", ".....", "....."],
  "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
};

function glyph(ch: string): string[] {
  return FONT[ch] ?? FONT["?"];
}

function textWidth(s: string, scale: number): number {
  if (s.length === 0) return 0;
  return s.length * 6 * scale - scale;
}

function drawText(x: number, y: number, s: string, scale: number, c: RGB): void {
  let cx = x;
  for (const ch of s) {
    const g = glyph(ch);
    for (let r = 0; r < 7; r++) {
      for (let col = 0; col < 5; col++) {
        if (g[r][col] === "#") rect(cx + col * scale, y + r * scale, scale, scale, c);
      }
    }
    cx += 6 * scale;
  }
}

function drawCentered(cx: number, y: number, s: string, scale: number, c: RGB): void {
  drawText(cx - Math.floor(textWidth(s, scale) / 2), y, s, scale, c);
}

// Word-wrap to a pixel width; returns lines.
function wrapText(s: string, scale: number, maxW: number): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur === "" ? w : cur + " " + w;
    if (textWidth(trial, scale) <= maxW || cur === "") {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}

// Draw a wrapped paragraph; returns the y just past the last line.
function drawBlock(x: number, y: number, s: string, scale: number, maxW: number, c: RGB, lh: number): number {
  const lines = wrapText(s, scale, maxW);
  for (const ln of lines) {
    drawText(x, y, ln, scale, c);
    y += lh;
  }
  return y;
}

// ---- PNG encoder -----------------------------------------------------------
const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}
function encodePNG(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    buf.copy(raw, y * (1 + W * 3) + 1, y * W * 3, (y + 1) * W * 3);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- layout ----------------------------------------------------------------
const MX = 28; // content left
const MR = 996; // content right
const CW = MR - MX; // 968

// Double border
frame(14, 14, W - 28, H - 28, INK, 2);
frame(20, 20, W - 40, H - 40, INK, 1);

// Masthead
drawCentered(512, 36, "THE WORLD", 11, INK);
hline(MX, 128, CW, INK, 2);
drawCentered(512, 142, "MONDAY 23 NOVEMBER 2026", 4, RED);
hline(MX, 180, CW, INK, 3);

// ---- Lead: left ~60% -------------------------------------------------------
const LEAD_Y = 198;
const LEAD_R = 628; // lead text right edge
drawText(MX, LEAD_Y, "CLIMATE \u2022 COP31 \u2022 ANTALYA", 2, RED);
drawText(MX, LEAD_Y + 28, "CLIMATE TALKS", 6, INK);
drawText(MX, LEAD_Y + 72, "COLLAPSE", 6, RED);
let y = LEAD_Y + 128;
y = drawBlock(
  MX,
  y,
  "EU AND ALLIES REJECT A DRAFT DEAL WITH NO MENTION OF FOSSIL FUELS AS THE UN CLIMATE SUMMIT IN ANTALYA, TURKIYE, RUNS INTO A SECOND DAY OF OVERTIME.",
  2,
  LEAD_R - MX,
  INK,
  19,
);
y += 8;
y = drawBlock(
  MX,
  y,
  "NEGOTIATORS RACE TO SAVE THE TALKS WHILE THE WORLD'S BIGGEST POLLUTERS HOLD OUT.",
  2,
  LEAD_R - MX,
  INK,
  19,
);
y += 10;
drawText(MX, y, "THE WORLD WATCHES ANTALYA", 2, RED);

// ---- Lead: right ~40%, flaming globe ---------------------------------------
const PANEL_X = 648;
const PANEL_Y = LEAD_Y;
const PANEL_W = MR - PANEL_X; // 348
const PANEL_H = 272;
frame(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, INK, 2);
rect(PANEL_X + 2, PANEL_Y + 2, PANEL_W - 4, PANEL_H - 4, SKY);
const GX = PANEL_X + Math.floor(PANEL_W / 2); // 822
const GY = PANEL_Y + 128; // 326
const GR = 100;
// flames above the globe
tri(GX - 78, GY - GR + 22, GX - 58, GY - GR + 22, GX - 68, GY - GR - 18, FLAME);
tri(GX - 30, GY - GR + 26, GX - 6, GY - GR + 26, GX - 18, GY - GR - 26, EMBER);
tri(GX + 16, GY - GR + 24, GX + 44, GY - GR + 24, GX + 30, GY - GR - 14, FLAME);
tri(GX + 52, GY - GR + 26, GX + 76, GY - GR + 26, GX + 64, GY - GR - 10, EMBER);
// ocean globe
circle(GX, GY, GR, OCEAN);
ring(GX, GY, GR, INK, 2);
// land blobs, all fully inside the globe
circle(GX - 38, GY - 32, 26, LAND);
circle(GX + 30, GY - 26, 20, LAND);
circle(GX - 30, GY + 32, 18, LAND);
circle(GX + 26, GY + 36, 15, LAND);
circle(GX + 2, GY + 4, 12, LAND);
// clouds
ellipse(GX - 52, GY - 58, 20, 7, WHITE);
ellipse(GX + 48, GY + 58, 18, 6, WHITE);
// dark crack zigzag across the lower globe
thickLine(GX - 62, GY + 38, GX - 34, GY + 58, INK, 3);
thickLine(GX - 34, GY + 58, GX - 8, GY + 40, INK, 3);
thickLine(GX - 8, GY + 40, GX + 22, GY + 64, INK, 3);
thickLine(GX + 22, GY + 64, GX + 52, GY + 46, INK, 3);
drawCentered(GX, PANEL_Y + PANEL_H - 30, "THE PLANET WAITS", 2, INK);

// ---- Rule, then three columns ----------------------------------------------
const COLS_Y = 492;
hline(MX, COLS_Y, CW, INK, 2);
const COL_W = 312;
const COL_X = [MX, 356, 684];
const COL_GAP = 8;

// Column 1 — Hormuz
let cy = COLS_Y + 14;
drawText(COL_X[0], cy, "MIDDLE EAST \u2022 HORMUZ", 2, RED);
cy += 24;
cy = drawBlock(COL_X[0], cy, "STRIKES HIT THE GULF", 3, COL_W, INK, 24);
cy += 6;
const PIC_Y = cy;
const PIC_H = 104;
// sea + tanker + missile streaks + burst
rect(COL_X[0], PIC_Y, COL_W, PIC_H, SKY);
rect(COL_X[0], PIC_Y + 62, COL_W, PIC_H - 62, DARKSEA);
rect(COL_X[0] + 52, PIC_Y + 46, 190, 20, INK); // tanker hull
rect(COL_X[0] + 60, PIC_Y + 30, 34, 16, INK); // bridge
rect(COL_X[0] + 100, PIC_Y + 36, 26, 10, RED);
rect(COL_X[0] + 132, PIC_Y + 36, 26, 10, TEAL);
rect(COL_X[0] + 164, PIC_Y + 36, 26, 10, SAFFRON);
thickLine(COL_X[0] + 250, PIC_Y + 8, COL_X[0] + 282, PIC_Y + 34, FLAME, 2);
thickLine(COL_X[0] + 262, PIC_Y + 4, COL_X[0] + 286, PIC_Y + 28, EMBER, 2);
circle(COL_X[0] + 288, PIC_Y + 36, 7, FLAME);
circle(COL_X[0] + 288, PIC_Y + 36, 3, EMBER);
frame(COL_X[0], PIC_Y, COL_W, PIC_H, INK, 1);
cy = PIC_Y + PIC_H + 10;
drawBlock(
  COL_X[0],
  cy,
  "IRAN-LINKED ATTACKS HIT A US BASE IN BAHRAIN AND WESTERN SAUDI ARABIA. A SAUDI-LED COALITION SAYS IT SHOT DOWN A HOUTHI MISSILE.",
  2,
  COL_W,
  INK,
  19,
);

// Column 2 — Ukraine
cy = COLS_Y + 14;
drawText(COL_X[1], cy, "WAR \u2022 UKRAINE", 2, RED);
cy += 24;
cy = drawBlock(COL_X[1], cy, "DRONE SETS SHIP ABLAZE", 3, COL_W, INK, 24);
cy += 6;
rect(COL_X[1], PIC_Y, COL_W, PIC_H, SKY);
rect(COL_X[1], PIC_Y + 62, COL_W, PIC_H - 62, DARKSEA);
rect(COL_X[1] + 52, PIC_Y + 46, 190, 20, INK); // cargo ship hull
rect(COL_X[1] + 62, PIC_Y + 28, 40, 18, RED); // containers
rect(COL_X[1] + 106, PIC_Y + 28, 40, 18, TEAL);
rect(COL_X[1] + 150, PIC_Y + 28, 40, 18, BLUE);
rect(COL_X[1] + 200, PIC_Y + 34, 22, 12, INK);
// flames above the ship
tri(COL_X[1] + 70, PIC_Y + 28, COL_X[1] + 86, PIC_Y + 28, COL_X[1] + 78, PIC_Y + 6, FLAME);
tri(COL_X[1] + 112, PIC_Y + 28, COL_X[1] + 130, PIC_Y + 28, COL_X[1] + 121, PIC_Y + 2, EMBER);
tri(COL_X[1] + 156, PIC_Y + 28, COL_X[1] + 172, PIC_Y + 28, COL_X[1] + 164, PIC_Y + 10, FLAME);
// smoke
circle(COL_X[1] + 90, PIC_Y + 2, 9, GREY);
circle(COL_X[1] + 122, PIC_Y - 2, 11, GREY);
circle(COL_X[1] + 152, PIC_Y + 4, 8, GREY);
frame(COL_X[1], PIC_Y, COL_W, PIC_H, INK, 1);
cy = PIC_Y + PIC_H + 10;
drawBlock(
  COL_X[1],
  cy,
  "A UKRAINIAN DRONE SET A RUSSIAN CARGO SHIP ON FIRE OFF FINLAND. 14 ARE MISSING AFTER A RUSSIAN DRONE HIT A BUILDING NEAR KYIV.",
  2,
  COL_W,
  INK,
  19,
);

// Column 3 — Nepal–India
cy = COLS_Y + 14;
drawText(COL_X[2], cy, "ASIA \u2022 NEPAL-INDIA", 2, RED);
cy += 24;
cy = drawBlock(COL_X[2], cy, "SHAH MEETS MODI IN DELHI", 3, COL_W, INK, 24);
cy += 6;
rect(COL_X[2], PIC_Y, COL_W, PIC_H, SKY);
// flag poles
vline(COL_X[2] + 78, PIC_Y + 12, 80, INK, 3);
vline(COL_X[2] + 208, PIC_Y + 12, 80, INK, 3);
// Nepal: crimson double-pennon (two stacked triangles)
tri(COL_X[2] + 81, PIC_Y + 14, COL_X[2] + 81, PIC_Y + 50, COL_X[2] + 150, PIC_Y + 50, CRIMSON);
tri(COL_X[2] + 81, PIC_Y + 52, COL_X[2] + 81, PIC_Y + 88, COL_X[2] + 138, PIC_Y + 88, CRIMSON);
circle(COL_X[2] + 96, PIC_Y + 30, 4, WHITE);
circle(COL_X[2] + 96, PIC_Y + 66, 4, WHITE);
// India: tricolour
rect(COL_X[2] + 211, PIC_Y + 14, 84, 20, SAFFRON);
rect(COL_X[2] + 211, PIC_Y + 34, 84, 20, WHITE);
rect(COL_X[2] + 211, PIC_Y + 54, 84, 20, LAND);
ring(COL_X[2] + 253, PIC_Y + 44, 9, BLUE, 2);
frame(COL_X[2], PIC_Y, COL_W, PIC_H, INK, 1);
cy = PIC_Y + PIC_H + 10;
drawBlock(
  COL_X[2],
  cy,
  "NEPAL PM BALENDRA SHAH HOLDS BILATERAL TALKS WITH PM MODI IN DELHI ON A 22-23 NOV STATE VISIT.",
  2,
  COL_W,
  INK,
  19,
);

// Thin grey vertical rules between columns
vline(COL_X[1] - COL_GAP - 1, COLS_Y + 14, 296, GREY, 1);
vline(COL_X[2] - COL_GAP - 1, COLS_Y + 14, 296, GREY, 1);

// ---- Also today strip ------------------------------------------------------
const STRIP_Y = 812;
hline(MX, STRIP_Y, CW, INK, 2);
drawText(MX, STRIP_Y + 12, "ALSO TODAY", 3, RED);
const ITEM_Y1 = STRIP_Y + 46;
const ITEM_Y2 = STRIP_Y + 96;
const HALF_W = 470;
drawBlock(MX, ITEM_Y1, "CRICKET: INDIA POST A RECORD 720/9 IN THE WELLINGTON TEST VS NEW ZEALAND.", 2, HALF_W, INK, 19);
drawBlock(MX + 498, ITEM_Y1, "LISBON: THOUSANDS MARCH OVER THE COST OF LIVING.", 2, HALF_W, INK, 19);
drawBlock(MX, ITEM_Y2, "SEOUL: EDUCATION MINISTER QUITS OVER AN AI CHEATING SCANDAL.", 2, HALF_W, INK, 19);
drawBlock(MX + 498, ITEM_Y2, "INDONESIA: 7 DEAD, 50 MISSING IN A FACTORY FIRE.", 2, HALF_W, INK, 19);

// ---- Footer ----------------------------------------------------------------
hline(MX, 948, CW, INK, 2);
drawCentered(512, 962, "23 NOVEMBER 2026 \u2022 THE WORLD IN ONE IMAGE", 2, INK);

// ---- Write output ----------------------------------------------------------
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "entry.png");
fs.writeFileSync(outPath, encodePNG());
