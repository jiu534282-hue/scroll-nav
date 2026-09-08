// ================================================================
//  Scroll Nav —— SillyTavern（酒馆）竖条浮动导航插件
// ----------------------------------------------------------------
//  一条竖状浮动按钮，从上到下三个可按区域：
//    顶部区  ⇈  回到聊天最上面（第一条消息）
//    中部区  ↑  跳到上一条消息
//    底部区  ⇊  回到聊天最下面（最新消息）
//  整条按钮可按住拖动到任意位置，位置会自动记忆（localStorage）。
//
//  安装：
//    1) 把整个 scroll-nav 文件夹复制到 SillyTavern 安装目录下
//       public/scripts/extensions/ 里（与其他扩展文件夹并列）
//    2) 完全刷新酒馆页面（F5）
//    3) 若"扩展"列表里显示为未启用，点一下启用即可
//
//  兼容性：纯 DOM 实现，不依赖酒馆内部 API，任意版本可用。
// ================================================================
(function () {
    'use strict';

    var LS_KEY = 'scnav-pos';
    var bar = null;
    var dragState = null;

    // ---------------- 图标（内联 SVG） ----------------
    var ICONS = {
        top: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 19.5 11 18 12.5 12 6.5 6 12.5 4.5 11 12 3.5z"/><path d="M12 11 19.5 18.5 18 20 12 14 6 20 4.5 18.5 12 11z"/></svg>',
        prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6.5 19.5 14 18 15.5 12 9.5 6 15.5 4.5 14 12 6.5z"/></svg>',
        bottom: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5 4.5 13 6 11.5 12 17.5 18 11.5 19.5 13 12 20.5z"/><path d="M12 13 4.5 5.5 6 4 12 10 18 4 19.5 5.5 12 13z"/></svg>'
    };

    // ---------------- 样式 ----------------
    var CSS = [
        '#scnav-bar{position:fixed;right:14px;top:50%;z-index:2147483000;width:40px;transform:translateY(-50%);display:flex;flex-direction:column;background:rgba(22,24,34,.85);border:1px solid rgba(255,255,255,.13);border-radius:22px;box-shadow:0 6px 24px rgba(0,0,0,.38);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);overflow:hidden;user-select:none;-webkit-user-select:none;touch-action:none;}',
        '#scnav-bar .scnav-zone{height:46px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:rgba(235,238,255,.88);transition:background-color .15s ease,color .15s ease;}',
        '#scnav-bar .scnav-zone+.scnav-zone{border-top:1px solid rgba(255,255,255,.08);}',
        '#scnav-bar .scnav-zone:hover{background:rgba(96,120,255,.30);color:#fff;}',
        '#scnav-bar .scnav-zone:active{background:rgba(96,120,255,.45);}',
        '#scnav-bar .scnav-zone svg{width:18px;height:18px;fill:currentColor;display:block;}',
        '#scnav-bar.scnav-dragging{cursor:grabbing;opacity:.92;}'
    ].join('\n');

    // ---------------- 工具 ----------------
    function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

    function getAllMessages() {
        var chat = document.getElementById('chat');
        if (!chat) return [];
        return Array.prototype.slice.call(chat.querySelectorAll('.mes'));
    }

    function scrollMes(el, block) {
        if (!el || typeof el.scrollIntoView !== 'function') return;
        try {
            el.scrollIntoView({ behavior: 'smooth', block: block, inline: 'nearest' });
        } catch (e) {
            el.scrollIntoView();
        }
    }

    // ---------------- 三个动作 ----------------
    // 回到最上面
    function gotoTop() {
        var mes = getAllMessages();
        scrollMes(mes[0], 'start');
    }

    // 回到最下面
    function gotoBottom() {
        var mes = getAllMessages();
        scrollMes(mes[mes.length - 1], 'end');
    }

    // 上一条消息：找到当前视口顶部可见的那条，再跳到它前面一条
    function gotoPrev() {
        var mes = getAllMessages();
        if (!mes.length) return;
        var chat = document.getElementById('chat');
        if (!chat) return;
        var chatTop = chat.getBoundingClientRect().top;
        var cur = 0;
        for (var i = 0; i < mes.length; i++) {
            if (mes[i].getBoundingClientRect().top - chatTop <= 30) {
                cur = i;
            } else {
                break;
            }
        }
        scrollMes(mes[Math.max(0, cur - 1)], 'start');
    }

    // ---------------- 位置记忆 ----------------
    function savePosition() {
        try {
            var r = bar.getBoundingClientRect();
            localStorage.setItem(LS_KEY, JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top) }));
        } catch (e) { /* 存储失败（如隐私模式）时忽略 */ }
    }

    function restorePosition() {
        try {
            var saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
            if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
                bar.style.right = 'auto';
                bar.style.transform = 'none';
                bar.style.left = saved.left + 'px';
                bar.style.top = saved.top + 'px';
                // 窗口变化后防止跑出屏幕
                var r = bar.getBoundingClientRect();
                if (r.right > window.innerWidth) bar.style.left = Math.max(0, window.innerWidth - r.width - 8) + 'px';
                if (r.bottom > window.innerHeight) bar.style.top = Math.max(0, window.innerHeight - r.height - 8) + 'px';
                if (r.left < 0) bar.style.left = '8px';
                if (r.top < 0) bar.style.top = '8px';
            }
        } catch (e) { /* 损坏数据忽略 */ }
    }

    // ---------------- 交互（点击三区 / 整条拖动） ----------------
    function handleZone(zone) {
        if (!zone) return;
        if (zone.classList.contains('scnav-top')) gotoTop();
        else if (zone.classList.contains('scnav-prev')) gotoPrev();
        else if (zone.classList.contains('scnav-bottom')) gotoBottom();
    }

    function attachEvents() {
        bar.addEventListener('pointerdown', function (e) {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            dragState = {
                sx: e.clientX,
                sy: e.clientY,
                startLeft: bar.getBoundingClientRect().left,
                startTop: bar.getBoundingClientRect().top,
                moved: false
            };
            bar.classList.add('scnav-dragging');
            try { bar.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
            if (e.cancelable) e.preventDefault();
        });

        bar.addEventListener('pointermove', function (e) {
            if (!dragState) return;
            var dx = e.clientX - dragState.sx;
            var dy = e.clientY - dragState.sy;
            if (!dragState.moved && Math.sqrt(dx * dx + dy * dy) > 6) {
                dragState.moved = true;
                bar.style.right = 'auto';
                bar.style.transform = 'none';
            }
            if (dragState.moved) {
                var r = bar.getBoundingClientRect();
                var x = clamp(dragState.startLeft + dx, 0, window.innerWidth - r.width);
                var y = clamp(dragState.startTop + dy, 0, window.innerHeight - r.height);
                bar.style.left = Math.round(x) + 'px';
                bar.style.top = Math.round(y) + 'px';
            }
        });

        function endDrag(e) {
            if (!dragState) return;
            var moved = dragState.moved;
            dragState = null;
            bar.classList.remove('scnav-dragging');
            try { bar.releasePointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
            if (moved) {
                savePosition();
            } else {
                var hit = document.elementFromPoint(e.clientX, e.clientY);
                if (hit && bar.contains(hit)) {
                    handleZone(hit.closest('.scnav-zone'));
                }
            }
        }

        bar.addEventListener('pointerup', endDrag);
        bar.addEventListener('pointercancel', function () {
            dragState = null;
            bar.classList.remove('scnav-dragging');
        });
    }

    // ---------------- 聊天区隐藏时同步隐藏按钮 ----------------
    function syncVisibility() {
        var chat = document.getElementById('chat');
        var visible = false;
        if (chat) {
            try { visible = chat.offsetParent !== null; } catch (e) { visible = true; }
        }
        if (bar) bar.style.display = visible ? '' : 'none';
    }

    // ---------------- 初始化 ----------------
    function boot() {
        if (document.getElementById('scnav-bar')) return;

        var styleEl = document.createElement('style');
        styleEl.id = 'scnav-style';
        styleEl.textContent = CSS;
        document.head.appendChild(styleEl);

        bar = document.createElement('div');
        bar.id = 'scnav-bar';
        bar.innerHTML =
            '<div class="scnav-zone scnav-top" title="回到最上面">' + ICONS.top + '</div>' +
            '<div class="scnav-zone scnav-prev" title="上一条消息">' + ICONS.prev + '</div>' +
            '<div class="scnav-zone scnav-bottom" title="回到最下面">' + ICONS.bottom + '</div>';
        document.body.appendChild(bar);

        attachEvents();
        restorePosition();
        syncVisibility();

        if (typeof MutationObserver === 'function') {
            new MutationObserver(syncVisibility).observe(document.body, { childList: true, subtree: true });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
