const INJECTED = window.XUDO_CONFIG || {};
const CONFIG = {
    AUTHORITY_DOMAIN: INJECTED.authority || window.location.hostname, 
    get AUTHORITY_URL() { return 'https://' + this.AUTHORITY_DOMAIN; },
    IS_LOCALHOST: ['localhost', '127.0.0.1'].includes(window.location.hostname),
    isAuthority: function() { return window.location.hostname === this.AUTHORITY_DOMAIN; }
};

const TEXTS = {
    allGenres: "All Categories", contWatch: "Recently Read", clearHistory: "Clear All", loadMore: "Load More",
    heroBtn: "READ FULL STORY", trending: "BREAKING", viewMore: "View More", confirmClear: "Are you sure?",
    newsGeneral: "Top Headlines", newsTech: "Technology", newsBusiness: "Business", newsSports: "Sports"
};

let currentPage = 1, isLoading = false;
let currentBrowseEndpoint = 'general', searchDebounceTimer;
let LOCAL_SEARCH_INDEX = []; 
let isSearchIndexLoaded = false;
const ITEMS_PER_PAGE = 20;
const renderedArticleIds = new Set();

// --- NEW NYT API CONFIGURATION ---
const API_KEY = INJECTED.apiKey || 'WxLcHPZMAnPr7JCDVtzK751MT2Opabd2LPE5STekNykANA7z'; 
const BASE_URL_TOP_STORIES = 'https://api.nytimes.com/svc/topstories/v2';
const BASE_URL_SEARCH = 'https://api.nytimes.com/svc/search/v2';

// Mapping existing local categories to NYT valid sections
const NYT_SECTION_MAP = {
    'general': 'home', 'world': 'world', 'nation': 'us', 
    'business': 'business', 'technology': 'technology', 
    'entertainment': 'arts', 'sports': 'sports', 
    'science': 'science', 'health': 'health'
};

/**
 * Normalizes NYT API response objects into a consistent format.
 * Handles both Top Stories and Article Search API structures safely.
 */
function normalizeNYTArticle(item, isSearch = false) {
    let normalized = {
        title: isSearch ? (item.headline?.main || 'No Title') : (item.title || 'No Title'),
        url: isSearch ? item.web_url : item.url,
        publishedAt: isSearch ? item.pub_date : item.published_date,
        description: item.abstract || item.snippet || '',
        source: { name: "The New York Times" }
    };
    normalized.id = generateId(normalized.url);
    
    // Extract image safely and robustly
    normalized.image = null;
    
    if (item.multimedia && item.multimedia.length > 0) {
        // Attempt to find a high-quality image first, fallback to the first available
        let targetMedia = item.multimedia.find(m => m.subtype === 'xlarge') || item.multimedia[0];
        let rawUrl = targetMedia.url;
        
        if (rawUrl) {
            if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
                normalized.image = rawUrl;
            } else {
                // Enterprise fix: NYT uses a dedicated CDN (static01.nyt.com) for relative image paths
                let separator = rawUrl.startsWith('/') ? '' : '/';
                normalized.image = 'https://static01.nyt.com' + separator + rawUrl;
            }
        }
    }
    return normalized;
}

/**
 * Generates a unique numeric ID from a string URL to maintain compatibility with legacy local storage functions.
 * @param {string} str - The URL string to hash.
 * @returns {number} The generated unique ID.
 */
function generateId(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash = hash & hash;
    }
    return Math.abs(hash);
}

/**
 * Sanitizes strings to prevent Cross-Site Scripting (XSS) when injecting HTML.
 * @param {string} str - The raw string.
 * @returns {string} Sanitized string safe for DOM insertion.
 */
