let currentConversationId = null;
let selectedFiles = [];
let selectedMode = 'general';
let ultimateUnlocked = false;
let modeHintResetHandle = null;
let modeControl = 'smart';

const MODE_ORDER = ['general', 'precise', 'turbo', 'ultimate'];

function configureMarked() {
    marked.setOptions({
        highlight: function(code, lang) {
            if (lang && hljs.getLanguage(lang)) {
                try {
                    return hljs.highlight(code, { language: lang }).value;
                } catch (e) {}
            }
            return hljs.highlightAuto(code).value;
        },
        breaks: true,
        gfm: true
    });
}

const MODE_COPY = {
    general: { label: 'Általános', desc: 'Gyors és megbízható válaszok.', tag: 'Auto' },
    precise: { label: 'Pontos', desc: 'Maximális pontosság és részletek.', tag: 'GPT-5.1' },
    turbo: { label: 'Turbo', desc: 'Legerősebb elérhető modellek.', tag: 'Gemini Pro' },
    ultimate: { label: 'Ultimate', desc: 'Három modell + egyesítés.', tag: 'Invite only' }
};
const MODE_DISPLAY = {
    general: 'Általános',
    precise: 'Pontos',
    turbo: 'Turbo',
    ultimate: 'Ultimate',
    manual: 'Manuális'
};

document.addEventListener('DOMContentLoaded', () => {
    configureMarked();
    loadUser();
    loadHistory();
    loadModels();
    renderModeOptions();
    initModeSwitcher();
    initMobileSidebar();
    
    const input = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const fileInput = document.getElementById('file-input');
    const attachBtn = document.getElementById('attach-btn');

    document.getElementById('new-chat-btn').addEventListener('click', () => {
        currentConversationId = null;
        renderEmptyState();
        document.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'));
        selectedFiles = [];
        renderFilePreview();
    });

    sendBtn.addEventListener('click', sendMessage);
    
    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = (input.scrollHeight) + 'px';
        updateSendButton();
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    attachBtn.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', handleFileSelect);
});

function initMobileSidebar() {
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.querySelector('.sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (!toggle || !sidebar || !backdrop) return;

    const openSidebar = () => {
        sidebar.classList.add('open');
        backdrop.classList.add('visible');
        backdrop.setAttribute('aria-hidden', 'false');
    };
    const closeSidebar = () => {
        sidebar.classList.remove('open');
        backdrop.classList.remove('visible');
        backdrop.setAttribute('aria-hidden', 'true');
    };

    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (sidebar.classList.contains('open')) closeSidebar(); else openSidebar();
    });

    backdrop.addEventListener('click', closeSidebar);

    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            closeSidebar();
        }
    });
}

function updateSendButton() {
    const input = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    if (input.value.trim() || selectedFiles.length > 0) {
        sendBtn.removeAttribute('disabled');
    } else {
        sendBtn.setAttribute('disabled', 'true');
    }
}

function ensureModeAvailability() {
    if (selectedMode === 'ultimate' && !ultimateUnlocked) {
        selectedMode = 'general';
    }
}

function setMode(mode) {
    selectedMode = mode;
    renderModeOptions();
}

function setModeHint(text, isAlert = false) {
    const hint = document.getElementById('mode-hint');
    if (!hint) return;
    hint.textContent = text || '';
    if (isAlert) {
        hint.classList.add('alert');
    } else {
        hint.classList.remove('alert');
    }
}

function refreshModeHint() {
    if (modeControl === 'manual') {
        setModeHint('Manuális modell kiválasztás aktív.', false);
    } else {
        const info = MODE_COPY[selectedMode];
        setModeHint(info ? info.desc : '', false);
    }
}

