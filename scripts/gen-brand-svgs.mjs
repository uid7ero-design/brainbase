#!/usr/bin/env node
/**
 * gen-brand-svgs.mjs
 * Generates production-ready SVG brand assets for BRΛINBASE and HLNΛ.
 *
 * All text → vector paths via opentype.js (no font imports).
 * One master Λ shape: legs at ~24° from vertical, consistent everywhere.
 * Blob path: 12-point mathematically derived (R_out=30, R_in=22).
 *
 * Usage: node scripts/gen-brand-svgs.mjs
 */

import opentype from 'opentype.js';
import fs from 'fs';
import path from 'path';

const FONT_500 = 'node_modules/@fontsource/inter/files/inter-latin-500-normal.woff';
const FONT_600 = 'node_modules/@fontsource/inter/files/inter-latin-600-normal.woff';
const OUT = 'public/assets/brand';

// ─── font helpers ─────────────────────────────────────────────────────────────

function textPaths(font, text, x, y, fontSize, letterSpacing = 0) {
  const scale = fontSize / font.unitsPerEm;
  let cx = x;
  const paths = [];
  for (let i = 0; i < text.length; i++) {
    const glyph = font.charToGlyph(text[i]);
    const pd = glyph.getPath(cx, y, fontSize).toPathData(2);
    if (pd && pd !== 'Z') paths.push(`<path d="${pd}"/>`);
    cx += glyph.advanceWidth * scale + letterSpacing;
  }
  return { paths, endX: cx };
}

function advW(font, char, fontSize, letterSpacing = 0) {
  const scale = fontSize / font.unitsPerEm;
  return font.charToGlyph(char).advanceWidth * scale + letterSpacing;
}

// ─── SVG helpers ──────────────────────────────────────────────────────────────

function svgWrap({ w, h, label, defs, children }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${label}">
${defs ? `  <defs>\n${defs}\n  </defs>\n` : ''}${children}
</svg>`;
}

// Render <path d="M x1,base L cx,apex L x2,base"> for the Λ glyph.
function lambdaPath(x1, cx, x2, apex, base, stroke, sw = 8) {
  return `  <path d="M ${x1},${base} L ${cx},${apex} L ${x2},${base}"
        fill="none" stroke="${stroke}" stroke-width="${sw}"
        stroke-linecap="round" stroke-linejoin="round"/>`;
}

function gradDef(id, x, y0, y1, stops) {
  const s = stops.map(([o, c]) => `      <stop offset="${o}" stop-color="${c}"/>`).join('\n');
  return `    <linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x}" y1="${y0}" x2="${x}" y2="${y1}">\n${s}\n    </linearGradient>`;
}

// ─── Master Λ geometry ────────────────────────────────────────────────────────
//
//  Canonical ratio derived from standalone lambda-icon (100×100):
//    feet: x=19, x=81  →  half-width = 31
//    apex: y=14, feet: y=84  →  height = 70
//    angle from vertical: atan(31/70) ≈ 23.9°
//
//  All Λ instances must use this same angle, scaled to fit their context.
//  The feet of the Λ are always symmetric about the centre point.

const LAMBDA_HALF = 31; // canonical half-width
const LAMBDA_H    = 70; // canonical height
// tan(master angle) = LAMBDA_HALF / LAMBDA_H
const LAMBDA_TAN = LAMBDA_HALF / LAMBDA_H; // ≈ 0.443

/** Given the height of a Λ, return the half-width that matches the master angle. */
function lambdaHalf(height) {
  return height * LAMBDA_TAN;
}

// ─── BRΛINBASE wordmark ───────────────────────────────────────────────────────

