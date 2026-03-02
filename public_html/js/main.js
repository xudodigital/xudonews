/**
 * XUDOTrailer MAIN SCRIPT (OPTIMIZED & SECURED)
 * - Includes Lazy Loading for Search Index
 * - Fixes Canonical Logic for Satellites
 * - XSS Protection (Sanitization)
 * - Explicit Error Handling
 */

/* --- DYNAMIC CLUSTER CONFIGURATION --- */
const INJECTED = window.XUDO_CONFIG || {};
const CONFIG = {
    AUTHORITY_DOMAIN: INJECTED.authority || window.location.hostname, 
    get AUTHORITY_URL() { return 'https://' + this.AUTHORITY_DOMAIN; },
    IS_LOCALHOST: ['localhost', '127.0.0.1'].includes(window.location.hostname),
    /**
     * [EN] Checks if the current domain is the master authority domain.
     * @returns {boolean}
     */
    isAuthority: function() { return window.location.hostname === this.AUTHORITY_DOMAIN; },
    /**
     * [EN] Uses injected API Key from generator or falls back to default for local dev.
     */
    API_KEY: INJECTED.apiKey || '9d3fd8464dbd695f9457240aeea19851'
};

/* --- API & ASSETS --- */
const API_KEY = CONFIG.API_KEY;
const BASE_URL = 'https://api.themoviedb.org/3';
const IMG_HD = 'https://image.tmdb.org/t/p/original';
const IMG_POSTER = 'https://image.tmdb.org/t/p/w500';
const IMG_THUMB = 'https://image.tmdb.org/t/p/w92';
const CURRENT_LANG = 'en-US';

const TEXTS = {
    allGenres: "All Genres", contWatch: "Recently Viewed", clearHistory: "Clear All", loadMore: "Load More",
    heroBtn: "WATCH TRAILER", trending: "TRENDING", viewMore: "View More", confirmClear: "Are you sure?",
    movPopular: "Popular Movies", movNowPlaying: "Now Playing", movUpcoming: "Upcoming", movTopRated: "Top Rated Movies",
    tvPopular: "Popular TV Shows", tvAiringToday: "Airing Today", tvOnAir: "On TV", tvTopRated: "Top Rated TV Shows",
    season: "Season"
};

/* --- STATE VARIABLES --- */
let currentPage = 1, isLoading = false, currentSeason = 1, currentEpisode = 1;
let currentBrowseEndpoint = '', currentMediaType = 'movie', currentGenreId = null, searchDebounceTimer;
let LOCAL_SEARCH_INDEX = []; 
let isSearchIndexLoaded = false;

/* --- SECURITY & HELPERS --- */

/**
 * [EN] Sanitizes strings to prevent Cross-Site Scripting (XSS) when injecting HTML.
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
 * [EN] Sets or updates the canonical link tag for SEO, forcing credit to Authority Domain.
 */
function updateCanonical() {
    let link = document.querySelector("link[rel='canonical']") || document.createElement('link');
    link.rel = 'canonical';

    const staticCanonical = document.querySelector("link[rel='canonical']");
    if (staticCanonical && !CONFIG.IS_LOCALHOST && staticCanonical.href.includes(CONFIG.AUTHORITY_DOMAIN)) return;

    const relativePath = window.location.pathname + window.location.search;
    if (CONFIG.IS_LOCALHOST) {
        link.href = window.location.href;
    } else {
        link.href = CONFIG.AUTHORITY_URL + relativePath;
    }
    if (!link.parentNode) document.head.appendChild(link);
}

/**
 * [EN] Updates the document title and meta description dynamically.
 */
function updateSEOMeta(t, d) {
    document.title = sanitizeHTML(t);
    let m = document.querySelector('meta[name="description"]') || document.createElement('meta');
    m.name = 'description'; m.content = sanitizeHTML(d);
    if (!m.parentNode) document.head.appendChild(m);
}

/**
 * [EN] Initializes basic content protection (disables right-click, dev tools shortcuts).
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

/* --- SMART ROUTING SYSTEM --- */
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
 * [EN] Determines whether to redirect to a generated static page or a dynamic watch page.
 */
