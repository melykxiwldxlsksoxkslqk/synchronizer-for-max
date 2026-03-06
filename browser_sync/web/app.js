// ============================================
// BrowserSync v3 — Clear & Intuitive UI
// ============================================

let isSyncing = false;
let isPaused = false;
let syncTimer = null;
let syncSeconds = 0;
let refreshInterval = null;
let lastWindowCount = 0;
let backendLogInterval = null;
let lastUnsupportedWindowsSignature = '';

function notifyExtensionEnabled(enabled) {
    try {
        window.postMessage({ type: '__bs_sync_control__', enabled: !!enabled }, '*');
    } catch (_) { /* no-op */ }
}

function isLikelyUnsupportedTabTitle(title) {
    const t = String(title || '').toLowerCase();
    return (
        t.includes('расширения') ||
        t.includes('extensions') ||
        t.includes('новая вкладка') ||
        t.includes('new tab') ||
        t.includes('chrome web store') ||
        t.includes('магазин chrome')
    );
}

// ===== MEGA BUTTON =====

async function onMegaClick() {
    const btn = document.getElementById('megaBtn');

    if (!isSyncing) {
        btn.disabled = true;
        updateStep(2, 'active');
        addLog('🔍 Настраиваю синхронизацию...', 'info');

        try {
            const result = await eel.auto_start()();
            if (result.success) {
                isSyncing = true;
                isPaused = false;
                notifyExtensionEnabled(true);
                updateSyncUI();
                startTimer();
                updateStep(2, 'done');
                updateStep(3, 'active');
                addLog('✅ Готово! Работай в поддерживаемой веб-вкладке (не chrome://) — действия повторяются в других', 'success');
                showToast('Синхронизация запущена!', 'success');
                await refreshWindows();
            } else {
                addLog('⚠ ' + result.message, 'warning');
                showToast(result.message, 'warning');
                updateStep(2, '');
            }
        } catch (err) {
            addLog('❌ Ошибка: ' + err, 'error');
            showToast('Ошибка запуска', 'error');
            updateStep(2, '');
        }
        btn.disabled = false;

    } else {
        eel.stop_sync()();
        isSyncing = false;
        isPaused = false;
        notifyExtensionEnabled(false);
        stopTimer();
        updateSyncUI();
        resetSteps();
        addLog('🔴 Синхронизация остановлена', 'info');
        showToast('Остановлено', 'warning');
    }
}

// ===== PAUSE =====

function onPause() {
    if (!isSyncing) return;
    eel.pause_sync()();
    isPaused = !isPaused;

    if (isPaused) {
        stopTimer();
        addLog('⏸ Пауза — действия не синхронизируются', 'warning');
        showToast('Пауза', 'warning');
    } else {
        startTimer();
        addLog('▶ Продолжаем синхронизацию', 'success');
        showToast('Продолжаем!', 'success');
    }
    updateSyncUI();
}

// ===== STEPS GUIDE =====

function updateStep(num, state) {
    const el = document.getElementById('step' + num);
    if (!el) return;
    el.classList.remove('done', 'active-step');
    if (state === 'done') el.classList.add('done');
    if (state === 'active') el.classList.add('active-step');

    const status = document.getElementById('step' + num + 'status');
    if (status) {
        if (state === 'done') {
            status.innerHTML = '<span style="color:var(--green);font-size:16px">✓</span>';
        } else if (state === 'active') {
            status.innerHTML = '<div class="spinner-small"></div>';
        } else {
            status.innerHTML = '';
        }
    }
}

function resetSteps() {
    updateStep(1, '');
    updateStep(2, '');
    updateStep(3, '');
    document.getElementById('step1status').innerHTML = '<div class="spinner-small"></div>';
    document.getElementById('stepsGuide').classList.remove('hidden');
}

// ===== UI SYNC STATE =====