function sanitizeHTML(str) {
    if (!str) return '';
    return str.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Sets or updates the canonical link tag for SEO purposes.
 */
function updateCanonical() {
    let link = document.querySelector("link[rel='canonical']") || document.createElement('link');
    link.rel = 'canonical';
    const staticCanonical = document.querySelector("link[rel='canonical']");
    if (staticCanonical && !CONFIG.IS_LOCALHOST && staticCanonical.href.includes(CONFIG.AUTHORITY_DOMAIN)) return;
    const relativePath = window.location.pathname + window.location.search;
    link.href = CONFIG.IS_LOCALHOST ? window.location.href : CONFIG.AUTHORITY_URL + relativePath;
    if (!link.parentNode) document.head.appendChild(link);
}

/**
 * Updates the document title and meta description dynamically.
 * @param {string} t - The title string.
 * @param {string} d - The description string.
 */
function updateSEOMeta(t, d) {
    document.title = sanitizeHTML(t);
    let m = document.querySelector('meta[name="description"]') || document.createElement('meta');
    m.name = 'description'; m.content = sanitizeHTML(d);
    if (!m.parentNode) document.head.appendChild(m);
}

/**
 * Initializes basic content protection by disabling context menu and dev tools shortcuts.
 */
function initContentProtection() {
    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('dragstart', e => e.preventDefault());
    document.addEventListener('keydown', e => {
        if (e.key === 'F12' || ((e.ctrlKey || e.metaKey) && ['I', 'i', 'J', 'j', 'C', 'c', 'U', 'u', 'S', 's', 'P', 'p'].includes(e.key))) {
            e.preventDefault(); return false;
        }
    });
}

/**
 * Loads the local JSON search index into memory to prevent duplicates.
 */
async function loadSearchIndex() {
    if (isSearchIndexLoaded) return;
    try {
        const timestamp = new Date().getTime();
        const res = await fetch(`search_index.json?v=${timestamp}`);
        if (res.ok) LOCAL_SEARCH_INDEX = await res.json();
        else {
            const res2 = await fetch(`../search_index.json?v=${timestamp}`);
            if(res2.ok) LOCAL_SEARCH_INDEX = await res2.json();
        }
        isSearchIndexLoaded = true;
    } catch (error) {}
}

/**
 * Saves the currently selected article data to local storage for the detail page.
 * @param {string} itemStr - The JSON stringified article object.
 */
window.saveCurrentArticle = function(itemStr) {
    localStorage.setItem('xudo_current_article', decodeURIComponent(itemStr));
};

/**
 * Initializes DOM events related to the search input field.
 */
function initSearchEvents() {
    const input = document.getElementById('search-input');
    if (!input) return;
    const q = new URLSearchParams(window.location.search).get('search');
    if (q) {
        input.value = sanitizeHTML(q);
        document.getElementById('clear-btn').classList.add('show-flex');
    }
    let drop = document.createElement('div');
    drop.id = 'search-dropdown'; drop.className = 'search-dropdown';
    document.querySelector('.search-wrapper').appendChild(drop);

    input.addEventListener('input', (e) => {
        document.getElementById('clear-btn').classList.toggle('show-flex', e.target.value.trim().length > 0);
        clearTimeout(searchDebounceTimer);
        const query = e.target.value.trim();
        if (query.length < 2) { drop.classList.remove('active'); return; }
        searchDebounceTimer = setTimeout(() => fetchLiveSearch(query), 300);
    });
    document.addEventListener('click', (e) => {
        if (!document.querySelector('.search-wrapper').contains(e.target)) drop.classList.remove('active');
    });
}

/**
 * Toggles the visibility of the search clear button based on input length.
 */
window.toggleClearButton = function() {
    const input = document.getElementById('search-input');
    document.getElementById('clear-btn').classList.toggle('show-flex', input.value.trim().length > 0);
};

/**
 * Fetches live search suggestions from the API as the user types.
 * @param {string} query - The search term.
 */
async function fetchLiveSearch(query) {
    const dropdown = document.getElementById('search-dropdown');
    try {
        // Switched to NYT Article Search API
        const res = await fetch(`${BASE_URL_SEARCH}/articlesearch.json?q=${encodeURIComponent(query)}&api-key=${API_KEY}`);
        const data = await res.json();
        
        // Safely extract docs array from NYT response and normalize
        const docs = data.response?.docs || [];
        const results = docs.map(i => normalizeNYTArticle(i, true)).slice(0, 8);

        if (results.length > 0) {
            dropdown.innerHTML = results.map(i => {
                const title = sanitizeHTML(i.title);
                const year = sanitizeHTML((i.publishedAt || '').split('T')[0] || 'N/A');
                const poster = i.image || 'https://placehold.co/40x60/222222/222222';
                const safeTitle = title.replace(/'/g, "\\'");
                const safePoster = poster.replace(/'/g, "\\'");
                const isFav = isFavorite(i.id);
                const targetLink = `article.html`;
                const itemStr = encodeURIComponent(JSON.stringify(i));
                
                const svgFill = '<svg viewBox="0 0 24 24"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>';
                const svgThin = '<svg viewBox="0 0 24 24"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
                const favSvg = isFav ? svgFill : svgThin;

                return `<div class="search-item"><a href="${targetLink}" onclick="saveCurrentArticle('${itemStr}')" class="search-item-link"><img src="${poster}" alt="${title}"><div class="search-item-info"><span class="search-item-title">${title}</span><span class="search-item-meta">${year} • NEWS</span></div></a><button class="search-fav-btn ${isFav?'active':''}" onclick="toggleFavorite(event, ${i.id}, 'news', '${safeTitle}', '${safePoster}', '${year}', '0')">${favSvg}</button></div>`;
            }).join('');
            dropdown.classList.add('active');
        } else {
            dropdown.classList.remove('active');
        }
    } catch (error) { 
        dropdown.classList.remove('active'); 
    }
}

/**
 * Clears the search input and hides the dropdown.
 */
window.clearSearch = function() {
    document.getElementById('search-input').value = '';
    document.getElementById('clear-btn').classList.remove('show-flex');
    document.getElementById('search-dropdown').classList.remove('active');
};

/**
 * Triggers the full search redirection to index page.
 */
window.executeSearch = function() {
    const q = document.getElementById('search-input').value.trim();
    // Removed legacy lang parameter, keeping compatibility
    if (q) window.location.href = `index.html?search=${encodeURIComponent(q)}`;
};

/**
 * Intercepts the Enter key to submit the search.
 * @param {Event} e - The keyboard event.
 */
window.handleEnter = function(e) { 
    if (e.key === 'Enter') executeSearch(); 
};

/**
 * Triggers native share functionality with Enterprise fallback logic.
 */
window.shareArticle = () => {
    // Attempt to grab canonical URL for statically generated pages
    const canonical = document.querySelector("link[rel='canonical']");
    let url = canonical && canonical.href !== window.location.href ? canonical.href : window.location.href;
    
    // Enterprise Fix: If sharing from dynamic article.html, share the original NYT source 
    // to prevent dead-links for peers (since they don't have the same localStorage).
    if (window.location.pathname.includes('article.html')) {
        const dataStr = localStorage.getItem('xudo_current_article');
        if (dataStr) {
            try { 
                const d = JSON.parse(dataStr); 
                if (d.url && d.url.startsWith('http')) url = d.url; 
            } catch(e) {}
        }
    }
    
    const title = document.title;
    if (navigator.share) return navigator.share({ title, text: `Read: ${title}`, url }).catch(() => {});
    navigator.clipboard.writeText(url).then(() => alert('Link copied!')).catch(() => prompt('Copy link:', url));
};

/**
 * Saves viewed items to LocalStorage for the 'Continue Reading' section.
 */
window.saveHistory = (id, type, title, poster, year, rating) => {
    let h = (JSON.parse(localStorage.getItem('xudo_history')) || []).filter(v => v.id != id);
    h.unshift({ id, type, title, poster, year: String(year || '????'), rating: +(rating || 0) });
    localStorage.setItem('xudo_history', JSON.stringify(h.slice(0, 20)));
};

/**
 * Clears local viewing history.
 */
window.clearHistory = () => {
    if (confirm(TEXTS.confirmClear)) {
        localStorage.removeItem('xudo_history');
        document.getElementById('continue-watching-section')?.remove();
    }
};

/**
 * Toggles an item in the user's local favorites list and updates the UI button.
 */
window.toggleFavorite = function(event, id, type, title, poster, year, rating) {
    event.preventDefault(); event.stopPropagation();
    let favs = JSON.parse(localStorage.getItem('xudo_favs')) || [];
    const index = favs.findIndex(f => f.id == id);
    const btn = event.currentTarget;

    const svgFill = '<svg viewBox="0 0 24 24"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>';
    const svgThin = '<svg viewBox="0 0 24 24"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z" fill="none" stroke="currentColor" stroke-width="1"/></svg>';

    if (index === -1) {
        favs.push({ id, type, title, poster, year, rating });
        btn.classList.add('active'); btn.innerHTML = svgFill;
    } else {
        favs.splice(index, 1);
        btn.classList.remove('active'); btn.innerHTML = svgThin;
    }
    localStorage.setItem('xudo_favs', JSON.stringify(favs));
};

/**
 * Checks if a specific ID exists in local favorites.
 */
function isFavorite(id) { 
    return (JSON.parse(localStorage.getItem('xudo_favs')) || []).some(f => f.id == id); 
}

/**
 * Automatically updates the history object when visiting a detail page.
 */
function updateContinueWatching(item) {
    let h = JSON.parse(localStorage.getItem('xudo_history')) || [];
    const id = item.id || generateId(item.url);
    h = h.filter(x => x.id !== id);
    h.unshift({
        id: id, type: 'news',
        title: item.title,
        poster: item.image || 'https://placehold.co/500x500/222222/222222',
        year: (item.publishedAt || '').split('T')[0], rating: 0
    });
    if (h.length > 20) h.pop();
    localStorage.setItem('xudo_history', JSON.stringify(h));
}

/**
 * Renders loading skeleton animations in the given container.
 */
function renderSkeletons(id, c) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = Array(c).fill('<div class="skeleton-card skeleton"></div>').join('');
}

/**
 * Generates the HTML string for an article card component.
 */
function createCardHTML(item) {
    item.id = item.id || generateId(item.url || item.title);
    const title = sanitizeHTML(item.title);
    const date = item.publishedAt || item.year || '????';
    const displayDate = date.split('T')[0];
    const poster = item.image || item.poster_path || item.poster || 'https://placehold.co/400x600/222222/222222';
    const isFav = isFavorite(item.id);
    
    const sT = title.replace(/'/g, "\\'");
    const sP = poster.replace(/'/g, "\\'");
    const itemStr = encodeURIComponent(JSON.stringify(item));
    let targetLink = `article.html`;
    if (item.url && !item.url.startsWith('http')) {
    targetLink = item.url;
}

    const SVG_ON = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"></path></svg>';
    const SVG_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"></path></svg>';

    return `<div class="content-card" onclick="saveCurrentArticle('${itemStr}'); location.href='${targetLink}'">
        <button class="card-fav-btn ${isFav?'active':''}" onclick="toggleFavorite(event, ${item.id}, 'news', '${sT}', '${sP}', '${displayDate}', '0')">${isFav ? SVG_ON : SVG_OFF}</button>
        <img src="${poster}" alt="${title}" loading="lazy" onerror="this.src='https://placehold.co/400x600/1a1a1a/ffffff?text=XUDONews'">
        <div class="card-info"><div class="card-title">${title}</div><div class="card-year">${displayDate}</div></div>
    </div>`;
}

/**
 * Renders static category filter buttons for the Browse page.
 */
function fetchCategories() {
    const list = document.getElementById('genre-list');
    if (!list) return;
    const categories = ['general', 'world', 'nation', 'business', 'technology', 'entertainment', 'sports', 'science', 'health'];
    list.innerHTML = '';
    categories.forEach(cat => {
        const b = document.createElement('button');
        b.className = `genre-btn ${currentBrowseEndpoint === cat ? 'active' : ''}`; 
        b.innerText = cat.toUpperCase();
        b.onclick = () => filterByCategory(cat, b);
        list.appendChild(b);
    });
}

/**
 * Triggers category filtering in Browse page.
 */
window.filterByCategory = function(cat, btn) {
    document.querySelectorAll('.genre-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentBrowseEndpoint = cat; currentPage = 1;
    document.getElementById('browse-grid').innerHTML = '';
    renderSkeletons('browse-grid', 10);
    loadBrowseContent();
};

/**
 * Initializes the Homepage logic locally.
 */
function initHome() {
    const q = new URLSearchParams(window.location.search).get('search');
    if (q) {
        document.querySelector('.hero-wrapper').style.display = 'none';
        const filterContainer = document.getElementById('home-filter-container');
        if (filterContainer) filterContainer.style.display = 'none';
        
        updateSEOMeta(`Search: ${q}`, `Results for ${q}`); 
        performSearch(q);
    } else {
        updateSEOMeta("XUDONews - World News & Breaking Headlines", "Stay informed with daily updates on technology, business, and global events.");
        loadHeroSlider(); 
        loadContinueWatching(); 
        loadAllSections();
    }
}

/**
 * Fetches top headlines and populates the Top Hero Slider using NYT Top Stories.
 */
async function loadHeroSlider() {
    try {
        const res = await fetch(`${BASE_URL_TOP_STORIES}/home.json?api-key=${API_KEY}`);
        const d = await res.json();
        
        let rawResults = d.results || [];
        let t = rawResults.map(i => normalizeNYTArticle(i, false)).slice(0, 10);
        t.forEach(item => renderedArticleIds.add(item.id));
        
        const c = document.getElementById('hero-slider'), dots = document.getElementById('hero-dots');
        if (!c || !t.length) return;

        c.innerHTML = [t[t.length - 1], ...t, t[0]].map(i => {
            const title = sanitizeHTML(i.title);
            const desc = sanitizeHTML(i.description || '');
            const img = i.image || 'https://placehold.co/1200x600/222222/222222';
            const itemStr = encodeURIComponent(JSON.stringify(i));
            return `<a href="article.html" onclick="saveCurrentArticle('${itemStr}')" class="hero-slide" style="background-image: linear-gradient(to top, #0f0f0f, transparent 90%), url('${img}')"><div class="hero-content"><div class="hero-tag">${TEXTS.trending}</div><h1 class="hero-title">${title}</h1><p class="hero-desc">${desc}</p><div class="hero-btn"><svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7zm-2 16H5V5h7V3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7z"/></svg> ${TEXTS.heroBtn}</div></div></a>`;
        }).join('');

        if (dots) {
            dots.innerHTML = t.map((_, idx) => `<div class="dot ${idx === 0 ? 'active' : ''}" data-index="${idx}"></div>`).join('');
            dots.querySelectorAll('.dot').forEach(d => d.addEventListener('click', (e) => { e.stopPropagation(); moveTo(parseInt(d.dataset.index) + 1); }));
        }

        let idx = 1, busy = false, timer;
        c.style.transform = `translateX(-100%)`;
        const updateDots = () => {
            if (dots) {
                dots.querySelectorAll('.dot').forEach(d => d.classList.remove('active'));
                let r = idx - 1; if (r < 0) r = t.length - 1; if (r >= t.length) r = 0;
                if (dots.children[r]) dots.children[r].classList.add('active');
            }
        };
        const moveTo = (i) => {
            if (busy) return; idx = i;
            c.style.transition = 'transform 0.5s ease-in-out'; c.style.transform = `translateX(-${idx * 100}%)`;
            busy = true; updateDots(); resetTimer();
        };
        const next = () => { if (idx >= t.length + 1) return; moveTo(idx + 1); };

        c.addEventListener('transitionend', () => {
            busy = false;
            if (idx === t.length + 1) { idx = 1; c.style.transition = 'none'; c.style.transform = `translateX(-100%)`; }
            if (idx === 0) { idx = t.length; c.style.transition = 'none'; c.style.transform = `translateX(-${idx * 100}%)`; }
        });

        const startTimer = () => { clearInterval(timer); timer = setInterval(next, 5000); };
        const resetTimer = () => { clearInterval(timer); startTimer(); };
        startTimer();
    } catch (error) {}
}

/**
 * Loads multiple horizontal category sliders for the Homepage natively from local JSON index 
 * to save API requests, fallback omitted to preserve your exact design intent.
 */
function loadAllSections() {
    const main = document.getElementById('main-content');
    const cats = [
        {t: "General News", c: "general"},
        {t: "World News", c: "world"},
        {t: "National", c: "nation"},
        {t: "Business", c: "business"},
        {t: "Technology", c: "technology"},
        {t: "Entertainment", c: "entertainment"},
        {t: "Sports", c: "sports"},
        {t: "Science", c: "science"},
        {t: "Health", c: "health"}
    ];
    
    for (const cat of cats) {
        const filtered = LOCAL_SEARCH_INDEX
        .filter(item => item.folder === cat.c && !renderedArticleIds.has(item.id)) // <-- Filter Duplikat
        .slice(0, 10);

        if (!filtered.length) continue;
        filtered.forEach(item => renderedArticleIds.add(item.id));
        
        const link = `browse.html?endpoint=${cat.c}&title=${encodeURIComponent(cat.t)}`;
        const s = document.createElement('section'); 
        s.className = 'content-section';
        s.innerHTML = `<div class="section-header"><h2 class="section-heading"><a href="${link}">${cat.t}</a></h2><a href="${link}" class="section-more-link">View More &rsaquo;</a></div><div class="horizontal-slider">${filtered.map(i => createCardHTML(i)).join('')}</div>`;
        main.appendChild(s);
    }
}

/**
 * Renders the 'Continue Reading' slider based on local storage history.
 */
function loadContinueWatching() {
    const h = JSON.parse(localStorage.getItem('xudo_history')) || [];
    if (!h.length) return;
    const m = document.getElementById('main-content'), s = document.createElement('section');
    s.id = 'continue-watching-section'; s.className = 'content-section';
    s.innerHTML = `<div class="section-header"><h2 class="section-heading">${TEXTS.contWatch}</h2><a href="javascript:void(0)" onclick="clearHistory()" class="section-more-link">${TEXTS.clearHistory}</a></div><div class="horizontal-slider">${h.map(i => createCardHTML(i)).join('')}</div>`;
    m.prepend(s);
}

/**
 * Executes a full multi-search and renders results in a grid using NYT Article Search.
 */
async function performSearch(q) {
    const m = document.getElementById('main-content');
    const safeQ = sanitizeHTML(q);
    m.innerHTML = `<div class="media-grid-container"><h2 class="page-title">Searching...</h2><div id="search-grid" class="media-grid"></div></div>`;
    renderSkeletons('search-grid', 10);
    try {
        const res = await fetch(`${BASE_URL_SEARCH}/articlesearch.json?q=${encodeURIComponent(q)}&api-key=${API_KEY}`);
        const d = await res.json();
        
        const docs = d.response?.docs || [];
        const results = docs.map(i => normalizeNYTArticle(i, true));
        
        m.innerHTML = `<div class="media-grid-container"><h2 class="page-title">Results: "${safeQ}"</h2>${results.length ? `<div class="media-grid">${results.map(i => createCardHTML(i)).join('')}</div>` : '<div class="no-results">No results found.</div>'}</div>`;
    } catch (error) {
        m.innerHTML = `<div class="media-grid-container"><h2 class="page-title" style="color:red;">Error fetching results</h2></div>`;
    }
}

/**
 * Initializes the Browse page (grid layout) including Saved logic.
 */
function initBrowse() {
    const p = new URLSearchParams(window.location.search);
    const ep = p.get('endpoint'), title = p.get('title'), type = p.get('type');

    if (type === 'saved' || type === 'favorites') {
        document.getElementById('page-title').innerText = "Saved Articles";
        document.getElementById('genre-list').style.display = 'none';
        document.getElementById('load-more-btn').style.display = 'none';
        let favs = JSON.parse(localStorage.getItem('xudo_favs')) || [];
        document.getElementById('browse-grid').innerHTML = favs.length ? favs.map(i => createCardHTML({
            id: i.id, title: i.title, image: i.poster, publishedAt: i.year
        })).join('') : '<div class="no-results">No saved articles yet.</div>';
        return;
    }

    currentBrowseEndpoint = ep || 'general';
    document.getElementById('page-title').innerText = title ? sanitizeHTML(title) : "Browse News";
    document.getElementById('load-more-btn').onclick = () => loadBrowseContent();
    renderSkeletons('browse-grid', 10); 
    fetchCategories(); 
    loadBrowseContent();
}

/**
 * Loads paginated content for Browse grid. Emulates pagination using array slicing 
 * since NYT Top Stories API doesn't support native ?page parameter.
 */
async function loadBrowseContent() {
    if (isLoading) return; isLoading = true;
    const btn = document.getElementById('load-more-btn');
    btn.innerText = "Loading..."; btn.disabled = true;
    try {
        const section = NYT_SECTION_MAP[currentBrowseEndpoint] || 'home';
        const res = await fetch(`${BASE_URL_TOP_STORIES}/${section}.json?api-key=${API_KEY}`);
        const d = await res.json();
        
        // Normalize and slice the results for pseudo-pagination
        let allResults = d.results ? d.results.map(i => normalizeNYTArticle(i, false)) : [];
        const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
        const resultsToRender = allResults.slice(startIdx, startIdx + ITEMS_PER_PAGE);
        
        if (currentPage === 1) document.getElementById('browse-grid').innerHTML = '';
        document.getElementById('browse-grid').insertAdjacentHTML('beforeend', resultsToRender.map(i => createCardHTML(i)).join(''));
        
        if (resultsToRender.length === 0 || startIdx + ITEMS_PER_PAGE >= allResults.length) {
            btn.style.display = 'none'; // Hide button if no more items to slice
        } else {
            currentPage++;
            btn.innerText = TEXTS.loadMore; 
            btn.disabled = false; 
            btn.style.display = 'inline-block'; 
        }
    } catch (error) { 
        btn.innerText = "Failed"; 
    } finally { 
        isLoading = false; 
    }
}

/**
 * Initializes the detailed Article page logic by reading local storage.
 * Injects dynamic anti-thin-content padding for SEO and user experience.
 */
function initArticlePage() {
    const dataStr = localStorage.getItem('xudo_current_article');
    if (!dataStr) return window.location.href = `index.html`;

    try {
        const d = JSON.parse(dataStr);
        d.id = d.id || generateId(d.url);
        updateContinueWatching(d);

        const title = sanitizeHTML(d.title);
        const date = sanitizeHTML((d.publishedAt || '').split('T')[0] || 'Unknown Date');
        const source = sanitizeHTML(d.source?.name || 'News Source');
        
        updateSEOMeta(`${title} - XUDONews`, d.description || `Read full details on XUDONews.`);

        const set = (id, v, isHTML = false) => { const el = document.getElementById(id); if (el) isHTML ? el.innerHTML = v : el.innerText = v; };

        set('detail-title', title);
        set('detail-source', `Source: ${source}`);
        set('detail-date', `Date: ${date}`);

        // --- ENTERPRISE ANTI-THIN CONTENT INJECTION (JS VERSION) ---
        const prefixes = [
            `In the rapidly evolving landscape of global events, staying informed is paramount. Today's briefing brings critical attention to the developments surrounding <strong>${title}</strong>. As the situation unfolds, understanding the nuances becomes essential for our audience.`,
            `XUDONews continuously monitors key international and domestic developments. Our latest aggregated coverage highlights significant updates regarding <strong>${title}</strong>. The following executive summary provides essential context drawn directly from our trusted syndication network.`,
            `Navigating today's complex news cycle requires reliable, high-fidelity insights. We have aggregated vital information concerning <strong>${title}</strong>. Below is the primary briefing detailing the core elements of this developing story.`,
            `As part of our commitment to delivering timely intelligence, XUDONews presents the latest findings on <strong>${title}</strong>. Analyzing these initial reports is crucial for grasping the broader geopolitical or socioeconomic implications.`
        ];
        
        const suffixes = [
            `This executive brief is part of XUDONews' ongoing mission to deliver high-impact information. To explore the comprehensive details and in-depth journalistic analysis, we strongly encourage readers to consult the original full-length publication provided by ${source}.`,
            `While this summary captures the primary aspects of the event, the full narrative contains crucial granular details. For a complete and definitive understanding of the implications, access the original reporting via the source link provided below.`,
            `The information presented in this digest highlights the immediate facts available at the time of publication. XUDONews remains dedicated to curating impactful stories. Proceed to the official material by ${source} to engage with the complete editorial piece.`,
            `Understanding the full scope of this issue requires looking beyond the executive summary. We invite our readers to dive deeper into the verified reporting and expert commentary on the original platform.`
        ];

        const randomPrefix = prefixes[Math.floor(Math.random() * prefixes.length)];
        const randomSuffix = suffixes[Math.floor(Math.random() * suffixes.length)];
        const abstractContent = sanitizeHTML(d.description || d.content || '');

        const enhancedHTML = `
            <p class="seo-prefix" style="color: #aaa; font-size: 1rem; margin-bottom: 25px; border-left: 3px solid #333; padding-left: 15px; font-style: italic; line-height: 1.6;">${randomPrefix}</p>
            <p style="font-weight:600; font-size:1.25rem; color:#fff; line-height: 1.8; margin-bottom: 25px;">${abstractContent}</p>
            <p class="seo-suffix" style="color: #aaa; font-size: 1rem; margin-top: 25px; margin-bottom: 10px; line-height: 1.6;">${randomSuffix}</p>
        `;
        
        set('detail-content', enhancedHTML, true);
        // -------------------------------------------------------------

        const img = document.getElementById('detail-image');
        if (img) { img.src = d.image || 'https://placehold.co/900x500/1a1a1a/ffffff?text=No+Image'; img.alt = title; }

        const readFullBtn = document.getElementById('read-full-btn');
        if (readFullBtn) readFullBtn.href = d.url;

        fetchRelatedNews(title, d.id);
    } catch (e) {
        window.location.href = `index.html`;
    }
}

/**
 * Fetches related news recommendations using NYT Article Search.
 */
async function fetchRelatedNews(title, currentId) { 
    try {
        const query = title.split(' ').slice(0, 3).join(' ');
        const res = await fetch(`${BASE_URL_SEARCH}/articlesearch.json?q=${encodeURIComponent(query)}&api-key=${API_KEY}`);
        const d = await res.json();
        
        const docs = d.response?.docs || [];
        const results = docs.map(i => normalizeNYTArticle(i, true))
                            .filter(i => i.id !== currentId)
                            .slice(0, 5);
        
        if (results.length > 0) {
            document.getElementById('rec-slider').innerHTML = results.map(i => createCardHTML(i)).join('');
        } else {
            document.querySelector('.recommendations-section').style.display = 'none';
        }
    } catch (error) {
        document.querySelector('.recommendations-section').style.display = 'none';
    }
}

// Ensure we use an async callback
document.addEventListener('DOMContentLoaded', async () => {
    // Wait for the local search index to fully load BEFORE rendering sections
    await loadSearchIndex(); 
    
    updateCanonical(); 
    initContentProtection(); 
    initSearchEvents();
    
    if (document.getElementById('hero-slider')) initHome();
    else if (document.getElementById('browse-grid')) initBrowse();
    else if (document.getElementById('detail-content')) initArticlePage();
});