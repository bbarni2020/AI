const App = {
  currentTheme: localStorage.getItem('theme') || 'light',
  
  init() {
    this.applyTheme();
    this.setupEventListeners();
    this.setupNavigation();
    this.loadStats();
  },
  
  applyTheme() {
    document.documentElement.setAttribute('data-theme', this.currentTheme);
  },
  
  toggleTheme() {
    this.currentTheme = this.currentTheme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', this.currentTheme);
    this.applyTheme();
  },
  
  setupEventListeners() {
    document.getElementById('themeToggle').onclick = () => this.toggleTheme();
    
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const textToCopy = btn.dataset.copy;
        navigator.clipboard.writeText(textToCopy).then(() => {
          this.showToast('Copied to clipboard');
        });
      };
    });
  },
  
  setupNavigation() {
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
    }
  },
  
  async loadStats() {
    try {
      const response = await fetch('/api/stats', {
        credentials: 'include'
      });
      
      if (response.ok) {
        const stats = await response.json();
        document.getElementById('statsKeys').textContent = stats.keys || 0;
        document.getElementById('statsRequests').textContent = this.formatNumber(stats.requests || 0);
        document.getElementById('statsTokens').textContent = this.formatNumber(stats.tokens || 0);
      }
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  },
  
  formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  },
  
  showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast success show';
    setTimeout(() => toast.classList.remove('show'), 2000);
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
