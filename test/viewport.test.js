import test from 'node:test';
import assert from 'node:assert/strict';
import * as renderer from '../src/render.js';
import { WIDTH, HEIGHT, TILE } from '../src/world.js';

test('camera follows Ran, clamps at every map edge, and never shows the whole map', () => {
  assert.equal(typeof renderer.cameraView, 'function');
  for (const [width, height] of [[1280, 720], [1920, 1080], [375, 667], [320, 568], [5120, 1440]]) {
    const middle = renderer.cameraView(width, height, { x: WIDTH / 2, y: HEIGHT / 2 });
    assert.ok(middle.width < WIDTH * TILE && middle.height < HEIGHT * TILE);
    assert.equal(middle.x + middle.width / 2, WIDTH * TILE / 2);
    assert.equal(middle.y + middle.height / 2, HEIGHT * TILE / 2);
    assert.equal(middle.width * middle.scale, width);
    assert.equal(middle.height * middle.scale, height);
    for (const x of [1, WIDTH - 1]) for (const y of [1, HEIGHT - 1]) {
      const edge = renderer.cameraView(width, height, { x, y });
      assert.ok(edge.x >= 0 && edge.y >= 0);
      assert.ok(edge.x + edge.width <= WIDTH * TILE);
      assert.ok(edge.y + edge.height <= HEIGHT * TILE);
      assert.equal(edge.x, x === 1 ? 0 : WIDTH * TILE - edge.width);
      assert.equal(edge.y, y === 1 ? 0 : HEIGHT * TILE - edge.height);
    }
    const moved = renderer.cameraView(width, height, { x: WIDTH / 2 + 1, y: HEIGHT / 2 + 1 });
    assert.equal(moved.x - middle.x, TILE);
    assert.equal(moved.y - middle.y, TILE);
    const retina = renderer.cameraView(width * 2, height * 2, { x: WIDTH / 2, y: HEIGHT / 2 }, 2);
    assert.deepEqual({ ...retina, scale: retina.scale / 2 }, middle);
  }
});
