import { weather } from "./game.js";
import {
  GREENHOUSE_OFFSET,
  HEIGHT,
  LEAK,
  OBJECTS,
  REGIONS,
  TILE,
  TRAILS,
  WIDTH,
  inLeak,
  isSafe,
  nearest,
  residentPosition,
  terrain,
} from "./world.js";

const colors = {
  sand: "#89583e",
  greenhouse: "#4b5950",
  facility: "#525653",
  pad: "#575858",
  shelter: "#435b58",
  wall: "#5c4536",
  crack: "#49362e",
};
const personColors = { seon: "#b9c88f", hong: "#d6a773", dj: "#a3b9d5" };

function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}
function text(ctx, value, x, y, color = "#e9dfc1", size = 11) {
  ctx.font = `${size}px -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillStyle = "#142122";
  ctx.fillText(value, x + 1, y + 1);
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
}

function tile(ctx, x, y) {
  const type = terrain(x, y),
    px = x * TILE,
    py = y * TILE;
  rect(ctx, px, py, TILE, TILE, colors[type]);
  const noise = ((x * 73 + y * 131) % 29) / 29;
  if (type === "sand") {
    rect(ctx, px + 3 + noise * 17, py + 6, 3, 2, "#a06b48");
    rect(ctx, px + 22, py + 21 + noise * 6, 5, 2, "#734c37");
    if ((x + y) % 5 === 0) rect(ctx, px + 10, py + 25, 9, 1, "#9a6749");
  } else if (type === "wall") {
    rect(ctx, px, py + 5, 30, 24, "#4c3c32");
    rect(ctx, px + 3, py + 4, 25, 19, "#72543d");
    rect(ctx, px + 5, py + 3, 20, 5, "#946c4a");
  } else if (type === "crack") {
    rect(ctx, px + 4, py, 20, 32, "#372d2a");
    rect(ctx, px + 8, py + 5, 10, 22, "#221f20");
    rect(ctx, px + 1, py, 3, 20, "#c38d60");
  } else {
    rect(ctx, px, py + 31, 32, 1, "#ffffff08");
    rect(ctx, px + 31, py, 1, 32, "#00000012");
    if (type === "shelter") rect(ctx, px + 3, py + 3, 26, 26, "#3c504b");
  }
}

function greenhouse(ctx) {
  // Cutaway greenhouse: metal glazing frame and warm interior lights.
  rect(ctx, 36, 67, 365, 8, "#94aaa0");
  rect(ctx, 36, 72, 365, 3, "#526f68");
  rect(ctx, 36, 73, 5, 477, "#8ca29a");
  rect(ctx, 392, 73, 5, 247, "#8ca29a");
  rect(ctx, 392, 352, 5, 198, "#8ca29a");
  rect(ctx, 36, 542, 188, 7, "#81948c");
  rect(ctx, 256, 542, 141, 7, "#81948c");
  for (let x = 64; x < 390; x += 64) {
    rect(ctx, x, 74, 3, 28, "#7d9d91");
    rect(ctx, x - 8, 84, 18, 3, "#d1bb7a");
    rect(ctx, x - 8, 87, 18, 7, "#d4ba6a28");
  }
  for (let y = 102; y < 525; y += 64) rect(ctx, 43, y, 346, 1, "#9fbba012");
  // Walkway and water conduit.
  rect(ctx, 66, 312, 328, 34, "#747566");
  rect(ctx, 225, 313, 30, 229, "#747566");
  for (let y = 317; y < 540; y += 16) rect(ctx, 228, y, 24, 1, "#a4a18b40");
  rect(ctx, 111, 168, 240, 4, "#84988d");
  rect(ctx, 347, 141, 4, 147, "#84988d");
  rect(ctx, 111, 285, 240, 4, "#84988d");
  // Storage shelf and seed crates.
  for (let x = 75; x < 190; x += 36) {
    rect(ctx, x, 469, 27, 25, "#292d29");
    rect(ctx, x, 466, 26, 22, "#997958");
    rect(ctx, x + 3, 469, 20, 4, "#b6996c");
    rect(ctx, x + 11, 466, 3, 22, "#4d5142");
  }
  text(ctx, "공동 창고", 131, 512, "#c9d3b2", 10);
  text(ctx, "AIRLOCK →", 353, 340, "#ede2b7", 9);
}

function plant(ctx, crop, px, py, pumpFixed, growth) {
  rect(ctx, px - 14, py - 12, 28, 28, "#273a30");
  rect(ctx, px - 14, py - 14, 28, 24, "#8b7960");
  rect(
    ctx,
    px - 11,
    py - 11,
    22,
    18,
    crop.watered || pumpFixed ? "#473b2d" : "#6b4b32",
  );
  for (const offset of [-6, 6]) {
    if (!crop.planted) {
      rect(ctx, px + offset - 3, py - 1, 5, 2, "#a27749");
      continue;
    }
    const ripe = crop.growth >= growth;
    const tall = crop.growth > 40;
    rect(ctx, px + offset, py - (tall ? 12 : 5), 2, tall ? 16 : 9, "#6e9a63");
    rect(ctx, px + offset - 5, py - (tall ? 10 : 3), 5, 4, "#a4c480");
    rect(ctx, px + offset + 2, py - (tall ? 13 : 6), 5, 4, "#7fba72");
    if (ripe) {
      rect(ctx, px + offset - 4, py + 1, 5, 5, "#dcc27f");
      rect(ctx, px + offset + 2, py + 3, 4, 4, "#b7a269");
    }
  }
  if (crop.planted && !crop.watered && !pumpFixed)
    text(ctx, "급수", px, py + 29, "#f2cc8f", 9);
  else if (crop.planted && crop.growth >= growth)
    text(ctx, "수확", px, py + 29, "#c0dfa1", 9);
}

function person(ctx, px, py, color, astronaut, time, moving) {
  const stride = moving ? Math.sin(time * 12) * 2 : 0;
  rect(ctx, px - 9, py + 8, 18, 5, "#16232255");
  rect(ctx, px - 7, py - 5, 14, 16, color);
  rect(ctx, px - 8, py + 10, 6, 5 + stride, "#28363a");
  rect(ctx, px + 2, py + 10, 6, 5 - stride, "#28363a");
  rect(ctx, px - 11, py - 2, 4, 10, "#987754");
  rect(ctx, px + 7, py - 2, 4, 10, color);
  rect(ctx, px - 8, py - 19, 16, 16, astronaut ? "#e9dcca" : "#d4b393");
  rect(ctx, px - 9, py - 17, 18, 5, astronaut ? "#e9dcca" : "#574e42");
  rect(ctx, px - 6, py - 14, 12, 7, astronaut ? "#3e7479" : "#ae8d73");
  if (astronaut) {
    rect(ctx, px - 4, py - 13, 5, 2, "#97c7be");
    rect(ctx, px - 3, py + 1, 6, 5, "#d59459");
  }
}

function object(ctx, state, o) {
  const px = o.x * TILE,
    py = o.y * TILE;
  if (o.type === "plot") {
    plant(
      ctx,
      state.crops[Number(o.id.split("-")[1])],
      px,
      py,
      state.pumpFixed,
      state.soilSettled ? 90 : 360,
    );
    if (o.id === "plot-5" && state.soil.phase !== "idle") {
      text(
        ctx,
        state.soilSettled
          ? "첫 흙 안착"
          : state.soil.phase === "observing"
            ? `흙 관찰 ${Math.floor(state.soil.observed)}/90`
            : "공동 텃밭",
        px,
        py + 41,
        "#c0dfa1",
        9,
      );
    }
    return;
  }
  if (o.type === "scrap") {
    const empty = state.searched.includes(o.id);
    rect(ctx, px - 15, py - 4, 31, 17, "#493c33");
    rect(ctx, px - 16, py - 14, 29, 22, empty ? "#6c6556" : "#c2b49a");
    rect(ctx, px - 11, py - 12, 16, 9, "#596e6d");
    rect(ctx, px - 7, py - 10, 8, 4, "#78918a");
    rect(ctx, px - 13, py + 5, 25, 4, "#8f7d65");
    rect(ctx, px + 10, py - 3, 7, 3, "#58483b");
    if (!empty) rect(ctx, px + 11, py - 18, 3, 3, "#e7c382");
  } else if (o.type === "ship") {
    rect(ctx, px - 31, py + 24, 62, 16, "#333d3b");
    rect(
      ctx,
      px - 22,
      py - 43,
      44,
      69,
      state.baseFixed ? "#a8b5a4" : "#8c9185",
    );
    rect(ctx, px - 27, py - 48, 54, 7, "#697e77");
    for (let y = -36; y < -10; y += 7)
      rect(
        ctx,
        px - 15,
        py + y,
        30,
        3,
        state.filterFixed ? "#93c8bc" : "#435653",
      );
    rect(ctx, px - 16, py + 3, 32, 16, "#403d34");
    for (let x = -12; x < 13; x += 8)
      rect(ctx, px + x, py + 5, 4, 12, state.heatFixed ? "#e8b06f" : "#6c6150");
    rect(ctx, px - 29, py - 2, 7, 28, "#657e75");
    rect(ctx, px + 22, py - 2, 7, 28, "#657e75");
    text(ctx, "정화·난방 타워", px, py + 57, "#ede0bf", 11);
  } else if (o.type === "board") {
    rect(ctx, px - 13, py - 17, 26, 29, "#ac9168");
    rect(ctx, px - 10, py - 14, 20, 21, "#d2c7a4");
    rect(ctx, px - 7, py - 11, 9, 6, "#6c8d7a");
    rect(ctx, px - 7, py - 2, 14, 2, "#8e8061");
    rect(ctx, px - 9, py + 12, 3, 7, "#836e50");
    rect(ctx, px + 6, py + 12, 3, 7, "#836e50");
    text(ctx, "논의 / 비축", px, py + 32, "#e1d4aa", 9);
  } else if (o.type === "pump") {
    rect(ctx, px - 13, py - 17, 26, 30, "#738f8b");
    rect(ctx, px - 9, py - 14, 18, 9, "#c6cec0");
    rect(ctx, px - 6, py - 11, 12, 4, state.pumpFixed ? "#97bb8a" : "#a66c51");
    rect(ctx, px - 14, py + 5, 28, 5, "#435e5b");
    text(ctx, "급수 장치", px, py + 32, "#c9dbbe", 9);
  } else if (o.type === "valve") {
    rect(ctx, px - 15, py - 3, 30, 9, "#a2a798");
    rect(ctx, px - 4, py - 14, 8, 20, "#a2a798");
    rect(ctx, px - 12, py - 13, 24, 4, state.leakFixed ? "#9bbf8c" : "#e6a16d");
    text(ctx, "누출 차단", px, py - 21, "#f5c28d", 10);
  } else if (o.type === "signal") {
    rect(ctx, px - 10, py - 12, 20, 23, "#9b9d89");
    rect(ctx, px - 7, py - 9, 14, 9, "#314c4c");
    rect(ctx, px - 1, py - 30, 2, 18, "#b2b9a6");
    rect(ctx, px - 10, py - 30, 20, 2, "#b2b9a6");
    rect(ctx, px + 5, py + 5, 3, 3, state.signal ? "#a2c899" : "#d4a772");
    text(ctx, "통신기", px, py + 29, "#d6d7b4", 10);
  }
}

// Camera coordinates are world pixels; backing-store density must not change the view.
export function cameraView(width, height, position, pixelRatio = 1) {
  const scale = Math.max(
    1.5 * pixelRatio,
    width / (30 * TILE),
    height / (20 * TILE),
  );
  const viewWidth = width / scale,
    viewHeight = height / scale;
  const clamp = (value, max) => Math.max(0, Math.min(max, value));
  return {
    x: clamp(position.x * TILE - viewWidth / 2, WIDTH * TILE - viewWidth),
    y: clamp(position.y * TILE - viewHeight / 2, HEIGHT * TILE - viewHeight),
    width: viewWidth,
    height: viewHeight,
    scale,
  };
}

function exterior(ctx) {
  ctx.strokeStyle = "#ba9867";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 12]);
  for (const trail of TRAILS) {
    ctx.beginPath();
    ctx.moveTo(trail[0].x * TILE, trail[0].y * TILE);
    for (const p of trail.slice(1)) ctx.lineTo(p.x * TILE, p.y * TILE);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const shelter = REGIONS.shelter;
  ctx.strokeStyle = "#9db5a4";
  ctx.lineWidth = 4;
  ctx.strokeRect(
    shelter.x * TILE + 3,
    shelter.y * TILE + 3,
    shelter.width * TILE - 6,
    shelter.height * TILE - 6,
  );
  for (const [name, label] of [
    ["shelter", "O₂ 대피소 · 산소 충전"],
    ["wreck", "캡슐 잔해 지대"],
    ["facility", "폐쇄 설비 구역"],
    ["pad", "중앙 타워"],
  ]) {
    const r = REGIONS[name];
    text(
      ctx,
      label,
      (r.x + r.width / 2) * TILE,
      r.y * TILE - 12,
      "#ead6ad",
      12,
    );
  }
  // Trail junctions keep destinations discoverable without exposing the whole map.
  text(
    ctx,
    "↑ 잔해 지대   /   O₂ 대피소 →",
    29.5 * TILE,
    19.5 * TILE,
    "#e8d6ad",
    11,
  );
  text(ctx, "← 공동 온실", 20.5 * TILE, 19.5 * TILE, "#e8d6ad", 11);
  text(
    ctx,
    "↑ 중앙 타워   /   설비 구역 ↓",
    49.5 * TILE,
    20.5 * TILE,
    "#e8d6ad",
    11,
  );
}

export function render(
  ctx,
  state,
  moving = false,
  reducedMotion = false,
  pixelRatio = 1,
) {
  const { width, height } = ctx.canvas;
  const view = cameraView(width, height, state.position, pixelRatio);
  ctx.resetTransform();
  rect(ctx, 0, 0, width, height, colors.sand);
  ctx.save();
  ctx.scale(view.scale, view.scale);
  ctx.translate(-view.x, -view.y);
  ctx.imageSmoothingEnabled = false;
  const right = Math.min(WIDTH, Math.ceil((view.x + view.width) / TILE));
  const bottom = Math.min(HEIGHT, Math.ceil((view.y + view.height) / TILE));
  for (let y = Math.floor(view.y / TILE); y < bottom; y++) {
    for (let x = Math.floor(view.x / TILE); x < right; x++) tile(ctx, x, y);
  }
  ctx.save();
  ctx.translate(GREENHOUSE_OFFSET.x * TILE, GREENHOUSE_OFFSET.y * TILE);
  greenhouse(ctx);
  ctx.restore();
  exterior(ctx);
  if (!state.leakFixed) {
    ctx.fillStyle = "#cf76592b";
    ctx.fillRect(
      LEAK.x * TILE,
      LEAK.y * TILE,
      LEAK.width * TILE,
      LEAK.height * TILE,
    );
    ctx.strokeStyle = "#e9ae67";
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(
      LEAK.x * TILE,
      LEAK.y * TILE,
      LEAK.width * TILE,
      LEAK.height * TILE,
    );
    ctx.setLineDash([]);
    text(
      ctx,
      "⚠ 누출 · 초당 체력 −2",
      (LEAK.x + LEAK.width / 2) * TILE,
      (LEAK.y + LEAK.height) * TILE + 20,
      "#f4c398",
      10,
    );
  }
  for (const o of OBJECTS) object(ctx, state, o);
  for (const r of state.residents.filter((r) => r.alive)) {
    const position = residentPosition(state, r);
    person(
      ctx,
      position.x * TILE,
      position.y * TILE,
      personColors[r.id],
      false,
      state.elapsed,
      !reducedMotion && r.id === "hong",
    );
    text(ctx, r.name, position.x * TILE, position.y * TILE + 31, "#e1e3c6", 10);
    if (r.id === "seon")
      text(
        ctx,
        "요양 중",
        position.x * TILE,
        position.y * TILE - 31,
        "#ffcd9b",
        9,
      );
  }
  const px = state.position.x * TILE,
    py = state.position.y * TILE;
  person(ctx, px, py, "#ede2c7", true, state.elapsed, moving && !reducedMotion);
  const target = nearest(state);
  if (target) {
    ctx.strokeStyle = "#efe0b2";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      Math.round(target.x * TILE - 19),
      Math.round(target.y * TILE - 23),
      38,
      42,
    );
    rect(ctx, target.x * TILE + 12, target.y * TILE - 33, 15, 15, "#172329");
    text(ctx, "E", target.x * TILE + 20, target.y * TILE - 22, "#f0d4a0", 10);
  }
  if (state.job) {
    rect(ctx, px - 20, py - 32, 40, 4, "#263439");
    rect(
      ctx,
      px - 20,
      py - 32,
      Math.max(0, 1 - state.job.remaining / state.job.duration) * 40,
      4,
      "#e4c88d",
    );
  }
  ctx.restore();
  // Weather and danger frames belong to the viewport, not a fixed world rectangle.
  if (weather(state).storm && !isSafe(state.position)) {
    rect(ctx, 0, 0, width, height, "#d4a26b26");
    for (let i = 0; i < 65; i++) {
      const t = reducedMotion ? 0 : state.elapsed;
      const x = ((i * 131 + t * 150) * pixelRatio) % width;
      const y = ((i * 79 + t * 24) * pixelRatio) % height;
      rect(ctx, x, y, (12 + (i % 10)) * pixelRatio, pixelRatio, "#e4c89e60");
    }
  }
  if (inLeak(state.position) && !state.leakFixed) {
    ctx.strokeStyle = "#d97c5b";
    ctx.lineWidth = 5 * pixelRatio;
    ctx.strokeRect(
      3 * pixelRatio,
      3 * pixelRatio,
      width - 6 * pixelRatio,
      height - 6 * pixelRatio,
    );
  }
}