async function genBrainbase(font) {
  const fontSize = 56;
  const baseline = 54;
  const ls = 3;
  const padL = 20;
  const padR = 20;
  const viewH = 72;
  const apex = 8;

  const { paths: brPaths, endX: lambdaL } = textPaths(font, 'BR', padL, baseline, fontSize, ls);

  // Λ footprint == 'A' glyph advance width (keeps consistent visual rhythm)
  const aAdv = advW(font, 'A', fontSize, ls);
  const lambdaR = lambdaL + aAdv;

  // FIX: lx1/lx2 are the actual feet; centre must be their midpoint (not lambdaR's midpoint).
  const lx1 = Math.round(lambdaL);
  const lx2 = Math.round(lambdaR - ls);   // trim trailing ls so Λ aligns with next glyph
  const lxc = Math.round((lx1 + lx2) / 2); // symmetric centre

  const { paths: inPaths, endX } = textPaths(font, 'INBASE', lambdaR, baseline, fontSize, ls);
  const viewW = Math.ceil(endX - ls + padR);

  const textPart = (fill) =>
    `  <g fill="${fill}">\n    ${[...brPaths, ...inPaths].join('\n    ')}\n  </g>`;

  const lg = gradDef('lg', lxc, baseline, apex, [
    ['0%', '#5B21B6'], ['55%', '#7C3AED'], ['100%', '#A78BFA'],
  ]);

  const variants = {
    'brainbase-wordmark.svg':           { fill: '#F5F7FA', defs: lg,        lStroke: 'url(#lg)' },
    'brainbase-wordmark-flat.svg':      { fill: '#F5F7FA', defs: undefined, lStroke: '#A78BFA'  },
    'brainbase-wordmark-light.svg':     { fill: '#0F0F0F', defs: lg,        lStroke: 'url(#lg)' },
    'brainbase-wordmark-flat-light.svg':{ fill: '#0F0F0F', defs: undefined, lStroke: '#7C3AED'  },
  };

  for (const [file, { fill, defs, lStroke }] of Object.entries(variants)) {
    const svg = svgWrap({
      w: viewW, h: viewH, label: 'BRAINBASE', defs,
      children: textPart(fill) + '\n' + lambdaPath(lx1, lxc, lx2, apex, baseline, lStroke),
    });
    fs.writeFileSync(path.join(OUT, file), svg);
  }

  console.log(`✓ BRAINBASE wordmark  ${viewW}×${viewH}  Λ=[${lx1},${lxc},${lx2}] legs=${lxc-lx1}/${lx2-lxc}px`);
}

// ─── HLNΛ wordmark ────────────────────────────────────────────────────────────

async function genHlna(font) {
  const fontSize = 52;
  const baseline = 48;
  const ls = 9;
  const padL = 18;
  const padR = 20;
  const viewH = 62;
  const apex = 7;

  const { paths: hlnPaths, endX: lambdaL } = textPaths(font, 'HLN', padL, baseline, fontSize, ls);

  const hAdv = advW(font, 'H', fontSize, ls);
  const lambdaR = lambdaL + hAdv;

  const lx1 = Math.round(lambdaL);
  const lx2 = Math.round(lambdaR - ls);
  const lxc = Math.round((lx1 + lx2) / 2); // symmetric centre — FIX

  const viewW = Math.ceil(lx2 + padR);

  const textPart = (fill) =>
    `  <g fill="${fill}">\n    ${hlnPaths.join('\n    ')}\n  </g>`;

  const lg = gradDef('lg', lxc, baseline, apex, [
    ['0%', '#6D28D9'], ['100%', '#C084FC'],
  ]);

  const variants = {
    'hlna-wordmark.svg':       { fill: '#F5F7FA', defs: lg, lStroke: 'url(#lg)' },
    'hlna-wordmark-light.svg': { fill: '#0F0F0F', defs: lg, lStroke: 'url(#lg)' },
  };

  for (const [file, { fill, defs, lStroke }] of Object.entries(variants)) {
    const svg = svgWrap({
      w: viewW, h: viewH, label: 'HLNA — Hyper Learning Neural Agent', defs,
      children: textPart(fill) + '\n' + lambdaPath(lx1, lxc, lx2, apex, baseline, lStroke),
    });
    fs.writeFileSync(path.join(OUT, file), svg);
  }

  console.log(`✓ HLNA wordmark       ${viewW}×${viewH}  Λ=[${lx1},${lxc},${lx2}] legs=${lxc-lx1}/${lx2-lxc}px`);
}

// ─── HLNΛ icon blob path ──────────────────────────────────────────────────────
//
//  12-point symmetric blob derived from polar control points:
//    6 outer lobes  at R=30, 60° apart, starting at 0° (top)
//    6 inner valleys at R=22, 30° offset
//  Bezier tangent handles: L=6px (both outer and inner), tangent ⊥ to radius.
//
//  All coordinates in 100×100 space, scaled by sc(n) = round(n * size/100 * 10)/10.

