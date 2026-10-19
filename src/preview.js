// Copyright 2026 wave789
// SPDX-License-Identifier: Apache-2.0
"use strict";

// Keep a small bitmap and a block model, rather than a second styled editor.
// Like an IDE minimap, subpixel lines are sampled at the bitmap's resolution.
const SKIP = 'script, style, link, meta, iframe, object, embed, audio, video, canvas, .protyle-attr, .protyle-action, .protyle-icons, .protyle-gutters, .protyle-select, .protyle-toolbar';
const VISUAL_ATTRIBUTES = new Set(['style', 'class', 'hidden', 'open', 'src', 'srcset', 'width', 'height', 'colspan', 'rowspan', 'dir', 'data-type', 'data-subtype', 'fold']);
const TRANSIENT_CLASSES = /^(protyle-wysiwyg--(select|hl|flash)|protyle-wysiwyg__select|select|selected)$/;
const MAX_TEXT = 16384;

function stableClasses(value) {
    return (value || '').split(/\s+/).filter(name => name && !TRANSIENT_CLASSES.test(name)).sort().join(' ');
}

function relevantMutation(record) {
    const element = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
    if (element?.closest(SKIP)) return false;
    if (record.type === 'attributes') {
        if (!VISUAL_ATTRIBUTES.has(record.attributeName)) return false;
        if (record.oldValue === element.getAttribute(record.attributeName)) return false;
        if (record.attributeName === 'class') {
            const normalize = value => stableClasses(value).split(' ').filter(name => !element.matches('.protyle-content, .protyle-wysiwyg') || name !== 'fn__none').join(' ');
            return normalize(record.oldValue) !== normalize(element.getAttribute('class'));
        }
    }
    if (record.type === 'childList') {
        return [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === Node.TEXT_NODE
            || (node.nodeType === Node.ELEMENT_NODE && !node.matches(SKIP)));
    }
    return true;
}

function blockText(block) {
    let text = '';
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (node.nodeType === Node.ELEMENT_NODE && (node.matches(SKIP) || node.hidden || node.style.display === 'none')) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        }
    });
    let node;
    while ((node = walker.nextNode()) && text.length < MAX_TEXT) {
        if (node.nodeType === Node.TEXT_NODE) text += node.nodeValue.slice(0, MAX_TEXT - text.length);
        else if (node.localName === 'br' || /^(p|li|tr|pre|h[1-6])$/.test(node.localName)) text += '\n';
    }
    return text.trim();
}

function linesFor(text, columns) {
    const lines = [];
    for (const paragraph of text.split('\n')) {
        let start = 0;
        let width = 0;
        for (let i = 0; i < paragraph.length; i++) {
            width += paragraph.charCodeAt(i) > 255 ? 2 : 1;
            if (width >= columns) {
                lines.push(paragraph.slice(start, i + 1));
                start = i + 1;
                width = 0;
            }
        }
        if (start < paragraph.length || !paragraph.length) lines.push(paragraph.slice(start));
    }
    return lines;
}

function imageOffset(space, position) {
    if (position?.endsWith('%')) return space * parseFloat(position) / 100;
    if (position?.endsWith('px')) return parseFloat(position);
    if (position === 'left' || position === 'top') return 0;
    if (position === 'right' || position === 'bottom') return space;
    return space / 2;
}

