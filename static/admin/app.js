const API = {
  async request(url, method = 'GET', body = null) {
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'include'
      });
      
      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('application/json') 
        ? await response.json() 
        : await response.text();
      
      return { status: response.status, data };
    } catch (err) {
      UI.showToast('Network error occurred', 'error');
      throw err;
    }
  }
};

const UI = {
  currentTheme: localStorage.getItem('theme') || 'light',
  
  init() {
    this.applyTheme();
  },
  
  applyTheme() {
    document.documentElement.setAttribute('data-theme', this.currentTheme);
    const lightIcon = document.querySelector('.theme-icon-light');
    const darkIcon = document.querySelector('.theme-icon-dark');
    if (this.currentTheme === 'dark') {
      lightIcon.style.display = 'none';
      darkIcon.style.display = 'block';
    } else {
      lightIcon.style.display = 'block';
      darkIcon.style.display = 'none';
    }
    
    if (UserKeys.chart) {
      UserKeys.loadUsageData();
    }
  },
  
  toggleTheme() {
    this.currentTheme = this.currentTheme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', this.currentTheme);
    this.applyTheme();
  },
  
  showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => toast.classList.remove('show'), 3000);
  },
  
  toggleView(showLogin) {
    document.getElementById('login').style.display = showLogin ? 'flex' : 'none';
    document.getElementById('app').style.display = showLogin ? 'none' : 'flex';
  },
  
  updateFormMode(isEdit) {
    const title = document.getElementById('userFormTitle');
    const submitBtn = document.getElementById('userAddBtn');
    const cancelBtn = document.getElementById('userCancelBtn');
    
    title.textContent = isEdit ? 'Edit API Key' : 'Generate New API Key';
    submitBtn.textContent = isEdit ? 'Update Key' : 'Generate Key';
    cancelBtn.style.display = isEdit ? 'block' : 'none';
  },
  
  clearForm() {
    document.getElementById('user_edit_id').value = '';
    document.getElementById('user_name').value = '';
    document.getElementById('user_enabled').checked = true;
    document.getElementById('rate_limit_enabled').checked = false;
    document.getElementById('user_rate').value = '';
    document.getElementById('user_rate').disabled = true;
    document.getElementById('token_limit_enabled').checked = false;
    document.getElementById('user_tokens').value = '';
    document.getElementById('user_tokens').disabled = true;
    this.updateFormMode(false);
  },
  
  showModal(apiKey) {
    const modal = document.getElementById('keyModal');
    document.getElementById('generatedKey').textContent = apiKey;
    modal.style.display = 'flex';
  },
  
  hideModal() {
    document.getElementById('keyModal').style.display = 'none';
  }
};

const Auth = {
  async checkAuth() {
    const result = await API.request('/admin/me');
    if (result.data.authenticated) {
      UI.toggleView(false);
      UserKeys.loadKeys();
      UserKeys.loadStats();
      CorsSettings.loadSettings();
    } else {
      UI.toggleView(true);
    }
  },
  
  async login() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const msgEl = document.getElementById('loginMsg');
    
    if (!username || !password) {
      msgEl.textContent = 'Please enter both username and password';
      return;
    }
    
    const result = await API.request('/admin/login', 'POST', { username, password });
    
    if (result.status === 200) {
      msgEl.textContent = '';
      UI.showToast('Login successful', 'success');
      this.checkAuth();
    } else {
      msgEl.textContent = 'Invalid username or password';
    }
  },
  
  async logout() {
    await API.request('/admin/logout', 'POST');
    UI.showToast('Logged out successfully', 'success');
    this.checkAuth();
  }
};

