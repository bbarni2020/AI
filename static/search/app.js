let currentType = 'web';
let currentQuery = '';

const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const resultsDiv = document.getElementById('results');
const loadingDiv = document.getElementById('loading');
const errorDiv = document.getElementById('error');
const tabs = document.querySelectorAll('.tab');
const freshnessFilter = document.getElementById('freshnessFilter');

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentType = tab.dataset.type;
        
        if (currentType === 'web' || currentType === 'videos' || currentType === 'news') {
            freshnessFilter.style.display = 'inline-block';
        } else {
            freshnessFilter.style.display = 'none';
        }
        
        if (currentQuery) {
            performSearch();
        }
    });
});

searchBtn.addEventListener('click', performSearch);
searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        performSearch();
    }
});

freshnessFilter.addEventListener('change', () => {
    if (currentQuery) {
        performSearch();
    }
});

async function performSearch() {
    currentQuery = searchInput.value.trim();
    if (!currentQuery) return;
    
    resultsDiv.innerHTML = '';
    errorDiv.style.display = 'none';
    loadingDiv.style.display = 'block';
    
    const params = new URLSearchParams({ q: currentQuery });
    const freshness = freshnessFilter.value;
    if (freshness && (currentType === 'web' || currentType === 'videos' || currentType === 'news')) {
        params.append('freshness', freshness);
    }
    
    try {
        const response = await fetch(`/api/search/${currentType}?${params}`);
        const data = await response.json();
        
        loadingDiv.style.display = 'none';
        
        if (!response.ok) {
            showError(data.error || 'Search failed');
            return;
        }
        
        renderResults(data);
    } catch (err) {
        loadingDiv.style.display = 'none';
        showError('Network error: ' + err.message);
    }
}

function showError(message) {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}

function renderResults(data) {
    if (currentType === 'web') {
        renderWebResults(data);
    } else if (currentType === 'images') {
        renderImageResults(data);
    } else if (currentType === 'videos') {
        renderVideoResults(data);
    } else if (currentType === 'news') {
        renderNewsResults(data);
    }
}

function renderWebResults(data) {
    const results = data.web?.results || [];
    if (results.length === 0) {
        resultsDiv.innerHTML = '<p class="no-results">No results found</p>';
        return;
    }
    
    resultsDiv.innerHTML = results.map(result => `
        <div class="result-item web-result">
            <a href="${escapeHtml(result.url)}" target="_blank" class="result-title">
                ${escapeHtml(result.title)}
            </a>
            <div class="result-url">${escapeHtml(result.url)}</div>
            <div class="result-description">${escapeHtml(result.description || '')}</div>
        </div>
    `).join('');
}

function renderImageResults(data) {
    const results = data.results || [];
    if (results.length === 0) {
        resultsDiv.innerHTML = '<p class="no-results">No results found</p>';
        return;
    }
    
    resultsDiv.innerHTML = '<div class="image-grid">' + results.map(result => `
        <div class="image-item">
            <a href="${escapeHtml(result.url)}" target="_blank">
                <img src="${escapeHtml(result.thumbnail?.src || result.properties?.url)}" 
                     alt="${escapeHtml(result.title || '')}"
                     loading="lazy">
            </a>
            <div class="image-title">${escapeHtml(result.title || '')}</div>
        </div>
    `).join('') + '</div>';
}

function renderVideoResults(data) {
    const results = data.results || [];
    if (results.length === 0) {
        resultsDiv.innerHTML = '<p class="no-results">No results found</p>';
        return;
    }
    
    resultsDiv.innerHTML = results.map(result => `
        <div class="result-item video-result">
            <div class="video-container">
                ${result.thumbnail?.src ? 
                    `<img src="${escapeHtml(result.thumbnail.src)}" alt="${escapeHtml(result.title)}" class="video-thumb">` 
                    : ''}
                <div class="video-info">
                    <a href="${escapeHtml(result.url)}" target="_blank" class="result-title">
                        ${escapeHtml(result.title)}
                    </a>
                    <div class="video-meta">
                        ${result.video?.creator ? `<span>${escapeHtml(result.video.creator)}</span>` : ''}
                        ${result.video?.duration ? `<span>${escapeHtml(result.video.duration)}</span>` : ''}
                        ${result.video?.views ? `<span>${formatNumber(result.video.views)} views</span>` : ''}
                        ${result.age ? `<span>${escapeHtml(result.age)}</span>` : ''}
                    </div>
                    <div class="result-description">${escapeHtml(result.description || '')}</div>
                </div>
            </div>
        </div>
    `).join('');
}

function renderNewsResults(data) {
    const results = data.results || [];
    if (results.length === 0) {
        resultsDiv.innerHTML = '<p class="no-results">No results found</p>';
        return;
    }
    
    resultsDiv.innerHTML = results.map(result => `
        <div class="result-item news-result">
            <div class="news-container">
                ${result.thumbnail?.src ? 
                    `<img src="${escapeHtml(result.thumbnail.src)}" alt="${escapeHtml(result.title)}" class="news-thumb">` 
                    : ''}
                <div class="news-info">
                    ${result.breaking ? '<span class="breaking-badge">BREAKING</span>' : ''}
                    <a href="${escapeHtml(result.url)}" target="_blank" class="result-title">
                        ${escapeHtml(result.title)}
                    </a>
                    <div class="news-meta">
                        ${result.meta_url?.hostname ? `<span>${escapeHtml(result.meta_url.hostname)}</span>` : ''}
                        ${result.age ? `<span>${escapeHtml(result.age)}</span>` : ''}
                    </div>
                    <div class="result-description">${escapeHtml(result.description || '')}</div>
                </div>
            </div>
        </div>
    `).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}