class CanvasPreview {
    constructor(canvas) {
        this.canvas = canvas;
        this.buffer = document.createElement('canvas');
        this.cache = new WeakMap();
        this.imageCache = new WeakMap();
        this.dirtyBlocks = new Set();
        this.layout = null;
        this.byNode = new WeakMap();
        this.full = true;
        this.hasImage = false;
        this.styleEpoch = 0;
        this.stats = { fullPaints: 0, partialPaints: 0, textReads: 0, styleReads: 0, draws: 0, presents: 0, imageRasters: 0, imageDraws: 0 };
    }
    invalidateStyles() {
        this.styleEpoch++;
        this.full = true;
    }
    mutations(records, body) {
        let changed = false;
        for (const record of records) {
            if (!relevantMutation(record)) continue;
            changed = true;
            const element = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
            if (element?.matches('img')) this.imageCache.delete(element);
            const block = element?.closest('[data-node-id]');
            if (!block || !body?.contains(block)) {
                this.full = true;
                // A style on the editor body can affect every block.
                if (record.type === 'attributes') this.invalidateStyles();
            } else {
                this.cache.delete(block);
                this.dirtyBlocks.add(block);
                if (record.type === 'attributes' && block.querySelector('[data-node-id]')) this.invalidateStyles();
                if (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && (node.matches('[data-node-id]') || node.querySelector('[data-node-id]')))) this.full = true;
            }
        }
        return changed;
    }
    imageChanged(image, body) {
        if (!image?.matches?.('img') || !body?.contains(image) || image.closest(SKIP)) return false;
        this.imageCache.delete(image);
        const block = image.closest('[data-node-id]');
        if (block) this.dirtyBlocks.add(block);
        else this.full = true;
        return true;
    }
    model(block) {
        let data = this.cache.get(block);
        if (!data) {
            const media = block.querySelector('img, table, pre, h1, h2, h3, h4, h5, h6');
            const images = block.matches('img') ? [block] : [...block.querySelectorAll('img')].filter(image => !image.closest(SKIP));
            data = { text: blockText(block), media, images, epoch: -1 };
            this.stats.textReads++;
            this.cache.set(block, data);
        }
        if (data.epoch !== this.styleEpoch) {
            const element = data.media?.matches('h1, h2, h3, h4, h5, h6, pre') ? data.media : block;
            const style = getComputedStyle(element);
            const fontSize = parseFloat(style.fontSize) || 16;
            data.style = { color: style.color, fontSize, lineHeight: parseFloat(style.lineHeight) || fontSize * 1.5,
                family: style.fontFamily, weight: style.fontWeight, hidden: style.display === 'none' || style.visibility === 'hidden' };
            data.epoch = this.styleEpoch;
            this.stats.styleReads++;
        }
        return data;
    }
    measure(block, content, top) {
        const rect = block.getBoundingClientRect();
        return { node: block, top: rect.top - top + content.scrollTop, left: rect.left - this.contentLeft + content.scrollLeft,
            width: rect.width, height: rect.height };
    }
    *createTask(content, body, geometry) {
        const { width, total, track, bitmapWidth } = geometry;
        const ratio = geometry.ratio;
        const key = [width, total, track, bitmapWidth, ratio].join(':');
        let full = this.full || !this.hasImage || this.key !== key || !this.layout || this.dirtyBlocks.size > 32;
        const contentRect = content.getBoundingClientRect();
        this.contentLeft = contentRect.left + content.clientLeft;
        const origin = contentRect.top + content.clientTop;
        let strips = [];
        if (!full) {
            for (const block of this.dirtyBlocks) {
                const previous = this.byNode.get(block);
                if (!previous || !block.isConnected) { full = true; break; }
                const current = this.measure(block, content, origin);
                if (['top', 'left', 'width', 'height'].some(name => Math.abs(previous[name] - current[name]) > 0.5)) { full = true; break; }
                const y = Math.floor(previous.top * track / total * ratio);
                const end = Math.ceil((previous.top + previous.height) * track / total * ratio);
                strips.push([Math.max(0, y - 1), Math.max(y + 1, end + 1)]);
            }
            if (!strips.length && !full) return;
        }
        const pixelWidth = Math.max(1, Math.ceil(bitmapWidth * ratio));
        const pixelHeight = Math.max(1, Math.ceil(track * ratio));
        if (this.buffer.width !== pixelWidth) this.buffer.width = pixelWidth;
        if (this.buffer.height !== pixelHeight) this.buffer.height = pixelHeight;
        const ctx = this.buffer.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, pixelWidth, pixelHeight);
        if (!full) {
            ctx.drawImage(this.canvas, 0, 0);
            for (const [start, end] of strips) ctx.clearRect(0, start, pixelWidth, end - start);
        }
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.textBaseline = 'top';
        const scaleX = bitmapWidth / Math.max(1, width);
        const scaleY = track / Math.max(1, total);
        let layout = this.layout;
        const byNode = full ? new WeakMap() : this.byNode;
        let nodes;
        if (full) {
            const candidates = [...body.querySelectorAll('[data-node-id]')];
            // Containers include their children in their bounds. Draw leaf blocks
            // once; plain DOM fixtures also work without SiYuan block attributes.
            nodes = candidates.length ? candidates.filter((node, i) => !node.contains(candidates[i + 1]) && !node.closest(SKIP)) : [...body.children];
            layout = [];
        } else nodes = layout.filter(entry => strips.some(([start, end]) => {
            const top = entry.top * scaleY * ratio;
            // Restore long images entering a dirty strip and the subpixel text
            // immediately before it, including their antialiased bottom edge.
            return top < end && Math.max((entry.top + entry.height) * scaleY * ratio, Math.floor(top) + 2) >= start;
        }));
        let lastRow = -Infinity;
        for (let i = 0; i < nodes.length; i++) {
            const entry = full ? this.measure(nodes[i], content, origin) : nodes[i];
            if (full) {
                layout.push(entry);
                byNode.set(entry.node, entry);
            }
            const row = Math.floor(entry.top * scaleY * ratio);
            if (entry.height > 0 && row >= 0 && row < pixelHeight && (row > lastRow || entry.height * scaleY * ratio >= 1)) {
                const data = this.model(entry.node);
                if (!data.style.hidden) {
                    if (!full) {
                        ctx.save();
                        ctx.beginPath();
                        for (const [start, end] of strips) ctx.rect(0, start / ratio, bitmapWidth, (end - start) / ratio);
                        ctx.clip();
                    }
                    this.draw(ctx, entry, data, scaleX, scaleY, ratio);
                    this.drawImages(ctx, data, content, origin, scaleX, scaleY, ratio);
                    if (!full) ctx.restore();
                }
                lastRow = row;
            }
            yield;
        }
        this.layout = layout;
        this.byNode = byNode;
        this.key = key;
        this.full = false;
        this.dirtyBlocks.clear();
        this.hasImage = true;
        this.stats[full ? 'fullPaints' : 'partialPaints']++;
        this.present();
    }
    draw(ctx, entry, data, scaleX, scaleY, ratio) {
        const { fontSize, lineHeight, color, family, weight } = data.style;
        const x = entry.left * scaleX;
        const y = entry.top * scaleY;
        const width = entry.width * scaleX;
        const height = entry.height * scaleY;
        ctx.fillStyle = color;
        if (data.media?.localName === 'table') {
            ctx.globalAlpha = 0.2;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1 / ratio;
            ctx.strokeRect(x, y, width, height);
            ctx.globalAlpha = 1;
        }
        const columns = Math.max(8, Math.floor(entry.width / (fontSize * 0.55)));
        if (data.columns !== columns) {
            data.columns = columns;
            data.lines = linesFor(data.text, columns);
        }
        const lines = data.lines;
        const font = Math.max(1 / ratio, Math.min(fontSize * scaleX, lineHeight * scaleY));
        const visibleRows = Math.max(1, Math.min(lines.length, Math.ceil(height * ratio)));
        const step = Math.max(1, Math.ceil(lines.length / visibleRows));
        ctx.font = `${weight} ${font}px ${family}`;
        let last = -Infinity;
        for (let line = 0; line < lines.length; line += step) {
            const top = y + Math.min(Math.max(0, height - 1 / ratio), line * lineHeight * scaleY);
            const row = Math.floor(top * ratio);
            if (row === last) continue;
            last = row;
            if (font >= 2) ctx.fillText(lines[line], x, top, width);
            else {
                // At <2px, character-shaped pixels add work without conveying
                // readable text. Preserve word widths and whitespace instead.
                const unit = fontSize * 0.55 * scaleX;
                let column = 0;
                for (const word of lines[line].match(/\s+|\S+/g) || []) {
                    let length = 0;
                    for (let i = 0; i < word.length; i++) length += word.charCodeAt(i) > 255 ? 2 : 1;
                    if (word.trim() && column * unit < width) ctx.fillRect(x + column * unit, top, Math.min(width - column * unit, length * unit), Math.max(0.6 / ratio, font * 0.7));
                    column += length;
                }
            }
        }
        this.stats.draws++;
    }
    thumbnail(image, boxWidth, boxHeight, width, height) {
        if (!image.complete || !image.naturalWidth || !image.naturalHeight) return undefined;
        const source = image.currentSrc || image.src;
        const baseKey = [image.naturalWidth, image.naturalHeight, boxWidth, boxHeight, width, height].join(':');
        const previous = this.imageCache.get(image);
        const sameImage = previous?.source === source && previous.baseKey === baseKey;
        if (sameImage && previous.epoch === this.styleEpoch) return previous.bitmap;
        const style = getComputedStyle(image);
        const key = [baseKey, style.objectFit, style.objectPosition, style.opacity, style.filter, style.visibility].join(':');
        if (sameImage && previous.key === key) {
            previous.epoch = this.styleEpoch;
            return previous.bitmap;
        }
        let bitmap = null;
        if (style.visibility !== 'hidden' && style.visibility !== 'collapse') {
            bitmap = document.createElement('canvas');
            bitmap.width = width;
            bitmap.height = height;
            const ctx = bitmap.getContext('2d');
            ctx.imageSmoothingQuality = 'high';
            ctx.globalAlpha = Number(style.opacity);
            ctx.filter = style.filter;
            let drawWidth = width, drawHeight = height, left = 0, top = 0;
            if (style.objectFit !== 'fill') {
                const contain = Math.min(boxWidth / image.naturalWidth, boxHeight / image.naturalHeight);
                const scale = style.objectFit === 'cover' ? Math.max(boxWidth / image.naturalWidth, boxHeight / image.naturalHeight)
                    : style.objectFit === 'none' ? 1 : style.objectFit === 'scale-down' ? Math.min(1, contain) : contain;
                const fittedWidth = image.naturalWidth * scale;
                const fittedHeight = image.naturalHeight * scale;
                const position = style.objectPosition.split(/\s+/);
                left = imageOffset(boxWidth - fittedWidth, position[0]) * width / boxWidth;
                top = imageOffset(boxHeight - fittedHeight, position[1]) * height / boxHeight;
                drawWidth = fittedWidth * width / boxWidth;
                drawHeight = fittedHeight * height / boxHeight;
            }
            try {
                // Reuse the editor's decoded image. Never create another image
                // request, animation loop, or full-sized raster for the minimap.
                ctx.drawImage(image, left, top, drawWidth, drawHeight);
                this.stats.imageRasters++;
            } catch {
                bitmap = undefined;
            }
        }
        this.imageCache.set(image, { source, baseKey, key, epoch: this.styleEpoch, bitmap });
        return bitmap;
    }
    drawImages(ctx, data, content, origin, scaleX, scaleY, ratio) {
        for (const image of data.images) {
            const rect = image.getBoundingClientRect();
            if (!rect.width || !rect.height) continue;
            const x = (rect.left - this.contentLeft + content.scrollLeft) * scaleX;
            const y = (rect.top - origin + content.scrollTop) * scaleY;
            const width = rect.width * scaleX;
            const height = rect.height * scaleY;
            const bitmap = this.thumbnail(image, rect.width, rect.height,
                Math.max(1, Math.min(160, Math.ceil(width * ratio))), Math.max(1, Math.min(512, Math.ceil(height * ratio))));
            if (bitmap === null) continue;
            if (bitmap) {
                ctx.drawImage(bitmap, x, y, width, height);
                this.stats.imageDraws++;
            } else {
                // Loading/failed images get a subtle outline, not a solid block.
                ctx.save();
                ctx.globalAlpha = 0.25;
                ctx.strokeStyle = data.style.color;
                ctx.lineWidth = 1 / ratio;
                ctx.strokeRect(x, y, width, Math.max(1 / ratio, height));
                if (width >= 4 && height >= 4) {
                    ctx.beginPath();
                    ctx.moveTo(x, y + height);
                    ctx.lineTo(x + width * 0.35, y + height * 0.4);
                    ctx.lineTo(x + width * 0.65, y + height * 0.8);
                    ctx.lineTo(x + width * 0.8, y + height * 0.6);
                    ctx.lineTo(x + width, y + height);
                    ctx.stroke();
                }
                ctx.restore();
            }
        }
    }
    present() {
        if (this.canvas.width !== this.buffer.width) this.canvas.width = this.buffer.width;
        if (this.canvas.height !== this.buffer.height) this.canvas.height = this.buffer.height;
        const ctx = this.canvas.getContext('2d');
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.drawImage(this.buffer, 0, 0);
        this.stats.presents++;
    }
}
module.exports = { CanvasPreview };
