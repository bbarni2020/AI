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
        document.getElementById('chat-messages').innerHTML = `
            <div class="empty-state">
                <h1>Szia!</h1>
                <p>Miben segíthetek ma?</p>
            </div>
        `;
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
            select.innerHTML = '<option value="AI">✨ AI (Auto)</option>';
            
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
        history.forEach(item => {
            const div = document.createElement('div');
            div.className = 'history-item';
            div.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                <span>${item.title}</span>
            `;
            div.onclick = () => loadConversation(item.id);
            if (item.id === currentConversationId) {
                div.classList.add('active');
            }
            list.appendChild(div);
        });
    }
}

async function loadConversation(id) {
    currentConversationId = id;
    const res = await fetch(`/api/chat/conversation/${id}`);
    if (res.ok) {
        const data = await res.json();
        const container = document.getElementById('chat-messages');
        container.innerHTML = '';
        data.messages.forEach(msg => appendMessage(msg.role, msg.content, msg.images));
        
        document.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'));
        loadHistory(); 
    }
}

async function sendMessage() {
    const input = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const modelSelect = document.getElementById('model-select');
    
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

    appendMessage('user', text, attachments);

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
                attachments: attachments
            })
        });

        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) loadingEl.remove();

        if (res.ok) {
            const data = await res.json();
            appendMessage('assistant', data.message, data.images);
            if (!currentConversationId) {
                currentConversationId = data.conversation_id;
                loadHistory();
            }
        } else {
            appendMessage('assistant', 'Hiba az üzenet küldésekor.');
        }
    } catch (e) {
        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) loadingEl.remove();
        appendMessage('assistant', 'Hálózati hiba.');
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

function appendMessage(role, text, images) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = `message ${role}`;
    
    const content = document.createElement('div');
    content.className = 'message-content';
    
    let htmlContent = '';
    
    if (role === 'assistant') {
        let textStr = text;
        if (typeof text !== 'string') {
             textStr = '';
        }
        
        if (textStr) {
            htmlContent = marked.parse(textStr);
        }
    } else {
        let textStr = text;
        if (Array.isArray(text)) {
            const textPart = text.find(p => p.type === 'text');
            textStr = textPart ? textPart.text : '';
        }
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
    
    if (role === 'assistant') {
        content.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    }
    
    div.appendChild(content);
    container.appendChild(div);

    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    container.scrollTop = container.scrollHeight;
}
