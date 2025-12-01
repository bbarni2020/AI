let currentConversationId = null;

document.addEventListener('DOMContentLoaded', () => {
    loadUser();
    loadHistory();
    
    const input = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');

    document.getElementById('new-chat-btn').addEventListener('click', () => {
        currentConversationId = null;
        document.getElementById('chat-messages').innerHTML = `
            <div class="empty-state">
                <h1>Szia!</h1>
                <p>Miben segíthetek ma?</p>
            </div>
        `;
        document.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'));
    });

    sendBtn.addEventListener('click', sendMessage);
    
    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = (input.scrollHeight) + 'px';

        if (input.value.trim()) {
            sendBtn.removeAttribute('disabled');
        } else {
            sendBtn.setAttribute('disabled', 'true');
        }
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
});

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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
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
        data.messages.forEach(msg => appendMessage(msg.role, msg.content));
        
        document.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'));
        loadHistory(); 
    }
}

async function sendMessage() {
    const input = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    input.style.height = 'auto';
    sendBtn.setAttribute('disabled', 'true');

    const emptyState = document.querySelector('.empty-state');
    if (emptyState) {
        emptyState.remove();
    }

    appendMessage('user', text);

    const loadingId = 'loading-' + Date.now();
    appendLoading(loadingId);

    const res = await fetch('/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: text,
            conversation_id: currentConversationId
        })
    });

    const loadingEl = document.getElementById(loadingId);
    if (loadingEl) loadingEl.remove();

    if (res.ok) {
        const data = await res.json();
        appendMessage('assistant', data.message);
        if (!currentConversationId) {
            currentConversationId = data.conversation_id;
            loadHistory();
        }
    } else {
        appendMessage('assistant', 'Hiba az üzenet küldésekor.');
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

function appendMessage(role, text) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = `message ${role}`;
    
    const content = document.createElement('div');
    content.className = 'message-content';
    
    if (role === 'assistant') {
        content.innerHTML = marked.parse(text);
        content.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    } else {
        content.innerText = text;
    }
    
    div.appendChild(content);
    container.appendChild(div);

    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    container.scrollTop = container.scrollHeight;
}
