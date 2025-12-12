let currentRoom = null;
let roomStream = null;
let streamingNode = null;
let streamingBuffer = '';
const seenMessageIds = new Set();

function configureMarked() {
    marked.setOptions({
        highlight: (code, lang) => {
            if (lang && hljs.getLanguage(lang)) {
                try {
                    return hljs.highlight(code, { language: lang }).value;
                } catch (e) {
                    return hljs.highlightAuto(code).value;
                }
            }
            return hljs.highlightAuto(code).value;
        },
        breaks: true,
        gfm: true
    });
}

document.addEventListener('DOMContentLoaded', () => {
    configureMarked();
    bindUI();
    loadMe();
    loadRooms();
    renderEmptyState();
    const codeParam = new URLSearchParams(window.location.search).get('code');
    if (codeParam) selectRoom(codeParam);
});

function bindUI() {
    const msgInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const createBtn = document.getElementById('create-room-btn');
    const joinBtn = document.getElementById('join-room-btn');
    const copyLinkBtn = document.getElementById('copy-room-link');
    const leaveBtn = document.getElementById('leave-room-btn');
    const manageBtn = document.getElementById('manage-rooms-btn');
    const editPromptBtn = document.getElementById('edit-prompt-btn');
    const clearChatBtn = document.getElementById('clear-chat-btn');
    const modal = document.getElementById('room-modal');
    const modalClose = document.getElementById('room-modal-close');
    const modalBackdrop = modal?.querySelector('.collab-modal-backdrop');
    const promptModal = document.getElementById('prompt-modal');
    const promptModalClose = document.getElementById('prompt-modal-close');
    const promptModalBackdrop = promptModal?.querySelector('.collab-modal-backdrop');
    const savePromptBtn = document.getElementById('save-prompt-btn');

    msgInput.addEventListener('input', () => {
        msgInput.style.height = 'auto';
        msgInput.style.height = msgInput.scrollHeight + 'px';
        updateSendState();
    });

    msgInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    sendBtn.addEventListener('click', sendMessage);
    createBtn.addEventListener('click', createRoom);
    joinBtn.addEventListener('click', joinRoom);
    copyLinkBtn.addEventListener('click', copyRoomLink);
    leaveBtn.addEventListener('click', leaveRoom);
    manageBtn.addEventListener('click', () => openModal(modal));
    editPromptBtn.addEventListener('click', openPromptEditor);
    clearChatBtn.addEventListener('click', clearChat);
    modalClose?.addEventListener('click', () => closeModal(modal));
    modalBackdrop?.addEventListener('click', () => closeModal(modal));
    promptModalClose?.addEventListener('click', () => closeModal(promptModal));
    promptModalBackdrop?.addEventListener('click', () => closeModal(promptModal));
    savePromptBtn?.addEventListener('click', saveSystemPrompt);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal(modal);
            closeModal(promptModal);
        }
    });

    initMobileSidebar();
}

function openModal(modal) {
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
}

function closeModal(modal) {
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
}

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
        sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
    });
    backdrop.addEventListener('click', closeSidebar);
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) closeSidebar();
    });
}

async function loadMe() {
    try {
        const res = await fetch('/api/chat/me');
        if (!res.ok) return;
        const user = await res.json();
        const profile = document.getElementById('collab-user');
        if (profile) {
            profile.innerHTML = `
                <div class="avatar"><img src="${user.picture}" alt="${user.name}" class="avatar-img"></div>
                <span class="username">${user.name}</span>
            `;
        }
    } catch (e) {
        console.error('profile load failed', e);
    }
}

async function loadRooms() {
    try {
        const res = await fetch('/api/collab/rooms');
        if (!res.ok) return;
        const data = await res.json();
        renderRooms(data.rooms || []);
    } catch (e) {
        console.error('room list failed', e);
    }
}