function updateSyncUI() {
    const btn = document.getElementById('megaBtn');
    const icon = document.getElementById('megaIcon');
    const text = document.getElementById('megaText');
    const hint = document.getElementById('megaHint');
    const pauseBtn = document.getElementById('pauseBtn');
    const badge = document.getElementById('statusBadge');
    const statusText = document.getElementById('statusText');
    const pauseIcon = document.getElementById('pauseIcon');
    const pauseText = document.getElementById('pauseText');
    const quickStats = document.getElementById('quickStats');
    const stepsGuide = document.getElementById('stepsGuide');

    if (isSyncing) {
        btn.classList.add('running');
        btn.classList.remove('no-windows');
        icon.textContent = '⏹';
        text.textContent = 'ОСТАНОВИТЬ';
        hint.textContent = 'или нажми F6';
        pauseBtn.style.display = 'inline-flex';
        quickStats.style.display = 'flex';
        stepsGuide.classList.add('hidden');

        if (isPaused) {
            badge.className = 'status-badge paused';
            statusText.textContent = 'Пауза';
            pauseBtn.classList.add('paused');
            pauseIcon.textContent = '▶';
            pauseText.textContent = 'Продолжить';
        } else {
            badge.className = 'status-badge active';
            statusText.textContent = 'Синхронизация активна';
            pauseBtn.classList.remove('paused');
            pauseIcon.textContent = '⏸';
            pauseText.textContent = 'Пауза';
        }
    } else {
        btn.classList.remove('running');
        icon.textContent = '▶';
        text.textContent = 'ЗАПУСТИТЬ';
        hint.textContent = 'или нажми F6';
        pauseBtn.style.display = 'none';
        quickStats.style.display = 'none';
        stepsGuide.classList.remove('hidden');
        badge.className = 'status-badge';
        statusText.textContent = 'Ожидание';
    }
}

// ===== WINDOWS REFRESH =====

async function refreshWindows() {
    try {
        const data = await eel.auto_scan()();
        const windows = data.windows;
        const masterHwnd = data.master_hwnd;

        document.getElementById('windowCount').textContent = windows.length;

        renderWindowsList(windows, masterHwnd);

        const unsupported = windows.filter((w) => isLikelyUnsupportedTabTitle(w.title));
        const unsupportedSignature = unsupported.map((w) => w.title).sort().join('|');
        if (unsupported.length > 0 && unsupportedSignature !== lastUnsupportedWindowsSignature) {
            const preview = unsupported.slice(0, 2).map((w) => `"${truncate(w.title, 32)}"`).join(', ');
            addLog(
                `⚠ Обнаружены служебные вкладки ${preview}. На chrome:// страницах extension не работает. Открой обычный сайт в каждом окне.`,
                'warning',
            );
            lastUnsupportedWindowsSignature = unsupportedSignature;
        } else if (unsupported.length === 0) {
            lastUnsupportedWindowsSignature = '';
        }

        // Update mega button & steps based on window count (state-sync mode does not block start)
        const btn = document.getElementById('megaBtn');
        if (windows.length < 1 && !isSyncing) {
            btn.classList.remove('no-windows');
            document.getElementById('megaText').textContent = 'ЗАПУСТИТЬ';
            document.getElementById('megaHint').textContent = 'state-sync работает даже без win32-скана';
            updateStep(1, '');
            document.getElementById('step1status').innerHTML = '<div class="spinner-small"></div>';
        } else if (!isSyncing) {
            btn.classList.remove('no-windows');
            document.getElementById('megaText').textContent = 'ЗАПУСТИТЬ';
            document.getElementById('megaHint').textContent = 'или нажми F6';
            updateStep(1, 'done');
        }

        // Log window count changes
        if (windows.length !== lastWindowCount) {
            if (windows.length > lastWindowCount && lastWindowCount > 0) {
                addLog(`🖥 Новое окно найдено (всего: ${windows.length})`, 'success');
            } else if (windows.length < lastWindowCount && lastWindowCount > 0) {
                addLog(`🖥 Окно закрыто (осталось: ${windows.length})`, 'warning');
            }
            lastWindowCount = windows.length;
        }
    } catch (e) {
        // Eel not ready
    }
}

