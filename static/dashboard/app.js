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
        if (stats.graph) this.renderUsageGraph(stats.graph);
      }
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  },

  renderUsageGraph(arr) {
    const c = document.getElementById('usageChart');
    if (!c) return;
    const ctx = c.getContext('2d');
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0,0,w,h);
    const pad = 30;
    const maxTokens = Math.max(...arr.map(x=>x.tokens),1);
    const maxReq = Math.max(...arr.map(x=>x.requests),1);
    const barW = (w - pad*2) / arr.length * 0.5;
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#666';
    ctx.fillText('Tokens', pad, 12);
    ctx.fillText('Requests', pad+70, 12);
    arr.forEach((d,i)=>{
      const xBase = pad + i * (w - pad*2) / arr.length + ((w - pad*2) / arr.length - barW*2)/2;
      const hTokens = (d.tokens / maxTokens) * (h - pad*2);
      const hReq = (d.requests / maxReq) * (h - pad*2);
      ctx.fillStyle = '#2d7ef0';
      ctx.fillRect(xBase, h - pad - hTokens, barW, hTokens);
      ctx.fillStyle = '#f0a22d';
      ctx.fillRect(xBase+barW, h - pad - hReq, barW, hReq);
      ctx.fillStyle = '#444';
      ctx.textAlign = 'center';
      ctx.fillText(d.date.slice(5), xBase+barW, h - 8);
    });
    ctx.strokeStyle = '#ccc';
    ctx.beginPath();
    ctx.moveTo(pad, h - pad);
    ctx.lineTo(w - pad, h - pad);
    ctx.stroke();
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
