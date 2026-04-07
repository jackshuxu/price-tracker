"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import type { Category } from "@/lib/categories";
import type { PriceData } from "@/lib/bls";
import TrendChart from "./TrendChart";
import { ICON_URLS } from "@/lib/icon-urls";

// ─── Basket geometry constants (measured from basket.png pixel scan) ──────────
const BASKET_ASPECT = 2.233;
const WALL_TOP_Y = 0.26;
const WALL_BOT_Y = 0.88;
const WALL_L_TOP_X = 0.18;
const WALL_R_TOP_X = 0.82;
const WALL_L_BOT_X = 0.25;
const WALL_R_BOT_X = 0.75;

// ─── Sizing helpers ──────────────────────────────────────────────────────────
function baseSize(W: number) {
  return Math.round(W * 0.125);
}
function inflationScale(pct: number): number {
  return Math.max(0.75, Math.min(1.5, 1 + pct * 0.025));
}
function labelFontSize(iconSz: number): number {
  return Math.max(12, Math.round(iconSz * 0.165));
}

// ─── Alpha extraction & contour ──────────────────────────────────────────────
function extractAlpha(img: HTMLImageElement, w: number, h: number): Uint8Array {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const cx = c.getContext("2d")!;
  cx.drawImage(img, 0, 0, w, h);
  const { data } = cx.getImageData(0, 0, w, h);
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = data[i * 4 + 3];
  return alpha;
}

function extractContour(
  alpha: Uint8Array,
  w: number,
  h: number,
  padding: number,
  numRays = 48,
): { x: number; y: number }[] {
  let cx = 0,
    cy = 0,
    n = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (alpha[y * w + x] > 128) {
        cx += x;
        cy += y;
        n++;
      }
  if (n === 0) return [];
  cx /= n;
  cy /= n;
  const points: { x: number; y: number }[] = [];
  const maxR = Math.hypot(w, h);
  for (let i = 0; i < numRays; i++) {
    const angle = (i / numRays) * Math.PI * 2;
    const dx = Math.cos(angle),
      dy = Math.sin(angle);
    let lastSolid = 0;
    for (let r = 0; r <= maxR; r++) {
      const px = Math.round(cx + dx * r);
      const py = Math.round(cy + dy * r);
      if (px < 0 || py < 0 || px >= w || py >= h) break;
      if (alpha[py * w + px] > 128) lastSolid = r;
    }
    const finalR = lastSolid + padding;
    points.push({ x: cx + dx * finalR - w / 2, y: cy + dy * finalR - h / 2 });
  }
  return points;
}

function alphaHitTest(
  alpha: Uint8Array,
  aw: number,
  ah: number,
  imgLocalX: number,
  imgLocalY: number,
  currentScale: number,
  pad: number,
): boolean {
  const mx = imgLocalX / currentScale + aw / 2;
  const my = imgLocalY / currentScale + ah / 2;
  const padM = Math.ceil(pad / currentScale);
  if (mx < -padM || my < -padM || mx >= aw + padM || my >= ah + padM)
    return false;
  const x0 = Math.max(0, Math.floor(mx) - padM);
  const x1 = Math.min(aw - 1, Math.ceil(mx) + padM);
  const y0 = Math.max(0, Math.floor(my) - padM);
  const y1 = Math.min(ah - 1, Math.ceil(my) + padM);
  const padSq = (pad / currentScale) ** 2;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if (alpha[y * aw + x] > 128) {
        const ddx = x - mx,
          ddy = y - my;
        if (ddx * ddx + ddy * ddy <= padSq) return true;
      }
  return false;
}

// ─── Golden angle for float placement ────────────────────────────────────────
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// ─── Props ───────────────────────────────────────────────────────────────────
interface Props {
  categories: Category[];
  priceDataMap: Record<string, PriceData>;
  heroMode?: boolean;
  onFallReady?: (triggerFall: () => void) => void;
}

