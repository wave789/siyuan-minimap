// Copyright 2026 wave789
// SPDX-License-Identifier: Apache-2.0
"use strict";
const { Plugin } = require("siyuan");
const { Minimap } = require("./minimap");
const EVENTS = ["loaded-protyle-static", "loaded-protyle-dynamic", "switch-protyle", "destroy-protyle"];
const EDITOR_CONTAINERS = ".protyle, .protyle-content, .protyle-preview, .layout-tab-container";

function editorClasses(value) {
    return (value || "").split(/\s+/).filter(name => name && name !== "sy-minimap-host").sort().join(" ");
}

module.exports = class MinimapPlugin extends Plugin {
    onload() {
        this.maps = new Map();
        this.pending = 0;
        this.stopped = false;
        this.refresh = () => {
            if (this.pending || this.stopped) return;
            this.pending = requestAnimationFrame(() => {
                this.pending = 0;
                this.scan();
            });
        };
        for (const event of EVENTS) this.eventBus.on(event, this.refresh);
    }
    onLayoutReady() {
        // Observe editor mounting/removal, including split panes and fullscreen moves.
        this.observer = new MutationObserver(records => {
            let relevant = false;
            const redraw = new Set();
            for (const record of records) {
                const target = record.target;
                if (target.closest?.(".sy-minimap")) continue;
                if (record.type === "attributes") {
                    if (!target.matches?.(EDITOR_CONTAINERS)) continue;
                    // Showing the minimap changes this class itself. It must not
                    // trigger a scan or invalidate every editor's preview.
                    if (editorClasses(record.oldValue) === editorClasses(target.getAttribute("class"))) continue;
                    relevant = true;
                    for (const [root, map] of this.maps) {
                        if (root.contains(target) || target.contains(root)) redraw.add(map);
                    }
                } else if ([...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && !node.matches(".sy-minimap") && (node.matches(".protyle, .protyle-content") || node.querySelector(".protyle, .protyle-content")))) {
                    relevant = true;
                }
            }
            for (const map of redraw) map.schedule(false, true);
            if (relevant) this.refresh();
        });
        this.observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"], attributeOldValue: true });
        this.scan();
    }
    scan() {
        if (this.stopped) return;
        for (const [root, map] of this.maps) {
            if (!root.isConnected || !root.contains(map.content)) {
                map.destroy();
                this.maps.delete(root);
            }
        }
        for (const root of document.querySelectorAll(".protyle")) {
            // Skip embedded editors and popover/backlink previews.
            if (root.parentElement?.closest(".protyle, .block__popover, .sy__backlink")) continue;
            const content = root.querySelector(":scope > .protyle-content");
            if (!content || !content.querySelector(".protyle-wysiwyg")) continue;
            if (!this.maps.has(root)) this.maps.set(root, new Minimap(root, content));
            else this.maps.get(root).schedule(false, true);
        }
    }
    onunload() {
        this.stopped = true;
        cancelAnimationFrame(this.pending);
        this.observer?.disconnect();
        for (const event of EVENTS) this.eventBus.off(event, this.refresh);
        for (const map of this.maps.values()) map.destroy();
        this.maps.clear();
    }
};