const UserKeys = {
  currentKeys: [],
  
  async loadKeys() {
    const result = await API.request('/admin/user-keys');
    this.currentKeys = result.data || [];
    this.renderTable();
  },
  
  async loadStats() {
    try {
      const result = await API.request('/api/stats');
      if (result.status === 200 && result.data) {
        document.getElementById('statsKeys').textContent = result.data.keys || 0;
        document.getElementById('statsRequests').textContent = (result.data.requests || 0).toLocaleString();
        document.getElementById('statsTokens').textContent = (result.data.tokens || 0).toLocaleString();
        if (result.data.graph) this.renderChart(result.data.graph);
      }
    } catch (e) {
      console.error('Failed to load /api/stats:', e);
    }
  },
  
  async loadUsageData() {
    try {
      const result = await API.request('/api/stats');
      if (result.status === 200 && result.data && result.data.graph) {
        this.renderChart(result.data.graph);
      }
    } catch (err) {
      console.error('Failed to load usage data:', err);
    }
  },
  
  renderChart(usageData) {
    const ctx = document.getElementById('usageChart');
    if (!ctx) return;
    
    const last7Days = [];
    const requestCounts = [];
    const tokenCounts = [];
    
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      last7Days.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      
      const dayData = usageData.find(d => d.date === dateStr) || { requests: 0, tokens: 0 };
      requestCounts.push(dayData.requests || 0);
      tokenCounts.push(dayData.tokens || 0);
    }
    
    if (this.chart) {
      this.chart.destroy();
    }
    
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#e3e3e3' : '#37352f';
    const gridColor = isDark ? '#37352f' : '#e9e9e7';
    
    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: last7Days,
        datasets: [
          {
            label: 'Requests',
            data: requestCounts,
            borderColor: '#2eaadc',
            backgroundColor: 'rgba(46, 170, 220, 0.1)',
            tension: 0.4,
            fill: true,
            pointRadius: 4,
            pointHoverRadius: 6
          },
          {
            label: 'Tokens (×1000)',
            data: tokenCounts.map(t => Math.round(t / 1000)),
            borderColor: '#a25ddc',
            backgroundColor: 'rgba(162, 93, 220, 0.1)',
            tension: 0.4,
            fill: true,
            pointRadius: 4,
            pointHoverRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: 2.5,
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: textColor,
              padding: 15,
              font: { size: 12, weight: '500' },
              usePointStyle: true,
              pointStyle: 'circle'
            }
          },
          tooltip: {
            backgroundColor: isDark ? '#2f2f2f' : '#ffffff',
            titleColor: textColor,
            bodyColor: textColor,
            borderColor: gridColor,
            borderWidth: 1,
            padding: 12,
            displayColors: true,
            callbacks: {
              label: function(context) {
                let label = context.dataset.label || '';
                if (label) {
                  label += ': ';
                }
                if (context.dataset.label === 'Tokens (×1000)') {
                  label += (context.parsed.y * 1000).toLocaleString();
                } else {
                  label += context.parsed.y.toLocaleString();
                }
                return label;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              color: textColor,
              font: { size: 11 }
            },
            grid: {
              color: gridColor,
              drawBorder: false
            }
          },
          x: {
            ticks: {
              color: textColor,
              font: { size: 11 }
            },
            grid: {
              display: false
            }
          }
        }
      }
    });
  },
  
  renderTable() {
    const tbody = document.querySelector('#userKeys tbody');
    const emptyState = document.getElementById('userEmptyState');
    
    tbody.innerHTML = '';
    
    if (this.currentKeys.length === 0) {
      emptyState.style.display = 'block';
      return;
    }
    
    emptyState.style.display = 'none';
    
    this.currentKeys.forEach(key => {
      const row = document.createElement('tr');
      const statusClass = key.enabled ? 'status-enabled' : 'status-disabled';
      const statusText = key.enabled ? 'Active' : 'Disabled';
      
      const rateLimit = key.rate_limit_enabled 
        ? `${key.rate_limit_value || key.rate_limit_per_min}/${key.rate_limit_period || 'min'}` 
        : '<span class="text-muted">None</span>';
      
      const tokenLimit = key.token_limit_enabled 
        ? `${key.token_limit_value || key.token_limit_per_day}/${key.token_limit_period || 'day'}` 
        : '<span class="text-muted">None</span>';
      
      const created = new Date(key.created_at).toLocaleDateString();
      const stats = `<span class="key-stats">${key.total_requests || 0} reqs / ${(key.total_tokens || 0).toLocaleString()} tokens</span>`;
      
      row.innerHTML = `
        <td><strong>${this.escapeHtml(key.name)}</strong></td>
        <td><code class="key-code">${this.escapeHtml(key.key)}</code></td>
        <td>${rateLimit}</td>
        <td>${tokenLimit}</td>
        <td><span class="status-badge ${statusClass}">${statusText}</span></td>
        <td>${stats}</td>
        <td>${created}</td>
        <td>
          <div class="table-actions">
            <button class="btn-stats" data-id="${key.id}">Stats</button>
            <button class="btn-edit" data-id="${key.id}">Edit</button>
            <button class="btn-delete" data-id="${key.id}">Delete</button>
          </div>
        </td>
      `;
      
      tbody.appendChild(row);
    });
    
    tbody.querySelectorAll('.btn-stats').forEach(btn => {
      btn.onclick = () => this.showKeyStats(btn.dataset.id);
    });
    
    tbody.querySelectorAll('.btn-edit').forEach(btn => {
      btn.onclick = () => this.editKey(btn.dataset.id);
    });
    
    tbody.querySelectorAll('.btn-delete').forEach(btn => {
      btn.onclick = () => this.deleteKey(btn.dataset.id);
    });
  },
  
  async showKeyStats(keyId) {
    const key = this.currentKeys.find(k => k.id == keyId);
    if (!key) return;
    
    const result = await API.request(`/admin/user-keys/${keyId}/stats`);
    if (result.status === 200 && result.data) {
      document.getElementById('statsModalTitle').textContent = `${key.name} - Statistics`;
      document.getElementById('modalTotalRequests').textContent = (result.data.total_requests || 0).toLocaleString();
      document.getElementById('modalTotalTokens').textContent = (result.data.total_tokens || 0).toLocaleString();
      
      if (result.data.graph) {
        this.renderModalChart(result.data.graph);
      }
      
      const activityHtml = result.data.recent && result.data.recent.length > 0
        ? result.data.recent.map(log => `
            <div class="activity-item">
              <span class="activity-time">${new Date(log.timestamp).toLocaleString()}</span>
              <span class="activity-tokens">${log.tokens.toLocaleString()} tokens</span>
            </div>
          `).join('')
        : '<p class="empty-message">No recent activity</p>';
      
      document.getElementById('modalRecentActivity').innerHTML = activityHtml;
      document.getElementById('keyStatsModal').style.display = 'flex';
    }
  },
  
  renderModalChart(arr) {
    const c = document.getElementById('modalUsageChart');
    if (!c) return;
    const ctx = c.getContext('2d');
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);
    const pad = 40;
    const maxTokens = Math.max(...arr.map(x => x.tokens), 1);
    const maxReq = Math.max(...arr.map(x => x.requests), 1);
    const barW = (w - pad * 2) / arr.length * 0.4;
    
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#666';
    ctx.fillText('Tokens', pad, 15);
    ctx.fillText('Requests', pad + 70, 15);
    
    arr.forEach((d, i) => {
      const xBase = pad + i * (w - pad * 2) / arr.length + ((w - pad * 2) / arr.length - barW * 2) / 2;
      const hTokens = (d.tokens / maxTokens) * (h - pad * 2);
      const hReq = (d.requests / maxReq) * (h - pad * 2);
      
      ctx.fillStyle = '#6366f1';
      ctx.fillRect(xBase, h - pad - hTokens, barW, hTokens);
      ctx.fillStyle = '#10b981';
      ctx.fillRect(xBase + barW, h - pad - hReq, barW, hReq);
      
      ctx.fillStyle = '#666';
      ctx.textAlign = 'center';
      ctx.font = '11px sans-serif';
      ctx.fillText(d.date.slice(5), xBase + barW, h - 10);
    });
    
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, h - pad);
    ctx.lineTo(w - pad, h - pad);
    ctx.stroke();
  },
  
  async saveKey(event) {
    event.preventDefault();
    
    const keyId = document.getElementById('user_edit_id').value;
    const rateLimitEnabled = document.getElementById('rate_limit_enabled').checked;
    const tokenLimitEnabled = document.getElementById('token_limit_enabled').checked;
    
    const keyData = {
      name: document.getElementById('user_name').value.trim(),
      enabled: document.getElementById('user_enabled').checked,
      rate_limit_enabled: rateLimitEnabled,
      rate_limit_value: rateLimitEnabled ? (parseInt(document.getElementById('user_rate').value) || 0) : 0,
      rate_limit_period: rateLimitEnabled ? (document.getElementById('user_rate_period')?.value || 'minute') : 'minute',
      rate_limit_per_min: rateLimitEnabled ? (parseInt(document.getElementById('user_rate').value) || 0) : 0,
      token_limit_enabled: tokenLimitEnabled,
      token_limit_value: tokenLimitEnabled ? (parseInt(document.getElementById('user_tokens').value) || 0) : 0,
      token_limit_period: tokenLimitEnabled ? (document.getElementById('user_token_period')?.value || 'day') : 'day',
      token_limit_per_day: tokenLimitEnabled ? (parseInt(document.getElementById('user_tokens').value) || 0) : 0
    };
    
    if (!keyData.name) {
      UI.showToast('Key name is required', 'error');
      return;
    }
    
    if (rateLimitEnabled && keyData.rate_limit_value < 1) {
      UI.showToast('Rate limit must be at least 1', 'error');
      return;
    }
    
    if (tokenLimitEnabled && keyData.token_limit_value < 1) {
      UI.showToast('Token limit must be at least 1', 'error');
      return;
    }
    
    const isUpdate = !!keyId;
    const url = isUpdate ? `/admin/user-keys/${keyId}` : '/admin/user-keys';
    const method = isUpdate ? 'PUT' : 'POST';
    
    const result = await API.request(url, method, keyData);
    
    if (isUpdate) {
      UI.showToast('Key updated successfully', 'success');
    } else {
      UI.showToast('Key generated successfully', 'success');
      if (result.data && result.data.key) {
        UI.showModal(result.data.key);
      }
    }
    
    UI.clearForm();
    this.loadKeys();
  },
  
  editKey(keyId) {
    const key = this.currentKeys.find(k => k.id == keyId);
    if (!key) return;
    
    document.getElementById('user_edit_id').value = key.id;
    document.getElementById('user_name').value = key.name;
    document.getElementById('user_enabled').checked = key.enabled;
    
    document.getElementById('rate_limit_enabled').checked = key.rate_limit_enabled;
    document.getElementById('user_rate').value = key.rate_limit_value || key.rate_limit_per_min || '';
    document.getElementById('user_rate').disabled = !key.rate_limit_enabled;
    if (document.getElementById('user_rate_period')) {
      document.getElementById('user_rate_period').value = key.rate_limit_period || 'minute';
      document.getElementById('user_rate_period').disabled = !key.rate_limit_enabled;
    }
    
    document.getElementById('token_limit_enabled').checked = key.token_limit_enabled;
    document.getElementById('user_tokens').value = key.token_limit_value || key.token_limit_per_day || '';
    document.getElementById('user_tokens').disabled = !key.token_limit_enabled;
    if (document.getElementById('user_token_period')) {
      document.getElementById('user_token_period').value = key.token_limit_period || 'day';
      document.getElementById('user_token_period').disabled = !key.token_limit_enabled;
    }
    
    UI.updateFormMode(true);
    
    document.getElementById('user_name').scrollIntoView({ behavior: 'smooth', block: 'center' });
  },
  
  async deleteKey(keyId) {
    const key = this.currentKeys.find(k => k.id == keyId);
    if (!key || !confirm(`Delete user key "${key.name}"?`)) return;
    
    await API.request(`/admin/user-keys/${keyId}`, 'DELETE');
    UI.showToast('Key deleted successfully', 'success');
    this.loadKeys();
  },
  
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