function buildFriendlyError(status, payload) {
    const code = payload && typeof payload.error === 'string' ? payload.error : '';
    const message = payload && typeof payload.message === 'string' ? payload.message : '';
    if (code === 'rate_limit_exceeded') {
        return 'Elérted a rate limitet. Várj egy kicsit, aztán próbáld újra.';
    }
    if (code === 'token_limit_exceeded') {
        return message || 'Elfogyott a tokenkereted erre az időszakra. Szólj egy adminnak vagy várj a resetig.';
    }
    if (code === 'ultimate_not_allowed') {
        return 'Ultimate mód csak meghívott felhasználóknak érhető el. Válassz másik módot vagy kérj engedélyt.';
    }
    if (message) {
        return message;
    }
    if (status === 429) {
        return 'Túl sok kérés érkezett egyszerre. Próbáld újra később.';
    }
    return 'Hiba az üzenet küldésekor.';
}

function renderModeOptions() {
    ensureModeAvailability();
    const container = document.getElementById('advanced-mode-selector');
    if (!container) return;
    if (modeHintResetHandle) {
        clearTimeout(modeHintResetHandle);
        modeHintResetHandle = null;
    }
    container.innerHTML = '';
    MODE_ORDER.forEach(modeKey => {
        const info = MODE_COPY[modeKey];
        if (!info) return;
        const locked = modeKey === 'ultimate' && !ultimateUnlocked;
        const pill = document.createElement('div');
        pill.className = 'mode-pill';
        if (selectedMode === modeKey) pill.classList.add('active');
        if (locked) pill.classList.add('locked');
        pill.setAttribute('role', 'button');
        pill.tabIndex = 0;
        if (locked) {
            pill.setAttribute('aria-disabled', 'true');
        } else {
            pill.removeAttribute('aria-disabled');
        }
        pill.innerHTML = `
            <span class="mode-tag">${info.tag}</span>
            <span class="mode-name">${info.label}</span>
            <span class="mode-desc">${info.desc}</span>
        `;
        if (locked) {
            const warn = () => {
                setModeHint('Ultimate csak meghívással érhető el.', true);
                if (modeHintResetHandle) {
                    clearTimeout(modeHintResetHandle);
                }
                modeHintResetHandle = setTimeout(() => {
                    refreshModeHint();
                    modeHintResetHandle = null;
                }, 2500);
            };
            pill.addEventListener('click', warn);
            pill.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    warn();
                }
            });
        } else {
            const activate = () => setMode(modeKey);
            pill.addEventListener('click', activate);
            pill.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    activate();
                }
            });
        }
        container.appendChild(pill);
    });
    if (modeControl === 'smart') {
        refreshModeHint();
    }
}

function escapeHtml(value) {
    if (value == null) return '';
    return String(value).replace(/[&<>"']/g, (ch) => {
        switch (ch) {
            case '&':
                return '&amp;';
            case '<':
                return '&lt;';
            case '>':
                return '&gt;';
            case '"':
                return '&quot;';
            case '\'':
                return '&#39;';
            default:
                return ch;
        }
    });
}

function initModeSwitcher() {
    const buttons = document.querySelectorAll('.mode-toggle-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const value = btn.dataset.mode === 'manual' ? 'manual' : 'smart';
            if (value !== modeControl) {
                applyModeControl(value);
            }
        });
    });
    applyModeControl(modeControl);
}

