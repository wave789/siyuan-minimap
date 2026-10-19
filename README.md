# 思源文档 Minimap

在编辑器右侧显示 80px 宽的正文缩略图，方便使用鼠标导航。

作者：[wave789](https://github.com/wave789) · [源码仓库](https://github.com/wave789/siyuan-minimap) · Apache-2.0

- 左键点击缩略图，把对应内容移动到视口附近。
- 按住视口框拖动，连续调整文档位置。
- 鼠标放在缩略图上使用滚轮，滚动对应编辑器；支持触控板。
- 高亮框显示当前视口，Canvas 概览显示文字轮廓、标题大小和颜色、段落位置；图片显示真实缩略图，表格显示简化轮廓。
- 支持多标签页、分屏，编辑、折叠、图片加载和窗口大小变化后更新。
- 通过 Tab 聚焦后，可使用方向键、PageUp / PageDown、Home / End。
- 内容不足一屏时自动隐藏；停用插件后恢复原滚动条。

## 本地安装

1. 执行 `npm run build`（构建不依赖第三方 npm 包）。
2. 在思源中打开「设置 → 关于 → 数据仓库」找到数据仓库目录。
3. 新建 `<数据仓库>/data/plugins/siyuan-minimap/`，将 `dist/` 内的全部文件复制进去。
4. 重启思源，在插件设置中启用「文档缩略图」。

`npm run package` 会生成集市要求的 `package.zip`，并保留同内容的 `siyuan-minimap.zip`，需要 Python 3。安装包根目录直接包含插件文件、`LICENSE` 和 `NOTICE`。
更新前先停用插件，覆盖上述文件后重新启用。

## GitHub 发布

源码提交到仓库的 `main` 分支；`node_modules/`、`dist/` 和 ZIP 安装包已由 `.gitignore` 排除。
执行 `npm run package` 后，在 GitHub 创建与 `plugin.json` 版本一致的正式 Release，将 `package.zip` 作为附件上传。
首次上架集市时，向 `siyuan-note/bazaar` 的 `plugins.txt` 添加 `wave789/siyuan-minimap` 并提交 PR。

## 许可证

本项目使用 [Apache License 2.0](LICENSE)。版权和项目来源见 [NOTICE](NOTICE)。再分发时请遵守许可证中保留相关声明、标记修改及随附许可证的要求。

## 范围和限制

这是桌面端和桌面浏览器的本地开发版，声明的最低版本为 3.0.0，尚未完成真实思源各版本兼容性验证。
0.3.1 使用固定尺寸 Canvas 和块数据缓存，不再复制整篇正文 DOM、每个节点的大量 CSS 或克隆图片元素。设计参考 [VS Code 的缓存与局部绘制](https://github.com/microsoft/vscode/blob/main/src/vs/editor/browser/viewParts/minimap/minimap.ts)及[文字像素绘制](https://github.com/microsoft/vscode/blob/main/src/vs/editor/browser/viewParts/minimap/minimapCharRenderer.ts)，并非完整移植 Monaco。
短文档按比例缩小；长文档按位图像素行采样，所有已加载块的位置仍参与映射。清晰度以导航为目标，行宽和换行是近似值，内联字体、代码语法配色、复杂表格和自定义组件不会逐像素还原。超大单块最多读取 16384 个字符，避免单个代码块占满渲染时间。
图片直接复用正文已加载的原图，按实际位置生成小尺寸缩略图并缓存，不额外下载原图。支持同一块中的多张图片、常见图片裁切和对齐；图片延迟加载或被替换时局部更新。滚动时不重新缩放或绘制图片；动图在概览中保留生成时的静态画面。尚未加载或加载失败的图片显示透明轮廓占位。
打开文档后下一帧开始绘制，首份概览分批显示进度（每帧工作预算约 5ms）。完整位图生成后持续缓存：文档不变时，滚动只更新视口框，不重新绘制正文；停止滚动也不会额外刷新。
正文修改合并等待约 80ms；块位置和高度不变时只重绘对应位图区域，其他块的文字和样式继续复用。增删块、折叠、改变宽度或主题时按需更新；连续滚动期间的新增内容等停止约 100ms 后再补入。更新期间保留已有完整位图。
编辑器辅助控件、光标选中状态和内部索引变化不会触发绘制。切换回同一个已挂载的编辑器会复用位图；关闭再打开文档会重新建立缓存。静止且内容未变化时没有轮询或定时渲染任务。
思源会对超长文档分段加载；当前版本映射的是**当前编辑器已加载内容**，无法直接点击尚未加载的任意段落。
滚动触发思源加载更多内容后，缩略图会更新。聚焦块时映射的是聚焦范围。
预览模式使用思源原有滚动方式。依赖 `.protyle-content` 等编辑器 DOM，第三方主题可能需要适配。
插件不修改笔记内容，不主动请求笔记内容或下载图片；概览只读取编辑器中已经加载的内容。

## 开发和验证

- `npm test`：坐标映射、边界和滚轮单位测试。
- `npm install`，然后 `npm run test:browser`：使用 Playwright 验证模拟编辑器中的点击、滚轮、拖动、分屏、动态挂载与清理。默认寻找本机 Chromium / Chrome，也可指定 `CHROMIUM_PATH`。
- `npm run test:performance`：在 3000 段富文本的模拟长文档中验证首次显示、未修改时零位图绘制、标签页和布局通知复用缓存、单块局部更新、局部与完整绘制像素一致、静止无轮询，以及修改和卸载取消任务。时间和样式读取次数作为诊断输出。
- `npm run test:images`：验证真实图片颜色和位置、多图、裁切、固定尺寸图片延迟加载、图片替换和失败处理、缩略图缓存、滚动零图片绘制，以及紧邻图片的局部更新。
- `MINIMAP_DPR=2 npm run test:performance`：验证高像素密度；浏览器功能测试也支持该环境变量。
- `src/index.js`：插件生命周期和编辑器发现。
- `src/minimap.js`：绘制、交互和观察器清理。
- `src/preview.js`：Canvas 绘制、像素采样、块缓存和局部更新。
- `src/geometry.js`：滚动位置映射。
- `src/index.css`：主题样式。

集市图标和预览图可按需补充；发布前仍应完成目标思源版本的兼容性验证。
API 和 DOM 参考：[官方插件示例](https://github.com/siyuan-note/plugin-sample)、[编辑器初始化源码](https://github.com/siyuan-note/siyuan/blob/master/app/src/protyle/ui/initUI.ts)。
