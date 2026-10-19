// Copyright 2026 wave789
// SPDX-License-Identifier: Apache-2.0
"use strict";
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
function metrics(total, visible, track, scroll) {
    const max = Math.max(0, total - visible);
    const height = Math.min(track, Math.max(24, track * visible / Math.max(1, total)));
    const travel = Math.max(0, track - height);
    return { max, height, travel, top: max ? clamp(scroll / max, 0, 1) * travel : 0 };
}
function fromThumb(top, m) {
    return m.travel ? clamp(top / m.travel, 0, 1) * m.max : 0;
}
function fromPoint(y, track, total, visible) {
    return clamp(y / Math.max(1, track) * total - visible / 2, 0, Math.max(0, total - visible));
}
function wheelPixels(delta, mode, page) {
    return delta * (mode === 1 ? 20 : mode === 2 ? page : 1);
}
module.exports = { metrics, fromThumb, fromPoint, wheelPixels };
