// ==UserScript==
// @name         Hard English Sub Hider (solid blur block + size buttons)
// @namespace    http://tampermonkey.net/
// @version      8.2
// @description  Covers burned-in English subs without touching the JP subtitle layer
// @match        http://192.168.0.200:4568/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'hardEnglishSubHider_v82';

    const defaults = {
        enabled: true,
        relX: 0.12,
        relY: 0.74,
        relW: 0.76,
        barH: 72,
        opacity: 0.97,
        blur: 18,
        uiHideSeconds: 8,
        useBlur: true
    };

    let settings = loadSettings();
    let uiVisible = false;
    let dragging = false;
    let dragDX = 0;
    let dragDY = 0;
    let uiHideTimer = null;
    let started = false;
    let tick = null;

    function loadSettings() {
        try {
            return { ...defaults, ...(JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}) };
        } catch {
            return { ...defaults };
        }
    }

    function saveSettings() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }

    function clamp(n, min, max) {
        return Math.max(min, Math.min(max, n));
    }

    function getVideo() {
        return document.querySelector('video.MuiBox-root.muiltr-1l3eo0q') || document.querySelector('video');
    }

    function getPlayerWrap() {
        const video = getVideo();
        return video ? video.parentElement : null;
    }

    function getOverlayLayer() {
        const wrap = getPlayerWrap();
        if (!wrap) return null;

        let overlay = wrap.querySelector('.MuiBox-root.muiltr-oj8v3y');

        if (!overlay) {
            const video = getVideo();
            if (video && video.nextElementSibling && video.nextElementSibling.tagName === 'DIV') {
                overlay = video.nextElementSibling;
            }
        }

        return overlay;
    }

    function ensureRelative(el) {
        if (el && getComputedStyle(el).position === 'static') {
            el.style.position = 'relative';
        }
    }

    const style = document.createElement('style');
    style.textContent = `
        #tm-hardsub-mask {
            position: absolute;
            display: none;
            pointer-events: none !important;
            box-sizing: border-box;
            border-radius: 10px;
            overflow: hidden;
        }

        #tm-hardsub-hitbox {
            position: absolute;
            display: none;
            pointer-events: auto;
            box-sizing: border-box;
            background: transparent;
            border-radius: 10px;
            z-index: 2;
        }

        #tm-hardsub-panel,
        #tm-hardsub-handle,
        #tm-hardsub-sizebox {
            position: fixed;
            z-index: 2147483646;
            opacity: 0;
            pointer-events: none;
            transition: opacity .2s ease;
            touch-action: none;
            -webkit-user-select: none;
            user-select: none;
        }

        #tm-hardsub-panel.visible,
        #tm-hardsub-handle.visible,
        #tm-hardsub-sizebox.visible {
            opacity: 1;
            pointer-events: auto;
        }

        #tm-hardsub-panel {
            top: 12px;
            right: 12px;
            background: rgba(20,20,20,.94);
            color: white;
            padding: 10px;
            border-radius: 12px;
            min-width: 190px;
            font: 13px system-ui, sans-serif;
            box-shadow: 0 6px 20px rgba(0,0,0,.35);
        }

        #tm-hardsub-panel button,
        #tm-hardsub-panel input {
            width: 100%;
            box-sizing: border-box;
        }

        #tm-hardsub-panel button {
            border: none;
            border-radius: 8px;
            padding: 7px 10px;
            color: white;
            background: #2d7ef7;
            margin-bottom: 8px;
        }

        #tm-hardsub-handle {
            width: 38px;
            height: 38px;
            line-height: 38px;
            text-align: center;
            border-radius: 999px;
            background: rgba(20,20,20,.92);
            color: white;
            font-size: 18px;
            box-shadow: 0 4px 14px rgba(0,0,0,.35);
        }

        #tm-hardsub-sizebox {
            display: grid;
            grid-template-columns: 32px 32px;
            gap: 6px;
            background: rgba(20,20,20,.92);
            padding: 6px;
            border-radius: 10px;
            box-shadow: 0 4px 14px rgba(0,0,0,.35);
        }

        #tm-hardsub-sizebox button {
            width: 32px;
            height: 32px;
            border: none;
            border-radius: 8px;
            background: #2d7ef7;
            color: white;
            font-size: 12px;
            padding: 0;
        }
    `;
    document.head.appendChild(style);

    const mask = document.createElement('div');
    mask.id = 'tm-hardsub-mask';

    const hitbox = document.createElement('div');
    hitbox.id = 'tm-hardsub-hitbox';
    hitbox.title = 'Open subtitle hider controls';

    const panel = document.createElement('div');
    panel.id = 'tm-hardsub-panel';
    panel.innerHTML = `
        <strong style="display:block;margin-bottom:8px;">English Sub Hider</strong>
        <button id="tm-toggle">ON</button>

        <label style="display:block;margin:6px 0 2px;">Darkness</label>
        <input id="tm-opacity" type="range" min="0.60" max="1" step="0.05">

        <label style="display:block;margin:6px 0 2px;">Blur</label>
        <input id="tm-blur" type="range" min="0" max="40" step="1">

        <label style="display:block;margin:6px 0 2px;">Height</label>
        <input id="tm-height" type="range" min="20" max="180" step="1">

        <label style="display:block;margin:6px 0 2px;">Width</label>
        <input id="tm-width" type="range" min="0.20" max="1" step="0.01">

        <label style="display:block;margin:6px 0 2px;">UI hide seconds</label>
        <input id="tm-hide" type="range" min="3" max="30" step="1">

        <label style="display:flex;gap:8px;align-items:center;margin-top:8px;">
            <input id="tm-useBlur" type="checkbox" style="width:auto;">
            <span>Use blur block</span>
        </label>

        <div style="margin-top:8px;font-size:12px;opacity:.9;line-height:1.35;">
            Tap the blur bar to show controls.<br>
            Drag ⬍ to move blocker.
        </div>
    `;

    const handle = document.createElement('div');
    handle.id = 'tm-hardsub-handle';
    handle.textContent = '⬍';

    const sizeBox = document.createElement('div');
    sizeBox.id = 'tm-hardsub-sizebox';
    sizeBox.innerHTML = `
        <button id="tm-w-minus">W-</button>
        <button id="tm-w-plus">W+</button>
        <button id="tm-h-minus">H-</button>
        <button id="tm-h-plus">H+</button>
    `;

    document.body.appendChild(panel);
    document.body.appendChild(handle);
    document.body.appendChild(sizeBox);

    const toggleBtn = panel.querySelector('#tm-toggle');
    const opacityInput = panel.querySelector('#tm-opacity');
    const blurInput = panel.querySelector('#tm-blur');
    const heightInput = panel.querySelector('#tm-height');
    const widthInput = panel.querySelector('#tm-width');
    const hideInput = panel.querySelector('#tm-hide');
    const useBlurInput = panel.querySelector('#tm-useBlur');

    const wMinus = sizeBox.querySelector('#tm-w-minus');
    const wPlus = sizeBox.querySelector('#tm-w-plus');
    const hMinus = sizeBox.querySelector('#tm-h-minus');
    const hPlus = sizeBox.querySelector('#tm-h-plus');

    function syncInputs() {
        opacityInput.value = settings.opacity;
        blurInput.value = settings.blur;
        heightInput.value = settings.barH;
        widthInput.value = settings.relW;
        hideInput.value = settings.uiHideSeconds;
        useBlurInput.checked = !!settings.useBlur;
    }

    function updateToggle() {
        toggleBtn.textContent = settings.enabled ? 'ON' : 'OFF';
        toggleBtn.style.background = settings.enabled ? '#2d7ef7' : '#555';
    }

    function applyMaskStyle() {
        mask.style.background = `rgba(0,0,0,${settings.opacity})`;

        if (settings.useBlur && settings.blur > 0) {
            mask.style.backdropFilter = `blur(${settings.blur}px)`;
            mask.style.webkitBackdropFilter = `blur(${settings.blur}px)`;
        } else {
            mask.style.backdropFilter = 'none';
            mask.style.webkitBackdropFilter = 'none';
        }

        mask.style.height = `${settings.barH}px`;
        mask.style.zIndex = '1';
        mask.style.border = 'none';
    }

    function attachMask() {
        const overlay = getOverlayLayer();
        if (!overlay) return false;

        ensureRelative(overlay);

        if (mask.parentElement !== overlay) overlay.appendChild(mask);
        if (hitbox.parentElement !== overlay) overlay.appendChild(hitbox);

        return true;
    }

    function layoutMask() {
        const video = getVideo();
        const overlay = getOverlayLayer();

        if (!video || !overlay || !settings.enabled) {
            mask.style.display = 'none';
            hitbox.style.display = 'none';
            hideHandle();
            hideSizeBox();
            return;
        }

        attachMask();

        const vr = video.getBoundingClientRect();
        const or = overlay.getBoundingClientRect();

        if (vr.width < 50 || vr.height < 50) {
            mask.style.display = 'none';
            hitbox.style.display = 'none';
            hideHandle();
            hideSizeBox();
            return;
        }

        const width = vr.width * settings.relW;
        const leftViewport = clamp(
            vr.left + vr.width * settings.relX,
            vr.left,
            vr.right - width
        );
        const topViewport = clamp(
            vr.top + vr.height * settings.relY,
            vr.top,
            vr.bottom - settings.barH
        );

        const left = leftViewport - or.left;
        const top = topViewport - or.top;

        mask.style.display = 'block';
        mask.style.left = `${left}px`;
        mask.style.top = `${top}px`;
        mask.style.width = `${width}px`;

        hitbox.style.display = 'block';
        hitbox.style.left = `${left}px`;
        hitbox.style.top = `${top}px`;
        hitbox.style.width = `${width}px`;
        hitbox.style.height = `${settings.barH}px`;

        updateFloatingControls();
    }

    function updateFloatingControls() {
        if (!uiVisible || !settings.enabled || mask.style.display === 'none') {
            hideHandle();
            hideSizeBox();
            return;
        }

        const r = mask.getBoundingClientRect();

        handle.style.left = `${r.right - 19}px`;
        handle.style.top = `${r.top - 19}px`;

        sizeBox.style.left = `${Math.max(8, r.left)}px`;
        sizeBox.style.top = `${Math.max(8, r.top - 52)}px`;

        showHandle();
        showSizeBox();
    }

    function showUI() {
        uiVisible = true;
        panel.classList.add('visible');
        updateFloatingControls();
        resetHideTimer();
    }

    function hideUI() {
        uiVisible = false;
        panel.classList.remove('visible');
        hideHandle();
        hideSizeBox();
        clearHideTimer();
    }

    function showHandle() {
        handle.classList.add('visible');
    }

    function hideHandle() {
        handle.classList.remove('visible');
    }

    function showSizeBox() {
        sizeBox.classList.add('visible');
    }

    function hideSizeBox() {
        sizeBox.classList.remove('visible');
    }

    function clearHideTimer() {
        if (uiHideTimer) clearTimeout(uiHideTimer);
        uiHideTimer = null;
    }

    function resetHideTimer() {
        clearHideTimer();
        uiHideTimer = setTimeout(() => {
            if (!dragging) hideUI();
        }, settings.uiHideSeconds * 1000);
    }

    function pointFromEvent(e) {
        if (e.touches && e.touches[0]) {
            return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
        if (e.changedTouches && e.changedTouches[0]) {
            return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
        }
        return { x: e.clientX, y: e.clientY };
    }

    function startDrag(e) {
        dragging = true;
        const p = pointFromEvent(e);
        const r = mask.getBoundingClientRect();
        dragDX = p.x - r.left;
        dragDY = p.y - r.top;
        showUI();
        e.preventDefault();
        e.stopPropagation();
    }

    function moveDrag(e) {
        if (!dragging) return;

        const video = getVideo();
        if (!video) return;

        const p = pointFromEvent(e);
        const vr = video.getBoundingClientRect();
        const width = vr.width * settings.relW;

        const left = clamp(p.x - dragDX, vr.left, vr.right - width);
        const top = clamp(p.y - dragDY, vr.top, vr.bottom - settings.barH);

        settings.relX = (left - vr.left) / vr.width;
        settings.relY = (top - vr.top) / vr.height;

        saveSettings();
        layoutMask();

        e.preventDefault();
        e.stopPropagation();
    }

    function endDrag() {
        if (!dragging) return;
        dragging = false;
        resetHideTimer();
    }

    function adjustWidth(delta) {
        settings.relW = clamp(settings.relW + delta, 0.20, 1.0);
        widthInput.value = settings.relW;
        saveSettings();
        layoutMask();
        showUI();
    }

    function adjustHeight(delta) {
        settings.barH = clamp(settings.barH + delta, 20, 180);
        heightInput.value = settings.barH;
        saveSettings();
        applyMaskStyle();
        layoutMask();
        showUI();
    }

    toggleBtn.addEventListener('click', (e) => {
        settings.enabled = !settings.enabled;
        saveSettings();
        updateToggle();
        layoutMask();
        showUI();
        e.stopPropagation();
    });

    opacityInput.addEventListener('input', () => {
        settings.opacity = Number(opacityInput.value);
        saveSettings();
        applyMaskStyle();
        showUI();
    });

    blurInput.addEventListener('input', () => {
        settings.blur = Number(blurInput.value);
        saveSettings();
        applyMaskStyle();
        showUI();
    });

    heightInput.addEventListener('input', () => {
        settings.barH = Number(heightInput.value);
        saveSettings();
        applyMaskStyle();
        layoutMask();
        showUI();
    });

    widthInput.addEventListener('input', () => {
        settings.relW = Number(widthInput.value);
        saveSettings();
        layoutMask();
        showUI();
    });

    hideInput.addEventListener('input', () => {
        settings.uiHideSeconds = Number(hideInput.value);
        saveSettings();
        resetHideTimer();
        showUI();
    });

    useBlurInput.addEventListener('change', () => {
        settings.useBlur = useBlurInput.checked;
        saveSettings();
        applyMaskStyle();
        showUI();
    });

    wMinus.addEventListener('click', (e) => {
        adjustWidth(-0.03);
        e.stopPropagation();
    });
    wPlus.addEventListener('click', (e) => {
        adjustWidth(0.03);
        e.stopPropagation();
    });
    hMinus.addEventListener('click', (e) => {
        adjustHeight(-6);
        e.stopPropagation();
    });
    hPlus.addEventListener('click', (e) => {
        adjustHeight(6);
        e.stopPropagation();
    });

    hitbox.addEventListener('click', (e) => {
        showUI();
        e.stopPropagation();
    }, true);

    hitbox.addEventListener('touchstart', (e) => {
        showUI();
        e.stopPropagation();
    }, { passive: true });

    handle.addEventListener('mousedown', startDrag);
    handle.addEventListener('touchstart', startDrag, { passive: false });
    window.addEventListener('mousemove', moveDrag, { passive: false });
    window.addEventListener('touchmove', moveDrag, { passive: false });
    window.addEventListener('mouseup', endDrag);
    window.addEventListener('touchend', endDrag);

    window.addEventListener('resize', layoutMask);
    window.addEventListener('orientationchange', layoutMask);
    window.addEventListener('scroll', layoutMask, true);

    window.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'b') {
            settings.enabled = !settings.enabled;
            saveSettings();
            updateToggle();
            layoutMask();
            showUI();
        } else if (e.key === '[') {
            adjustWidth(-0.03);
        } else if (e.key === ']') {
            adjustWidth(0.03);
        } else if (e.key === '-') {
            adjustHeight(-6);
        } else if (e.key === '=') {
            adjustHeight(6);
        }
    });

    function init() {
        if (started) return;
        const video = getVideo();
        const overlay = getOverlayLayer();
        if (!video || !overlay) return;

        started = true;
        attachMask();
        syncInputs();
        applyMaskStyle();
        updateToggle();
        layoutMask();
        hideUI();

        video.addEventListener('loadedmetadata', layoutMask);
        video.addEventListener('play', layoutMask);
        video.addEventListener('pause', layoutMask);

        tick = setInterval(layoutMask, 700);
    }

    const boot = setInterval(() => {
        if (getVideo() && getOverlayLayer()) {
            clearInterval(boot);
            init();
        }
    }, 400);
})();