interface ModalState {
  category: Category;
  priceData: PriceData;
}

// ─── Float icon state ────────────────────────────────────────────────────────
interface FloatIcon {
  slug: string;
  img: HTMLImageElement;
  drawW: number;
  drawH: number;
  baseX: number;
  baseY: number;
  currentX: number;
  currentY: number;
  currentRot: number;
  freqX: number;
  freqY: number;
  phaseX: number;
  phaseY: number;
  ampX: number;
  ampY: number;
  baseRot: number;
  vx: number;
  vy: number;
  pctChange: number;
  targetScale: number;
  alphaData: Uint8Array;
  alphaW: number;
  alphaH: number;
  contour: { x: number; y: number }[];
  bcX: number;
  bcY: number;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function BasketPhysics({
  categories,
  priceDataMap,
  heroMode,
  onFallReady,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [modal, setModal] = useState<ModalState | null>(null);

  const openModal = useCallback(
    (slug: string) => {
      const cat = categories.find((c) => c.slug === slug);
      const pd = priceDataMap[slug];
      if (cat && pd) setModal({ category: cat, priceData: pd });
    },
    [categories, priceDataMap],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;

    // ── Canvas sizing ──────────────────────────────────────────────────────
    const DPR = window.devicePixelRatio || 1;
    const W = canvas.parentElement!.clientWidth;
    const containerH = canvas.parentElement!.clientHeight;

    // Basket dimensions
    const bW = heroMode ? W * 0.86 : W * 0.98;
    const bH = bW / BASKET_ASPECT;
    const bX = (W - bW) / 2;

    // Canvas height & basket Y position
    let H: number, bY: number;
    if (heroMode) {
      H = Math.max(containerH, bH + 100);
      bY = H - bH;
    } else {
      const DROP_ZONE = bH * WALL_TOP_Y + 20;
      H = bH + DROP_ZONE;
      bY = DROP_ZONE;
    }

    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${Math.round(H)}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(DPR, DPR);

    // ── Wall endpoints ─────────────────────────────────────────────────────
    const WL_TOP = { x: bX + bW * WALL_L_TOP_X, y: bY + bH * WALL_TOP_Y };
    const WR_TOP = { x: bX + bW * WALL_R_TOP_X, y: bY + bH * WALL_TOP_Y };
    const WL_BOT = { x: bX + bW * WALL_L_BOT_X, y: bY + bH * WALL_BOT_Y };
    const WR_BOT = { x: bX + bW * WALL_R_BOT_X, y: bY + bH * WALL_BOT_Y };

    // ── Basket image ───────────────────────────────────────────────────────
    const basketImg = new Image();
    basketImg.src = "/icons/basket.png";

    // ── Phase tracking ─────────────────────────────────────────────────────
    let phase: "floating" | "physics" = heroMode ? "floating" : "physics";
    let rafId = 0;
    const cleanup = { fn: () => {} };

    // ── Click-vs-drag tracking ─────────────────────────────────────────────
    let downPos: { x: number; y: number } | null = null;
    let downSlug: string | null = null;

    // ── Float state ────────────────────────────────────────────────────────
    const floatIcons: FloatIcon[] = [];
    let mousePos: { x: number; y: number } | null = null;
    const validCats = categories.filter((c) => ICON_URLS[c.slug]);

    // Float icon placement — responsive to screen size
    const isMobile = W <= 767;
    const isTablet = W > 767 && W <= 1024;
    const floatCenterX = W * 0.5;
    const floatCenterY = isMobile ? H * 0.62 : isTablet ? H * 0.60 : H * 0.5;
    const floatRadius = isMobile
      ? Math.min(W * 0.44, H * 0.28)
      : isTablet
        ? Math.min(W * 0.36, H * 0.25)
        : Math.min(W * 0.35, H * 0.3);

    // ── Load images and prepare float icons ────────────────────────────────
    let pending = validCats.length;
    const base = isMobile ? Math.round(W * 0.16) : baseSize(W);

    validCats.forEach((cat, idx) => {
      const pd = priceDataMap[cat.slug];
      const pct = pd?.pctChange3m ?? 0;
      const tScale = inflationScale(pct);
      const img = new Image();
      img.src = ICON_URLS[cat.slug];

      const onLoad = () => {
        const nat = img.naturalWidth / img.naturalHeight;
        let bDrawW: number, bDrawH: number;
        if (nat >= 1) {
          bDrawW = base;
          bDrawH = base / nat;
        } else {
          bDrawH = base;
          bDrawW = base * nat;
        }

        const alphaW = Math.round(bDrawW);
        const alphaH = Math.round(bDrawH);
        const alphaData = extractAlpha(img, alphaW, alphaH);
        const contour = extractContour(alphaData, alphaW, alphaH, 10, 48);
        let bcX = 0,
          bcY = 0;
        if (contour.length >= 3) {
          const xs = contour.map((v) => v.x),
            ys = contour.map((v) => v.y);
          bcX = (Math.min(...xs) + Math.max(...xs)) / 2;
          bcY = (Math.min(...ys) + Math.max(...ys)) / 2;
        }

        // Golden-angle spiral placement
        const r = Math.sqrt((idx + 0.5) / validCats.length) * floatRadius;
        const theta = idx * GOLDEN_ANGLE;
        const jX = (Math.random() - 0.5) * base * 0.6;
        const jY = (Math.random() - 0.5) * base * 0.6;
        const bx = floatCenterX + r * Math.cos(theta) + jX;
        const by = floatCenterY + r * Math.sin(theta) + jY;

        floatIcons.push({
          slug: cat.slug,
          img,
          drawW: bDrawW,
          drawH: bDrawH,
          baseX: bx,
          baseY: by,
          currentX: bx,
          currentY: by,
          currentRot: (Math.random() - 0.5) * 0.15,
          freqX: 0.0004 + Math.random() * 0.0003,
          freqY: 0.0003 + Math.random() * 0.0004,
          phaseX: Math.random() * Math.PI * 2,
          phaseY: Math.random() * Math.PI * 2,
          ampX: 6 + Math.random() * 10,
          ampY: 5 + Math.random() * 8,
          baseRot: (Math.random() - 0.5) * 0.15,
          vx: 0,
          vy: 0,
          pctChange: pct,
          targetScale: tScale,
          alphaData,
          alphaW,
          alphaH,
          contour,
          bcX,
          bcY,
        });

        pending--;
        if (pending <= 0) {
          if (heroMode) startFloatLoop();
          startPhysics(); // always load Matter.js; in heroMode it just exposes triggerFall
        }
      };

      if (img.complete && img.naturalWidth > 0) onLoad();
      else {
        img.onload = onLoad;
        img.onerror = () => {
          pending--;
          if (pending <= 0) {
            if (heroMode) startFloatLoop();
            startPhysics();
          }
        };
      }
    });

    // ── Float render loop (no physics) ─────────────────────────────────────
    function startFloatLoop() {
      function floatLoop() {
        if (phase !== "floating") return;
        const now = performance.now();
        ctx.clearRect(0, 0, W, H);

        // Inter-icon repulsion: push apart when overlapping
        for (let i = 0; i < floatIcons.length; i++) {
          const a = floatIcons[i];
          const aR = Math.max(a.drawW, a.drawH) * 0.5 + 8; // half-size + padding
          for (let j = i + 1; j < floatIcons.length; j++) {
            const b = floatIcons[j];
            const bR = Math.max(b.drawW, b.drawH) * 0.5 + 8;
            const dx = a.currentX - b.currentX;
            const dy = a.currentY - b.currentY;
            const dist = Math.hypot(dx, dy);
            const minDist = aR + bR;
            if (dist < minDist && dist > 0) {
              const overlap = (minDist - dist) / minDist;
              const force = overlap * 3;
              const nx = dx / dist,
                ny = dy / dist;
              a.vx += nx * force;
              a.vy += ny * force;
              b.vx -= nx * force;
              b.vy -= ny * force;
            }
          }
        }

        for (const fi of floatIcons) {
          if (!fi.img.complete || !fi.img.naturalWidth) continue;

          // Mouse repulsion
          if (mousePos) {
            const dx = fi.currentX - mousePos.x;
            const dy = fi.currentY - mousePos.y;
            const dist = Math.hypot(dx, dy);
            if (dist < 120 && dist > 0) {
              const force = (1 - dist / 120) * 1.8;
              fi.vx += (dx / dist) * force;
              fi.vy += (dy / dist) * force;
            }
          }
          fi.vx *= 0.92;
          fi.vy *= 0.92;

          const driftX = fi.ampX * Math.sin(fi.freqX * now + fi.phaseX);
          const driftY = fi.ampY * Math.cos(fi.freqY * now + fi.phaseY);
          fi.currentX = fi.baseX + driftX + fi.vx * 3;
          fi.currentY = fi.baseY + driftY + fi.vy * 3;
          fi.currentRot =
            fi.baseRot + 0.04 * Math.sin(fi.freqX * now * 0.5 + fi.phaseY);

          ctx.save();
          ctx.translate(fi.currentX, fi.currentY);
          ctx.rotate(fi.currentRot);
          ctx.shadowColor = "rgba(28,24,20,0.15)";
          ctx.shadowBlur = 8;
          ctx.shadowOffsetY = 4;
          ctx.drawImage(
            fi.img,
            -fi.drawW / 2,
            -fi.drawH / 2,
            fi.drawW,
            fi.drawH,
          );
          ctx.restore();
        }

        rafId = requestAnimationFrame(floatLoop);
      }
      rafId = requestAnimationFrame(floatLoop);
    }

    // ── Physics phase ──────────────────────────────────────────────────────
    function startPhysics() {
      import("matter-js").then(async (Matter) => {
        if (!overlay) return;
        try {
          const decomp = await import("poly-decomp");
          Matter.Common.setDecomp((decomp as any).default || decomp);
        } catch {
          /* fallback */
        }

        const { Engine, Bodies, Body, Composite } = Matter;
        const engine = Engine.create({ gravity: { y: 1.6 } });
        const world = engine.world;

        // Static basket walls
        function wall(
          ax: number,
          ay: number,
          bx: number,
          by: number,
          thickness = 18,
        ) {
          const cx = (ax + bx) / 2,
            cy = (ay + by) / 2;
          const len = Math.hypot(bx - ax, by - ay);
          const angle = Math.atan2(by - ay, bx - ax);
          return Bodies.rectangle(cx, cy, len + thickness, thickness, {
            isStatic: true,
            angle,
            friction: 0.6,
            restitution: 0.12,
            collisionFilter: { category: 0x0002, mask: 0x0001 },
          });
        }
        Composite.add(world, [
          wall(WL_TOP.x, WL_TOP.y, WL_BOT.x, WL_BOT.y),
          wall(WR_TOP.x, WR_TOP.y, WR_BOT.x, WR_BOT.y),
          wall(WL_BOT.x, WL_BOT.y, WR_BOT.x, WR_BOT.y),
        ]);

        // Entry type for physics phase
        type Entry = {
          body: Matter.Body;
          img: HTMLImageElement;
          baseDrawW: number;
          baseDrawH: number;
          targetScale: number;
          prevScale: number;
          slug: string;
          pctChange: number;
          alphaData: Uint8Array;
          alphaW: number;
          alphaH: number;
          bcX: number;
          bcY: number;
        };
        const entries: Entry[] = [];
        let animStartTime = 0;
        let addedToWorld = 0;
        let hoverSlug: string | null = null;
        let currentEased = 0;

        const ANIM_DURATION = 4000;
        const K = 3,
          MID = 2;
        const sig = (s: number) => 1 / (1 + Math.exp(-K * (s - MID)));
        const SIG_0 = sig(0),
          SIG_4 = sig(4);
        function logisticEase(tMs: number): number {
          const t = Math.min(tMs / 1000, 4);
          return (sig(t) - SIG_0) / (SIG_4 - SIG_0);
        }

        function createBody(
          sx: number,
          sy: number,
          contour: { x: number; y: number }[],
          bcX: number,
          bcY: number,
          bDrawW: number,
          bDrawH: number,
        ) {
          const opts = {
            friction: 0.5,
            restitution: 0.18,
            frictionAir: 0.013,
            collisionFilter: { category: 0x0001, mask: 0x0003 },
          };
          if (contour.length >= 3) {
            try {
              const body = Bodies.fromVertices(
                sx + bcX,
                sy + bcY,
                [contour],
                opts,
              );
              if (body && body.vertices && body.vertices.length >= 3)
                return body;
            } catch {
              /* fallback */
            }
          }
          return Bodies.circle(
            sx,
            sy,
            Math.max(bDrawW, bDrawH) * 0.5 + 10,
            opts,
          );
        }

        // Spawn bodies from current float positions or grid drop positions
        function spawnIcons(fromFloat: boolean) {
          floatIcons.forEach((fi, i) => {
            let sx: number, sy: number;
            if (fromFloat) {
              sx = fi.currentX;
              sy = fi.currentY;
            } else {
              const cols = Math.ceil(Math.sqrt(validCats.length));
              const col = i % cols,
                row = Math.floor(i / cols);
              const xFrac = 0.12 + 0.76 * (col / Math.max(1, cols - 1));
              sx = WL_TOP.x + (WR_TOP.x - WL_TOP.x) * xFrac;
              sy =
                WL_TOP.y -
                row * (base * 1.1 + 20) -
                base / 2 -
                10 +
                Math.random() * 10;
            }

            const body = createBody(
              sx,
              sy,
              fi.contour,
              fi.bcX,
              fi.bcY,
              fi.drawW,
              fi.drawH,
            );
            Body.setVelocity(body, {
              x: (Math.random() - 0.5) * 1.5,
              y: fromFloat ? 2 + Math.random() * 2 : 0,
            });

            entries.push({
              body,
              img: fi.img,
              baseDrawW: fi.drawW,
              baseDrawH: fi.drawH,
              targetScale: fi.targetScale,
              prevScale: 1,
              slug: fi.slug,
              pctChange: fi.pctChange,
              alphaData: fi.alphaData,
              alphaW: fi.alphaW,
              alphaH: fi.alphaH,
              bcX: fi.bcX,
              bcY: fi.bcY,
            });

            const delay = fromFloat ? i * 60 : i * 100;
            setTimeout(() => {
              Composite.add(world, body);
              addedToWorld++;
            }, delay);
          });
        }

        // ── Physics render loop ────────────────────────────────────────────
        let loopStarted = false;
        function startLoop() {
          if (loopStarted) return;
          loopStarted = true;
          document.fonts.load('24px "Londrina Solid"').catch(() => {});
          const STEP = 1000 / 60;

          function loop() {
            const now = performance.now();
            Engine.update(engine, STEP);
            ctx.clearRect(0, 0, W, H);

            // Settle detection
            if (
              animStartTime === 0 &&
              addedToWorld >= entries.length &&
              entries.length > 0
            ) {
              const allSettled = entries.every(
                (e) => Math.hypot(e.body.velocity.x, e.body.velocity.y) < 0.4,
              );
              if (allSettled) animStartTime = now;
            }

            const animElapsed = animStartTime > 0 ? now - animStartTime : -1;
            const eased = animElapsed >= 0 ? logisticEase(animElapsed) : 0;
            currentEased = eased;

            let animLabelAlpha = 0;
            if (animElapsed >= 0 && animElapsed < 1000) {
              // Fade in over first 1s of animation
              animLabelAlpha = animElapsed / 1000;
            } else if (animElapsed >= 1000 && animElapsed < ANIM_DURATION) {
              animLabelAlpha = 1;
            } else if (animElapsed >= ANIM_DURATION) {
              const fadeElapsed = animElapsed - ANIM_DURATION;
              animLabelAlpha = fadeElapsed < 3000 ? 1 - fadeElapsed / 3000 : 0;
            }

            // Draw basket
            if (basketImg.complete && basketImg.naturalWidth > 0) {
              ctx.drawImage(basketImg, bX, bY, bW, bH);
            }

            // Draw icons
            for (const e of entries) {
              if (!e.img.complete || !e.img.naturalWidth) continue;
              const { x, y } = e.body.position;
              const angle = e.body.angle;

              const currentScale = 1 + (e.targetScale - 1) * eased;
              const curDrawW = e.baseDrawW * currentScale;
              const curDrawH = e.baseDrawH * currentScale;

              if (currentScale !== e.prevScale && e.prevScale > 0) {
                const delta = currentScale / e.prevScale;
                Body.scale(e.body, delta, delta);
                e.prevScale = currentScale;
              }

              ctx.save();
              ctx.translate(x, y);
              ctx.rotate(angle);
              ctx.translate(-e.bcX * currentScale, -e.bcY * currentScale);

              ctx.shadowColor = "rgba(28,24,20,0.20)";
              ctx.shadowBlur = 12;
              ctx.shadowOffsetY = 5;
              ctx.drawImage(
                e.img,
                -curDrawW / 2,
                -curDrawH / 2,
                curDrawW,
                curDrawH,
              );
              ctx.shadowColor = "transparent";
              ctx.shadowBlur = 0;
              ctx.shadowOffsetY = 0;

              const labelAlpha = Math.max(
                animLabelAlpha,
                e.slug === hoverSlug ? 1 : 0,
              );
              if (labelAlpha > 0) {
                const iconSz = Math.max(curDrawW, curDrawH);
                const fs = labelFontSize(iconSz);
                const displayPct = e.pctChange * eased;
                const sign = displayPct >= 0 ? "+" : "";
                const label = `${sign}${displayPct.toFixed(1)}%`;
                const ly = curDrawH * 0.42;

                ctx.globalAlpha = labelAlpha;
                ctx.font = `${fs}px "Londrina Solid", 'Arial Black', sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.lineJoin = "round";
                ctx.lineWidth = 6;
                ctx.strokeStyle = "#84432A";
                ctx.strokeText(label, 0, ly);
                ctx.fillStyle = "#FFFFFF";
                ctx.fillText(label, 0, ly);
                ctx.globalAlpha = 1;
              }

              ctx.restore();
            }

            rafId = requestAnimationFrame(loop);
          }
          rafId = requestAnimationFrame(loop);
        }

        // ── Fall trigger (heroMode) ────────────────────────────────────────
        if (heroMode) {
          const triggerFall = () => {
            if (phase !== "floating") return;
            phase = "physics";
            cancelAnimationFrame(rafId);
            spawnIcons(true);
            startLoop();
          };
          onFallReady?.(triggerFall);
        } else {
          // Legacy mode: spawn immediately
          spawnIcons(false);
          startLoop();
        }

        // ── Drag & click ───────────────────────────────────────────────────
        type DragState = { entry: Entry; offX: number; offY: number };
        let drag: DragState | null = null;

        const getPos = (clientX: number, clientY: number) => {
          const r = overlay.getBoundingClientRect();
          return { x: clientX - r.left, y: clientY - r.top };
        };
        const hitEntry = (px: number, py: number) =>
          entries.find((e) => {
            const { x: bx, y: by } = e.body.position;
            const angle = e.body.angle;
            const dx = px - bx,
              dy = py - by;
            const cos = Math.cos(-angle),
              sin = Math.sin(-angle);
            const bodyLX = dx * cos - dy * sin;
            const bodyLY = dx * sin + dy * cos;
            const cScale = 1 + (e.targetScale - 1) * currentEased;
            const imgLX = bodyLX + e.bcX * cScale;
            const imgLY = bodyLY + e.bcY * cScale;
            return alphaHitTest(
              e.alphaData,
              e.alphaW,
              e.alphaH,
              imgLX,
              imgLY,
              cScale,
              10,
            );
          }) ?? null;

        const onDown = (e: MouseEvent) => {
          const p = getPos(e.clientX, e.clientY);
          downPos = p;
          const hit = hitEntry(p.x, p.y);
          if (hit) {
            downSlug = hit.slug;
            drag = {
              entry: hit,
              offX: p.x - hit.body.position.x,
              offY: p.y - hit.body.position.y,
            };
            Body.setStatic(hit.body, true);
          }
        };
        const onMove = (e: MouseEvent) => {
          const p = getPos(e.clientX, e.clientY);
          // Track mouse for float-phase repulsion
          mousePos = p;
          const hit = hitEntry(p.x, p.y);
          hoverSlug = hit ? hit.slug : null;
          overlay.style.cursor = hit ? "grab" : "default";
          if (!drag) return;
          Body.setPosition(drag.entry.body, {
            x: p.x - drag.offX,
            y: p.y - drag.offY,
          });
        };
        const onLeave = () => {
          hoverSlug = null;
          mousePos = null;
        };
        const onUp = (e: MouseEvent) => {
          if (drag) {
            Body.setStatic(drag.entry.body, false);
            Body.setVelocity(drag.entry.body, { x: 0, y: 1 });
            drag = null;
          }
          if (downPos && downSlug) {
            const up = getPos(e.clientX, e.clientY);
            if (Math.hypot(up.x - downPos.x, up.y - downPos.y) < 8)
              openModal(downSlug);
          }
          downPos = null;
          downSlug = null;
        };

        const onTDown = (e: TouchEvent) => {
          const t = e.touches[0];
          const p = getPos(t.clientX, t.clientY);
          downPos = p;
          const hit = hitEntry(p.x, p.y);
          if (hit) {
            downSlug = hit.slug;
            drag = {
              entry: hit,
              offX: p.x - hit.body.position.x,
              offY: p.y - hit.body.position.y,
            };
            Body.setStatic(hit.body, true);
          }
        };
        const onTMove = (e: TouchEvent) => {
          if (!drag) return;
          const t = e.touches[0];
          const p = getPos(t.clientX, t.clientY);
          Body.setPosition(drag.entry.body, {
            x: p.x - drag.offX,
            y: p.y - drag.offY,
          });
        };
        const onTUp = (e: TouchEvent) => {
          if (drag) {
            Body.setStatic(drag.entry.body, false);
            Body.setVelocity(drag.entry.body, { x: 0, y: 1 });
            drag = null;
          }
          if (downPos && downSlug) {
            const t = e.changedTouches[0];
            const up = getPos(t.clientX, t.clientY);
            if (Math.hypot(up.x - downPos.x, up.y - downPos.y) < 12)
              openModal(downSlug);
          }
          downPos = null;
          downSlug = null;
        };

        overlay.addEventListener("mousedown", onDown);
        overlay.addEventListener("mousemove", onMove);
        overlay.addEventListener("mouseup", onUp);
        overlay.addEventListener("mouseleave", onLeave);
        overlay.addEventListener("touchstart", onTDown, { passive: true });
        overlay.addEventListener("touchmove", onTMove, { passive: true });
        overlay.addEventListener("touchend", onTUp, { passive: true });

        cleanup.fn = () => {
          cancelAnimationFrame(rafId);
          Engine.clear(engine);
          overlay.removeEventListener("mousedown", onDown);
          overlay.removeEventListener("mousemove", onMove);
          overlay.removeEventListener("mouseup", onUp);
          overlay.removeEventListener("mouseleave", onLeave);
          overlay.removeEventListener("touchstart", onTDown);
          overlay.removeEventListener("touchmove", onTMove);
          overlay.removeEventListener("touchend", onTUp);
        };
      });
    }

    // Mouse tracking for float phase (before Matter.js loads)
    const onOverlayMove = (e: MouseEvent) => {
      const r = overlay.getBoundingClientRect();
      mousePos = { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onOverlayLeave = () => {
      mousePos = null;
    };
    if (heroMode) {
      overlay.addEventListener("mousemove", onOverlayMove);
      overlay.addEventListener("mouseleave", onOverlayLeave);
    }

    return () => {
      cancelAnimationFrame(rafId);
      if (heroMode) {
        overlay.removeEventListener("mousemove", onOverlayMove);
        overlay.removeEventListener("mouseleave", onOverlayLeave);
      }
      cleanup.fn();
    };
  }, [categories, priceDataMap, openModal, heroMode, onFallReady]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: "var(--cream)",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      />
      <div
        ref={overlayRef}
        style={{ position: "absolute", inset: 0, cursor: "default" }}
      />

      {modal && (
        <div
          onClick={() => setModal(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(28,24,20,0.55)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--cream)",
              border: "1px solid var(--cream-dark)",
              borderRadius: 4,
              padding: "1.75rem 2rem",
              maxWidth: 720,
              width: "100%",
              boxShadow: "0 24px 64px rgba(28,24,20,0.3)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: "1.25rem",
              }}
            >
              <div>
                <p
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.55rem",
                    letterSpacing: "0.15em",
                    textTransform: "uppercase",
                    color: "var(--ink-muted)",
                    marginBottom: "0.3rem",
                  }}
                >
                  Price history · {modal.category.source.toUpperCase()}
                </p>
                <h2
                  style={{
                    fontFamily: "var(--font-fraunces)",
                    fontSize: "1.6rem",
                    fontWeight: 700,
                    color: "var(--ink)",
                    lineHeight: 1.1,
                  }}
                >
                  {modal.category.label}
                </h2>
                <div
                  style={{
                    display: "flex",
                    gap: "1.5rem",
                    marginTop: "0.5rem",
                  }}
                >
                  <Stat
                    label="current"
                    value={`$${modal.priceData.current.toFixed(2)}${modal.category.unit}`}
                  />
                  <Stat
                    label="3-month"
                    value={`${modal.priceData.pctChange3m >= 0 ? "+" : ""}${modal.priceData.pctChange3m.toFixed(1)}%`}
                    color={
                      modal.priceData.pctChange3m > 0
                        ? "var(--amber)"
                        : "var(--moss)"
                    }
                  />
                  <Stat
                    label="12-month"
                    value={`${modal.priceData.pctChange12m >= 0 ? "+" : ""}${modal.priceData.pctChange12m.toFixed(1)}%`}
                    color={
                      modal.priceData.pctChange12m > 0
                        ? "var(--amber)"
                        : "var(--moss)"
                    }
                  />
                </div>
              </div>
              <button
                onClick={() => setModal(null)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.7rem",
                  color: "var(--ink-muted)",
                  letterSpacing: "0.05em",
                  padding: "0.25rem 0.5rem",
                }}
              >
                ✕ close
              </button>
            </div>
            <TrendChart
              data={modal.priceData.history}
              unit={modal.category.unit}
              height={300}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <p
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "0.5rem",
          color: "var(--ink-muted)",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          marginBottom: "0.1rem",
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "0.85rem",
          fontWeight: 600,
          color: color ?? "var(--ink)",
        }}
      >
        {value}
      </p>
    </div>
  );
}