function buildBlobPath(sc) {
  // Precomputed from the polar formula.
  // Each segment: C cp1x,cp1y cp2x,cp2y ex,ey
  // where cp1 is the forward handle of the previous point,
  //       cp2 is the backward handle of the endpoint.
  return `M ${sc(50)},${sc(20)}
    C ${sc(56)},${sc(20)} ${sc(56)},${sc(28)} ${sc(61)},${sc(31)}
    C ${sc(66)},${sc(34)} ${sc(73)},${sc(30)} ${sc(76)},${sc(35)}
    C ${sc(79)},${sc(40)} ${sc(72)},${sc(44)} ${sc(72)},${sc(50)}
    C ${sc(72)},${sc(56)} ${sc(79)},${sc(60)} ${sc(76)},${sc(65)}
    C ${sc(73)},${sc(70)} ${sc(66)},${sc(66)} ${sc(61)},${sc(69)}
    C ${sc(56)},${sc(72)} ${sc(56)},${sc(80)} ${sc(50)},${sc(80)}
    C ${sc(44)},${sc(80)} ${sc(44)},${sc(72)} ${sc(39)},${sc(69)}
    C ${sc(34)},${sc(66)} ${sc(27)},${sc(70)} ${sc(24)},${sc(65)}
    C ${sc(21)},${sc(60)} ${sc(28)},${sc(56)} ${sc(28)},${sc(50)}
    C ${sc(28)},${sc(44)} ${sc(21)},${sc(40)} ${sc(24)},${sc(35)}
    C ${sc(27)},${sc(30)} ${sc(34)},${sc(34)} ${sc(39)},${sc(31)}
    C ${sc(44)},${sc(28)} ${sc(44)},${sc(20)} ${sc(50)},${sc(20)} Z`;
}

// ─── HLNΛ icon (all sizes) ────────────────────────────────────────────────────