function renderRooms(rooms) {
    const list = document.getElementById('rooms-list');
    list.innerHTML = '';
    if (!rooms.length) {
        const empty = document.createElement('div');
        empty.className = 'history-empty';
        empty.textContent = 'Nincsenek szobák';
        list.appendChild(empty);
        return;
    }

    rooms.forEach((room) => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.dataset.code = room.code;
        const title = document.createElement('span');
        title.textContent = room.name;
        const meta = document.createElement('span');
        meta.className = 'history-meta';
        meta.textContent = room.last_message || '';
        div.appendChild(title);
        if (meta.textContent) div.appendChild(meta);
        div.addEventListener('click', () => selectRoom(room.code));
        if (currentRoom && currentRoom.code === room.code) div.classList.add('active');
        list.appendChild(div);
    });
}

async function createRoom() {
    const nameInput = document.getElementById('room-name-input');
    const payload = { name: (nameInput.value || '').trim() };
    try {
        const res = await fetch('/api/collab/rooms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) return;
        nameInput.value = '';
        const data = await res.json();
        await loadRooms();
        if (data.room?.code) selectRoom(data.room.code);
        closeModal(document.getElementById('room-modal'));
    } catch (e) {
        console.error('create room failed', e);
    }
}

async function joinRoom() {
    const codeInput = document.getElementById('join-code-input');
    const code = (codeInput.value || '').trim();
    if (!code) return;
    try {
        const res = await fetch('/api/collab/rooms/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });
        if (!res.ok) return;
        codeInput.value = '';
        const data = await res.json();
        await loadRooms();
        if (data.room?.code) selectRoom(data.room.code);
        closeModal(document.getElementById('room-modal'));
    } catch (e) {
        console.error('join failed', e);
    }
}

async function selectRoom(code) {
    if (!code) return;
    try {
        const res = await fetch(`/api/collab/rooms/${code}`);
        if (!res.ok) return;
        const data = await res.json();
        currentRoom = data.room;
        streamingBuffer = '';
        streamingNode = null;
        seenMessageIds.clear();
        renderRoomHeader();
        renderRoomMessages(data.messages || []);
        openStream(code);
        updateSendState();
        highlightActiveRoom();
    } catch (e) {
        console.error('room load failed', e);
    }
}

function renderRoomHeader() {
    const title = document.getElementById('room-title');
    const codeEl = document.getElementById('room-code');
    const copyBtn = document.getElementById('copy-room-link');
    const leaveBtn = document.getElementById('leave-room-btn');
    const editPromptBtn = document.getElementById('edit-prompt-btn');
    const clearChatBtn = document.getElementById('clear-chat-btn');
    if (!currentRoom) {
        title.textContent = 'Válassz ki egy szobát';
        codeEl.textContent = '';
        copyBtn.setAttribute('disabled', 'true');
        leaveBtn.setAttribute('disabled', 'true');
        editPromptBtn.setAttribute('disabled', 'true');
        clearChatBtn.setAttribute('disabled', 'true');
        return;
    }
    title.textContent = currentRoom.name;
    codeEl.textContent = `Kód: ${currentRoom.code}`;
    copyBtn.removeAttribute('disabled');
    leaveBtn.removeAttribute('disabled');
    editPromptBtn.removeAttribute('disabled');
    clearChatBtn.removeAttribute('disabled');
}

function renderRoomMessages(messages) {
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';
    messages.forEach((msg) => {
        seenMessageIds.add(msg.id);
        appendMessage(msg);
    });
    if (!messages.length) renderEmptyState();
}

function renderEmptyState() {
    const container = document.getElementById('chat-messages');
    container.innerHTML = `
        <div class="empty-state">
            <h1>Közös beszélgetések</h1>
            <p>Csatlakozz egy szobához vagy hozz létre egyet.</p>
        </div>
    `;
}

function highlightActiveRoom() {
    document.querySelectorAll('.history-item').forEach((el) => {
        el.classList.remove('active');
        if (currentRoom && el.dataset.code === currentRoom.code) {
            el.classList.add('active');
        }
    });
}

function openStream(code) {
    if (roomStream) roomStream.close();
    roomStream = new EventSource(`/api/collab/rooms/${code}/stream`);
    roomStream.onmessage = (evt) => {
        if (!evt.data) return;
        try {
            const payload = JSON.parse(evt.data);
            handleStreamPayload(payload);
        } catch (e) {
            console.error('stream parse failed', e);
        }
    };
    roomStream.onerror = () => {
        roomStream?.close();
        setTimeout(() => {
            if (currentRoom) openStream(currentRoom.code);
        }, 1500);
    };
}

function closeStream() {
    if (roomStream) {
        roomStream.close();
        roomStream = null;
    }
}

function handleStreamPayload(payload) {
    if (!payload || payload.type === 'ping' || payload.type === 'ready') return;
    if (payload.type === 'message' && payload.message) {
        if (payload.message.role === 'assistant' && streamingNode) {
            streamingNode.remove();
            streamingNode = null;
            streamingBuffer = '';
        }
        if (seenMessageIds.has(payload.message.id)) return;
        seenMessageIds.add(payload.message.id);
        appendMessage(payload.message);
        return;
    }
    if (payload.type === 'ai_start') {
        startStreaming(payload.model);
        return;
    }
    if (payload.type === 'ai_delta') {
        updateStreaming(payload.content || '');
        return;
    }
    if (payload.type === 'room_deleted') {
        appendSystemMessage('A szoba megszűnt.');
        closeStream();
        currentRoom = null;
        renderRoomHeader();
        renderEmptyState();
        loadRooms();
        return;
    }
    if (payload.type === 'system_prompt_updated') {
        if (currentRoom) currentRoom.system_prompt = payload.system_prompt || '';
        appendSystemMessage('A rendszer kontextus frissült.');
        return;
    }
    if (payload.type === 'chat_cleared') {
        const container = document.getElementById('chat-messages');
        container.innerHTML = '';
        seenMessageIds.clear();
        appendSystemMessage('A beszélgetés törölve lett.');
        return;
    }
    if (payload.type === 'error') {
        if (streamingNode) {
            streamingNode.remove();
            streamingNode = null;
            streamingBuffer = '';
        }
        appendSystemMessage(payload.message || 'Hiba történt.');
    }
}

function startStreaming(model) {
    streamingBuffer = '';
    const container = document.getElementById('chat-messages');
    streamingNode = document.createElement('div');
    streamingNode.className = 'message assistant streaming';
    streamingNode.innerHTML = `
        <div class="message-content"><span class="word-cursor"></span></div>
        <div class="message-meta"><span class="message-model">${model ? 'Model: ' + model : ''}</span></div>
    `;
    container.appendChild(streamingNode);
    scrollToBottom();
}

function updateStreaming(delta) {
    if (!streamingNode) return;
    streamingBuffer += delta;
    const content = streamingNode.querySelector('.message-content');
    content.innerHTML = marked.parse(streamingBuffer) + '<span class="word-cursor"></span>';
    content.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
    renderMathInElement(content, {
        delimiters: [
            {left: '$$', right: '$$', display: true},
            {left: '\\[', right: '\\]', display: true},
            {left: '\\(', right: '\\)', display: false}
        ],
        throwOnError: false
    });
    scrollToBottom();
}

async function sendMessage() {
    if (!currentRoom) return;
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    updateSendState();
    try {
        const res = await fetch(`/api/collab/rooms/${currentRoom.code}/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text })
        });
        if (res.ok) {
            const data = await res.json();
            if (data.message && !seenMessageIds.has(data.message.id)) {
                seenMessageIds.add(data.message.id);
                appendMessage(data.message);
            }
        } else if (res.status === 429) {
            appendSystemMessage('Rate limit, próbáld újra később.');
        }
    } catch (e) {
        appendSystemMessage('Hálózati hiba.');
    }
}

async function leaveRoom() {
    if (!currentRoom) return;
    try {
        const res = await fetch(`/api/collab/rooms/${currentRoom.code}/leave`, { method: 'POST' });
        if (res.ok) {
            closeStream();
            currentRoom = null;
            streamingNode = null;
            streamingBuffer = '';
            renderRoomHeader();
            renderEmptyState();
            loadRooms();
            updateSendState();
        }
    } catch (e) {
        appendSystemMessage('Nem sikerült kilépni a szobából.');
    }
}

function appendSystemMessage(text) {
    appendMessage({
        id: `sys-${Date.now()}`,
        role: 'assistant',
        content: text,
        model: null,
        meta: {},
        user: null
    });
}

function appendMessage(message) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = `message ${message.role}`;
    const content = document.createElement('div');
    content.className = 'message-content';

    const text = typeof message.content === 'string' ? message.content : '';
    content.innerHTML = message.role === 'assistant' ? marked.parse(text) : text.replace(/\n/g, '<br>');
    if (message.role === 'assistant') {
        content.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
        renderMathInElement(content, {
            delimiters: [
                {left: '$$', right: '$$', display: true},
                {left: '\\[', right: '\\]', display: true},
                {left: '\\(', right: '\\)', display: false}
            ],
            throwOnError: false
        });
    }

    const meta = document.createElement('div');
    meta.className = 'message-meta';
    const modelSpan = document.createElement('span');
    modelSpan.className = 'message-model';
    const modelLabel = message.model ? `Model: ${message.model}` : '';
    const senderLabel = message.user ? `${message.user.name || message.user.email}` : '';
    modelSpan.textContent = [modelLabel, senderLabel].filter(Boolean).join(' • ');
    meta.appendChild(modelSpan);
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.textContent = 'Másolás';
    copyBtn.addEventListener('click', () => copyText(text, copyBtn));
    actions.appendChild(copyBtn);
    meta.appendChild(actions);

    div.appendChild(content);
    div.appendChild(meta);
    container.appendChild(div);
    scrollToBottom();
}

function copyText(value, btn) {
    if (!value) return;
    navigator.clipboard?.writeText(value).then(() => {
        btn.classList.add('copied');
        btn.textContent = 'Másolva';
        setTimeout(() => {
            btn.classList.remove('copied');
            btn.textContent = 'Másolás';
        }, 1200);
    });
}

function scrollToBottom() {
    const container = document.getElementById('chat-messages');
    container.scrollTop = container.scrollHeight;
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

function updateSendState() {
    const input = document.getElementById('message-input');
    const btn = document.getElementById('send-btn');
    if (input.value.trim() && currentRoom) {
        btn.removeAttribute('disabled');
    } else {
        btn.setAttribute('disabled', 'true');
    }
}

async function copyRoomLink() {
    if (!currentRoom) return;
    const url = `${window.location.origin}/collab?code=${encodeURIComponent(currentRoom.code)}`;
    try {
        await navigator.clipboard.writeText(url);
        const btn = document.getElementById('copy-room-link');
        btn.textContent = 'Kimásolva';
        setTimeout(() => btn.textContent = 'Link másolása', 1200);
    } catch (e) {
        console.error('copy failed', e);
    }
}

function openPromptEditor() {
    if (!currentRoom) return;
    const textarea = document.getElementById('system-prompt-input');
    textarea.value = currentRoom.system_prompt || '';
    openModal(document.getElementById('prompt-modal'));
}

async function saveSystemPrompt() {
    if (!currentRoom) return;
    const textarea = document.getElementById('system-prompt-input');
    const prompt = textarea.value.trim();
    try {
        const res = await fetch(`/api/collab/rooms/${currentRoom.code}/system-prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ system_prompt: prompt })
        });
        if (res.ok) {
            const data = await res.json();
            currentRoom.system_prompt = data.system_prompt;
            closeModal(document.getElementById('prompt-modal'));
            appendSystemMessage('Kontextus frissítve.');
        }
    } catch (e) {
        appendSystemMessage('Hiba a mentéskor.');
    }
}

async function clearChat() {
    if (!currentRoom) return;
    const confirmed = confirm('Biztosan törölni szeretnéd az összes üzenetet? A kontextus megmarad.');
    if (!confirmed) return;
    try {
        const res = await fetch(`/api/collab/rooms/${currentRoom.code}/clear`, { method: 'POST' });
        if (res.ok) {
            const container = document.getElementById('chat-messages');
            container.innerHTML = '';
            seenMessageIds.clear();
            appendSystemMessage('Beszélgetés törölve.');
        }
    } catch (e) {
        appendSystemMessage('Hiba a törléskor.');
    }
}
