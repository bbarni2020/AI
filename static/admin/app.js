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
    document.getElementById('statsKeys').textContent = this.currentKeys.length;
    await this.loadUsageData();
  },
  
  async loadUsageData() {
    try {
      const result = await API.request('/admin/usage');
      if (result.status === 200 && result.data) {
        this.renderChart(result.data);
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
        ? `${key.rate_limit_per_min}/min` 
        : '<span class="text-muted">None</span>';
      
      const tokenLimit = key.token_limit_enabled 
        ? `${key.token_limit_per_day}/day` 
        : '<span class="text-muted">None</span>';
      
      const created = new Date(key.created_at).toLocaleDateString();
      
      row.innerHTML = `
        <td><strong>${this.escapeHtml(key.name)}</strong></td>
        <td><code class="key-code">${this.escapeHtml(key.key)}</code></td>
        <td>${rateLimit}</td>
        <td>${tokenLimit}</td>
        <td><span class="status-badge ${statusClass}">${statusText}</span></td>
        <td>${created}</td>
        <td>
          <div class="table-actions">
            <button class="btn-edit" data-id="${key.id}">Edit</button>
            <button class="btn-delete" data-id="${key.id}">Delete</button>
          </div>
        </td>
      `;
      
      tbody.appendChild(row);
    });
    
    tbody.querySelectorAll('.btn-edit').forEach(btn => {
      btn.onclick = () => this.editKey(btn.dataset.id);
    });
    
    tbody.querySelectorAll('.btn-delete').forEach(btn => {
      btn.onclick = () => this.deleteKey(btn.dataset.id);
    });
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
      rate_limit_per_min: rateLimitEnabled ? (parseInt(document.getElementById('user_rate').value) || 0) : 0,
      token_limit_enabled: tokenLimitEnabled,
      token_limit_per_day: tokenLimitEnabled ? (parseInt(document.getElementById('user_tokens').value) || 0) : 0
    };
    
    if (!keyData.name) {
      UI.showToast('Key name is required', 'error');
      return;
    }
    
    if (rateLimitEnabled && keyData.rate_limit_per_min < 1) {
      UI.showToast('Rate limit must be at least 1', 'error');
      return;
    }
    
    if (tokenLimitEnabled && keyData.token_limit_per_day < 1) {
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
    document.getElementById('user_rate').value = key.rate_limit_per_min || '';
    document.getElementById('user_rate').disabled = !key.rate_limit_enabled;
    
    document.getElementById('token_limit_enabled').checked = key.token_limit_enabled;
    document.getElementById('user_tokens').value = key.token_limit_per_day || '';
    document.getElementById('user_tokens').disabled = !key.token_limit_enabled;
    
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
      }
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  UI.init();
  
  document.getElementById('loginBtn').onclick = () => Auth.login();
  document.getElementById('logoutBtn').onclick = () => Auth.logout();
  
  document.getElementById('userKeyForm').onsubmit = (e) => UserKeys.saveKey(e);
  document.getElementById('userCancelBtn').onclick = () => {
    UI.clearForm();
    UI.showToast('Edit cancelled', 'success');
  };
  
  document.getElementById('corsForm').onsubmit = (e) => CorsSettings.saveSettings(e);
  
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
    if (e.target.checked) document.getElementById('user_rate').focus();
  };
  
  document.getElementById('token_limit_enabled').onchange = (e) => {
    document.getElementById('user_tokens').disabled = !e.target.checked;
    if (e.target.checked) document.getElementById('user_tokens').focus();
  };
  
  document.getElementById('password').onkeypress = (e) => {
    if (e.key === 'Enter') Auth.login();
  };
  
  document.querySelector('.modal-close').onclick = () => UI.hideModal();
  document.getElementById('modalCloseBtn').onclick = () => UI.hideModal();
  
  document.getElementById('copyKeyBtn').onclick = () => {
    const key = document.getElementById('generatedKey').textContent;
    navigator.clipboard.writeText(key).then(() => {
      UI.showToast('API key copied to clipboard', 'success');
    });
  };
  
  document.getElementById('themeToggle').onclick = () => UI.toggleTheme();
  
  Navigation.init();
  Auth.checkAuth();
});