function applyModeControl(value) {
    modeControl = value === 'manual' ? 'manual' : 'smart';
    document.body.dataset.modePanel = modeControl;
    document.querySelectorAll('.mode-toggle-btn').forEach(btn => {
        const active = btn.dataset.mode === modeControl;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const smartPanel = document.getElementById('smart-mode-panel');
    const manualPanel = document.getElementById('manual-mode-panel');
    if (smartPanel) smartPanel.classList.toggle('hidden-panel', modeControl !== 'smart');
    if (manualPanel) manualPanel.classList.toggle('hidden-panel', modeControl !== 'manual');
    const select = document.getElementById('model-select');
    if (select) {
        if (modeControl === 'smart') {
            select.value = 'AI';
            select.setAttribute('disabled', 'true');
        } else {
            select.removeAttribute('disabled');
        }
    }
    refreshModeHint();
}

async function loadModels() {
    try {
        const res = await fetch('/api/chat/models');
        if (res.ok) {
            const data = await res.json();
            const select = document.getElementById('model-select');
            select.innerHTML = '<option value="AI">AI (Auto)</option>';
            
            const models = data.models || data.data || [];
            models.forEach(model => {
                const option = document.createElement('option');
                const modelName = typeof model === 'string' ? model : model.id;
                option.value = modelName;
                option.textContent = modelName;
                select.appendChild(option);
            });
            applyModeControl(modeControl);
        }
    } catch (e) {
        console.error('Failed to load models', e);
    }
}

function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    files.forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            selectedFiles.push(e.target.result);
            renderFilePreview();
            updateSendButton();
        };
        reader.readAsDataURL(file);
    });
    
    e.target.value = '';
}

function renderFilePreview() {
    const container = document.getElementById('file-preview-area');
    container.innerHTML = '';
    
    if (selectedFiles.length > 0) {
        container.style.display = 'flex';
    } else {
        container.style.display = 'none';
    }

    selectedFiles.forEach((file, index) => {
        const div = document.createElement('div');
        div.className = 'file-preview-item';
        div.innerHTML = `
            <img src="${file}" alt="preview">
            <button class="file-preview-remove" data-index="${index}">×</button>
        `;
        container.appendChild(div);
    });

    document.querySelectorAll('.file-preview-remove').forEach(btn => {
        btn.onclick = (e) => {
            const idx = parseInt(e.target.dataset.index);
            selectedFiles.splice(idx, 1);
            renderFilePreview();
            updateSendButton();
        };
    });
}

function renderEmptyState() {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    container.innerHTML = `
        <div class="empty-state">
            <h1>Szia!</h1>
            <p>Miben segíthetek ma?</p>
        </div>
    `;
}

async function loadUser() {
    const res = await fetch('/api/chat/me');
    if (res.ok) {
        const user = await res.json();
        ultimateUnlocked = !!user.ultimate_enabled;
        renderModeOptions();
        const profileEl = document.querySelector('.user-profile');
        if (profileEl) {
            const badge = user.ultimate_enabled ? '<span class="ultimate-badge">Ultimate</span>' : '';
            profileEl.innerHTML = `
                <div class="avatar">
                    <img src="${user.picture}" alt="${user.name}" class="avatar-img">
                </div>
                <span class="username">${user.name}</span>
                ${badge}
            `;
        }
    }
}

async function loadHistory() {
    const res = await fetch('/api/chat/history');
    if (res.ok) {
        const history = await res.json();
        const list = document.getElementById('history-list');
        list.innerHTML = '';
        if (!history.length) {
            const empty = document.createElement('div');
            empty.className = 'history-empty';
            empty.textContent = 'Nincsenek beszélgetések';
            list.appendChild(empty);
            return;
        }
        history.forEach(item => {
            const div = document.createElement('div');
            div.className = 'history-item';
            const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            icon.setAttribute('width', '14');
            icon.setAttribute('height', '14');
            icon.setAttribute('viewBox', '0 0 24 24');
            icon.setAttribute('fill', 'none');
            icon.setAttribute('stroke', 'currentColor');
            icon.setAttribute('stroke-width', '2');
            icon.setAttribute('stroke-linecap', 'round');
            icon.setAttribute('stroke-linejoin', 'round');
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M21 15a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z');
            icon.appendChild(path);
            const title = document.createElement('span');
            title.textContent = item.title || 'Új beszélgetés';
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'history-delete-btn';
            deleteBtn.setAttribute('title', 'Beszélgetés törlése');
            deleteBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
            deleteBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                deleteConversation(item.id);
            });
            div.appendChild(icon);
            div.appendChild(title);
            div.appendChild(deleteBtn);
            div.onclick = () => loadConversation(item.id);
            if (item.id === currentConversationId) {
                div.classList.add('active');
            }
            list.appendChild(div);
        });
    }
}