const CorsSettings = {
  origins: [],
  
  async loadSettings() {
    const result = await API.request('/admin/cors');
    if (result.status === 200 && result.data) {
      const originsStr = result.data.allowed_origins || '*';
      this.origins = originsStr.split(',').map(o => o.trim()).filter(o => o);
      this.renderOriginList();
      
      document.getElementById('cors_methods').value = result.data.allowed_methods || 'GET,POST,PUT,DELETE,OPTIONS';
      document.getElementById('cors_headers').value = result.data.allowed_headers || '*';
      document.getElementById('cors_credentials').checked = result.data.allow_credentials || false;
      document.getElementById('cors_max_age').value = result.data.max_age || 3600;
      
      this.syncCheckboxes();
    }
  },
  
  renderOriginList() {
    const container = document.getElementById('originList');
    container.innerHTML = '';
    
    this.origins.forEach((origin, index) => {
      const item = document.createElement('div');
      item.className = 'origin-item';
      
      const isWildcard = origin === '*';
      
      item.innerHTML = `
        <span class="origin-item-url ${isWildcard ? 'origin-item-wildcard' : ''}">${this.escapeHtml(origin)}</span>
        <button type="button" class="origin-item-remove" data-index="${index}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
          Remove
        </button>
      `;
      
      container.appendChild(item);
    });
    
    document.querySelectorAll('.origin-item-remove').forEach(btn => {
      btn.onclick = () => this.removeOrigin(parseInt(btn.dataset.index));
    });
    
    document.getElementById('cors_origins').value = this.origins.join(',');
  },
  
  addOrigin(origin) {
    const trimmed = origin.trim();
    if (!trimmed) {
      UI.showToast('Origin cannot be empty', 'error');
      return;
    }
    
    if (this.origins.includes(trimmed)) {
      UI.showToast('Origin already exists', 'error');
      return;
    }
    
    if (trimmed === '*' && this.origins.length > 0) {
      UI.showToast('Using * will replace all specific origins', 'error');
      this.origins = ['*'];
    } else if (this.origins.includes('*')) {
      UI.showToast('Remove * first to add specific origins', 'error');
      return;
    } else {
      this.origins.push(trimmed);
    }
    
    this.renderOriginList();
    document.getElementById('newOriginInput').value = '';
    this.syncQuickAddCheckboxes();
  },
  
  removeOrigin(index) {
    this.origins.splice(index, 1);
    this.renderOriginList();
    this.syncQuickAddCheckboxes();
  },
  
  syncQuickAddCheckboxes() {
    document.querySelectorAll('.origin-quick-add').forEach(cb => {
      cb.checked = this.origins.includes(cb.dataset.value);
    });
  },
  
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },
  
  syncCheckboxes() {
    const methods = document.getElementById('cors_methods').value.split(',').map(m => m.trim());
    const headers = document.getElementById('cors_headers').value;
    
    document.querySelectorAll('.method-helper').forEach(cb => {
      cb.checked = methods.includes(cb.dataset.value);
    });
    
    if (headers !== '*') {
      const headerList = headers.split(',').map(h => h.trim());
      document.querySelectorAll('.header-helper').forEach(cb => {
        cb.checked = headerList.includes(cb.dataset.value);
      });
    }
    
    this.syncQuickAddCheckboxes();
  },
  
  updateFromCheckboxes(type) {
    const inputId = type === 'method' ? 'cors_methods' : 
                    type === 'header' ? 'cors_headers' : 'cors_origins';
    const checkboxes = document.querySelectorAll(`.${type}-helper:checked`);
    
    if (checkboxes.length > 0) {
      const values = Array.from(checkboxes).map(cb => cb.dataset.value);
      document.getElementById(inputId).value = values.join(',');
    }
  },
  
  applyPreset(preset) {
    switch(preset) {
      case 'development':
        this.origins = ['*'];
        this.renderOriginList();
        document.getElementById('cors_methods').value = 'GET,POST,PUT,DELETE,PATCH,OPTIONS';
        document.getElementById('cors_headers').value = '*';
        document.getElementById('cors_credentials').checked = false;
        document.getElementById('cors_max_age').value = 3600;
        UI.showToast('Development preset applied - Allow all', 'success');
        break;
        
      case 'production':
        this.origins = [];
        this.renderOriginList();
        document.getElementById('cors_methods').value = 'GET,POST,OPTIONS';
        document.getElementById('cors_headers').value = 'Content-Type,Authorization';
        document.getElementById('cors_credentials').checked = true;
        document.getElementById('cors_max_age').value = 86400;
        UI.showToast('Production preset applied - Add your domains', 'success');
        break;
        
      case 'localhost':
        this.origins = ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080'];
        this.renderOriginList();
        document.getElementById('cors_methods').value = 'GET,POST,PUT,DELETE,OPTIONS';
        document.getElementById('cors_headers').value = 'Content-Type,Authorization';
        document.getElementById('cors_credentials').checked = true;
        document.getElementById('cors_max_age').value = 3600;
        UI.showToast('Local development preset applied', 'success');
        break;
    }
    
    this.syncCheckboxes();
  },
  
  async saveSettings(event) {
    event.preventDefault();
    
    if (this.origins.length === 0) {
      UI.showToast('Add at least one origin or use *', 'error');
      return;
    }
    
    const settings = {
      allowed_origins: this.origins.join(','),
      allowed_methods: document.getElementById('cors_methods').value.trim(),
      allowed_headers: document.getElementById('cors_headers').value.trim(),
      allow_credentials: document.getElementById('cors_credentials').checked,
      max_age: parseInt(document.getElementById('cors_max_age').value) || 3600
    };
    
    if (settings.allow_credentials && settings.allowed_origins === '*') {
      UI.showToast('Cannot use * for origins when credentials are allowed', 'error');
      return;
    }
    
    await API.request('/admin/cors', 'PUT', settings);
    UI.showToast('CORS settings updated successfully', 'success');
  }
};

const Whitelist = {
  async loadSettings() {
    const result = await API.request('/admin/whitelist');
    if (result.status === 200 && result.data) {
      document.getElementById('whitelist_emails').value = result.data.whitelisted_emails || '';
      document.getElementById('whitelist_domains').value = result.data.whitelisted_domains || '';
    }
  },

  async saveSettings(event) {
    event.preventDefault();
    const settings = {
      whitelisted_emails: document.getElementById('whitelist_emails').value.trim(),
      whitelisted_domains: document.getElementById('whitelist_domains').value.trim()
    };
    await API.request('/admin/whitelist', 'PUT', settings);
    UI.showToast('Whitelist settings saved', 'success');
  }
};

