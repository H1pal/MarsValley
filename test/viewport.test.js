import test from 'node:test';
import assert from 'node:assert/strict';
import * as renderer from '../src/render.js';
import { WIDTH, HEIGHT, TILE } from '../src/world.js';

test('fullscreen rendering keeps the entire playable map visible without stretching', () => {
  assert.equal(typeof renderer.fitWorld, 'function');
  for (const [width, height] of [[1440, 900], [1920, 1080], [693, 853], [320, 568]]) {
    const { x, y, scale } = renderer.fitWorld(width, height);
    const right = x + WIDTH * TILE * scale, bottom = y + HEIGHT * TILE * scale;
    assert.ok(x >= 0 && y >= 0 && right <= width + 1e-8 && bottom <= height + 1e-8);
    assert.ok(Math.abs(x - (width - right)) < 1e-8, 'horizontal centering');
    assert.ok(Math.abs(y - (height - bottom)) < 1e-8, 'vertical centering');
    assert.ok(Math.abs((right - x) / (bottom - y) - WIDTH / HEIGHT) < 1e-8, 'world aspect ratio');
    assert.ok(x < 1e-8 || y < 1e-8, 'world fills at least one viewport dimension');
  }
});
