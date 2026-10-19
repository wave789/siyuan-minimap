const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const BLOCKS = 3000;

(async () => {
    const executablePath = process.env.CHROMIUM_PATH || ['/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium-browser'].find(fs.existsSync);
    const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: Number(process.env.MINIMAP_DPR) || 1 });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent(`<style>
            body { margin: 0; --b3-theme-primary: #4d88ff; }
            .protyle { position: relative; width: 840px; height: 740px; display: flex; flex-direction: column; }
            .toolbar { height: 40px; flex-shrink: 0; }
            .protyle-content { flex: 1; overflow: auto; min-height: 0; }
            .protyle-wysiwyg { padding: 24px; color: #345; }
            .protyle-wysiwyg > div { min-height: 48px; margin-bottom: 8px; }
            .protyle-attr { position: absolute; width: 1px; height: 1px; overflow: hidden; }
            .fn__none { display: none !important; }
            html[data-theme-mode="dark"] .protyle-wysiwyg { color: #abc; }
        </style><div class="protyle" id="long"><div class="toolbar">Long document</div><div class="protyle-content"><div class="protyle-wysiwyg">${Array.from({ length: BLOCKS }, (_, i) => `<div data-node-id="block-${i}" data-type="NodeParagraph"><span>段落 ${i} </span><strong>粗体内容</strong><span style="color:rgb(40, 100, 160)"> 彩色内容 </span><em>斜体内容</em><span> 长文档滚动性能 </span><code>value_${i}</code><span class="protyle-attr"><span>EDITOR-HELPER</span></span></div>`).join('')}</div></div><div class="protyle-scroll">Native</div></div>`);
        await page.addStyleTag({ path: 'src/index.css' });
        await page.evaluate(() => {
            const source = document.querySelector('.protyle-content');
            const nativeStyle = window.getComputedStyle;
            const nativeRect = Element.prototype.getBoundingClientRect;
            const nativeTimeout = window.setTimeout.bind(window);
            const nativeClearTimeout = window.clearTimeout.bind(window);
            const nativeFrame = window.requestAnimationFrame.bind(window);
            const probe = window.perfProbe = {
                started: performance.now(), firstPixels: null, styleReads: 0, rectReads: 0, draws: 0, presents: 0,
                action: null, pendingTasks: new Set(), slices: [],
                delay: ms => new Promise(resolve => nativeTimeout(resolve, ms)),
                nextFrame: () => new Promise(nativeFrame),
                reset() { this.styleReads = 0; this.rectReads = 0; this.draws = 0; this.presents = 0; this.action = null; },
            };
            window.setTimeout = (callback, ms, ...args) => {
                const id = nativeTimeout(() => { probe.pendingTasks.delete(id); callback(...args); }, ms);
                probe.pendingTasks.add(id);
                return id;
            };
            window.clearTimeout = id => { probe.pendingTasks.delete(id); nativeClearTimeout(id); };
            window.getComputedStyle = function (element, pseudo) {
                if (element === source || source.contains(element)) {
                    probe.styleReads++;
                    const action = probe.action;
                    if (action && !action.scheduled) {
                        action.scheduled = true;
                        nativeTimeout(() => {
                            action.fired = true;
                            action.presentsBefore = probe.presents;
                            if (action.kind === 'edit') source.querySelector('[data-node-id="block-0"] > span').textContent = 'LATEST';
                            else {
                                window.plugin.onunload();
                                action.readsAtUnload = probe.styleReads;
                                action.pendingAtUnload = probe.pendingTasks.size;
                            }
                        }, 0);
                    }
                }
                return nativeStyle.call(this, element, pseudo);
            };
            Element.prototype.getBoundingClientRect = function () {
                if (this.matches('.protyle') || this === source || source.contains(this)) probe.rectReads++;
                return nativeRect.call(this);
            };
            for (const method of ['fillRect', 'fillText', 'clearRect', 'drawImage']) {
                const original = CanvasRenderingContext2D.prototype[method];
                CanvasRenderingContext2D.prototype[method] = function (...args) {
                    probe.draws++;
                    if (method === 'drawImage' && this.canvas.classList.contains('sy-minimap__preview')) {
                        probe.presents++;
                        probe.firstPixels ??= performance.now();
                    }
                    return original.apply(this, args);
                };
            }
        });
        const bundle = fs.readFileSync('dist/index.js', 'utf8');
        await page.evaluate(bundle => {
            window.handlers = new Map();
            const siyuan = { Plugin: class { constructor() { this.eventBus = { on: (name, fn) => handlers.set(name, fn), off: name => handlers.delete(name) }; } } };
            const module = { exports: {} };
            new Function('require', 'module', 'exports', bundle)(name => {
                if (name === 'siyuan') return siyuan;
                throw new Error('Unexpected import: ' + name);
            }, module, module.exports);
            window.plugin = new module.exports(); plugin.onload(); plugin.onLayoutReady();
            window.map = [...plugin.maps.values()][0];
            const paint = map.paint;
            map.paint = function () { const start = performance.now(); paint.call(this); perfProbe.slices.push(performance.now() - start); };
        }, bundle);
        const settled = () => page.waitForFunction(() => map.renderer.hasImage && !map.dirty && !map.frame && !map.paintFrame && !map.paintTimer);
        await settled();
        const initial = await page.evaluate(() => ({
            firstPixelsMs: perfProbe.firstPixels - perfProbe.started, completeMs: performance.now() - perfProbe.started,
            renderMs: perfProbe.slices.reduce((a, b) => a + b, 0), maxSliceMs: Math.max(...perfProbe.slices),
            styleReads: perfProbe.styleReads, textReads: map.renderer.stats.textReads,
            canvasHeight: map.preview.height, fullPaints: map.renderer.stats.fullPaints,
            pixels: map.preview.getContext('2d').getImageData(0, 0, map.preview.width, map.preview.height).data.some((value, index) => index % 4 === 3 && value > 0)
        }));
        assert.ok(initial.pixels, 'initial overview contains pixels');
        assert.equal(initial.fullPaints, 1, 'initial resize notifications are coalesced into one completed build');
        assert.ok(initial.textReads <= initial.canvasHeight, 'long documents sample at bitmap resolution instead of copying all inline elements');
        assert.equal(await page.locator('.sy-minimap__preview *').count(), 0, 'no duplicate editor DOM');

        async function scrollBurst(mode) {
            return page.evaluate(async mode => {
                const source = map.content;
                const body = source.querySelector('.protyle-wysiwyg');
                const before = map.preview.toDataURL();
                perfProbe.reset();
                const gaps = [];
                let previous;
                for (let frame = 0; frame < 40; frame++) {
                    await perfProbe.nextFrame();
                    const now = performance.now();
                    if (previous !== undefined) gaps.push(now - previous);
                    previous = now;
                    source.scrollTop = (frame % 2 ? 0.62 : 0.18) * (source.scrollHeight - source.clientHeight);
                    source.dispatchEvent(new Event('scroll'));
                    if (mode === 'helpers') {
                        body.children[frame].querySelector('.protyle-attr').classList.toggle('active');
                        body.children[frame].setAttribute('updated', String(frame));
                        body.children[frame].setAttribute('data-node-index', String(frame));
                        body.classList.toggle('protyle-wysiwyg--select');
                    }
                    if (mode === 'layout') plugin.refresh();
                    if (mode === 'content' && frame === 6) {
                        const block = document.createElement('div');
                        block.dataset.nodeId = 'loaded-while-scrolling';
                        block.textContent = 'LOADED-WHILE-SCROLLING';
                        body.append(block);
                    }
                }
                await perfProbe.nextFrame();
                source.dispatchEvent(new Event('scroll'));
                return { styleReads: perfProbe.styleReads, rectReads: perfProbe.rectReads, draws: perfProbe.draws,
                    samePixels: map.preview.toDataURL() === before, largestFrameGap: Math.max(...gaps) };
            }, mode);
        }
        async function assertThumb() {
            const result = await page.evaluate(() => {
                const source = map.content;
                const track = Math.min(map.rail.clientHeight, source.scrollHeight * (map.rail.clientWidth - 8) / source.clientWidth);
                const height = Math.min(track, Math.max(24, track * source.clientHeight / source.scrollHeight));
                return { expected: source.scrollTop / (source.scrollHeight - source.clientHeight) * (track - height),
                    actual: new DOMMatrix(getComputedStyle(map.thumb).transform).m42,
                    aria: Number(map.rail.getAttribute('aria-valuenow')), scroll: source.scrollTop };
            });
            assert.ok(Math.abs(result.actual - result.expected) < 0.1, 'viewport frame stays mapped to scrolling');
            assert.ok(Math.abs(result.aria - result.scroll) < 1, 'accessible scroll position stays accurate');
        }
        const pure = await scrollBurst('pure');
        assert.equal(pure.styleReads, 0, 'scrolling reads no content styles');
        assert.equal(pure.rectReads, 0, 'scrolling measures no document nodes');
        assert.equal(pure.draws, 0, 'scrolling performs no canvas drawing');
        assert.ok(pure.samePixels, 'scrolling preserves the cached bitmap');
        await settled(); await assertThumb();
        await page.evaluate(() => perfProbe.delay(250));
        assert.equal(await page.evaluate(() => perfProbe.draws), 0, 'stopping scrolling does not redraw an unmodified document');
        const helpers = await scrollBurst('helpers');
        assert.equal(helpers.styleReads, 0);
        assert.equal(helpers.draws, 0);
        await page.evaluate(() => perfProbe.delay(250));
        assert.equal(await page.evaluate(() => perfProbe.draws), 0, 'selection and bookkeeping changes do not trigger a delayed redraw');
        const layout = await scrollBurst('layout');
        assert.equal(layout.styleReads, 0);
        assert.equal(layout.draws, 0, 'editor scans and unchanged layout do not redraw the bitmap');
        await settled();

        const beforeHide = await page.evaluate(() => map.preview.toDataURL());
        await page.evaluate(() => { perfProbe.reset(); map.content.classList.add('fn__none'); });
        await page.locator('.sy-minimap').waitFor({ state: 'hidden' });
        await page.evaluate(() => map.content.classList.remove('fn__none'));
        await page.locator('.sy-minimap').waitFor({ state: 'visible' }); await settled();
        assert.equal(await page.evaluate(() => map.preview.toDataURL()), beforeHide, 'hiding and revealing an unchanged editor keeps its bitmap');
        assert.equal(await page.evaluate(() => perfProbe.draws), 0, 'revealing a cached editor does not redraw it');

        const beforeEdit = await page.evaluate(() => {
            perfProbe.reset();
            const before = map.preview.toDataURL();
            document.querySelector('[data-node-id="block-0"] > span').textContent = 'A';
            document.querySelector('[data-node-id="block-0"] > strong').textContent = '';
            return before;
        });
        await settled();
        const edit = await page.evaluate(() => ({ styleReads: perfProbe.styleReads, rectReads: perfProbe.rectReads,
            stats: map.renderer.stats, pixels: map.preview.toDataURL() }));
        assert.notEqual(edit.pixels, beforeEdit, 'editing changes the visible bitmap');
        assert.equal(edit.stats.partialPaints, 1, 'an edit with unchanged geometry repaints its strip');
        assert.ok(edit.styleReads <= 2, 'a block edit reuses other blocks without reading their styles');
        assert.ok(edit.rectReads <= 4, 'a block edit does not remeasure the whole document');
        await page.evaluate(() => { map.renderer.full = true; map.invalidatePreview(); map.schedule(false); });
        await settled();
        assert.equal(await page.evaluate(() => map.preview.toDataURL()), edit.pixels, 'partial repaint matches a fresh complete bitmap exactly');

        const loaded = await scrollBurst('content');
        assert.equal(loaded.styleReads, 0);
        assert.equal(loaded.draws, 0, 'newly loaded content is deferred during scrolling');
        await settled();
        assert.equal(await page.evaluate(() => map.renderer.layout.length), BLOCKS + 1);
        assert.ok(await page.evaluate(() => perfProbe.styleReads) < BLOCKS / 2, 'new content reuses models already cached');
        await assertThumb();

        // Force a full recolor, then change a leading block after copying starts.
        // The old complete bitmap stays visible until a current build is ready.
        await page.evaluate(() => {
            perfProbe.reset(); perfProbe.action = { kind: 'edit' };
            document.querySelector('[data-node-id="block-0"] > span').textContent = 'STALE';
            document.documentElement.setAttribute('data-theme-mode', 'dark');
        });
        await page.waitForFunction(() => perfProbe.action?.fired);
        assert.equal(await page.evaluate(() => perfProbe.action.presentsBefore), 0, 'updating a complete bitmap yields without publishing stale progress');
        await settled();
        assert.ok(await page.evaluate(() => map.renderer.cache.get(document.querySelector('[data-node-id="block-0"]')).text.startsWith('LATEST')));
        await page.mouse.move(300, 350);
        const beforeWheel = await page.locator('.protyle-content').evaluate(el => el.scrollTop);
        await page.mouse.wheel(0, 450);
        await page.waitForFunction(before => map.content.scrollTop > before, beforeWheel);
        await page.waitForFunction(() => Math.abs(Number(map.rail.getAttribute('aria-valuenow')) - map.content.scrollTop) < 1);
        await assertThumb(); await settled();

        // A completed unchanged minimap owns no polling or idle render loop.
        await page.evaluate(() => perfProbe.reset());
        await page.evaluate(() => perfProbe.delay(300));
        assert.equal(await page.evaluate(() => perfProbe.styleReads + perfProbe.rectReads + perfProbe.draws + perfProbe.pendingTasks.size), 0, 'idle editor has no rendering work or pending timer');
        await page.evaluate(() => {
            perfProbe.action = { kind: 'unload' };
            document.documentElement.setAttribute('data-theme-mode', 'light');
        });
        await page.waitForFunction(() => perfProbe.action?.fired);
        const unloaded = await page.evaluate(() => ({ ...perfProbe.action }));
        assert.equal(unloaded.presentsBefore, 0);
        assert.equal(unloaded.pendingAtUnload, 0, 'unload clears render timers');
        await page.evaluate(() => perfProbe.delay(250));
        assert.equal(await page.evaluate(() => perfProbe.styleReads), unloaded.readsAtUnload, 'no drawing work continues after unload');
        assert.equal(await page.evaluate(() => perfProbe.presents), 0);
        assert.equal(await page.locator('.sy-minimap, .sy-minimap-host').count(), 0);
        assert.equal(await page.evaluate(() => handlers.size), 0);
        assert.deepEqual(errors, []);
        console.log(`PASS: ${BLOCKS} rich blocks; cached scrolling, selection/layout/tab reuse, partial edit, loaded content, theme invalidation, wheel, idle and unload`);
        console.log('Initial render diagnostics:', JSON.stringify(initial));
        console.log('Single-block edit reads:', JSON.stringify({ styles: edit.styleReads, rectangles: edit.rectReads }));
        console.log(`Maximum scroll frame intervals: pure ${pure.largestFrameGap.toFixed(1)} ms; helper ${helpers.largestFrameGap.toFixed(1)} ms; loaded ${loaded.largestFrameGap.toFixed(1)} ms`);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