async function deleteConversation(id) {
    const ok = window.confirm('Törlöd ezt a beszélgetést?');
    if (!ok) return;
    try {
        const res = await fetch(`/api/chat/conversation/${id}`, { method: 'DELETE' });
        if (res.ok) {
            if (currentConversationId === id) {
                currentConversationId = null;
                renderEmptyState();
            }
            loadHistory();
        }
    } catch (e) {
        console.error('Failed to delete conversation', e);
    }
}

async function loadConversation(id) {
    currentConversationId = id;
    
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';
    
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'chat-loading';
    loadingDiv.innerHTML = `
        <div class="chat-loading-spinner">
            <div class="spinner-ring"></div>
            <div class="spinner-ring"></div>
            <div class="spinner-ring"></div>
        </div>
        <p>Beszélgetés betöltése...</p>
    `;
    container.appendChild(loadingDiv);
    
    const res = await fetch(`/api/chat/conversation/${id}`);
    if (res.ok) {
        const data = await res.json();
        container.innerHTML = '';
        data.messages.forEach(msg => appendMessage(msg.role, msg.content, msg.images, msg.sources, msg.model, msg.meta));
        
        document.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'));
        loadHistory(); 
    } else {
        container.innerHTML = '<div class="empty-state"><p>Hiba a beszélgetés betöltésekor</p></div>';
    }
}