const Playground = {
  messages: [],
  selectedKey: null,
  selectedModel: null,
  selectedMode: 'chat',
  systemMdContent: null,
  compareEnabled: false,
  selectedModelB: null,
  messagesA: [],
  messagesB: [],
  
  async init() {
    await this.loadKeys();
    await this.loadModels();
    this.setupTextareaAutoResize();
    this.setupMdHandlers();
    this.adaptSettingsForMobile();
  },
  
  async loadKeys() {
    const res = await API.request('/admin/user-keys');
    if (res.status !== 200) return;
    
    const select = document.getElementById('playgroundKeySelect');
    select.innerHTML = '<option value="">Select key</option>';
    
    res.data.forEach(key => {
      const option = document.createElement('option');
      option.value = key.id;
      option.textContent = key.name || key.key;
      select.appendChild(option);
    });
  },

  adaptSettingsForMobile() {
    try {
      const sidebar = document.querySelector('.playground-sidebar');
      const main = document.querySelector('.playground-main');
      const settings = sidebar.querySelector('.playground-settings');
      if (!sidebar || !main || !settings) return;

      const isMobile = window.matchMedia('(max-width: 900px)').matches;
      const alreadyMoved = !!main.querySelector('.playground-settings');

      if (isMobile && !alreadyMoved) {
        settings.classList.add('mobile-settings');
        settings.id = 'playgroundSettings';
        settings.classList.add('collapsed');
        main.insertBefore(settings, main.firstChild);
      } else if (!isMobile && alreadyMoved) {
        settings.classList.remove('mobile-settings');
        settings.classList.remove('collapsed');
        settings.classList.remove('expanded');
        settings.id = '';
        sidebar.appendChild(settings);
      }
    } catch (e) {
    }
  },

  toggleMobileSettings() {
    try {
      const settings = document.querySelector('.mobile-settings') || document.querySelector('.playground-settings');
      const toggleBtn = document.getElementById('settingsToggle');
      if (!settings || !toggleBtn) return;
      const isMobileSettings = !!document.querySelector('.mobile-settings');
      if (!isMobileSettings) {
        settings.scrollIntoView({ behavior: 'smooth', block: 'center' });
        settings.classList.add('highlight');
        setTimeout(() => settings.classList.remove('highlight'), 1200);
        return;
      }

      const isExpanded = settings.classList.toggle('expanded');
      if (isExpanded) {
        settings.classList.remove('collapsed');
        toggleBtn.setAttribute('aria-expanded', 'true');
        toggleBtn.textContent = 'Hide settings';
      } else {
        settings.classList.remove('expanded');
        settings.classList.add('collapsed');
        toggleBtn.setAttribute('aria-expanded', 'false');
        toggleBtn.textContent = 'Settings';
        const input = document.getElementById('chatInput');
        if (input) input.focus();
      }
    } catch (e) {
    }
  },
  
  async loadModels() {
    const res = await API.request('/models');
    if (res.status !== 200) return;
    
    const selectA = document.getElementById('playgroundModelSelect');
    const selectB = document.getElementById('playgroundModelSelectB');
    selectA.innerHTML = '<option value="">Select model</option>';
    selectB.innerHTML = '<option value="">Select model B</option>';
    if (res.data && res.data.models) {
      const models = res.data.models;
      const isEmbeddings = this.selectedMode === 'embeddings';
      models.forEach(model => {
        const lower = (model || '').toLowerCase();
        if (isEmbeddings) {
          if (!lower.includes('embed')) return;
        } else {
          if (lower.includes('embed')) return;
        }
        const optionA = document.createElement('option');
        optionA.value = model;
        optionA.textContent = model + (lower.includes('image') ? ' (image)' : '');
        selectA.appendChild(optionA);
        const optionB = document.createElement('option');
        optionB.value = model;
        optionB.textContent = model + (lower.includes('image') ? ' (image)' : '');
        selectB.appendChild(optionB);
      });
    }
  },
  
  setupTextareaAutoResize() {
    const textarea = document.getElementById('chatInput');
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
      this.updateSendButton();
    });
  },
  
  updateSendButton() {
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendMessageBtn');
    const hasText = input.value.trim().length > 0;
    sendBtn.disabled = !hasText;
  },
  
  onKeyChange() {
    this.selectedKey = document.getElementById('playgroundKeySelect').value;
  },
  
  onModelChange() {
    this.selectedModel = document.getElementById('playgroundModelSelect').value;
  },

  onModelBChange() {
    this.selectedModelB = document.getElementById('playgroundModelSelectB').value;
  },

  onModeChange() {
    this.selectedMode = document.getElementById('playgroundModeSelect').value;
    this.loadModels();
    const input = document.getElementById('chatInput');
    if (this.selectedMode === 'embeddings') {
      input.placeholder = 'Enter text to embed...';
    } else {
      input.placeholder = 'Message AI...';
    }
    this.updateSendButton();
  },

  setupMdHandlers() {
    const upload = document.getElementById('playgroundMdUpload');
    const urlInput = document.getElementById('playgroundMdUrl');
    const fetchBtn = document.getElementById('playgroundMdFetchBtn');
    const clearBtn = document.getElementById('playgroundMdClearBtn');
    const preview = document.getElementById('playgroundMdPreview');

    if (upload) {
      upload.onchange = async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (!file.name.toLowerCase().endsWith('.md')) {
          UI.showToast('Only .md files are supported', 'error');
          return;
        }
        try {
          const text = await file.text();
          this.systemMdContent = text;
          preview.style.display = 'block';
          try {
            preview.innerHTML = `<div class="preview-header">System prompt preview <span style=\"font-weight:400;color:var(--text-muted);font-size:12px\">${text.length} chars</span></div><div class="preview-body">${this.renderMarkdown(text.slice(0, 2000))}</div>`;
          } catch (e) {
            preview.innerText = text.slice(0, 2000);
          }
          const fileName = document.getElementById('playgroundMdFileName');
          if (fileName) fileName.textContent = file.name;
          UI.showToast('Model.md loaded', 'success');
        } catch (err) {
          UI.showToast('Failed to read file', 'error');
        }
      };
    }

    if (fetchBtn && urlInput) {
      fetchBtn.onclick = async () => {
        const url = urlInput.value && urlInput.value.trim();
        if (!url) {
          UI.showToast('Please provide a URL', 'error');
          return;
        }
        try {
          const r = await API.request('/admin/playground/fetch_md', 'POST', { url });
          if (r.status !== 200) {
            throw new Error(r.data && r.data.error ? r.data.error : 'Failed to fetch');
          }
          this.systemMdContent = r.data.content || '';
          preview.style.display = 'block';
          try {
            preview.innerHTML = `<div class="preview-header">System prompt preview <span style=\"font-weight:400;color:var(--text-muted);font-size:12px\">${this.systemMdContent.length} chars</span></div><div class="preview-body">${this.renderMarkdown(this.systemMdContent.slice(0, 2000))}</div>`;
          } catch (e) {
            preview.innerText = this.systemMdContent.slice(0, 2000);
          }
          UI.showToast('Model.md loaded from URL', 'success');
        } catch (err) {
          UI.showToast(err.message || 'Failed to fetch .md', 'error');
        }
      };
    }

    if (clearBtn) {
      clearBtn.onclick = () => {
        this.systemMdContent = null;
        preview.style.display = 'none';
        preview.innerText = '';
        if (upload) upload.value = '';
        if (urlInput) urlInput.value = '';
        const fileName = document.getElementById('playgroundMdFileName');
        if (fileName) fileName.textContent = '';
        UI.showToast('System prompt removed', 'success');
      };
    }
  },

  onCompareChange() {
    this.compareEnabled = document.getElementById('compareToggle').checked;
    const selB = document.getElementById('playgroundModelSelectB');
    selB.style.display = this.compareEnabled ? 'block' : 'none';
  },
  
  async sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    
    if (!message) return;
    if (!this.selectedKey) {
      UI.showToast('Please select an API key', 'error');
      return;
    }
    if (!this.selectedModel) {
      UI.showToast('Please select a model', 'error');
      return;
    }
    
    input.value = '';
    input.style.height = 'auto';
    input.disabled = true;
    document.getElementById('sendMessageBtn').disabled = true;
    
    this.hideWelcomeScreen();
    
    this.messages.push({ role: 'user', content: message });
    this.renderMessages();
    this.showTypingIndicator();
    
    try {
      if (this.compareEnabled && this.selectedModel && this.selectedModelB) {
        if (this.selectedMode === 'embeddings') {
          const [rA, rB] = await Promise.all([
            API.request('/admin/playground/embeddings', 'POST', { key_id: this.selectedKey, model: this.selectedModel, input: message }),
            API.request('/admin/playground/embeddings', 'POST', { key_id: this.selectedKey, model: this.selectedModelB, input: message })
          ]);
          this.hideTypingIndicator();
          if (rA.status !== 200 || rB.status !== 200) {
            const err = (rA.status !== 200 && rA.data && rA.data.error) || (rB.status !== 200 && rB.data && rB.data.error) || 'Request failed';
            throw new Error(err);
          }
          const embedA = (rA.data && rA.data.data && rA.data.data[0] && (rA.data.data[0].embedding || rA.data.data[0].vector)) || [];
          const embedB = (rB.data && rB.data.data && rB.data.data[0] && (rB.data.data[0].embedding || rB.data.data[0].vector)) || [];
          this.messagesA.push({ role: 'user', content: message });
          this.messagesB.push({ role: 'user', content: message });
          this.messagesA.push({ role: 'assistant', content: `Embedding (len=${embedA.length})\nPreview: ${JSON.stringify(embedA.slice(0,10))}` });
          this.messagesB.push({ role: 'assistant', content: `Embedding (len=${embedB.length})\nPreview: ${JSON.stringify(embedB.slice(0,10))}` });
          this.renderComparison();
        } else {
          const msgs = this.messages.slice();
          if (this.systemMdContent && this.selectedMode === 'chat') {
            msgs.unshift({ role: 'system', content: this.systemMdContent });
          }
          const [rA, rB] = await Promise.all([
            API.request('/admin/playground/chat', 'POST', { key_id: this.selectedKey, model: this.selectedModel, messages: msgs }),
            API.request('/admin/playground/chat', 'POST', { key_id: this.selectedKey, model: this.selectedModelB, messages: msgs })
          ]);
          this.hideTypingIndicator();
          if (rA.status !== 200 || rB.status !== 200) {
            const err = (rA.status !== 200 && rA.data && rA.data.error) || (rB.status !== 200 && rB.data && rB.data.error) || 'Request failed';
            throw new Error(err);
          }
          const assistantA = (rA.data && rA.data.choices && rA.data.choices[0] && rA.data.choices[0].message) || { role: 'assistant', content: 'No response' };
          const assistantB = (rB.data && rB.data.choices && rB.data.choices[0] && rB.data.choices[0].message) || { role: 'assistant', content: 'No response' };
          this.messagesA.push({ role: 'user', content: message });
          this.messagesB.push({ role: 'user', content: message });
          this.messagesA.push(assistantA);
          this.messagesB.push(assistantB);
          this.renderComparison();
        }
      } else {
        if (this.selectedMode === 'embeddings') {
          const result = await API.request('/admin/playground/embeddings', 'POST', { key_id: this.selectedKey, model: this.selectedModel, input: message });
          this.hideTypingIndicator();
          if (result.status !== 200) {
            throw new Error(result.data.error || 'Request failed');
          }
          const data = result.data;
          let embedding = null;
          if (data && data.data && Array.isArray(data.data) && data.data[0]) {
            embedding = data.data[0].embedding || data.data[0].vector || null;
          }
          const len = embedding ? embedding.length : 0;
          const preview = embedding ? JSON.stringify(embedding.slice(0, 10)) : '[]';
          const content = `Embedding (len=${len})\nPreview: ${preview}`;
          this.messages.push({ role: 'assistant', content });
          this.renderMessages();
        } else {
          const msgs = this.messages.slice();
          if (this.systemMdContent && this.selectedMode === 'chat') {
            msgs.unshift({ role: 'system', content: this.systemMdContent });
          }
          const result = await API.request('/admin/playground/chat', 'POST', { key_id: this.selectedKey, model: this.selectedModel, messages: msgs });
          this.hideTypingIndicator();
          if (result.status !== 200) {
            throw new Error(result.data.error || 'Request failed');
          }
          const assistantMsg = result.data.choices && result.data.choices[0] && result.data.choices[0].message ? result.data.choices[0].message : { role: 'assistant', content: 'No response' };
          this.messages.push(assistantMsg);
          this.renderMessages();
        }
      }
      
    } catch (err) {
      this.hideTypingIndicator();
      UI.showToast(err.message, 'error');
    } finally {
      input.disabled = false;
      input.focus();
    }
  },

  renderComparison() {
    const container = document.getElementById('chatMessages');
    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'comparison-wrapper';
    const colA = document.createElement('div');
    colA.className = 'comparison-col';
    const colB = document.createElement('div');
    colB.className = 'comparison-col';
    const headerA = document.createElement('div');
    headerA.className = 'comparison-header';
    headerA.textContent = `Model A: ${this.selectedModel || ''}`;
    const headerB = document.createElement('div');
    headerB.className = 'comparison-header';
    headerB.textContent = `Model B: ${this.selectedModelB || ''}`;
    colA.appendChild(headerA);
    colB.appendChild(headerB);
    const filenameFromUrl = (url) => {
      if (!url) return 'image.png';
      if (url.startsWith('data:')) {
        const m = url.match(/^data:image\/([a-zA-Z0-9+.-]+);/);
        const ext = m ? m[1] : 'png';
        return `image.${ext}`;
      }
      try {
        const u = new URL(url);
        const name = u.pathname.split('/').pop();
        return name || 'image.png';
      } catch (e) {
        const parts = url.split('/');
        return parts[parts.length - 1].split('?')[0] || 'image.png';
      }
    };

    const renderList = (list, root) => {
      list.forEach(msg => {
        const div = document.createElement('div');
        div.className = 'chat-message';
        const isUser = msg.role === 'user';
        const contentText = isUser ? (msg.content || '') : (msg.content || '');
        const messageContent = isUser ? this.escapeHtml(contentText) : this.renderMarkdown(contentText);
        let imagesHtml = '';
        if (msg && Array.isArray(msg.images) && msg.images.length) {
          const imgs = msg.images.map(im => {
            let url = '';
            if (im && im.image_url) url = im.image_url.url || im.image_url;
            else if (im && im.url) url = im.url;
            else url = im;
            const name = filenameFromUrl(url);
            const imgHtml = `<a class=\"img-link\" href=\"${this.escapeHtml(url)}\" target=\"_blank\" rel=\"noopener noreferrer\" download=\"${this.escapeHtml(name)}\"><img src=\"${this.escapeHtml(url)}\" alt=\"image\" loading=\"lazy\"/></a>`;
            return imgHtml;
          }).join('');
          imagesHtml = `<div class="message-images">${imgs}</div>`;
        }
        div.innerHTML = `
          <div class="message-header">
            <div class="message-avatar ${msg.role}"></div>
            <span class="message-sender">${isUser ? 'You' : 'AI Assistant'}</span>
          </div>
          <div class="message-text">${messageContent}${imagesHtml}</div>
        `;
        root.appendChild(div);
      });
    };
    renderList(this.messagesA, colA);
    renderList(this.messagesB, colB);
    wrapper.appendChild(colA);
    wrapper.appendChild(colB);
    container.appendChild(wrapper);
    container.scrollTop = container.scrollHeight;
  },
  
  hideWelcomeScreen() {
    const welcome = document.querySelector('.welcome-screen');
    if (welcome) {
      welcome.remove();
    }
  },
  
  showTypingIndicator() {
    const container = document.getElementById('chatMessages');
    const indicator = document.createElement('div');
    indicator.className = 'typing-indicator';
    indicator.innerHTML = `
      <div class="message-header">
        <div class="message-avatar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
        </div>
        <span class="message-sender">AI Assistant</span>
      </div>
      <div class="typing-dots">
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      </div>
    `;
    container.appendChild(indicator);
    container.scrollTop = container.scrollHeight;
  },
  
  hideTypingIndicator() {
    const indicator = document.querySelector('.typing-indicator');
    if (indicator) {
      indicator.remove();
    }
  },
  
  renderMessages() {
    const container = document.getElementById('chatMessages');
    
    const existingMessages = container.querySelectorAll('.chat-message');
    existingMessages.forEach(msg => msg.remove());
    
    this.messages.forEach(msg => {
      const div = document.createElement('div');
      div.className = 'chat-message';
      
      const isUser = msg.role === 'user';
      const avatarContent = isUser 
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>';
      
      const contentText = msg && msg.content ? msg.content : '';
      const messageContent = isUser ? this.escapeHtml(contentText) : this.renderMarkdown(contentText);
      let imagesHtml = '';
      if (msg && Array.isArray(msg.images) && msg.images.length) {
        const filenameFromUrl = (url) => {
          if (!url) return 'image.png';
          if (url.startsWith('data:')) {
            const m = url.match(/^data:image\/([a-zA-Z0-9+.-]+);/);
            const ext = m ? m[1] : 'png';
            return `image.${ext}`;
          }
          try {
            const u = new URL(url);
            const name = u.pathname.split('/').pop();
            return name || 'image.png';
          } catch (e) {
            const parts = url.split('/');
            return parts[parts.length - 1].split('?')[0] || 'image.png';
          }
        };
        const imgs = msg.images.map(im => {
          let url = '';
          if (im && im.image_url) url = im.image_url.url || im.image_url;
          else if (im && im.url) url = im.url;
          else url = im;
          const name = filenameFromUrl(url);
          const imgHtml = `<a class="img-link" href="${this.escapeHtml(url)}" target="_blank" rel="noopener noreferrer" download="${this.escapeHtml(name)}"><img src="${this.escapeHtml(url)}" alt="image" loading="lazy"/><span class=\"img-download\">⬇</span></a>`;
          return imgHtml;
        }).join('');
        imagesHtml = `<div class="message-images">${imgs}</div>`;
      }

      div.innerHTML = `
        <div class="message-header">
          <div class="message-avatar ${msg.role}">
            ${avatarContent}
          </div>
          <span class="message-sender">${isUser ? 'You' : 'AI Assistant'}</span>
        </div>
        <div class="message-text">${messageContent}${imagesHtml}</div>
      `;
      
      container.appendChild(div);
    });
    
    container.scrollTop = container.scrollHeight;
  },
  
  renderMarkdown(text) {
    if (typeof marked !== 'undefined') {
      marked.setOptions({
        breaks: true,
        gfm: true,
        headerIds: false,
        mangle: false
      });
      try {
        let mathBlocks = [];
        let idx = 0;
        text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => {
          const key = `@@MATH${idx++}@@`;
          mathBlocks.push({ key, content: m, display: true });
          return key;
        });
        text = text.replace(/\$([^\$\n]+?)\$/g, (_, m) => {
          const key = `@@MATH${idx++}@@`;
          mathBlocks.push({ key, content: m, display: false });
          return key;
        });
        let html = marked.parse(text);
        if (typeof katex !== 'undefined') {
          mathBlocks.forEach(b => {
            try {
              const k = katex.renderToString(b.content, { throwOnError: false, displayMode: b.display });
              html = html.split(b.key).join(k);
            } catch (e) {
              html = html.split(b.key).join(this.escapeHtml(b.content));
            }
          });
        } else {
          mathBlocks.forEach(b => {
            html = html.split(b.key).join(this.escapeHtml(b.content));
          });
        }
        return html;
      } catch (e) {
        return marked.parse(text);
      }
    }
    return this.escapeHtml(text);
  },
  
  newChat() {
    this.messages = [];
    const container = document.getElementById('chatMessages');
    container.innerHTML = `
      <div class="welcome-screen">
        <div class="welcome-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
        </div>
        <h2>AI Playground</h2>
        <p>Start a conversation with your AI assistant</p>
        <div class="welcome-suggestions">
          <button class="suggestion-card">
            <span class="suggestion-icon">💡</span>
            <span>Explain quantum computing</span>
          </button>
          <button class="suggestion-card">
            <span class="suggestion-icon">✍️</span>
            <span>Write a creative story</span>
          </button>
          <button class="suggestion-card">
            <span class="suggestion-icon">🔍</span>
            <span>Help me debug code</span>
          </button>
          <button class="suggestion-card">
            <span class="suggestion-icon">🎨</span>
            <span>Brainstorm ideas</span>
          </button>
        </div>
      </div>
    `;
    this.attachSuggestionHandlers();
    UI.showToast('New chat started', 'success');
  },
  
  attachSuggestionHandlers() {
    document.querySelectorAll('.suggestion-card').forEach(card => {
      card.onclick = () => {
        const text = card.querySelector('span:last-child').textContent;
        document.getElementById('chatInput').value = text;
        this.updateSendButton();
        document.getElementById('chatInput').focus();
      };
    });
  },
  
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

