const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
    const executablePath = process.env.CHROMIUM_PATH || ['/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium-browser'].find(fs.existsSync);
    const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: Number(process.env.MINIMAP_DPR) || 1 });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent(`<style>
            body { margin: 0; display: flex; --b3-theme-primary: #4d88ff; }
            .protyle { position: relative; width: 580px; height: 700px; display: flex; flex-direction: column; }
            .toolbar { height: 40px; flex-shrink: 0; }
            .protyle-content { flex: 1; overflow: auto; min-height: 0; }
            .protyle-wysiwyg { padding: 24px; }
            .protyle-wysiwyg > div { min-height: 60px; margin-bottom: 8px; }
            .fn__none { display: none !important; }
        </style><div class="protyle" id="first"><div class="toolbar">Document</div><div class="protyle-content"><div class="protyle-wysiwyg">${Array.from({ length: 80 }, (_, i) => `<div data-node-id="${i}" data-type="${i % 8 ? 'NodeParagraph' : 'NodeHeading'}">Paragraph ${i} — 测试文档内容</div>`).join('')}</div></div><div class="protyle-scroll">Native</div></div>`);
        await page.evaluate(() => {
            const blocks = document.querySelectorAll('[data-node-id]');
            blocks[0].innerHTML = '<h1 style="font-size:32px;color:rgb(30, 90, 180)">真实正文预览</h1>';
            blocks[1].innerHTML = '<p contenteditable="true" id="original-only">这里保留正文的 <strong>粗体</strong> 与 <span style="color:rgb(210, 50, 60)">彩色文字</span>，以及实际换行后的文字布局。</p>';
            blocks[2].innerHTML = '<ul><li>项目一</li><li>项目二<ul><li>嵌套列表</li></ul></li></ul>';
            blocks[3].innerHTML = '<pre style="background:rgb(240, 242, 246);padding:12px"><code><span style="color:rgb(130, 60, 160)">const</span> answer = 42;\nconsole.log(answer);</code></pre>';
            blocks[4].innerHTML = '<table style="border-collapse:collapse;width:100%"><tr><td style="border:1px solid gray">名称</td><td style="border:1px solid gray">说明</td></tr><tr><td style="border:1px solid gray">Minimap</td><td style="border:1px solid gray">正文缩略图</td></tr></table>';
            const img = document.createElement('img');
            img.width = 240; img.height = 100;
            img.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="100"><rect width="240" height="100" fill="#69b4c7"/><circle cx="170" cy="35" r="20" fill="#ffe09c"/><path d="M0 100L80 20L160 100" fill="#397563"/></svg>');
            blocks[5].append(img);
            const helper = document.createElement('span'); helper.className = 'protyle-attr'; helper.textContent = 'EDITOR-HELPER'; blocks[6].append(helper);
        });
        await page.addStyleTag({ path: 'src/index.css' });
        const bundle = fs.readFileSync('dist/index.js', 'utf8');
        await page.evaluate(bundle => {
            window.handlers = new Map();
            const siyuan = { Plugin: class { constructor() { this.eventBus = { on: (name, fn) => handlers.set(name, fn), off: name => handlers.delete(name) }; } } };
            const module = { exports: {} };
            const hostRequire = name => { if (name === 'siyuan') return siyuan; throw new Error('Unexpected external import: ' + name); };
            new Function('require', 'module', 'exports', bundle)(hostRequire, module, module.exports);
            window.plugin = new module.exports();
            plugin.onload(); plugin.onLayoutReady();
        }, bundle);
        const rail = page.locator('#first .sy-minimap');
        await rail.waitFor({ state: 'visible' });
        await page.waitForFunction(() => [...plugin.maps.values()].every(map => map.renderer.hasImage && !map.dirty));
        const preview = page.locator('#first .sy-minimap__preview');
        assert.equal(await preview.evaluate(el => el.tagName), 'CANVAS');
        const pixels = await preview.evaluate(canvas => {
            const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            let painted = 0, headingColor = 0;
            for (let i = 0; i < data.length; i += 4) {
                if (data[i + 3]) painted++;
                if (data[i + 3] > 10 && Math.abs(data[i] - 30) < 3 && Math.abs(data[i + 1] - 90) < 3 && Math.abs(data[i + 2] - 180) < 3) headingColor++;
            }
            return { painted, headingColor };
        });
        assert.ok(pixels.painted > 100, 'document overview contains rendered pixels');
        assert.ok(pixels.headingColor > 0, 'heading color is represented in the bitmap');
        assert.equal(await preview.locator('[id], [data-node-id], [contenteditable], iframe, script').count(), 0);
        assert.equal(await preview.locator('*').count(), 0, 'preview does not create another document DOM or reload images');
        await page.screenshot({ path: '/tmp/siyuan-minimap-preview.png' });
        const box = await rail.boundingBox();
        assert.equal(Math.round(box.y), 40);
        const scroll = () => page.locator('#first .protyle-content').evaluate(el => el.scrollTop);
        await page.mouse.click(box.x + 40, box.y + box.height / 2);
        assert.ok(await scroll() > 2000, 'click jumps into document');
        const before = await scroll();
        await page.mouse.wheel(0, 180);
        await page.waitForFunction(value => document.querySelector('.protyle-content').scrollTop > value, before);
        await rail.focus(); await page.keyboard.press('Home');
        await page.waitForFunction(() => document.querySelector('.protyle-content').scrollTop === 0);
        await page.mouse.move(box.x + 40, box.y + 10); await page.mouse.down();
        await page.mouse.move(box.x + 40, box.y + box.height + 40, { steps: 8 }); await page.mouse.up();
        const bottom = await page.locator('#first .protyle-content').evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop);
        assert.ok(Math.abs(bottom) < 2, 'drag reaches bottom');
        await page.evaluate(() => { const clone = document.querySelector('#first').cloneNode(true); clone.id = 'second'; clone.querySelector('.sy-minimap').remove(); clone.classList.remove('sy-minimap-host'); document.body.append(clone); });
        await page.waitForFunction(() => plugin.maps.size === 2 && document.querySelectorAll('.sy-minimap').length === 2);
        const second = page.locator('#second .sy-minimap'); await second.waitFor({ state: 'visible' });
        await second.hover(); await page.mouse.wheel(0, 120);
        await page.waitForFunction(() => document.querySelector('#second .protyle-content').scrollTop > 0);
        assert.ok(Math.abs(await scroll() - (await page.locator('#first .protyle-content').evaluate(el => el.scrollHeight - el.clientHeight))) < 2);
        await page.evaluate(() => document.querySelector('#second').remove());
        await page.waitForFunction(() => plugin.maps.size === 1);
        await page.evaluate(() => document.querySelector('#first .protyle-content').classList.add('fn__none'));
        await rail.waitFor({ state: 'hidden' });
        await page.evaluate(() => document.querySelector('#first .protyle-content').classList.remove('fn__none'));
        await rail.waitFor({ state: 'visible' });
        const beforeEdit = await preview.evaluate(canvas => canvas.toDataURL());
        await page.evaluate(() => document.querySelector('#original-only').textContent = '编辑后');
        await page.waitForFunction(before => {
            const map = [...plugin.maps.values()][0];
            return !map.dirty && map.preview.toDataURL() !== before;
        }, beforeEdit);
        await page.evaluate(() => document.querySelector('#first').style.width = '480px');
        await page.waitForFunction(() => {
            const map = [...plugin.maps.values()][0];
            return !map.dirty && map.geometry.width === document.querySelector('.protyle-content').clientWidth;
        });
        await page.evaluate(() => {
            const body = document.querySelector('.protyle-wysiwyg');
            body.innerHTML = Array.from({ length: 16 }, (_, i) => `<div data-node-id="mid-${i}">中等长度文档 ${i}</div>`).join('');
        });
        await page.waitForFunction(() => ![...plugin.maps.values()][0].dirty);
        const naturalScale = await page.evaluate(() => {
            const map = [...plugin.maps.values()][0];
            return { x: parseFloat(map.preview.style.width) / map.content.clientWidth, y: parseFloat(map.preview.style.height) / map.content.scrollHeight };
        });
        assert.ok(Math.abs(naturalScale.x - naturalScale.y) < 0.00001, 'medium document preserves aspect ratio');
        const mediumBox = await rail.boundingBox();
        await page.mouse.click(mediumBox.x + 40, mediumBox.y + mediumBox.height - 5);
        assert.ok(await page.locator('#first .protyle-content').evaluate(el => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 2), 'blank track below short preview jumps to bottom');
        await page.evaluate(() => document.querySelector('.protyle-wysiwyg').innerHTML = '<div data-node-id="short">Short</div>');
        await rail.waitFor({ state: 'hidden' });
        await page.evaluate(() => plugin.onunload());
        assert.equal(await page.locator('.sy-minimap').count(), 0);
        assert.equal(await page.locator('.sy-minimap-host').count(), 0);
        assert.equal(await page.evaluate(() => handlers.size), 0);
        assert.equal(await page.locator('.protyle-content').evaluate(el => getComputedStyle(el).scrollbarWidth), 'auto');
        assert.deepEqual(errors, []);
        console.log('PASS: click, wheel, drag, keyboard, split panes, mount/remove, canvas pixels/colors, edit/resize refresh, short document, unload');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