async function sendMessage() {
    const input = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const modelSelect = document.getElementById('model-select');
    const useWebSearch = document.getElementById('web-search-toggle')?.checked;
    
    const text = input.value.trim();
    const attachments = [...selectedFiles];
    const model = modelSelect.value;

    if (!text && attachments.length === 0) return;

    input.value = '';
    input.style.height = 'auto';
    selectedFiles = [];
    renderFilePreview();
    sendBtn.setAttribute('disabled', 'true');

    const emptyState = document.querySelector('.empty-state');
    if (emptyState) {
        emptyState.remove();
    }

    appendMessage('user', text, attachments, null, null, null);

    const mode = modeControl === 'manual' ? 'manual' : selectedMode;
    const useStream = mode !== 'ultimate';

    if (!useStream) {
        const loadingId = 'loading-' + Date.now();
        appendLoading(loadingId, useWebSearch);

        try {
            const res = await fetch('/api/chat/message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    conversation_id: currentConversationId,
                    model: model,
                    attachments: attachments,
                    use_web_search: !!useWebSearch,
                    mode: mode,
                    stream: false
                })
            });

            const loadingEl = document.getElementById(loadingId);
            if (loadingEl) loadingEl.remove();

            if (res.ok) {
                const data = await res.json();
                appendMessage('assistant', data.message, data.images, data.sources, data.model, data.meta);
                if (!currentConversationId) {
                    currentConversationId = data.conversation_id;
                    loadHistory();
                }
            } else {
                let payload = null;
                try {
                    payload = await res.json();
                } catch {}
                let friendly = 'Hiba történt.';
                if (payload?.error === 'rate_limit_exceeded') {
                    friendly = 'Túl sok kérés. Várj egy kicsit!';
                } else if (payload?.error === 'ultimate_not_allowed') {
                    friendly = 'Nincs jogod Ultimate módot használni.';
                }
                appendMessage('assistant', friendly, null, null, null, null);
            }
        } catch (err) {
            const loadingEl = document.getElementById(loadingId);
            if (loadingEl) loadingEl.remove();
            appendMessage('assistant', 'Hálózati hiba.', null, null, null, null);
        }
    } else {
        const streamMsgId = 'stream-' + Date.now();
        const container = document.getElementById('chat-messages');
        const streamDiv = document.createElement('div');
        streamDiv.id = streamMsgId;
        streamDiv.className = 'message assistant';
        
        const content = document.createElement('div');
        content.className = 'message-content';
        content.innerHTML = '<span class="word-cursor"></span>';
        streamDiv.appendChild(content);
        container.appendChild(streamDiv);
        scrollToBottom();

        try {
            const res = await fetch('/api/chat/message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    conversation_id: currentConversationId,
                    model: model,
                    attachments: attachments,
                    use_web_search: !!useWebSearch,
                    mode: mode,
                    stream: true
                })
            });

            if (!res.ok) {
                streamDiv.remove();
                let payload = null;
                try {
                    payload = await res.json();
                } catch {}
                let friendly = 'Hiba történt.';
                if (payload?.error === 'rate_limit_exceeded') {
                    friendly = 'Túl sok kérés. Várj egy kicsit!';
                } else if (payload?.error === 'ultimate_not_allowed') {
                    friendly = 'Nincs jogod Ultimate módot használni.';
                }
                appendMessage('assistant', friendly, null, null, null, null);
                return;
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let accumulated = '';
            let streamData = {};
            let lastWordCount = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const jsonStr = line.slice(6);
                        if (jsonStr.trim()) {
                            try {
                                const data = JSON.parse(jsonStr);
                                
                                if (data.type === 'start') {
                                    streamData = data.data;
                                    if (!currentConversationId) {
                                        currentConversationId = streamData.conversation_id;
                                    }
                                } else if (data.type === 'content') {
                                    accumulated += data.content;
                                    const htmlContent = marked.parse(accumulated);
                                    
                                    const tempDiv = document.createElement('div');
                                    tempDiv.innerHTML = htmlContent;
                                    const textContent = tempDiv.textContent || '';
                                    const words = textContent.trim().split(/\s+/);
                                    const currentWordCount = words.length;
                                    
                                    if (currentWordCount > lastWordCount) {
                                        content.innerHTML = htmlContent + '<span class="word-cursor"></span>';
                                        content.querySelectorAll('pre code').forEach((block) => {
                                            hljs.highlightElement(block);
                                        });
                                        
                                        const newWords = content.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, td, th');
                                        newWords.forEach(el => {
                                            if (!el.classList.contains('word-animated')) {
                                                el.classList.add('word-animated');
                                            }
                                        });
                                        
                                        lastWordCount = currentWordCount;
                                        scrollToBottom();
                                    }
                                } else if (data.type === 'done') {
                                    const htmlContent = marked.parse(accumulated);
                                    content.innerHTML = htmlContent;
                                    content.querySelectorAll('pre code').forEach((block) => {
                                        hljs.highlightElement(block);
                                    });
                                    renderMathInElement(content, {
                                        delimiters: [
                                            {left: '$$', right: '$$', display: true},
                                            {left: '$', right: '$', display: false},
                                            {left: '\\[', right: '\\]', display: true},
                                            {left: '\\(', right: '\\)', display: false},
                                            {left: '[', right: ']', display: true},
                                            {left: '(', right: ')', display: false}
                                        ],
                                        throwOnError: false
                                    });

                                    if (streamData.sources && streamData.sources.length) {
                                        const sourcesDiv = document.createElement('div');
                                        sourcesDiv.className = 'message-sources';
                                        const sourcesHeader = '<div class="sources-header"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> Web források</div>';
                                        sourcesDiv.innerHTML = sourcesHeader + streamData.sources.map((src, idx) => {
                                            const title = src.title || src.url || `Forrás ${idx + 1}`;
                                            const href = src.url || '#';
                                            return `<div class="source-item">[${idx + 1}] <a href="${href}" target="_blank" rel="noopener">${title}</a></div>`;
                                        }).join('');
                                        content.appendChild(sourcesDiv);
                                    }

                                    const metaRow = document.createElement('div');
                                    metaRow.className = 'message-meta';
                                    const modelSpan = document.createElement('span');
                                    modelSpan.className = 'message-model';
                                    let modelLabel = streamData.model ? `Model: ${streamData.model}` : '';
                                    const modeLabel = streamData.meta && streamData.meta.mode ? MODE_DISPLAY[streamData.meta.mode] : null;
                                    if (modeLabel) {
                                        modelLabel = modelLabel ? `${modelLabel} • ${modeLabel}` : modeLabel;
                                    }
                                    modelSpan.textContent = modelLabel;
                                    const actions = document.createElement('div');
                                    actions.className = 'message-actions';
                                    const copyBtn = document.createElement('button');
                                    copyBtn.className = 'copy-btn';
                                    copyBtn.setAttribute('title', 'Szöveg másolása');
                                    const copyIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
                                    copyBtn.dataset.icon = copyIcon;
                                    copyBtn.innerHTML = copyIcon;
                                    copyBtn.addEventListener('click', () => copyMessageText(copyBtn, accumulated));
                                    actions.appendChild(copyBtn);
                                    metaRow.appendChild(modelSpan);
                                    metaRow.appendChild(actions);
                                    content.appendChild(metaRow);
                                    
                                    loadHistory();
                                    scrollToBottom();
                                } else if (data.type === 'error') {
                                    streamDiv.remove();
                                    appendMessage('assistant', 'Hiba: ' + data.error, null, null, null, null);
                                }
                            } catch (e) {
                                console.error('Parse error:', e);
                            }
                        }
                    }
                }
            }
        } catch (err) {
            streamDiv.remove();
            appendMessage('assistant', 'Hálózati hiba.', null, null, null, null);
        }
    }

    updateSendButton();
}

