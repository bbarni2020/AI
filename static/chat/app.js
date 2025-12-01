let currentConversationId = null;
let selectedFiles = [];

document.addEventListener('DOMContentLoaded', () => {
    loadUser();
    loadHistory();
    loadModels();
    
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

function updateSendButton() {
    const input = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    if (input.value.trim() || selectedFiles.length > 0) {
        sendBtn.removeAttribute('disabled');
    } else {
        sendBtn.setAttribute('disabled', 'true');
    }
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
        const profileEl = document.querySelector('.user-profile');
        if (profileEl) {
            profileEl.innerHTML = `
                <div class="avatar">
                    <img src="${user.picture}" alt="${user.name}" class="avatar-img">
                </div>
                <span class="username">${user.name}</span>
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
        data.messages.forEach(msg => appendMessage(msg.role, msg.content, msg.images, msg.sources, msg.model));
        
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

    appendMessage('user', text, attachments, null, null);

    const loadingId = 'loading-' + Date.now();
    appendLoading(loadingId);

    try {
        const res = await fetch('/api/chat/message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: text,
                conversation_id: currentConversationId,
                model: model,
                attachments: attachments,
                use_web_search: !!useWebSearch
            })
        });

        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) loadingEl.remove();

        if (res.ok) {
            const data = await res.json();
            appendMessage('assistant', data.message, data.images, data.sources, data.model);
            if (!currentConversationId) {
                currentConversationId = data.conversation_id;
                loadHistory();
            }
        } else {
            appendMessage('assistant', 'Hiba az üzenet küldésekor.', null, null, null);
        }
    } catch (e) {
        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) loadingEl.remove();
        appendMessage('assistant', 'Hálózati hiba.', null, null, null);
    }
}

function appendLoading(id) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'message assistant';
    div.id = id;
    
    const content = document.createElement('div');
    content.className = 'message-content';
    content.innerHTML = `
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

function appendMessage(role, text, images, sources, modelName) {
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
    
    let metaRow = null;

    if (role === 'assistant') {
        content.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
        metaRow = document.createElement('div');
        metaRow.className = 'message-meta';
            const modelSpan = document.createElement('span');
            modelSpan.className = 'message-model';
            modelSpan.textContent = modelName ? `Model: ${modelName}` : '';
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
        sourcesDiv.innerHTML = sources.map((src, idx) => {
            const title = src.title || src.url || `Forrás ${idx + 1}`;
            const href = src.url || '#';
            return `<div>[${idx + 1}] <a href="${href}" target="_blank" rel="noopener">${title}</a></div>`;
        }).join('');
        content.appendChild(sourcesDiv);
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