function getTargetUrl(item) {
    const type = item.media_type || (item.title ? 'movie' : 'tv');
    const localFile = LOCAL_SEARCH_INDEX.find(x => x.id == item.id && x.type == type);
    return localFile ? `/${localFile.folder}/${localFile.slug}.html` : `/watch.html?type=${type}&id=${item.id}&lang=${CURRENT_LANG}`;
}

/* --- SEARCH SYSTEM --- */

/**
 * [EN] Initializes DOM events related to the search input.
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
 * [EN] Defines a global function for the inline HTML oninput event (if used).
 */
window.toggleClearButton = function() {
    const input = document.getElementById('search-input');
    document.getElementById('clear-btn').classList.toggle('show-flex', input.value.trim().length > 0);
};

/**
 * [EN] Fetches live search suggestions from TMDB API as the user types.
 */
async function fetchLiveSearch(query) {
    const dropdown = document.getElementById('search-dropdown');
    if (!isSearchIndexLoaded) await loadSearchIndex();

    try {
        const res = await fetch(`${BASE_URL}/search/multi?api_key=${API_KEY}&language=${CURRENT_LANG}&query=${encodeURIComponent(query)}`);
        const data = await res.json();
        const results = data.results.filter(i => i.media_type === 'movie' || i.media_type === 'tv').slice(0, 10);

        if (results.length > 0) {
            dropdown.innerHTML = results.map(i => {
                const title = sanitizeHTML(i.title || i.name);
                const year = sanitizeHTML((i.release_date || i.first_air_date || '').split('-')[0] || 'N/A');
                const poster = i.poster_path ? IMG_THUMB + i.poster_path : 'https://via.placeholder.com/40x60?text=NA';
                
                // Safe for inline JS handler injection
                const safeTitle = title.replace(/'/g, "\\'");
                const safePoster = (i.poster_path ? IMG_POSTER + i.poster_path : poster).replace(/'/g, "\\'");
                const rating = i.vote_average ? i.vote_average.toFixed(1) : 'NR';
                const isFav = isFavorite(i.id);
                const targetLink = getTargetUrl(i);
                
                const svgFill = '<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
                const svgThin = '<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
                const favSvg = isFav ? svgFill : svgThin;

                return `<div class="search-item"><a href="${targetLink}" class="search-item-link"><img src="${poster}" alt="${title}"><div class="search-item-info"><span class="search-item-title">${title}</span><span class="search-item-meta">${year} • ${i.media_type.toUpperCase()}</span></div></a><button class="search-fav-btn ${isFav?'active':''}" onclick="toggleFavorite(event, ${i.id}, '${i.media_type}', '${safeTitle}', '${safePoster}', '${year}', '${rating}')">${favSvg}</button></div>`;
            }).join('');
            dropdown.classList.add('active');
        } else {
            dropdown.classList.remove('active');
        }
    } catch (error) { 
        console.error("[EN] Live Search Fetch Error:", error);
        dropdown.classList.remove('active'); 
    }
}

/**
 * [EN] Clears the search input and hides the dropdown.
 */
window.clearSearch = function() {
    document.getElementById('search-input').value = '';
    document.getElementById('clear-btn').classList.remove('show-flex');
    document.getElementById('search-dropdown').classList.remove('active');
};

/**
 * [EN] Triggers the full search redirection.
 */
window.executeSearch = function() {
    const q = document.getElementById('search-input').value.trim();
    if (q) window.location.href = `index.html?search=${encodeURIComponent(q)}&lang=${CURRENT_LANG}`;
};

/**
 * [EN] Intercepts the Enter key to submit the search.
 */
window.handleEnter = function(e) { 
    if (e.key === 'Enter') executeSearch(); 
};

/* --- GLOBAL HELPERS --- */

/**
 * [EN] Native Web Share API integration or clipboard fallback for sharing movies.
 */
window.shareMovie = () => {
    const url = location.href, title = document.title;
    if (navigator.share) return navigator.share({ title, text: `Watch ${title}`, url }).catch(() => {});
    navigator.clipboard.writeText(url).then(() => alert('Link copied!')).catch(() => prompt('Copy link:', url));
};

/**
 * [EN] Saves viewed items to LocalStorage for 'Continue Watching' section.
 */
window.saveHistory = (id, type, title, poster, year, rating) => {
    let h = (JSON.parse(localStorage.getItem('xudo_history')) || []).filter(v => v.id != id);
    h.unshift({ id, type, title, poster, year: String(year || '????'), rating: +(rating || 0) });
    localStorage.setItem('xudo_history', JSON.stringify(h.slice(0, 20)));
};

/**
 * [EN] Clears local viewing history.
 */
window.clearHistory = () => {
    if (confirm(TEXTS.confirmClear)) {
        localStorage.removeItem('xudo_history');
        document.getElementById('continue-watching-section')?.remove();
    }
};

/**
 * [EN] Toggles an item in the user's local favorites list and updates the UI button.
 */
window.toggleFavorite = function(event, id, type, title, poster, year, rating) {
    event.preventDefault(); event.stopPropagation();
    let favs = JSON.parse(localStorage.getItem('xudo_favs')) || [];
    const index = favs.findIndex(f => f.id == id);
    const btn = event.currentTarget;

    const svgFill = '<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
    const svgThin = '<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="none" stroke="currentColor" stroke-width="1"/></svg>';

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
 * [EN] Checks if a specific ID exists in local favorites.
 */
function isFavorite(id) { 
    return (JSON.parse(localStorage.getItem('xudo_favs')) || []).some(f => f.id == id); 
}

/**
 * [EN] Automatically updates the 'Continue Watching' history object when visiting a detail page.
 */
function updateContinueWatching(item) {
    let h = JSON.parse(localStorage.getItem('xudo_history')) || [];
    h = h.filter(x => x.id !== item.id);
    h.unshift({
        id: item.id, type: item.media_type || (item.title ? 'movie' : 'tv'),
        title: item.title || item.name,
        poster: item.poster_path ? (item.poster_path.startsWith('http') ? item.poster_path : IMG_POSTER + item.poster_path) : 'https://via.placeholder.com/500',
        year: (item.release_date || item.first_air_date || '').split('-')[0], rating: item.vote_average
    });
    if (h.length > 20) h.pop();
    localStorage.setItem('xudo_history', JSON.stringify(h));
}

/* --- UI HELPERS --- */

/**
 * [EN] Renders loading skeleton animations in the given container.
 */
function renderSkeletons(id, c) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = Array(c).fill('<div class="skeleton-card skeleton"></div>').join('');
}

/**
 * [EN] Generates the HTML string for a movie/tv card component.
 */
function createCardHTML(item, typeOverride) {
    const t = item.media_type || typeOverride || (item.title ? 'movie' : 'tv');
    const title = sanitizeHTML(item.title || item.name);
    const d = item.release_date || item.first_air_date; 
    const year = d ? d.split('-')[0] : '????';
    const poster = item.poster_path ? (item.poster_path.startsWith('http') ? item.poster_path : IMG_POSTER + item.poster_path) : 'https://via.placeholder.com/500x750/1a1a1a/fff?text=No+Image';
    const rating = item.vote_average ? item.vote_average.toFixed(1) : 'NR';
    const isFav = isFavorite(item.id);
    
    // JS String escaping for inline events
    const sT = title.replace(/'/g, "\\'");
    const sP = poster.replace(/'/g, "\\'");
    const targetLink = getTargetUrl({ id: item.id, media_type: t });

    const mediaTypeLabel = t === 'movie' ? 'Movie' : 'TV Series';
    const seoAlt = `${title} (${year}) - Full ${mediaTypeLabel} Review & Details`;

    const SVG_ON = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>';
    const SVG_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>';

    return `<div class="content-card" onclick="location.href='${targetLink}'">
        <button class="card-fav-btn ${isFav?'active':''}" onclick="toggleFavorite(event, ${item.id}, '${t}', '${sT}', '${sP}', '${year}', '${rating}')">${isFav ? SVG_ON : SVG_OFF}</button>
        <img src="${poster}" alt="${seoAlt}" loading="lazy">
        <span class="card-rating">★ ${rating}</span>
        <div class="card-info"><div class="card-title">${title}</div><div class="card-year">${year} • ${t.toUpperCase()}</div></div>
    </div>`;
}

/* --- PAGE LOGIC --- */

/**
 * [EN] Fetches and renders genre filter buttons.
 */
async function fetchGenres(type) {
    const list = document.getElementById('genre-list');
    if (!list) return;
    list.innerHTML = `<button class="genre-btn active" onclick="filterByGenre(null, this)">${TEXTS.allGenres}</button>`;
    const add = (g) => {
        const b = document.createElement('button');
        b.className = 'genre-btn'; b.innerText = g.name; // innerText is safe
        b.onclick = () => filterByGenre(g.id, b);
        list.appendChild(b);
    };
    const key = `xudo_genres_en_${type}`;
    const cached = localStorage.getItem(key);
    
    if (cached) {
        JSON.parse(cached).forEach(add);
    } else {
        try {
            const res = await fetch(`${BASE_URL}/genre/${type}/list?api_key=${API_KEY}&language=en-US`);
            if (!res.ok) throw new Error("Failed to fetch genres");
            const d = await res.json();
            if (d.genres) { 
                localStorage.setItem(key, JSON.stringify(d.genres)); 
                d.genres.forEach(add); 
            }
        } catch (error) {
            console.error("[EN] Fetch Genres Error:", error);
        }
    }
}

/**
 * [EN] Global function to trigger genre filtering in Browse page.
 */
window.filterByGenre = function(id, btn) {
    document.querySelectorAll('.genre-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentGenreId = id; currentPage = 1;
    document.getElementById('browse-grid').innerHTML = '';
    renderSkeletons('browse-grid', 10);
    currentBrowseEndpoint = id ? `/discover/${currentMediaType}?with_genres=${id}&sort_by=popularity.desc` : (new URLSearchParams(window.location.search).get('endpoint'));
    loadBrowseContent();
};

/**
 * [EN] Fetches content certification (age rating) based on US release.
 */
async function fetchCertification(type, id) {
    const el = document.getElementById('detail-cert');
    if (!el) return;
    try {
        const res = await fetch(type === 'movie' ? `${BASE_URL}/movie/${id}/release_dates?api_key=${API_KEY}` : `${BASE_URL}/tv/${id}/content_ratings?api_key=${API_KEY}`);
        if (!res.ok) throw new Error("Certification API failed");
        const d = await res.json();
        let c = type === 'movie' ? (d.results.find(r => r.iso_3166_1 === 'US')?.release_dates.find(x => x.certification)?.certification) : (d.results.find(r => r.iso_3166_1 === 'US')?.rating);
        if (c) { 
            el.innerText = sanitizeHTML(c); 
            el.style.display = 'inline-block'; 
        }
    } catch (error) {
        console.warn("[EN] Could not fetch certification:", error);
    }
}

/**
 * [EN] Initializes the Homepage logic (either search results or default sliders).
 */
async function initHome() {
    const q = new URLSearchParams(window.location.search).get('search');
    if (q) {
        document.querySelector('.hero-wrapper').style.display = 'none';
        updateSEOMeta(`Search: ${q}`, `Results for ${q}`); 
        await performSearch(q);
    } else {
        updateSEOMeta("XUDOTrailer - Reviews, Trailers & Movie Database", "XUDOTrailer is your premier source for movie reviews, cast information, trailers, and ratings.");
        await loadHeroSlider(); 
        loadContinueWatching(); 
        await loadAllSections();
    }
}

/**
 * [EN] Renders the 'Continue Watching' slider based on local storage.
 */
function loadContinueWatching() {
    const h = JSON.parse(localStorage.getItem('xudo_history')) || [];
    if (!h.length) return;
    const m = document.getElementById('main-content'), s = document.createElement('section');
    s.id = 'continue-watching-section'; s.className = 'content-section';
    s.innerHTML = `<div class="section-header"><h2 class="section-heading">${TEXTS.contWatch}</h2><a href="javascript:void(0)" onclick="clearHistory()" class="section-more-link">${TEXTS.clearHistory}</a></div><div class="horizontal-slider">${h.map(i => createCardHTML({id:i.id,media_type:i.type,title:i.title,name:i.title,poster_path:i.poster,release_date:i.year,first_air_date:i.year,vote_average:+i.rating})).join('')}</div>`;
    m.prepend(s);
}

/**
 * [EN] Fetches trending content and populates the Top Hero Slider.
 */
async function loadHeroSlider() {
    try {
        const res = await fetch(`${BASE_URL}/trending/all/day?api_key=${API_KEY}&language=${CURRENT_LANG}`);
        if (!res.ok) throw new Error("Hero slider fetch failed");
        const d = await res.json();
        let t = d.results.slice(0, 10);
        const c = document.getElementById('hero-slider'), dots = document.getElementById('hero-dots');
        if (!c || !t.length) return;

        c.innerHTML = [t[t.length - 1], ...t, t[0]].map(i => {
            const link = getTargetUrl(i);
            const title = sanitizeHTML(i.title || i.name);
            const overview = sanitizeHTML(i.overview);
            return `<a href="${link}" class="hero-slide" style="background-image: linear-gradient(to top, #0f0f0f, transparent 90%), url('${IMG_HD + i.backdrop_path}')"><div class="hero-content"><div class="hero-tag">${TEXTS.trending}</div><h1 class="hero-title">${title}</h1><p class="hero-desc">${overview}</p><div class="hero-btn"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg> ${TEXTS.heroBtn}</div></div></a>`;
        }).join('');

        if (dots) {
            dots.innerHTML = t.map((_, i) => `<div class="dot ${i === 0 ? 'active' : ''}" data-index="${i}"></div>`).join('');
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
    } catch (error) {
        console.error("[EN] Load Hero Slider Error:", error);
    }
}

/**
 * [EN] Loads multiple horizontal category sliders for the Homepage.
 */
async function loadAllSections() {
    const main = document.getElementById('main-content');
    const cats = [{t: TEXTS.movPopular,u:"/movie/popular",k:"movie"},{t: TEXTS.movNowPlaying,u:"/movie/now_playing",k:"movie"},{t: TEXTS.movUpcoming,u:"/movie/upcoming",k:"movie"},{t: TEXTS.movTopRated,u:"/movie/top_rated",k:"movie"},{t: TEXTS.tvPopular,u:"/tv/popular",k:"tv"},{t: TEXTS.tvAiringToday,u:"/tv/airing_today",k:"tv"},{t: TEXTS.tvOnAir,u:"/tv/on_the_air",k:"tv"},{t: TEXTS.tvTopRated,u:"/tv/top_rated",k:"tv"}];
    for (const c of cats) {
        try {
            const res = await fetch(`${BASE_URL}${c.u}?api_key=${API_KEY}&language=${CURRENT_LANG}`);
            if (!res.ok) throw new Error(`Failed section: ${c.u}`);
            const d = await res.json();
            if (!d.results.length) continue;
            
            const link = `browse.html?endpoint=${c.u}&title=${encodeURIComponent(c.t)}&type=${c.k}&lang=${CURRENT_LANG}`;
            const s = document.createElement('section'); s.className = 'content-section';
            s.innerHTML = `<div class="section-header"><h2 class="section-heading"><a href="${link}">${c.t}</a></h2><a href="${link}" class="section-more-link">${TEXTS.viewMore} &rsaquo;</a></div><div class="horizontal-slider">${d.results.map(i => createCardHTML(i, c.k)).join('')}</div>`;
            main.appendChild(s);
        } catch (error) {
            console.error(`[EN] Error loading section ${c.t}:`, error);
        }
    }
}

/**
 * [EN] Executes a full multi-search and renders results in a grid.
 */
async function performSearch(q) {
    const m = document.getElementById('main-content');
    const safeQ = sanitizeHTML(q);
    m.innerHTML = `<div class="media-grid-container"><h2 class="page-title">Searching...</h2><div id="search-grid" class="media-grid"></div></div>`;
    renderSkeletons('search-grid', 10);
    try {
        const res = await fetch(`${BASE_URL}/search/multi?api_key=${API_KEY}&language=${CURRENT_LANG}&query=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error("Search API failed");
        const d = await res.json();
        const results = d.results.filter(i => i.media_type === 'movie' || i.media_type === 'tv');
        m.innerHTML = `<div class="media-grid-container"><h2 class="page-title">Results: "${safeQ}"</h2>${results.length ? `<div class="media-grid">${results.map(i => createCardHTML(i)).join('')}</div>` : '<div class="no-results">No results.</div>'}</div>`;
    } catch (error) {
        console.error("[EN] Perform Search Error:", error);
        m.innerHTML = `<div class="media-grid-container"><h2 class="page-title" style="color:red;">Error fetching results</h2></div>`;
    }
}

/**
 * [EN] Initializes the Browse page (grid layout) including Favorites logic.
 */
async function initBrowse() {
    const p = new URLSearchParams(window.location.search);
    const ep = p.get('endpoint'), title = p.get('title'), type = p.get('type');

    if (type === 'favorites') {
        document.getElementById('page-title').innerText = "My Favorites";
        document.getElementById('genre-list').style.display = 'none';
        document.getElementById('load-more-btn').style.display = 'none';
        let favs = JSON.parse(localStorage.getItem('xudo_favs')) || [];
        document.getElementById('browse-grid').innerHTML = favs.length ? favs.map(i => createCardHTML({
            id: i.id, media_type: i.type, title: i.title, name: i.title, poster_path: i.poster, release_date: i.year, first_air_date: i.year, vote_average: parseFloat(i.rating)
        })).join('') : '<div class="no-results">No favorites yet.</div>';
        return;
    }
    if (!ep) return window.location.href = `index.html`;

    document.getElementById('page-title').innerText = sanitizeHTML(title);
    document.getElementById('load-more-btn').onclick = () => loadBrowseContent();
    currentMediaType = type; currentBrowseEndpoint = ep;
    renderSkeletons('browse-grid', 15); 
    await fetchGenres(type); 
    await loadBrowseContent();
}

/**
 * [EN] Loads and appends paginated content into the Browse grid.
 */
async function loadBrowseContent() {
    if (isLoading) return; isLoading = true;
    const btn = document.getElementById('load-more-btn');
    btn.innerText = "Loading..."; btn.disabled = true;
    try {
        const sep = currentBrowseEndpoint.includes('?') ? '&' : '?';
        const res = await fetch(`${BASE_URL}${currentBrowseEndpoint}${sep}api_key=${API_KEY}&language=${CURRENT_LANG}&page=${currentPage}`);
        if (!res.ok) throw new Error("Browse content fetch failed");
        const d = await res.json();
        
        if (currentPage === 1) document.getElementById('browse-grid').innerHTML = '';
        document.getElementById('browse-grid').insertAdjacentHTML('beforeend', d.results.map(i => createCardHTML(i, currentMediaType)).join(''));
        
        currentPage++;
        if (d.page >= d.total_pages) {
            btn.style.display = 'none';
        } else { 
            btn.innerText = TEXTS.loadMore; 
            btn.disabled = false; 
            btn.style.display = 'inline-block'; 
        }
    } catch (error) { 
        console.error("[EN] Load Browse Content Error:", error);
        btn.innerText = "Failed"; 
    } finally { 
        isLoading = false; 
    }
}

/**
 * [EN] Initializes the detailed Watch page logic.
 */
async function initWatchPage() {
    const p = new URLSearchParams(window.location.search);
    const type = p.get('type'), id = p.get('id');
    currentSeason = p.get('s') || 1; currentEpisode = p.get('e') || 1;
    if (!id || !type) return window.location.href = `index.html`;

    updatePlayer(type, id);
    if (type === 'tv') {
        const c = document.getElementById('tv-controls');
        if (c) c.style.display = 'block'; 
        await loadTVSeasons(id);
    }
    await fetchMovieDetails(type, id); 
    await fetchCertification(type, id);
    await fetchCast(type, id); 
    await fetchSimilarMovies(type, id);
}

/**
 * [EN] Fetches YouTube trailer key and updates the iframe player.
 */
async function updatePlayer(type, id) {
    const el = document.getElementById('player-container');
    el.innerHTML = '<div style="display:grid;place-items:center;height:100%;background:#000;color:#fff"><div class="loader">Loading Player...</div></div>';
    try {
        const res = await fetch(`${BASE_URL}/${type}/${id}/videos?api_key=${API_KEY}&language=${CURRENT_LANG}`);
        if (!res.ok) throw new Error("Video API failed");
        const d = await res.json();
        let v = (d.results || []).find(x => x.site === "YouTube" && x.type === "Trailer") || (d.results || [])[0];
        
        el.innerHTML = v ? `<iframe src="https://www.youtube.com/embed/${v.key}?autoplay=1&mute=1&modestbranding=1&rel=0&iv_load_policy=3" class="player-frame" allowfullscreen></iframe>` : `<div style="display:grid;place-items:center;height:100%;color:#888;">NO TRAILER AVAILABLE</div>`;
    } catch (error) { 
        console.error("[EN] Update Player Error:", error);
        el.innerHTML = `<div style="display:grid;place-items:center;height:100%;color:#e50914;">ERROR LOADING MEDIA</div>`; 
    }
}

/**
 * [EN] Populates the Season select dropdown for TV Shows.
 */
async function loadTVSeasons(id) {
    const s = document.getElementById('season-select');
    s.onchange = (e) => {
        currentSeason = e.target.value; currentEpisode = 1;
        loadEpisodesForSeason(id, currentSeason); updatePlayer('tv', id);
    };
    try {
        const res = await fetch(`${BASE_URL}/tv/${id}?api_key=${API_KEY}&language=${CURRENT_LANG}`);
        if (!res.ok) throw new Error("TV Seasons API failed");
        const d = await res.json();
        s.innerHTML = '';
        d.seasons.forEach(x => {
            if (x.season_number > 0) {
                const o = document.createElement('option');
                o.value = x.season_number; 
                o.text = `${TEXTS.season} ${x.season_number}`;
                if (x.season_number == currentSeason) o.selected = true;
                s.appendChild(o);
            }
        });
        loadEpisodesForSeason(id, currentSeason);
    } catch (error) {
        console.error("[EN] Load TV Seasons Error:", error);
    }
}

/**
 * [EN] Fetches and displays episodes based on the selected season.
 */
async function loadEpisodesForSeason(id, sn) {
    const g = document.getElementById('episodes-grid');
    g.innerHTML = 'Loading...';
    try {
        const res = await fetch(`${BASE_URL}/tv/${id}/season/${sn}?api_key=${API_KEY}&language=${CURRENT_LANG}`);
        if (!res.ok) throw new Error(`Season ${sn} API failed`);
        const d = await res.json();
        g.innerHTML = '';
        d.episodes.forEach(e => {
            const b = document.createElement('div');
            b.className = `ep-btn ${e.episode_number == currentEpisode ? 'active' : ''}`;
            b.innerText = `Ep ${e.episode_number}`;
            b.onclick = () => {
                currentEpisode = e.episode_number;
                document.querySelectorAll('.ep-btn').forEach(x => x.classList.remove('active'));
                b.classList.add('active'); updatePlayer('tv', id);
            };
            g.appendChild(b);
        });
    } catch (error) {
        console.error("[EN] Load Episodes Error:", error);
        g.innerHTML = '<span style="color:red">Failed to load episodes.</span>';
    }
}

/**
 * [EN] Fetches core details and injects SEO disclaimers into the Watch page.
 */
async function fetchMovieDetails(type, id) {
    try {
        const res = await fetch(`${BASE_URL}/${type}/${id}?api_key=${API_KEY}&language=${CURRENT_LANG}`);
        if (!res.ok) return document.querySelector('.watch-container').innerHTML = '<div class="error-message">Not Found</div>';
        const d = await res.json();
        try { updateContinueWatching(d); } catch (e) {}

        const title = d.title || d.name, year = (d.release_date || d.first_air_date || '').split('-')[0] || '----';
        const rt = type === 'movie' && d.runtime ? `${Math.floor(d.runtime/60)}h ${d.runtime%60}m` : (type === 'tv' && d.episode_run_time?.[0] ? `${d.episode_run_time[0]}m / ep` : 'N/A');

        updateSEOMeta(`${title} (${year}) - Reviews & Details`, `Read reviews and watch the trailer for ${title}.`);

        const authDomain = sanitizeHTML(CONFIG.AUTHORITY_DOMAIN);
        const currentDomain = sanitizeHTML(window.location.hostname);
        const overviewClean = sanitizeHTML(d.overview || "No synopsis available.");
        const titleClean = sanitizeHTML(title);
        
        // [EN] Dynamic SEO injection variations to prevent spam detection
        const seoVariations = [
            `Find movie summaries, production details, and trivia about <strong>${titleClean}</strong> on <strong>${currentDomain}</strong>.`,
            `Explore the complete cast list, ratings, and reviews for <strong>${titleClean}</strong> right here at <strong>${currentDomain}</strong>.`,
            `Your ultimate guide to <strong>${titleClean}</strong>. Dive into the plot and exclusive details provided by <strong>${currentDomain}</strong>.`
        ];
        const randomSeoText = seoVariations[Math.floor(Math.random() * seoVariations.length)];
        
        // [EN] Inject random SEO text without the legal disclaimer
        const seoText = `<br><br>${randomSeoText}`;

        const set = (id, v, isHTML = false) => { const el = document.getElementById(id); if (el) isHTML ? el.innerHTML = v : el.innerText = v; };

        set('detail-title', title);
        set('detail-overview', overviewClean + seoText, true);
        set('detail-year', year);
        set('detail-rating', `⭐ ${d.vote_average?.toFixed(1) || 'NR'}`);
        set('detail-runtime', rt);

        const img = document.getElementById('detail-poster');
        if (img) { img.src = d.poster_path ? IMG_POSTER + d.poster_path : 'https://via.placeholder.com/500x750?text=No+Poster'; img.alt = title; }
        const g = document.getElementById('detail-genres');
        if (g && d.genres) g.innerHTML = d.genres.map(x => `<span class="genre-tag">${sanitizeHTML(x.name)}</span>`).join('');

        // =====================================================================
        // [EN] UPDATE DYNAMIC WATCH FULL BUTTON URL (SMART DEEP-LINKING)
        // =====================================================================
        const watchFullBtn = document.getElementById('watch-full-btn');
        if (watchFullBtn) {
            const localFile = LOCAL_SEARCH_INDEX.find(x => x.id == id && x.type == type);
            
            if (localFile) {
                // watchFullBtn.href = `https://xudomovie.us/${localFile.folder}/${localFile.slug}.html`;
                watchFullBtn.href = `https://xudomovie.us/watch.html?type=${type}&id=${id}&lang=${CURRENT_LANG}`;
            } else {
                watchFullBtn.href = `https://xudomovie.us/watch.html?type=${type}&id=${id}&lang=${CURRENT_LANG}`;
            }
            
            // 2. Set target to _blank for a better user experience
            watchFullBtn.target = "_blank";
        }

            } catch (error) { 
                console.error("[EN] Fetch Movie Details Error:", error); 
            }
        }

/**
 * [EN] Fetches cast list and creates horizontal scrolling profile cards.
 */
async function fetchCast(type, id) {
    try {
        const res = await fetch(`${BASE_URL}/${type}/${id}/credits?api_key=${API_KEY}&language=${CURRENT_LANG}`);
        if (!res.ok) throw new Error("Credits API failed");
        const d = await res.json();
        const l = document.getElementById('cast-list');
        if (d.cast.length) {
            l.innerHTML = d.cast.slice(0, 10).map(a => {
                const name = sanitizeHTML(a.name);
                const char = sanitizeHTML(a.character);
                return `<div class="cast-card"><img src="${a.profile_path ? 'https://image.tmdb.org/t/p/w200'+a.profile_path : 'https://via.placeholder.com/200x200?text=No+Img'}" class="cast-img"><div class="cast-name">${name}</div><div class="cast-character">${char}</div></div>`;
            }).join('');
        } else {
            l.innerHTML = '<div style="color:#666;font-size:0.8rem;">No cast info available.</div>';
        }
    } catch (error) {
        console.error("[EN] Fetch Cast Error:", error);
    }
}

/**
 * [EN] Fetches recommendations based on current content ID.
 */
async function fetchSimilarMovies(type, id) {
    try {
        const res = await fetch(`${BASE_URL}/${type}/${id}/similar?api_key=${API_KEY}&language=${CURRENT_LANG}`);
        if (!res.ok) throw new Error("Similar movies API failed");
        const d = await res.json();
        if (d.results.length) {
            document.getElementById('rec-slider').innerHTML = d.results.map(i => createCardHTML(i, type)).join('');
        } else {
            document.querySelector('.recommendations-section').style.display = 'none';
        }
    } catch (error) {
        console.error("[EN] Fetch Similar Error:", error);
        document.querySelector('.recommendations-section').style.display = 'none';
    }
}

/* --- INIT --- */
document.addEventListener('DOMContentLoaded', () => {
    loadSearchIndex(); updateCanonical(); initContentProtection(); initSearchEvents();
    if (document.getElementById('hero-slider')) initHome();
    else if (document.getElementById('browse-grid')) initBrowse();
    else if (document.getElementById('player-container')) initWatchPage();

});