function scrollToBottom() {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    const container = document.getElementById('chat-messages');
    container.scrollTop = container.scrollHeight;
}

function appendLoading(id, isWebSearching = false) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'message assistant';
    div.id = id;
    
    const content = document.createElement('div');
    content.className = 'message-content';
    const statusText = isWebSearching ? '<span class="loading-status">Keresés a weben...</span>' : '';
    content.innerHTML = `
        ${statusText}
        <div class="typing-indicator">
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
        </div>
    `;
    
    div.appendChild(content);
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function appendMessage(role, text, images, sources, modelName, meta) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = `message ${role}`;
    
    const content = document.createElement('div');
    content.className = 'message-content';
    
    let htmlContent = '';
    let plainText = '';
    
    if (role === 'assistant') {
        let textStr = text;
        if (typeof text !== 'string') {
            textStr = '';
        }
        plainText = textStr || '';
        if (textStr) {
            htmlContent = marked.parse(textStr);
        }
    } else {
        let textStr = text;
        if (Array.isArray(text)) {
            const textPart = text.find(p => p.type === 'text');
            textStr = textPart ? textPart.text : '';
        }
        plainText = textStr || '';
        htmlContent = textStr ? textStr.replace(/\n/g, '<br>') : '';
    }

    if (images && images.length > 0) {
        let imgsHtml = '<div class="message-images">';
        images.forEach(img => {
            let url = img;
            if (typeof img === 'object') {
                url = img.url || img.image_url || '';
                if (typeof url === 'object') url = url.url;
            }
            
            if (url) {
                const filename = 'image.png';
                imgsHtml += `
                    <a class="img-link" href="${url}" target="_blank" download="${filename}">
                        <img src="${url}" alt="Generated Image">
                        <span class="img-download">⬇</span>
                    </a>
                `;
            }
        });
        imgsHtml += '</div>';
        htmlContent += imgsHtml;
    }
    
    content.innerHTML = htmlContent;
    if (role === 'assistant' && meta && meta.mode === 'ultimate') {
        content.classList.add('word-animated');
    }
    
    let metaRow = null;
    if (role === 'assistant') {
        content.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
        renderMathInElement(content, {
            delimiters: [
                {left: '$$', right: '$$', display: true},
                {left: '$', right: '$', display: false},
                {left: '\\[', right: '\\]', display: true},
                {left: '\\(', right: '\\)', display: false},
                {left: '[', right: ']', display: true},
                {left: '(', right: ')', display: false}
            ],
            throwOnError: false
        });
        metaRow = document.createElement('div');
        metaRow = document.createElement('div');
        metaRow.className = 'message-meta';
            const modelSpan = document.createElement('span');
            modelSpan.className = 'message-model';
            let modelLabel = modelName ? `Model: ${modelName}` : '';
            const modeLabel = meta && meta.mode ? MODE_DISPLAY[meta.mode] : null;
            if (modeLabel) {
                modelLabel = modelLabel ? `${modelLabel} • ${modeLabel}` : modeLabel;
            }
            modelSpan.textContent = modelLabel;
            const actions = document.createElement('div');
            actions.className = 'message-actions';
            const copyBtn = document.createElement('button');
            copyBtn.className = 'copy-btn';
            copyBtn.setAttribute('title', 'Szöveg másolása');
            const copyIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
            copyBtn.dataset.icon = copyIcon;
            copyBtn.innerHTML = copyIcon;
            copyBtn.addEventListener('click', () => copyMessageText(copyBtn, plainText));
            actions.appendChild(copyBtn);
            metaRow.appendChild(modelSpan);
            metaRow.appendChild(actions);
    }

    if (sources && sources.length) {
        const sourcesDiv = document.createElement('div');
        sourcesDiv.className = 'message-sources';
        const sourcesHeader = '<div class="sources-header"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> Web források</div>';
        sourcesDiv.innerHTML = sourcesHeader + sources.map((src, idx) => {
            const title = src.title || src.url || `Forrás ${idx + 1}`;
            const href = src.url || '#';
            return `<div class="source-item">[${idx + 1}] <a href="${href}" target="_blank" rel="noopener">${title}</a></div>`;
        }).join('');
        content.appendChild(sourcesDiv);
    }

    if (meta && meta.mode === 'ultimate' && Array.isArray(meta.ultimate_candidates) && meta.ultimate_candidates.length) {
        const breakdown = document.createElement('details');
        breakdown.className = 'ultimate-breakdown';
        breakdown.innerHTML = '<summary>Ultimate bontás</summary>';
        const list = document.createElement('div');
        list.className = 'ultimate-breakdown-list';
        meta.ultimate_candidates.forEach(item => {
            const row = document.createElement('div');
            row.className = 'ultimate-breakdown-item';
            const modelLabel = escapeHtml(item?.model || 'Model');
            const excerpt = escapeHtml(item?.excerpt || '').replace(/\n/g, '<br>');
            row.innerHTML = `<strong>${modelLabel}</strong><div>${excerpt}</div>`;
            list.appendChild(row);
        });
        if (meta.aggregator_model) {
            const agg = document.createElement('div');
            agg.className = 'ultimate-breakdown-item';
            agg.innerHTML = `<strong>Kombináló: ${escapeHtml(meta.aggregator_model)}</strong><div>Végső válasz</div>`;
            list.appendChild(agg);
        }
        breakdown.appendChild(list);
        content.appendChild(breakdown);
    }
    
    if (metaRow) {
        content.appendChild(metaRow);
    }
    div.appendChild(content);
    container.appendChild(div);

    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    container.scrollTop = container.scrollHeight;
}

async function copyMessageText(button, value) {
    if (!value) return;
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(value);
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = value;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }
        const original = button.dataset.icon;
        button.classList.add('copied');
        button.textContent = 'Másolva';
        setTimeout(() => {
            button.classList.remove('copied');
            button.innerHTML = original;
        }, 1500);
    } catch (e) {
        console.error('copy failed', e);
    }
}