const AgentBuilder = {
  agents: [],
  currentAgent: null,
  mdContent: '',
  selectedKey: null,
  selectedModel: null,

  async init() {
    await this.loadAgents();
    await Playground.loadKeys();
    await Playground.loadModels();
    await this.populateKeySelect();
    await this.populateModelSelect();
    this.setupEditorHandlers();
    this.setupChatHandlers();
    this.setupTabHandlers();
    this.setupSettingsHandlers();
  },

  async loadAgents() {
    const r = await API.request('/admin/agents');
    if (r.status !== 200) return;
    this.agents = r.data.agents || [];
    this.renderList();
  },

  renderList() {
    const el = document.getElementById('agentList');
    el.innerHTML = '';
    this.agents.forEach(name => {
      const btn = document.createElement('button');
      btn.className = 'agent-list-item';
      btn.textContent = name;
      btn.onclick = () => this.loadAgent(name);
      el.appendChild(btn);
    });
  },

  async createOrLoad() {
    const name = document.getElementById('agentNameInput').value.trim();
    if (!name) { UI.showToast('Agent name is required', 'error'); return; }
    const r = await API.request('/admin/agents', 'POST', { name });
    if (r.status === 200) {
      UI.showToast('Agent ready', 'success');
      this.currentAgent = r.data.name || name;
      this.agents = Array.from(new Set([...(this.agents || []), this.currentAgent]));
      this.renderList();
      document.getElementById('deleteAgentBtn').style.display = 'inline-block';
      this.loadAgent(this.currentAgent);
    }
  },

  async loadAgent(name) {
    const r = await API.request(`/admin/agents/${encodeURIComponent(name)}`);
    if (r.status !== 200) { UI.showToast('Failed to load agent', 'error'); return; }
    this.currentAgent = name;
    this.mdContent = r.data.content || '';
    document.getElementById('agentMdEditor').value = this.mdContent;
    document.getElementById('agentStatus').textContent = `Editing: ${name}`;
    document.getElementById('deleteAgentBtn').style.display = 'inline-block';
    this.populateKeySelect();
    this.populateModelSelect();
  },

  async deleteAgent() {
    if (!this.currentAgent) return;
    if (!confirm(`Delete agent ${this.currentAgent}?`)) return;
    const r = await API.request(`/admin/agents/${encodeURIComponent(this.currentAgent)}`, 'DELETE');
    if (r.status === 200) {
      UI.showToast('Agent deleted', 'success');
      this.currentAgent = null;
      document.getElementById('agentMdEditor').value = '';
      document.getElementById('agentStatus').textContent = '';
      document.getElementById('deleteAgentBtn').style.display = 'none';
      await this.loadAgents();
    } else {
      UI.showToast('Delete failed', 'error');
    }
  },

  async saveAgent() {
    if (!this.currentAgent) { UI.showToast('Create or load an agent first', 'error'); return; }
    const content = document.getElementById('agentMdEditor').value;
    const r = await API.request(`/admin/agents/${encodeURIComponent(this.currentAgent)}`, 'PUT', { content });
    if (r.status === 200) UI.showToast('Saved', 'success');
    else UI.showToast('Save failed', 'error');
  },

  async populateKeySelect() {
    const res = await API.request('/admin/user-keys');
    const select = document.getElementById('agentKeySelect');
    if (!select) return;
    select.innerHTML = '<option value="">Select API Key</option>';
    if (res.status !== 200) return;
    (res.data || []).forEach(k => {
      const opt = document.createElement('option');
      opt.value = k.id;
      opt.textContent = k.name || k.key;
      select.appendChild(opt);
    });
    select.onchange = () => { this.selectedKey = select.value; };
  },

  async populateModelSelect() {
    const res = await API.request('/models');
    const select = document.getElementById('agentModelSelect');
    if (!select) return;
    select.innerHTML = '<option value="">Select model</option>';
    if (res.status !== 200 || !res.data || !res.data.models) return;
    (res.data.models || []).forEach(m => {
      const lower = (m || '').toLowerCase();
      const isEmbeddings = false;
      if (isEmbeddings && !lower.includes('embed')) return;
      if (!isEmbeddings && lower.includes('embed')) return;
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m + (lower.includes('image') ? ' (image)' : '');
      select.appendChild(opt);
    });
    select.onchange = () => { this.selectedModel = select.value; };
  },

  async generateFromChat() {
    if (!this.currentAgent) { UI.showToast('Create or load an agent first', 'error'); return; }
    const messages = this.gatherAgentMessages();
    const model = this.selectedModel || document.getElementById('playgroundModelSelect')?.value || 'gpt-4';
    const r = await API.request('/admin/agents/generate', 'POST', { agent: this.currentAgent, messages, model });
    if (r.status === 200) {
      document.getElementById('agentMdEditor').value = r.data.content || '';
      UI.showToast('Agent model.md generated', 'success');
    } else {
      UI.showToast((r.data && r.data.error) || 'Generate failed', 'error');
    }
  },

  gatherAgentMessages() {
    const msgs = [];
    const input = document.getElementById('agentChatInput');
    const text = input.value && input.value.trim();
    if (text) msgs.push({ role: 'user', content: text });
    return msgs;
  },

  async sendAgentChat() {
    const text = document.getElementById('agentChatInput').value.trim();
    if (!text) return; 
    if (!this.currentAgent) { UI.showToast('Load an agent first', 'error'); return; }
    if (!this.selectedKey) { UI.showToast('Select an API key in Playground to test', 'error'); return; }
    const model = this.selectedModel || document.getElementById('playgroundModelSelect')?.value;
    document.getElementById('agentChatInput').value = '';
    const msgs = [{ role: 'user', content: text }];
    const list = document.getElementById('agentChatMessages');
    this.appendChatMessage('user', text, list);
    this.appendTyping(list);
    try {
      const r = await API.request(`/admin/agents/${encodeURIComponent(this.currentAgent)}/chat`, 'POST', { key_id: this.selectedKey, model, messages: msgs });
      this.removeTyping(list);
      if (r.status !== 200) { UI.showToast((r.data && r.data.error) || 'Agent chat failed', 'error'); return; }
      const assistant = r.data && r.data.choices && r.data.choices[0] && r.data.choices[0].message;
      this.appendChatMessage('assistant', assistant || { content: 'No response' }, list);
    } catch (e) {
      this.removeTyping(list);
      UI.showToast('Network error', 'error');
    }
  },

  appendChatMessage(role, content, container) {
    const div = document.createElement('div');
    div.className = 'chat-message';
    let textContent = '';
    let imagesHtml = '';
    if (typeof content === 'string') {
      textContent = content;
    } else if (content && typeof content === 'object') {
      textContent = content.content || '';
      if (Array.isArray(content.images) && content.images.length) {
        const filenameFromUrl = (url) => {
          if (!url) return 'image.png';
          if (url.startsWith('data:')) {
            const m = url.match(/^data:image\/([a-zA-Z0-9+.-]+);/);
            const ext = m ? m[1] : 'png';
            return `image.${ext}`;
          }
          try {
            const u = new URL(url);
            const name = u.pathname.split('/').pop();
            return name || 'image.png';
          } catch (e) {
            const parts = url.split('/');
            return parts[parts.length - 1].split('?')[0] || 'image.png';
          }
        };
        const imgs = content.images.map(im => {
          let url = '';
          if (im && im.image_url) url = im.image_url.url || im.image_url;
          else if (im && im.url) url = im.url;
          else url = im;
          const name = filenameFromUrl(url);
          return `<a class="img-link" href="${this.escapeHtml(url)}" target="_blank" rel="noopener noreferrer" download="${this.escapeHtml(name)}"><img src="${this.escapeHtml(url)}" alt="image" loading="lazy"/><span class=\"img-download\">⬇</span></a>`;
        }).join('');
        imagesHtml = `<div class="message-images">${imgs}</div>`;
      }
    }
    const text = role === 'user' ? this.escapeHtml(textContent) : this.renderMarkdown(textContent);
    const avatarSvg = role === 'user' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/></svg>';
    div.innerHTML = `<div class="message-header"><div class="message-avatar ${role}">${avatarSvg}</div><span class="message-sender">${role === 'user' ? 'You' : 'Agent'}</span></div><div class="message-text">${text}${imagesHtml}</div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  },

  appendTyping(container) {
    const indicator = document.createElement('div');
    indicator.className = 'typing-indicator';
    indicator.innerHTML = '<div class="typing-dots"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>';
    container.appendChild(indicator);
    container.scrollTop = container.scrollHeight;
  },

  removeTyping(container) {
    const indicator = container.querySelector('.typing-indicator');
    if (indicator) indicator.remove();
  },

  setupEditorHandlers() {
    document.getElementById('createAgentBtn').onclick = () => this.createOrLoad();
    document.getElementById('deleteAgentBtn').onclick = () => this.deleteAgent();
    document.getElementById('saveAgentBtn').onclick = () => this.saveAgent();
    document.getElementById('generateAgentBtn').onclick = () => this.generateFromChat();
    document.getElementById('previewAgentBtn').onclick = () => {
      const v = document.getElementById('agentMdEditor').value;
      const el = document.getElementById('agentMdEditor');
      try { document.getElementById('agentMdEditor').value = v; } catch (e) {}
      UI.showToast('Preview is inline (markdown rendered in chat)', 'success');
    };
    document.getElementById('openMdBtn').onclick = () => { if (!this.currentAgent) return; const url = `/admin/agents/raw/${encodeURIComponent(this.currentAgent)}`; window.open(url, '_blank'); };
    document.querySelector('.ai-builder-trigger').onclick = () => this.openAIBuilder();
  },

  setupTabHandlers() {
    document.querySelectorAll('.agent-tab').forEach(tab => {
      tab.onclick = () => this.switchTab(tab.dataset.tab);
    });
  },

  switchTab(tabName) {
    document.querySelectorAll('.agent-tab').forEach(tab => {
      tab.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    document.querySelectorAll('.agent-tab-content').forEach(content => {
      content.classList.remove('active');
    });
    document.getElementById(`${tabName}-tab`).classList.add('active');

    if (tabName === 'settings') {
      this.loadAgentSettings();
    }
  },

  setupSettingsHandlers() {
    document.getElementById('saveAgentSettingsBtn').onclick = () => this.saveAgentSettings();
    document.getElementById('resetAgentSettingsBtn').onclick = () => this.resetAgentSettings();
    document.getElementById('deleteAgentSettingsBtn').onclick = () => this.deleteAgent();
  },

  loadAgentSettings() {
    if (!this.currentAgent) return;

    document.getElementById('agentNameSetting').value = this.currentAgent;
    document.getElementById('agentModelSetting').value = this.selectedModel || '';
    document.getElementById('agentKeySetting').value = this.selectedKey || '';
    document.getElementById('agentSystemPrompt').value = this.mdContent;

    document.getElementById('agentTemperature').value = '0.7';
    document.getElementById('agentMaxTokens').value = '2048';

    this.populateSettingsKeySelect();
    this.populateSettingsModelSelect();
  },

  async populateSettingsKeySelect() {
    const res = await API.request('/admin/user-keys');
    const select = document.getElementById('agentKeySetting');
    if (!select) return;
    select.innerHTML = '<option value="">Select API Key</option>';
    if (res.status !== 200) return;
    (res.data || []).forEach(k => {
      const opt = document.createElement('option');
      opt.value = k.id;
      opt.textContent = k.name || k.key;
      select.appendChild(opt);
    });
  },

  async populateSettingsModelSelect() {
    const res = await API.request('/models');
    const select = document.getElementById('agentModelSetting');
    if (!select) return;
    select.innerHTML = '<option value="">Select model</option>';
    if (res.status !== 200 || !res.data || !res.data.models) return;
    (res.data.models || []).forEach(m => {
      const lower = (m || '').toLowerCase();
      const isEmbeddings = false;
      if (isEmbeddings && !lower.includes('embed')) return;
      if (!isEmbeddings && lower.includes('embed')) return;
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m + (lower.includes('image') ? ' (image)' : '');
      select.appendChild(opt);
    });
  },

  async saveAgentSettings() {
    if (!this.currentAgent) {
      UI.showToast('No agent selected', 'error');
      return;
    }

    const name = document.getElementById('agentNameSetting').value.trim();
    const model = document.getElementById('agentModelSetting').value;
    const key = document.getElementById('agentKeySetting').value;
    const temperature = parseFloat(document.getElementById('agentTemperature').value) || 0.7;
    const maxTokens = parseInt(document.getElementById('agentMaxTokens').value) || 2048;
    const systemPrompt = document.getElementById('agentSystemPrompt').value;

    this.selectedModel = model;
    this.selectedKey = key;

    const r = await API.request(`/admin/agents/${encodeURIComponent(this.currentAgent)}`, 'PUT', { content: systemPrompt });
    if (r.status === 200) {
      this.mdContent = systemPrompt;
      document.getElementById('agentMdEditor').value = systemPrompt;
      UI.showToast('Agent settings saved', 'success');
    } else {
      UI.showToast('Failed to save settings', 'error');
    }
  },

  resetAgentSettings() {
    if (!this.currentAgent) return;
    this.loadAgentSettings();
    UI.showToast('Settings reset to current values', 'success');
  },

  openAIBuilder() {
    const modal = document.getElementById('ai-builder-modal');
    if (modal) {
      modal.style.display = 'flex';
      const currentContent = document.getElementById('agentMdEditor').value;
      document.getElementById('ai-builder-prompt').value = currentContent;
    }
  },

  closeAIBuilder() {
    const modal = document.getElementById('ai-builder-modal');
    if (modal) {
      modal.style.display = 'none';
    }
  },

  async generateAIBuilder() {
    const prompt = document.getElementById('ai-builder-prompt').value.trim();
    if (!prompt) {
      UI.showToast('Please enter a prompt for the AI builder', 'error');
      return;
    }

    const generateBtn = document.getElementById('ai-builder-generate-btn');
    const originalText = generateBtn.innerHTML;
    generateBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Generating...';
    generateBtn.disabled = true;

    try {
      const r = await API.request('/admin/agents/generate', 'POST', { 
        agent: 'ai-builder-temp',
        messages: [{ role: 'user', content: prompt }],
        model: 'gpt-4'
      });

      if (r.status === 200) {
        let content = r.data.content || 'No content generated';
        content = content.replace(/^```markdown\s*\n?/gm, '').replace(/^```\s*\n?/gm, '').trim();
        document.getElementById('ai-builder-output').value = content;
        UI.showToast('AI Builder generated successfully', 'success');
      } else {
        UI.showToast('Failed to generate AI builder content', 'error');
      }
    } catch (e) {
      UI.showToast('Network error during generation', 'error');
    } finally {
      generateBtn.innerHTML = originalText;
      generateBtn.disabled = false;
    }
  },

  copyAIBuilderOutput() {
    const output = document.getElementById('ai-builder-output').value;
    if (!output.trim()) {
      UI.showToast('No content to copy', 'error');
      return;
    }

    navigator.clipboard.writeText(output).then(() => {
      UI.showToast('Content copied to clipboard', 'success');
    }).catch(() => {
      UI.showToast('Failed to copy content', 'error');
    });
  },

  applyAIBuilderOutput() {
    const output = document.getElementById('ai-builder-output').value.trim();
    if (!output) {
      UI.showToast('No content to apply', 'error');
      return;
    }

    document.getElementById('agentMdEditor').value = output;
    this.mdContent = output;
    
    this.closeAIBuilder();
    
    UI.showToast('Content applied to agent editor', 'success');
  },

  useExample(exampleText) {
    document.getElementById('ai-builder-prompt').value = exampleText;
    UI.showToast('Example loaded into prompt', 'success');
  },

  renderMarkdown(text) { 
    if (typeof marked !== 'undefined') {
      try {
        let mathBlocks = [];
        let idx = 0;
        text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => { const key = `@@MATH${idx++}@@`; mathBlocks.push({ key, content: m, display: true }); return key; });
        text = text.replace(/\$([^\$\n]+?)\$/g, (_, m) => { const key = `@@MATH${idx++}@@`; mathBlocks.push({ key, content: m, display: false }); return key; });
        let html = marked.parse(text);
        if (typeof katex !== 'undefined') {
          mathBlocks.forEach(b => {
            try { const k = katex.renderToString(b.content, { throwOnError: false, displayMode: b.display }); html = html.split(b.key).join(k); } catch (e) { html = html.split(b.key).join(this.escapeHtml(b.content)); }
          });
        } else {
          mathBlocks.forEach(b => { html = html.split(b.key).join(this.escapeHtml(b.content)); });
        }
        return html;
      } catch (e) {
        return marked.parse(text);
      }
    }
    return this.escapeHtml(text);
  },
  escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
};

const Users = {
  users: [],

  async loadUsers() {
    const result = await API.request('/admin/users');
    if (result.status === 200) {
      this.users = result.data || [];
      this.renderTable();
    }
  },

  renderTable() {
    const tbody = document.querySelector('#usersTable tbody');
    const emptyState = document.getElementById('usersEmptyState');
    
    tbody.innerHTML = '';
    
    if (this.users.length === 0) {
      emptyState.style.display = 'block';
      return;
    }
    
    emptyState.style.display = 'none';
    
    this.users.forEach(user => {
      const row = document.createElement('tr');
      const created = new Date(user.created_at).toLocaleDateString();
      const ultimateState = Boolean(user.ultimate_enabled);
      const statusTitle = ultimateState ? 'Ultimate engedélyezve' : 'Ultimate letiltva';
      const statusHint = ultimateState ? 'Ultimate mód és ensemble funkciók elérhetőek.' : 'Nincs hozzáférés Ultimate módhoz.';
      const actionLabel = ultimateState ? 'Letiltás' : 'Engedélyezés';
      
      row.innerHTML = `
        <td><strong>${this.escapeHtml(user.name)}</strong></td>
        <td>${this.escapeHtml(user.email)}</td>
        <td>${created}</td>
        <td>${user.key_id || '-'}</td>
        <td>
          <div class="ultimate-cell ${ultimateState ? 'active' : ''}">
            <div class="ultimate-status">
              <span class="ultimate-status-dot"></span>
              <div class="ultimate-status-text">
                <strong>${statusTitle}</strong>
                <span>${statusHint}</span>
              </div>
            </div>
            <button class="ultimate-toggle" data-id="${user.id}" data-enabled="${ultimateState ? '1' : '0'}">
              ${actionLabel}
            </button>
          </div>
        </td>
        <td>
          <div class="table-actions">
            <button class="btn-delete" data-id="${user.id}">Delete</button>
          </div>
        </td>
      `;
      
      tbody.appendChild(row);
    });
    
    tbody.querySelectorAll('.btn-delete').forEach(btn => {
      btn.onclick = () => this.deleteUser(btn.dataset.id);
    });
    tbody.querySelectorAll('.ultimate-toggle').forEach(btn => {
      btn.onclick = () => this.toggleUltimate(btn.dataset.id, btn.dataset.enabled === '1');
    });
  },

  async deleteUser(uid) {
    const user = this.users.find(u => u.id == uid);
    if (!user || !confirm(`Delete user "${user.name}" (${user.email})?`)) return;
    
    const result = await API.request(`/admin/users/${uid}`, 'DELETE');
    if (result.status === 200) {
      UI.showToast('User deleted successfully', 'success');
      this.loadUsers();
    } else {
      UI.showToast('Failed to delete user', 'error');
    }
  },

  async toggleUltimate(uid, currentlyEnabled) {
    const newState = !currentlyEnabled;
    const result = await API.request(`/admin/users/${uid}/ultimate`, 'PUT', { enabled: newState });
    if (result.status === 200) {
      UI.showToast(newState ? 'Ultimate engedélyezve' : 'Ultimate letiltva', 'success');
      this.loadUsers();
    } else {
      UI.showToast('Ultimate frissítése sikertelen', 'error');
    }
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

const Navigation = {
  init() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.onclick = (e) => {
        e.preventDefault();
        const targetId = item.getAttribute('href').substring(1);
        this.navigateTo(targetId);
      };
    });
  },
  
  navigateTo(sectionId) {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    
    const navItem = document.querySelector(`[href="#${sectionId}"]`);
    const section = document.getElementById(sectionId);
    
    if (navItem && section) {
      navItem.classList.add('active');
      section.classList.add('active');
      
      if (sectionId === 'cors-settings') {
        CorsSettings.loadSettings();
      } else if (sectionId === 'playground') {
        Playground.init();
        setTimeout(() => Playground.attachSuggestionHandlers(), 100);
      } else if (sectionId === 'agent-builder') {
        AgentBuilder.init();
      } else if (sectionId === 'users') {
        Users.loadUsers();
      } else if (sectionId === 'whitelist') {
        Whitelist.loadSettings();
      }
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  UI.init();
  
  document.getElementById('loginBtn').onclick = () => Auth.login();
  document.getElementById('logoutBtn').onclick = () => Auth.logout();
  document.getElementById('logoutBtnTop').onclick = () => Auth.logout();
  
  document.getElementById('userKeyForm').onsubmit = (e) => UserKeys.saveKey(e);
  document.getElementById('userCancelBtn').onclick = () => {
    UI.clearForm();
    UI.showToast('Edit cancelled', 'success');
  };
  
  document.getElementById('corsForm').onsubmit = (e) => CorsSettings.saveSettings(e);
  
  document.getElementById('whitelistForm').onsubmit = (e) => Whitelist.saveSettings(e);
  
  document.getElementById('addOriginBtn').onclick = () => {
    const input = document.getElementById('newOriginInput');
    CorsSettings.addOrigin(input.value);
  };
  
  document.getElementById('newOriginInput').onkeypress = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      CorsSettings.addOrigin(e.target.value);
    }
  };
  
  document.querySelectorAll('.origin-quick-add').forEach(cb => {
    cb.onchange = (e) => {
      if (e.target.checked) {
        CorsSettings.addOrigin(e.target.dataset.value);
      } else {
        const index = CorsSettings.origins.indexOf(e.target.dataset.value);
        if (index > -1) {
          CorsSettings.removeOrigin(index);
        }
      }
    };
  });
  
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.onclick = () => CorsSettings.applyPreset(btn.dataset.preset);
  });
  
  document.querySelectorAll('.method-helper').forEach(cb => {
    cb.onchange = () => CorsSettings.updateFromCheckboxes('method');
  });
  
  document.querySelectorAll('.header-helper').forEach(cb => {
    cb.onchange = () => CorsSettings.updateFromCheckboxes('header');
  });
  
  document.getElementById('rate_limit_enabled').onchange = (e) => {
    document.getElementById('user_rate').disabled = !e.target.checked;
    document.getElementById('user_rate_period').disabled = !e.target.checked;
    if (e.target.checked) document.getElementById('user_rate').focus();
  };
  
  document.getElementById('token_limit_enabled').onchange = (e) => {
    document.getElementById('user_tokens').disabled = !e.target.checked;
    document.getElementById('user_token_period').disabled = !e.target.checked;
    if (e.target.checked) document.getElementById('user_tokens').focus();
  };
  
  document.getElementById('password').onkeypress = (e) => {
    if (e.key === 'Enter') Auth.login();
  };
  
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.onclick = () => {
      const keyModal = document.getElementById('keyModal');
      const keyStatsModal = document.getElementById('keyStatsModal');
      if (keyModal) keyModal.style.display = 'none';
      if (keyStatsModal) keyStatsModal.style.display = 'none';
    };
  });
  document.getElementById('modalCloseBtn').onclick = () => UI.hideModal();
  
  document.getElementById('copyKeyBtn').onclick = () => {
    const key = document.getElementById('generatedKey').textContent;
    navigator.clipboard.writeText(key).then(() => {
      UI.showToast('API key copied to clipboard', 'success');
    });
  };
  
  document.getElementById('themeToggle').onclick = () => UI.toggleTheme();
  
  document.getElementById('playgroundKeySelect').onchange = () => Playground.onKeyChange();
  document.getElementById('playgroundModelSelect').onchange = () => Playground.onModelChange();
  document.getElementById('playgroundModelSelectB').onchange = () => Playground.onModelBChange();
  document.getElementById('playgroundModeSelect').onchange = () => Playground.onModeChange();
  document.getElementById('compareToggle').onchange = () => Playground.onCompareChange();
  document.getElementById('sendMessageBtn').onclick = () => Playground.sendMessage();
  document.getElementById('newChatBtn').onclick = () => Playground.newChat();
  document.getElementById('chatInput').onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      Playground.sendMessage();
    }
  };
  document.getElementById('chatInput').oninput = () => Playground.updateSendButton();
  const settingsToggle = document.getElementById('settingsToggle');
  if (settingsToggle) settingsToggle.onclick = () => Playground.toggleMobileSettings();
  
  const aiBuilderClose = document.querySelector('.ai-builder-modal-close');
  if (aiBuilderClose) aiBuilderClose.onclick = () => AgentBuilder.closeAIBuilder();
  
  const aiBuilderGenerate = document.getElementById('ai-builder-generate-btn');
  if (aiBuilderGenerate) aiBuilderGenerate.onclick = () => AgentBuilder.generateAIBuilder();
  
  const aiBuilderCopy = document.getElementById('ai-builder-copy-btn');
  if (aiBuilderCopy) aiBuilderCopy.onclick = () => AgentBuilder.copyAIBuilderOutput();
  
  const aiBuilderApply = document.getElementById('ai-builder-apply-btn');
  if (aiBuilderApply) aiBuilderApply.onclick = () => AgentBuilder.applyAIBuilderOutput();
  
  document.querySelectorAll('.ai-builder-use-example').forEach(btn => {
    btn.onclick = (e) => AgentBuilder.useExample(e.target.closest('.ai-builder-example-card').querySelector('p').textContent);
  });
  
  Navigation.init();
  Auth.checkAuth();
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  Navigation.navigateTo('overview');
  window.addEventListener('resize', () => {
    Playground.adaptSettingsForMobile();
    
  });
});