const { test } = require('node:test');
const assert = require('node:assert/strict');
const { metrics, fromPoint, fromThumb, wheelPixels } = require('../src/geometry');
test('click maps content positions and clamps both ends', () => {
    assert.equal(fromPoint(250, 500, 5000, 500), 2250);
    assert.equal(fromPoint(0, 500, 5000, 500), 0);
    assert.equal(fromPoint(500, 500, 5000, 500), 4500);
});
test('drag reaches both ends even with a minimum-height thumb', () => {
    const m = metrics(100000, 500, 500, 99500);
    assert.equal(m.height, 24);
    assert.equal(m.top, m.travel);
    assert.equal(fromThumb(m.travel, m), 99500);
    assert.equal(fromThumb(-10, m), 0);
});
test('short and empty documents never produce invalid coordinates', () => {
    for (const total of [0, 100, 500]) {
        const m = metrics(total, 500, 500, 0);
        assert.equal(m.max, 0);
        assert.equal(fromThumb(100, m), 0);
        assert.equal(fromPoint(200, 500, total, 500), 0);
    }
});
test('wheel supports pixel, line and page units in both directions', () => {
    assert.equal(wheelPixels(40, 0, 600), 40);
    assert.equal(wheelPixels(-3, 1, 600), -60);
    assert.equal(wheelPixels(1, 2, 600), 600);
});
