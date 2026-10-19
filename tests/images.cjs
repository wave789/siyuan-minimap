const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

(async () => {
    const executablePath = process.env.CHROMIUM_PATH || ['/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium-browser'].find(fs.existsSync);
    const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
    let releaseImage;
    const imageReady = new Promise(resolve => { releaseImage = resolve; });
    try {
        const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: Number(process.env.MINIMAP_DPR) || 1 });
        const errors = [];
        let requests = 0;
        page.on('pageerror', error => errors.push(error.message));
        await page.route('http://minimap.test/late.svg', async route => {
            requests++;
            await imageReady;
            await route.fulfill({ contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' },
                body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="rgb(245,180,30)"/></svg>' });
        });
        await page.setContent(`<style>
            body { margin: 0; }
            .protyle { position: relative; width: 680px; height: 680px; display: flex; flex-direction: column; }
            .protyle-content { flex: 1; overflow: auto; min-height: 0; }
            .protyle-wysiwyg { padding: 20px; }
            .protyle-wysiwyg > div { min-height: 40px; }
            .photos { height: 100px; }
            .photos img { vertical-align: top; margin-left: 20px; }
        </style><div class="protyle"><div class="protyle-content"><div class="protyle-wysiwyg">
            <div data-node-id="photos" class="photos"></div>
            <div data-node-id="after-photo">文字</div>
            <div data-node-id="cover" class="photos"></div>
            <div data-node-id="late" class="photos"></div>
            ${Array.from({ length: 100 }, (_, i) => `<div data-node-id="text-${i}">Paragraph ${i} — 图片缩略图测试</div>`).join('')}
        </div></div></div>`);
        await page.evaluate(() => {
            const uri = svg => 'data:image/svg+xml,' + encodeURIComponent(svg);
            const add = (parent, id, width, height, src) => {
                const image = document.createElement('img');
                image.id = id; image.width = width; image.height = height; image.src = src;
                document.querySelector(`[data-node-id="${parent}"]`).append(image);
                return image;
            };
            add('photos', 'first-photo', 120, 100, uri('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="60" height="80" fill="rgb(240,40,50)"/><rect x="60" width="60" height="80" fill="rgb(30,80,220)"/></svg>'));
            add('photos', 'second-photo', 100, 100, uri('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80" fill="rgb(20,190,90)"/></svg>'));
            const cover = add('cover', 'cover-photo', 80, 100, uri('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><rect width="100" height="100" fill="rgb(240,40,50)"/><rect x="100" width="100" height="100" fill="rgb(20,190,90)"/><rect x="200" width="100" height="100" fill="rgb(30,80,220)"/></svg>'));
            cover.style.objectFit = 'cover';
            const late = document.createElement('img');
            late.id = 'late-photo'; late.width = 120; late.height = 100; late.crossOrigin = 'anonymous';
            late.src = 'http://minimap.test/late.svg';
            document.querySelector('[data-node-id="late"]').append(late);
        });
        await page.waitForFunction(() => ['first-photo', 'second-photo', 'cover-photo'].every(id => document.getElementById(id).complete));
        await page.addStyleTag({ path: 'src/index.css' });
        await page.evaluate(bundle => {
            const module = { exports: {} };
            class Plugin { constructor() { this.eventBus = { on() {}, off() {} }; } }
            new Function('require', 'module', 'exports', bundle)(() => ({ Plugin }), module, module.exports);
            window.plugin = new module.exports(); plugin.onload(); plugin.onLayoutReady();
            window.map = [...plugin.maps.values()][0];
        }, fs.readFileSync('dist/index.js', 'utf8'));
        const settled = () => page.waitForFunction(() => map.renderer.hasImage && !map.dirty && !map.frame && !map.paintFrame && !map.paintTimer);
        await settled();
        async function pixel(id, u = 0.5, v = 0.5) {
            return page.evaluate(({ id, u, v }) => {
                const image = document.getElementById(id);
                const rect = image.getBoundingClientRect();
                const origin = map.content.getBoundingClientRect();
                const { bitmapWidth, width, track, total, ratio } = map.geometry;
                const x = (rect.left - origin.left - map.content.clientLeft + map.content.scrollLeft + rect.width * u) * bitmapWidth / width * ratio;
                const y = (rect.top - origin.top - map.content.clientTop + map.content.scrollTop + rect.height * v) * track / total * ratio;
                return [...map.preview.getContext('2d').getImageData(Math.floor(x), Math.floor(y), 1, 1).data];
            }, { id, u, v });
        }
        async function color(id, expected, u = 0.5) {
            const actual = await pixel(id, u);
            assert.ok(actual[3] > 220 && expected.every((value, i) => Math.abs(value - actual[i]) <= 6), `${id} should show ${expected}, received ${actual}`);
        }
        await color('first-photo', [240, 40, 50], 0.25);
        await color('first-photo', [30, 80, 220], 0.75);
        await color('second-photo', [20, 190, 90]);
        await color('cover-photo', [20, 190, 90]);
        assert.equal(await page.locator('.sy-minimap img').count(), 0, 'thumbnails reuse decoded images instead of duplicating DOM image resources');
        const initialRasterizations = await page.evaluate(() => map.renderer.stats.imageRasters);
        assert.equal(initialRasterizations, 3, 'each loaded image is downsampled only once');
        const previousHeight = await page.evaluate(() => map.geometry.total);
        const fullPaintsBeforeLoad = await page.evaluate(() => map.renderer.stats.fullPaints);
        releaseImage();
        await page.waitForFunction(() => document.querySelector('#late-photo').complete && document.querySelector('#late-photo').naturalWidth > 0);
        await settled();
        await color('late-photo', [245, 180, 30]);
        assert.equal(await page.evaluate(() => map.geometry.total), previousHeight, 'late loading does not change the reserved image dimensions');
        assert.equal(await page.evaluate(() => map.renderer.stats.fullPaints), fullPaintsBeforeLoad, 'fixed-size image load updates its region without rebuilding the whole overview');
        assert.equal(requests, 1, 'the minimap issues no additional image requests');

        const beforeScroll = await page.evaluate(() => ({ bitmap: map.preview.toDataURL(), ...map.renderer.stats }));
        await page.evaluate(async () => {
            for (let i = 0; i < 20; i++) {
                map.content.scrollTop = (i % 2 ? 0.5 : 0.1) * (map.content.scrollHeight - map.content.clientHeight);
                await new Promise(requestAnimationFrame);
            }
        });
        await settled();
        const afterScroll = await page.evaluate(() => ({ bitmap: map.preview.toDataURL(), ...map.renderer.stats }));
        assert.equal(afterScroll.bitmap, beforeScroll.bitmap);
        assert.equal(afterScroll.imageRasters, beforeScroll.imageRasters, 'scrolling performs no image rasterization');
        assert.equal(afterScroll.imageDraws, beforeScroll.imageDraws, 'scrolling performs no image drawing');
        assert.equal(afterScroll.presents, beforeScroll.presents, 'scrolling reuses the entire bitmap');

        await page.evaluate(() => document.querySelector('[data-node-id="after-photo"]').textContent = '改');
        await settled();
        const partial = await page.evaluate(() => map.preview.toDataURL());
        await page.evaluate(() => { map.renderer.full = true; map.invalidatePreview(); map.schedule(false); });
        await settled();
        assert.equal(await page.evaluate(() => map.preview.toDataURL()), partial, 'partial text update restores adjacent image edges exactly');
        assert.equal(await page.evaluate(() => map.renderer.stats.imageRasters), afterScroll.imageRasters, 'an unrelated edit and a full redraw reuse the thumbnail cache');

        await page.evaluate(() => document.querySelector('#cover-photo').style.objectPosition = 'right center');
        await settled();
        await color('cover-photo', [30, 80, 220]);
        await page.evaluate(() => {
            document.querySelector('#first-photo').src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="rgb(150,50,200)"/></svg>');
        });
        await page.waitForFunction(() => document.querySelector('#first-photo').complete && document.querySelector('#first-photo').naturalWidth > 0);
        await settled();
        await color('first-photo', [150, 50, 200]);
        await color('second-photo', [20, 190, 90]);
        const replaced = await page.evaluate(() => map.preview.toDataURL());
        await page.evaluate(() => { map.renderer.full = true; map.invalidatePreview(); map.schedule(false); });
        await settled();
        assert.equal(await page.evaluate(() => map.preview.toDataURL()), replaced, 'partial image replacement matches a complete redraw');
        await page.screenshot({ path: '/tmp/siyuan-minimap-images.png' });
        await page.evaluate(() => document.querySelector('#first-photo').src = 'data:image/png;base64,invalid');
        await page.waitForFunction(() => document.querySelector('#first-photo').complete && !document.querySelector('#first-photo').naturalWidth);
        await settled();
        assert.ok((await pixel('first-photo'))[3] < 200, 'a failed image clears the old thumbnail and uses a transparent placeholder');
        await page.evaluate(() => plugin.onunload());
        assert.equal(await page.locator('.sy-minimap').count(), 0);
        assert.deepEqual(errors, []);
        console.log('PASS: image colors/position, multiple images, cover/crop, late loading without layout changes, replacement/failure, thumbnail cache, zero scroll drawing and adjacent partial repaint');
    } finally { releaseImage(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