function renderWindowsList(windows, masterHwnd) {
    const list = document.getElementById('windowsList');

    if (!windows || windows.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🌐</div>
                <p class="empty-title">Окна не найдены</p>
                <p class="empty-sub">Открой Chrome, Firefox, Edge или другой браузер</p>
            </div>`;
        return;
    }

    if (windows.length === 1 && !isSyncing) {
        const win = windows[0];
        const titleShort = truncate(win.title, 50);
        list.innerHTML = `
            <div class="window-row">
                <span class="badge">🖥</span>
                <div class="window-info">
                    <div class="window-title">${escapeHtml(titleShort)}</div>
                    <div class="window-meta">${win.width}×${win.height} · PID ${win.pid}</div>
                </div>
            </div>
            <div class="empty-state" style="padding:20px">
                <p class="empty-title">Нужно ещё одно окно</p>
                <p class="empty-sub">Открой второе окно браузера — оно появится здесь автоматически</p>
            </div>`;
        return;
    }

    list.innerHTML = '';
    windows.forEach((win, idx) => {
        const isMaster = win.hwnd === masterHwnd;
        const isUnsupported = isLikelyUnsupportedTabTitle(win.title);
        const row = document.createElement('div');
        row.className = `window-row${isMaster ? ' master' : ' target-row'}`;
        row.style.animationDelay = `${idx * 0.05}s`;

        const titleShort = truncate(win.title, 50);

        row.innerHTML = `
            <span class="badge">${isMaster ? '👑' : '🔗'}</span>
            <span class="role ${isMaster ? 'role-master' : 'role-target'}">${isMaster ? 'ГЛАВНОЕ' : 'ЦЕЛЬ'}</span>
            <div class="window-info">
                <div class="window-title">${escapeHtml(titleShort)}</div>
                <div class="window-meta">${win.width}×${win.height} · PID ${win.pid}${isUnsupported ? ' · ⚠ chrome:// не поддерживается' : ''}</div>
            </div>
        `;
        list.appendChild(row);
    });
}

// ===== SETTINGS =====

function toggleSettings() {
    const body = document.getElementById('settingsBody');
    const arrow = document.getElementById('settingsArrow');
    body.classList.toggle('collapsed');
    arrow.textContent = body.classList.contains('collapsed') ? '▶' : '▼';
}

function saveAllSettings() {
    const settings = {
        sync_clicks: document.getElementById('syncClicks').checked,
        sync_scroll: document.getElementById('syncScroll').checked,
        sync_keyboard: document.getElementById('syncKeyboard').checked,
        sync_mouse_move: document.getElementById('syncMouseMove').checked,
    };
    const keywords = document.getElementById('keywordsInput').value;
    eel.save_settings(settings)();
    eel.save_keywords(keywords)();
    showToast('Настройки сохранены', 'success');
}

function onDelayChange(value) {
    document.getElementById('delayValue').textContent = value + ' мс';
    eel.set_delay(parseInt(value))();
}

// ===== LOG =====

function addLog(text, type = 'info') {
    const logBody = document.getElementById('logBody');
    const now = new Date();
    const time = now.toLocaleTimeString('ru-RU', { hour12: false });

    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.innerHTML = `
        <span class="log-time">${time}</span>
        <span class="log-text">${escapeHtml(text)}</span>
    `;
    logBody.appendChild(entry);
    logBody.scrollTop = logBody.scrollHeight;

    while (logBody.children.length > 200) {
        logBody.removeChild(logBody.firstChild);
    }
}

function clearLog() {
    document.getElementById('logBody').innerHTML = '';
    addLog('Журнал очищен', 'info');
}

async function copyLogs() {
    const logBody = document.getElementById('logBody');
    const rows = Array.from(logBody.querySelectorAll('.log-entry'));
    const text = rows.map((row) => row.innerText.trim()).join('\n');

    if (!text) {
        showToast('Лог пуст', 'warning');
        return;
    }

    try {
        await navigator.clipboard.writeText(text);
        showToast('Логи скопированы', 'success');
    } catch (_err) {
        // Fallback for restricted clipboard contexts.
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('Логи скопированы', 'success');
    }
}

async function pullBackendLogs() {
    try {
        const items = await eel.pull_backend_logs()();
        if (!Array.isArray(items) || items.length === 0) return;
        items.forEach((message) => addLog(String(message), 'action'));
    } catch (_err) {
        // Eel may be unavailable during startup/shutdown.
    }
}

// ===== TIMER =====

function startTimer() {
    if (syncTimer) return;
    syncTimer = setInterval(() => {
        syncSeconds++;
        const m = String(Math.floor(syncSeconds / 60)).padStart(2, '0');
        const s = String(syncSeconds % 60).padStart(2, '0');
        document.getElementById('statTime').textContent = `${m}:${s}`;
    }, 1000);
}

function stopTimer() {
    if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
    syncSeconds = 0;
    document.getElementById('statTime').textContent = '00:00';
}

// ===== TOAST =====

function showToast(message, type = 'info') {
    // Remove existing toasts
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = message;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

// ===== UTILS =====

function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

function truncate(str, len) {
    return str.length > len ? str.substring(0, len) + '…' : str;
}

function updateStat(id, value) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = value;
        el.style.transform = 'scale(1.15)';
        setTimeout(() => { el.style.transform = 'scale(1)'; }, 200);
    }
}

// ===== PYTHON → JS CALLBACKS =====

eel.expose(updateStatus);
function updateStatus(text) {
    document.getElementById('statusText').textContent = text;
    const badge = document.getElementById('statusBadge');
    if (text.includes('активна') || text.includes('возобновлена')) {
        badge.className = 'status-badge active';
    } else if (text.includes('Пауза')) {
        badge.className = 'status-badge paused';
    } else {
        badge.className = 'status-badge';
    }
}

eel.expose(updateStats);
function updateStats(actions, errors) {
    updateStat('qsActions', actions);
    updateStat('qsErrors', errors);
}

eel.expose(logAction);
function logAction(text) {
    addLog(text, 'action');
}

eel.expose(onSyncStopped);
function onSyncStopped() {
    isSyncing = false;
    isPaused = false;
    stopTimer();
    updateSyncUI();
    resetSteps();
    addLog('🔴 Синхронизация остановлена (горячая клавиша)', 'info');
    showToast('Синхронизация остановлена', 'warning');
}

eel.expose(loadSettings);
function loadSettings(settings) {
    if (!settings) return;
    document.getElementById('syncClicks').checked = settings.sync_mouse_clicks;
    document.getElementById('syncScroll').checked = settings.sync_mouse_scroll;
    document.getElementById('syncKeyboard').checked = settings.sync_keyboard;
    document.getElementById('syncMouseMove').checked = settings.sync_mouse_move;
    document.getElementById('delaySlider').value = settings.action_delay * 1000;
    document.getElementById('delayValue').textContent = Math.round(settings.action_delay * 1000) + ' мс';
    if (settings.browser_window_keywords) {
        document.getElementById('keywordsInput').value = settings.browser_window_keywords.join(', ');
    }
}

// ===== SYNC STATUS =====

// ===== FILE UPLOAD =====

function toggleUpload() {
    const body = document.getElementById('uploadBody');
    const arrow = document.getElementById('uploadArrow');
    body.classList.toggle('collapsed');
    arrow.textContent = body.classList.contains('collapsed') ? '▶' : '▼';
}

async function onSelectFiles() {
    addLog('📄 Выбор файлов...', 'info');
    try {
        const result = await eel.select_upload_files()();
        if (result.success) {
            renderUploadFiles(result.names, result.count);
            addLog(`📄 Выбрано файлов: ${result.count}`, 'success');
            showToast(`Выбрано ${result.count} файл(ов)`, 'success');
        }
    } catch(e) {
        addLog('❌ Ошибка выбора файлов: ' + e, 'error');
    }
}

async function onSelectFolder() {
    addLog('📁 Выбор папки...', 'info');
    try {
        const result = await eel.select_upload_folder()();
        if (result.success) {
            renderUploadFiles(result.names, result.count);
            addLog(`📁 Папка выбрана, файлов: ${result.count}`, 'success');
            showToast(`Найдено ${result.count} файл(ов) в папке`, 'success');
        } else {
            if (result.message) showToast(result.message, 'warning');
        }
    } catch(e) {
        addLog('❌ Ошибка выбора папки: ' + e, 'error');
    }
}

async function onDoUpload() {
    const btn = document.getElementById('uploadGoBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Загрузка...';
    addLog('🚀 Загружаю файлы во все окна...', 'info');

    try {
        const result = await eel.do_upload_files()();
        if (result.success) {
            addLog(result.message, 'success');
            showToast(result.message, 'success');
        } else {
            addLog(result.message, 'warning');
            showToast(result.message, 'warning');
        }
    } catch(e) {
        addLog('❌ Ошибка загрузки: ' + e, 'error');
        showToast('Ошибка загрузки файлов', 'error');
    }

    btn.disabled = false;
    btn.textContent = '🚀 Загрузить во все окна';
}

async function onClearUpload() {
    await eel.clear_upload_files()();
    renderUploadFiles([], 0);
    addLog('🗑 Список файлов очищен', 'info');
}

function renderUploadFiles(names, count) {
    const list = document.getElementById('uploadFilesList');
    const btn = document.getElementById('uploadGoBtn');

    if (!names || names.length === 0) {
        list.innerHTML = '<div class="upload-empty">Файлы не выбраны</div>';
        btn.disabled = true;
        return;
    }

    btn.disabled = false;
    let html = `<div class="upload-count">${count} файл(ов) готово к загрузке:</div>`;
    const maxShow = 5;
    const shown = names.slice(0, maxShow);
    shown.forEach(name => {
        html += `<div class="upload-file-item">📎 ${escapeHtml(name)}</div>`;
    });
    if (names.length > maxShow) {
        html += `<div class="upload-file-more">... и ещё ${names.length - maxShow}</div>`;
    }
    list.innerHTML = html;
}

// Load upload files on init
async function loadUploadFiles() {
    try {
        const data = await eel.get_upload_files()();
        if (data && data.count > 0) {
            renderUploadFiles(data.names, data.count);
        }
    } catch(e) {}
}

// ===== STATE SYNC STATUS =====

async function refreshSyncStatus() {
    try {
        const r = await eel.get_sync_status()();
        const banner = document.getElementById('syncBanner');
        const icon = document.getElementById('syncIcon');
        const msg = document.getElementById('syncMessage');
        const hint = banner.querySelector('.sync-hint');

        banner.style.display = 'flex';
        banner.classList.add('ok');
        banner.classList.remove('warn');
        icon.textContent = '🧠';
        msg.textContent = r.message || 'State-sync режим активен';
        hint.textContent = 'Установите extension один раз, затем достаточно нажать Старт в приложении.';
    } catch(e) {}
}

// ===== EXTENSION MANAGEMENT =====

async function onOpenBrowser() {
    const btn = document.getElementById('openBrowserBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Запуск...';

    try {
        const result = await eel.open_browser_with_extension()();
        if (result.success) {
            addLog('🌐 ' + result.message, 'success');
            showToast('Браузер открыт!', 'success');
        } else {
            addLog('⚠ ' + result.message, 'warning');
            showToast(result.message, 'warning');
        }
    } catch (err) {
        addLog('❌ Ошибка: ' + err, 'error');
    }

    btn.disabled = false;
    btn.textContent = '🌐 Открыть Chrome с расширением';
}

async function checkExtensionStatus() {
    try {
        const status = await eel.get_extension_status()();
        const el = document.getElementById('extStatus');
        if (!el) return;

        if (status.error) {
            el.innerHTML = '<span class="ext-err">Ошибка: ' + status.error + '</span>';
            return;
        }

        const parts = [];
        if (status.version) {
            parts.push('v' + status.version);
        }
        if (status.built) {
            parts.push('<span class="ext-ok">собран</span>');
        } else {
            parts.push('<span class="ext-warn">не собран</span>');
        }
        if (status.browser_found) {
            parts.push(status.browser_type);
        } else {
            parts.push('<span class="ext-err">браузер не найден</span>');
        }
        el.innerHTML = parts.join(' · ');
    } catch (_) { /* no-op */ }
}

// ===== INIT =====

window.addEventListener('load', () => {
    eel.get_settings()(loadSettings);

    // Check extension status
    setTimeout(checkExtensionStatus, 200);

    // Check state-sync mode status
    setTimeout(refreshSyncStatus, 500);

    // Load upload files
    setTimeout(loadUploadFiles, 400);

    // First scan
    setTimeout(() => refreshWindows(), 300);

    // Live refresh every 3s + sync status check every 10s
    refreshInterval = setInterval(refreshWindows, 3000);
    setInterval(refreshSyncStatus, 10000);
    backendLogInterval = setInterval(pullBackendLogs, 1000);

    addLog('👋 Привет! Открой окна браузера и нажми кнопку', 'info');
    setTimeout(pullBackendLogs, 600);
});
