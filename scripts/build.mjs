// Copyright 2026 wave789
// SPDX-License-Identifier: Apache-2.0
import { mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
// Bundle the local CommonJS modules; only SiYuan remains external.
// The host evaluates index.js and does not resolve relative plugin imports.
const factories = [];
for (const name of ['geometry', 'preview', 'minimap', 'index']) {
    factories.push(`${JSON.stringify('./' + name)}: function(require, module, exports) {\n${await readFile(`src/${name}.js`, 'utf8')}\n}`);
}
const bundle = `// Copyright 2026 wave789\n// SPDX-License-Identifier: Apache-2.0\n"use strict";\n(function(hostRequire) {\nconst factories = {${factories.join(',\n')}};\nconst cache = {};\nfunction localRequire(id) {\n  if (!Object.prototype.hasOwnProperty.call(factories, id)) return hostRequire(id);\n  if (!cache[id]) {\n    const item = { exports: {} };\n    cache[id] = item;\n    factories[id](localRequire, item, item.exports);\n  }\n  return cache[id].exports;\n}\nmodule.exports = localRequire('./index');\n})(require);\n`;
await mkdir('dist', { recursive: true });
for (const old of ['minimap.js', 'geometry.js']) await rm(`dist/${old}`, { force: true });
await writeFile('dist/index.js', bundle);
await copyFile('src/index.css', 'dist/index.css');
for (const file of ['plugin.json', 'README.md', 'LICENSE', 'NOTICE']) await copyFile(file, `dist/${file}`);
console.log('插件已构建到 dist/');