function hlnaIconSVG({ blobStops, lambdaStops, size = 100, showGlass = false, label }) {
  const s = size / 100;
  const sc = (n) => Math.round(n * s * 10) / 10;

  // Blob gradient — coordinates scaled to current viewBox
  const blobGrad = [
    `    <linearGradient id="blobGrad" gradientUnits="userSpaceOnUse" x1="${sc(50)}" y1="${sc(80)}" x2="${sc(50)}" y2="${sc(20)}">`,
    ...blobStops.map(([o, c]) => `      <stop offset="${o}" stop-color="${c}"/>`),
    '    </linearGradient>',
  ].join('\n');

  // Λ gradient — apex to base (light at top, slightly dimmer at base)
  const lamGrad = [
    `    <linearGradient id="lamGrad" gradientUnits="userSpaceOnUse" x1="${sc(50)}" y1="${sc(74)}" x2="${sc(50)}" y2="${sc(28)}">`,
    ...lambdaStops.map(([o, c]) => `      <stop offset="${o}" stop-color="${c}"/>`),
    '    </linearGradient>',
  ].join('\n');

  const blob = buildBlobPath(sc);

  // Glass highlight: a crisp arc following the inner top-left curve of the blob.
  // Only at 100px — too noisy at smaller sizes and misleading at print scale.
  const glass = showGlass ? [
    `  <path d="M ${sc(39)},${sc(31)} C ${sc(43)},${sc(23)} ${sc(47)},${sc(21)} ${sc(50)},${sc(21)}"`,
    `        fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="${sc(3)}" stroke-linecap="round"/>`,
  ].join('\n') : '';

  // Master Λ: apex at y=28, feet at y=74 → height=46.
  // Apply master angle: half-width = lambdaHalf(46) ≈ 20.4 → 20px.
  const lHeight = sc(74) - sc(28);
  const lHalf   = Math.round(lambdaHalf(lHeight) * 10) / 10;
  const lxc = sc(50);
  const lx1 = Math.round((lxc - lHalf) * 10) / 10;
  const lx2 = Math.round((lxc + lHalf) * 10) / 10;
  const lapex = sc(28);
  const lbase = sc(74);
  const lsw   = sc(9);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${label}">
  <defs>
${blobGrad}
${lamGrad}
  </defs>
  <path d="${blob}" fill="url(#blobGrad)"/>
${glass}
  <path d="M ${lx1},${lbase} L ${lxc},${lapex} L ${lx2},${lbase}"
        fill="none" stroke="url(#lamGrad)"
        stroke-width="${lsw}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

// Simplified icon for 16px: rounded-square + crisp Λ.
// At favicon size the 12-segment blob adds complexity without adding shape reading.
function hlnaIconMicro(blobStops, lambdaStops, label) {
  const size = 16;
  const cx = 8;
  const pad = 1.5;
  const rx = 3.5;

  const blobGrad = [
    `    <linearGradient id="blobGrad" gradientUnits="userSpaceOnUse" x1="8" y1="14.5" x2="8" y2="1.5">`,
    ...blobStops.map(([o, c]) => `      <stop offset="${o}" stop-color="${c}"/>`),
    '    </linearGradient>',
  ].join('\n');

  const lamGrad = [
    `    <linearGradient id="lamGrad" gradientUnits="userSpaceOnUse" x1="8" y1="12.5" x2="8" y2="3.5">`,
    ...lambdaStops.map(([o, c]) => `      <stop offset="${o}" stop-color="${c}"/>`),
    '    </linearGradient>',
  ].join('\n');

  // Apply master angle to the micro Λ: height ≈ 9px, half-width = lambdaHalf(9)
  const lHeight = 9;
  const lHalf   = Math.round(lambdaHalf(lHeight) * 10) / 10;
  const lapex   = 3.5;
  const lbase   = 12.5;
  const lx1     = Math.round((cx - lHalf) * 10) / 10;
  const lx2     = Math.round((cx + lHalf) * 10) / 10;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${label}">
  <defs>
${blobGrad}
${lamGrad}
  </defs>
  <rect x="${pad}" y="${pad}" width="${size - pad * 2}" height="${size - pad * 2}" rx="${rx}" fill="url(#blobGrad)"/>
  <path d="M ${lx1},${lbase} L ${cx},${lapex} L ${lx2},${lbase}"
        fill="none" stroke="url(#lamGrad)"
        stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

function genHlnaIcons() {
  // Darker base → sharper gradient feel, less "glowing"
  const darkBlob  = [['0%','#1B0660'],['35%','#4616A8'],['70%','#6B2ED6'],['100%','#7C3AED']];
  const darkLam   = [['0%','#C4B5FD'],['55%','#FFFFFF'],['100%','#FFFFFF']];
  const lightBlob = [['0%','#C4B5FD'],['55%','#DDD6FE'],['100%','#EDE9FE']];
  const lightLam  = [['0%','#5B21B6'],['100%','#7C3AED']];
  const label = 'HLNA — Hyper Learning Neural Agent';

  // 100px: full detail + glass highlight
  fs.writeFileSync(path.join(OUT, 'hlna-icon.svg'),
    hlnaIconSVG({ blobStops: darkBlob,  lambdaStops: darkLam,  size: 100, showGlass: true,  label }));
  fs.writeFileSync(path.join(OUT, 'hlna-icon-light.svg'),
    hlnaIconSVG({ blobStops: lightBlob, lambdaStops: lightLam, size: 100, showGlass: true,  label }));

  // 64px / 32px: full blob, no glass
  for (const sz of [64, 32]) {
    fs.writeFileSync(path.join(OUT, `hlna-icon-${sz}.svg`),
      hlnaIconSVG({ blobStops: darkBlob, lambdaStops: darkLam, size: sz, showGlass: false, label }));
  }

  // 16px: simplified rounded-square favicon
  fs.writeFileSync(path.join(OUT, 'hlna-icon-16.svg'),
    hlnaIconMicro(darkBlob, darkLam, label));

  console.log('✓ HLNA icons  (100, 64, 32px blob  +  16px micro  +  light)');
}

// ─── Λ standalone icon ────────────────────────────────────────────────────────
//
//  Master canonical shape at 100px: feet at x=19,81  apex at y=14,84.
//  Scaled proportionally for 64/32/16 using the same master angle.

function lambdaIconSVG({ size, darkMode = true }) {
  const s = size / 100;
  const r = (n) => Math.round(n * s * 10) / 10;

  // Master foot spread (62px at 100px) and height (70px at 100px)
  const x1   = r(19);
  const cx   = r(50);
  const x2   = r(81);
  const apex = r(14);
  const base = r(84);

  // Stroke width scales proportionally — clamped to ≥1.5px at tiny sizes
  const sw = Math.max(1.5, r(13));

  const stops = darkMode
    ? [['0%','#5B21B6'],['50%','#7C3AED'],['100%','#C084FC']]
    : [['0%','#4C1D95'],['50%','#6D28D9'],['100%','#9333EA']];

  const lg = [
    `    <linearGradient id="lg" gradientUnits="userSpaceOnUse" x1="${cx}" y1="${base}" x2="${cx}" y2="${apex}">`,
    ...stops.map(([o, c]) => `      <stop offset="${o}" stop-color="${c}"/>`),
    '    </linearGradient>',
  ].join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Lambda — HLNA symbol">
  <defs>
${lg}
  </defs>
  <path d="M ${x1},${base} L ${cx},${apex} L ${x2},${base}"
        fill="none" stroke="url(#lg)" stroke-width="${sw}"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

function genLambdaIcons() {
  fs.writeFileSync(path.join(OUT, 'lambda-icon.svg'),       lambdaIconSVG({ size: 100 }));
  fs.writeFileSync(path.join(OUT, 'lambda-icon-light.svg'), lambdaIconSVG({ size: 100, darkMode: false }));
  for (const sz of [64, 32, 16]) {
    fs.writeFileSync(path.join(OUT, `lambda-icon-${sz}.svg`), lambdaIconSVG({ size: sz }));
  }
  console.log('✓ Lambda icons  (100, 64, 32, 16px  +  light)');
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const font500 = await opentype.load(FONT_500);
  const font600 = await opentype.load(FONT_600);

  await genBrainbase(font500);
  await genHlna(font600);
  genHlnaIcons();
  genLambdaIcons();

  console.log(`\nAll assets written to ${OUT}/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
