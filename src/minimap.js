// Copyright 2026 wave789
// SPDX-License-Identifier: Apache-2.0
"use strict";
const { metrics, fromThumb, fromPoint, wheelPixels } = require("./geometry");
const { CanvasPreview } = require("./preview");
const PREVIEW_DELAY = 80;
const SCROLL_DELAY = 100;
const SLICE_MS = 5;

class Minimap {
    constructor(root, content) {
        this.root = root;
        this.content = content;
        this.frame = 0;
        this.dirty = true;
        this.layoutDirty = true;
        this.geometry = null;
        this.destroyed = false;
        this.drag = null;
        this.paintTimer = 0;
        this.paintFrame = 0;
        this.previewTask = null;
        this.paintAfter = 0;
        this.scrollUntil = 0;
        this.rail = document.createElement("div");
        this.rail.className = "sy-minimap";
        this.rail.tabIndex = 0;
        this.rail.setAttribute("role", "scrollbar");
        this.rail.setAttribute("aria-label", "文档缩略图（当前已加载内容）");
        this.rail.setAttribute("aria-orientation", "vertical");
        this.rail.setAttribute("aria-valuemin", "0");
        this.rail.title = "点击跳转 · 拖动定位 · 滚轮滚动\n显示当前已加载内容";
        this.preview = document.createElement("canvas");
        this.preview.className = "sy-minimap__preview";
        this.preview.setAttribute("aria-hidden", "true");
        this.preview.inert = true;
        this.renderer = new CanvasPreview(this.preview);
        this.thumb = document.createElement("div");
        this.thumb.className = "sy-minimap__viewport";
        this.rail.append(this.preview, this.thumb);
        root.append(this.rail);
        this.abort = new AbortController();
        const signal = this.abort.signal;
        this.content.addEventListener("scroll", () => {
            this.noteScrolling();
            this.schedule(false);
        }, { passive: true, signal });
        this.content.addEventListener("wheel", () => this.noteScrolling(), { passive: true, signal });
        document.fonts?.addEventListener("loadingdone", () => this.schedule(), { signal });
        const assetChanged = event => {
            if (this.renderer.imageChanged(event.target, this.observedBody)) this.invalidatePreview();
            this.schedule(false, true);
        };
        this.content.addEventListener("load", assetChanged, { capture: true, signal });
        this.content.addEventListener("error", assetChanged, { capture: true, signal });
        window.addEventListener("resize", () => this.schedule(false, true), { passive: true, signal });
        this.rail.addEventListener("wheel", event => {
            if (event.ctrlKey || event.metaKey) return;
            event.preventDefault();
            event.stopPropagation();
            this.noteScrolling();
            this.content.scrollTop += wheelPixels(event.deltaY, event.deltaMode, this.content.clientHeight);
        }, { passive: false, signal });
        this.rail.addEventListener("pointerdown", event => {
            if (event.button !== 0 || !event.isPrimary) return;
            event.preventDefault();
            event.stopPropagation();
            this.noteScrolling();
            const y = event.clientY - this.rail.getBoundingClientRect().top;
            const m = this.getMetrics();
            const inside = y >= m.top && y <= m.top + m.height;
            this.drag = { id: event.pointerId, offset: inside ? y - m.top : m.height / 2 };
            if (!inside) this.content.scrollTop = fromPoint(y, this.getTrackHeight(), this.content.scrollHeight, this.content.clientHeight);
            // Preserve the actual pointer-to-thumb offset after a clamped jump.
            this.drag.offset = y - this.getMetrics().top;
            this.rail.setPointerCapture(event.pointerId);
            this.rail.classList.add("sy-minimap--dragging");
            this.schedule(false);
        }, { signal });
        this.rail.addEventListener("pointermove", event => {
            if (!this.drag || event.pointerId !== this.drag.id) return;
            this.noteScrolling();
            this.content.scrollTop = fromThumb(event.clientY - this.rail.getBoundingClientRect().top - this.drag.offset, this.getMetrics());
            this.schedule(false);
        }, { signal });
        const end = event => {
            if (!this.drag || event.pointerId !== this.drag.id) return;
            this.drag = null;
            if (this.rail.hasPointerCapture(event.pointerId)) this.rail.releasePointerCapture(event.pointerId);
            this.rail.classList.remove("sy-minimap--dragging");
            this.queuePaint();
        };
        for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) this.rail.addEventListener(name, end, { signal });
        this.rail.addEventListener("keydown", event => {
            const steps = { ArrowDown: 48, ArrowUp: -48, PageDown: content.clientHeight * 0.9, PageUp: -content.clientHeight * 0.9, Home: -content.scrollHeight, End: content.scrollHeight };
            if (!(event.key in steps)) return;
            event.preventDefault();
            event.stopPropagation();
            content.scrollTop += steps[event.key];
        }, { signal });
        this.mutations = new MutationObserver(records => {
            if (this.renderer.mutations(records, this.observedBody)) {
                this.invalidatePreview();
                this.schedule(false, true);
            }
        });
        this.mutations.observe(content, { subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true });
        this.resize = new ResizeObserver(() => this.schedule(false, true));
        this.resize.observe(root);
        this.resize.observe(content);
        this.observedBody = null;
        this.theme = new MutationObserver(() => this.schedule());
        this.theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme-mode", "style", "class", "data-light-theme", "data-dark-theme"] });
        this.schedule(false, true);
    }
    getTrackHeight() {
        return this.geometry?.track || 0;
    }
    getMetrics() {
        return metrics(this.content.scrollHeight, this.content.clientHeight, this.getTrackHeight(), this.content.scrollTop);
    }
    schedule(redraw = true, layout = redraw) {
        if (this.destroyed) return;
        if (redraw) {
            this.renderer.invalidateStyles();
            this.invalidatePreview();
        }
        this.layoutDirty ||= layout;
        if (this.frame) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = 0;
            this.render();
        });
    }
    render() {
        if (!this.content.isConnected) return;
        if (this.layoutDirty) {
            this.layoutDirty = false;
            this.updateLayout();
        }
        if (this.rail.hidden || !this.geometry) return;
        const { total, visible, track } = this.geometry;
        const scroll = this.content.scrollTop;
        const m = metrics(total, visible, track, scroll);
        const height = `${m.height}px`;
        if (this.thumb.style.height !== height) this.thumb.style.height = height;
        this.thumb.style.transform = `translateY(${m.top}px)`;
        this.rail.setAttribute("aria-valuemax", String(Math.round(m.max)));
        this.rail.setAttribute("aria-valuenow", String(Math.round(scroll)));
        this.queuePaint();
    }
    updateLayout() {
        const content = this.content;
        const body = content.querySelector(".protyle-wysiwyg");
        if (body !== this.observedBody) {
            if (this.observedBody) this.resize.unobserve(this.observedBody);
            if (body) this.resize.observe(body);
            this.observedBody = body;
            this.renderer.full = true;
            this.invalidatePreview();
        }
        const visible = content.clientHeight > 0 && content.clientWidth > 0 && body && content.scrollHeight > content.clientHeight + 1;
        if (this.rail.hidden === !!visible) this.rail.hidden = !visible;
        if (this.root.classList.contains("sy-minimap-host") !== !!visible) this.root.classList.toggle("sy-minimap-host", !!visible);
        if (!visible) {
            this.cancelSlice();
            this.previewTask = null;
            return;
        }
        const rootRect = this.root.getBoundingClientRect();
        const rect = content.getBoundingClientRect();
        const top = rect.top - rootRect.top - this.root.clientTop;
        const width = content.clientWidth;
        const height = content.clientHeight;
        const total = content.scrollHeight;
        const bitmapWidth = Math.max(1, this.rail.clientWidth - 8);
        const track = Math.min(height, total * bitmapWidth / Math.max(1, width));
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        const previous = this.geometry;
        if (!previous || previous.width !== width || previous.total !== total || previous.track !== track || previous.bitmapWidth !== bitmapWidth || previous.ratio !== ratio) {
            this.renderer.full = true;
            if (previous && previous.width !== width) this.renderer.invalidateStyles();
            this.invalidatePreview();
        }
        this.geometry = { width, total, visible: height, bitmapWidth, track, ratio };
        this.preview.style.width = `${bitmapWidth}px`;
        this.preview.style.height = `${track}px`;
        this.rail.style.top = `${top}px`;
        this.rail.style.height = `${height}px`;
    }
    noteScrolling() {
        this.scrollUntil = performance.now() + SCROLL_DELAY;
        // The first bitmap is cheap enough to appear while the user scrolls.
        // Once present, pending edits/loads wait until scrolling has stopped.
        if (this.renderer.hasImage) this.cancelSlice();
        this.queuePaint();
    }
    invalidatePreview() {
        this.dirty = true;
        this.paintAfter = this.renderer.hasImage ? performance.now() + PREVIEW_DELAY : 0;
        this.cancelSlice();
        this.previewTask = null;
    }
    cancelSlice() {
        cancelAnimationFrame(this.paintFrame);
        this.paintFrame = 0;
    }
    queuePaint() {
        if (!this.dirty || this.destroyed || !this.content.isConnected || this.rail.hidden || (this.drag && this.renderer.hasImage) || this.paintTimer || this.paintFrame) return;
        const remaining = Math.max(this.paintAfter, this.renderer.hasImage ? this.scrollUntil : 0) - performance.now();
        if (remaining > 0 || this.layoutDirty) {
            this.paintTimer = setTimeout(() => {
                this.paintTimer = 0;
                this.queuePaint();
            }, Math.max(16, remaining));
        } else {
            this.paintFrame = requestAnimationFrame(() => {
                this.paintFrame = 0;
                this.paint();
            });
        }
    }
    paint() {
        if (this.destroyed || !this.content.isConnected || this.rail.hidden) return;
        if ((this.drag && this.renderer.hasImage) || this.layoutDirty || performance.now() < Math.max(this.renderer.hasImage ? this.scrollUntil : 0, this.paintAfter)) {
            this.queuePaint();
            return;
        }
        if (!this.previewTask) {
            this.previewTask = this.renderer.createTask(this.content, this.observedBody, this.geometry);
        }
        const started = performance.now();
        let completed = false;
        // No per-node stylesheet copying or DOM mounting; use the frame budget
        // for actual pixels and publish initial progress without waiting seconds.
        do {
            const result = this.previewTask.next();
            if (result.done) {
                completed = true;
                break;
            }
        } while (performance.now() - started < SLICE_MS);
        if (completed) {
            this.previewTask = null;
            this.dirty = false;
            return;
        }
        if (!this.renderer.hasImage) this.renderer.present();
        this.queuePaint();
    }
    destroy() {
        this.destroyed = true;
        cancelAnimationFrame(this.frame);
        clearTimeout(this.paintTimer);
        this.cancelSlice();
        this.previewTask = null;
        this.abort.abort();
        this.mutations.disconnect();
        this.resize.disconnect();
        this.theme.disconnect();
        this.rail.remove();
        this.root.classList.remove("sy-minimap-host");
    }
}
module.exports = { Minimap };
