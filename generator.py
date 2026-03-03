import requests, os, re, time, json, random

# --- GLOBAL CONFIGURATION ---
# [EN] Fetch API key from environment variables to prevent hardcoding credentials.
# Fallback is provided for local testing. Usage in terminal: export TMDB_API_KEY='your_api_key'
API_KEY = os.getenv('TMDB_API_KEY', '9d3fd8464dbd695f9457240aeea19851')
BASE_URL = 'https://api.themoviedb.org/3'
LANG = 'en-US'
TOTAL_PAGES = 200  # Fetch more content

# [MULTI-CLUSTER CONFIGURATION]
TARGETS = [
    # --- CLUSTER 1: BRAND ---
    {"domain": "https://xudotrailer.us",       "path": "./public_html",      "authority_url": "https://xudotrailer.us"},
]

GA_MAPPING = {
    "https://xudotrailer.us":          "G-34E9TJGR5H",
}

# Database buffer
CURRENT_INDEX_DB = {}

# --- HELPER FUNCTIONS ---

def slugify(text, item_id=""):
    """
    [EN] Converts a given text into a URL-friendly slug.
    Removes non-alphanumeric characters and provides a fallback if empty.
    """
    text = str(text).lower()
    slug = re.sub(r'[^a-z0-9]+', '-', text).strip('-')
    if not slug:
        return f"movie-{item_id}" if item_id else "untitled-content"
    return slug

def fmt_run(minutes):
    """
    [EN] Formats runtime from total minutes into an 'Xh Ym' string representation.
    """
    return f"{minutes//60}h {minutes%60}m" if minutes else "N/A"

def safe_str(text):
    """
    [EN] Escapes single and double quotes to ensure string is safe for HTML/JS injection.
    """
    return str(text).replace("'", "\\'").replace('"', '\\"')

def get_trailer(videos_data):
    """
    [EN] Iterates through the TMDB video array to find the primary YouTube trailer key.
    """
    results = videos_data.get('results', [])
    for video in results:
        if video.get('site') == 'YouTube' and video.get('type') == 'Trailer':
            return video.get('key')
    return results[0].get('key', '') if results else ''

def get_cert(release_data, media_type):
    """
    [EN] Extracts the certification or age rating based on the US region from TMDB data.
    """
    try:
        if media_type == 'movie':
            results = release_data.get('release_dates', {}).get('results', [])
            us_release = next((item for item in results if item['iso_3166_1'] == 'US'), None)
            if us_release:
                for release in us_release['release_dates']:
                    if release.get('certification'):
                        return release['certification']
        else:
            results = release_data.get('content_ratings', {}).get('results', [])
            us_rating = next((item['rating'] for item in results if item['iso_3166_1'] == 'US'), None)
            if us_rating: return us_rating
        return "NR"
    except Exception as e:
        print(f"  ⚠️ [Warning] Failed to parse certification: {e}")
        return "NR"

def ping_new_content(title, url):
    """
    [EN] Sends a ping to pingomatic service to notify search engines about new content.
    """
    try:
        services = {'title': title, 'blogurl': url, 'chk_weblogscom': 'on', 'chk_blogs': 'on', 'chk_google': 'on'}
        requests.get("http://pingomatic.com/ping/", params=services, timeout=2)
    except requests.exceptions.RequestException as e:
        print(f"  ⚠️ [Warning] Ping failed for {title}: {e}")

def generate_json_ld(data, media_type, title):
    """
    [EN] Generates valid JSON-LD schema markup for Rich Snippet SEO purposes.
    """
    runtime = data.get('runtime') or (data.get('episode_run_time', [0])[0] if data.get('episode_run_time') else 0)
    poster_path = data.get('poster_path')
    final_poster = f"https://image.tmdb.org/t/p/w500{poster_path}" if poster_path else "https://via.placeholder.com/500x750?text=No+Poster"
    
    schema = {
        "@context": "https://schema.org",
        "@type": "Movie" if media_type == "movie" else "TVSeries",
        "name": title,
        "image": final_poster,
        "description": data.get('overview', '')[:160],
        "datePublished": data.get('release_date') if media_type == "movie" else data.get('first_air_date'),
        "genre": [g['name'] for g in data.get('genres', [])],
        "actor": [{"@type": "Person", "name": c['name']} for c in data.get('credits', {}).get('cast', [])[:5]],
        "aggregateRating": {
            "@type": "AggregateRating", 
            "ratingValue": data.get('vote_average', 0), 
            "bestRating": "10", 
            "ratingCount": max(1, data.get('vote_count', 0))
        }
    }
    if runtime > 0:
        schema["duration"] = f"PT{runtime//60}H{runtime%60}M"
    return json.dumps(schema)

# --- FILE GENERATORS ---

def generate_sitemap(target_path, site_domain, folder_name):
    """
    [EN] Generates an XML sitemap for a specific folder containing HTML files.
    """
    full_path = os.path.join(target_path, folder_name)
    if not os.path.exists(full_path): return
    print(f"    🗺️  Generating sitemap for {folder_name}...")
    
    try:
        xml_content = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        files = [f for f in os.listdir(full_path) if f.endswith('.html')]
        for filename in files:
            file_path = os.path.join(full_path, filename)
            mod_time = time.strftime('%Y-%m-%d', time.gmtime(os.path.getmtime(file_path)))
            xml_content += f'  <url>\n    <loc>{site_domain}/{folder_name}/{filename}</loc>\n    <lastmod>{mod_time}</lastmod>\n    <changefreq>weekly</changefreq>\n  </url>\n'
        xml_content += '</urlset>'
        
        with open(os.path.join(target_path, f"{folder_name}_sitemap.xml"), 'w', encoding='utf-8') as f:
            f.write(xml_content)
    except IOError as e:
        print(f"  ❌ [Error] Failed to write sitemap {folder_name}: {e}")

def generate_master_sitemap(target_path, site_domain):
    """
    [EN] Generates the main sitemap index pointing to specific category sitemaps.
    """
    today = time.strftime('%Y-%m-%d')
    try:
        xml_content = '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        xml_content += f'  <sitemap>\n    <loc>{site_domain}/movies_sitemap.xml</loc>\n    <lastmod>{today}</lastmod>\n  </sitemap>\n'
        xml_content += f'  <sitemap>\n    <loc>{site_domain}/tvshows_sitemap.xml</loc>\n    <lastmod>{today}</lastmod>\n  </sitemap>\n'
        xml_content += '</sitemapindex>'
        with open(os.path.join(target_path, 'sitemap.xml'), 'w', encoding='utf-8') as f:
            f.write(xml_content)
    except IOError as e:
        print(f"  ❌ [Error] Failed to write master sitemap: {e}")

def generate_robots_txt(target_path, site_domain):
    """
    [EN] Generates a robots.txt file to instruct search engine crawlers.
    """
    print("    🤖 Generating robots.txt...")
    content = f"""User-agent: *
Allow: /
Disallow: /*?search=
Disallow: /*&search=
Disallow: /*?lang=
Disallow: /*&lang=
Sitemap: {site_domain}/sitemap.xml
"""
    try:
        with open(os.path.join(target_path, 'robots.txt'), 'w', encoding='utf-8') as f:
            f.write(content)
    except IOError as e:
        print(f"  ❌ [Error] Failed to write robots.txt: {e}")

def load_existing_index(target_path):
    """
    [EN] Loads the existing local JSON search index into memory to avoid duplicates.
    """
    global CURRENT_INDEX_DB
    CURRENT_INDEX_DB = {}
    index_file = os.path.join(target_path, 'search_index.json')
    if os.path.exists(index_file):
        try:
            with open(index_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                for item in data:
                    key = f"{item['type']}_{item['id']}"
                    CURRENT_INDEX_DB[key] = item
        except json.JSONDecodeError as e:
            print(f"  ❌ [Error] JSON format error in search_index.json: {e}")
        except IOError as e:
            print(f"  ❌ [Error] Could not read search_index.json: {e}")

def save_search_index(target_path):
    """
    [EN] Dumps the global index buffer back to a JSON file for local searching.
    """
    print("    🔍 Saving search_index.json...")
    final_list = list(CURRENT_INDEX_DB.values())
    try:
        with open(os.path.join(target_path, 'search_index.json'), 'w', encoding='utf-8') as f:
            json.dump(final_list, f)
    except IOError as e:
        print(f"  ❌ [Error] Could not save search_index.json: {e}")

# --- CORE LOGIC ---

def fetch_content_from_tmdb():
    """
    [EN] Fetches content lists from TMDB API handling both popular movies and TV shows.
    """
    content_list = []
    print("📡 Connecting to TMDB API...")
    for page in range(1, TOTAL_PAGES + 1):
        try:
            url = f"{BASE_URL}/movie/popular?api_key={API_KEY}&language={LANG}&page={page}"
            response = requests.get(url).json()
            for item in response.get('results', []):
                item['media_type_override'] = 'movie'
                content_list.append(item)
        except requests.exceptions.RequestException as e: 
            print(f"  ❌ [Error] Network failure fetching movies page {page}: {e}")

    for page in range(1, TOTAL_PAGES + 1):
        try:
            url = f"{BASE_URL}/tv/popular?api_key={API_KEY}&language={LANG}&page={page}"
            response = requests.get(url).json()
            for item in response.get('results', []):
                item['media_type_override'] = 'tv'
                content_list.append(item)
        except requests.exceptions.RequestException as e: 
            print(f"  ❌ [Error] Network failure fetching TV page {page}: {e}")
            
    print(f"✅ Downloaded {len(content_list)} items to process.")
    return content_list

def process_targets(all_content):
    """
    [EN] Iterates through cluster targets and generates static HTML files based on TMDB data.
    """
    try:
        with open('template.html', 'r', encoding='utf-8') as f: TEMPLATE = f.read()
    except FileNotFoundError:
        print("❌ CRITICAL ERROR: template.html not found! Aborting target processing.")
        return

    for target in TARGETS:
        domain = target['domain']
        root_path = target['path']
        authority_url = target['authority_url']
        is_king = (domain == authority_url)
        clean_authority = authority_url.replace('https://', '').replace('http://', '').strip('/')
        clean_domain = domain.replace('https://', '').replace('http://', '').strip('/')

        # Default: Empty string (For Satellite domains, removes GA4)
        analytics_code = ""
        
        # Only inject GA4 if this is a KING domain and exists in GA_MAPPING
        if is_king and authority_url in GA_MAPPING:
            ga_id = GA_MAPPING[authority_url]
            analytics_code = f"""<script async src="https://www.googletagmanager.com/gtag/js?id={ga_id}"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}gtag('js',new Date());gtag('config','{ga_id}');</script>"""

        print(f"\n🚀 Processing Target: {domain}")
        if not os.path.exists(root_path):
            print(f"   ⚠️ Directory not found: {root_path}. Skipping.")
            continue
            
        os.makedirs(os.path.join(root_path, "movies"), exist_ok=True)
        os.makedirs(os.path.join(root_path, "tvshows"), exist_ok=True)
        load_existing_index(root_path)
        new_files_count = 0
        
        for item in all_content:
            media_type = item['media_type_override']
            folder = "movies" if media_type == "movie" else "tvshows"
            title = item.get('title') if media_type == "movie" else item.get('name')
            if not title: continue
            
            raw_date = item.get('release_date') if media_type == "movie" else item.get('first_air_date')
            year = raw_date.split('-')[0] if raw_date else 'NA'
            
            slug = f"{slugify(title, item['id'])}-{year}"
            db_key = f"{media_type}_{item['id']}"
            CURRENT_INDEX_DB[db_key] = {"id": item['id'], "slug": slug, "type": media_type, "folder": folder}
            
            output_filename = f"{slug}.html"
            output_path = os.path.join(root_path, folder, output_filename)
            
            if os.path.exists(output_path): continue
            
            try:
                endpoint = "movie" if media_type == "movie" else "tv"
                detail_url = f"{BASE_URL}/{endpoint}/{item['id']}?api_key={API_KEY}&language={LANG}&append_to_response=videos,credits,release_dates,content_ratings"
                details = requests.get(detail_url).json()
                
                page_url = f"{domain}/{folder}/{slug}.html"
                canonical_url = f"{authority_url}/{folder}/{slug}.html"
                
                overview = safe_str(details.get('overview', 'No synopsis available.'))
                seo_description = f"Watch {title} ({year}). {overview[:100]}... Review and details on {clean_domain}."
                # [EN] Create dynamic SEO injection to avoid boilerplate/duplicate content penalty from Google
                seo_variations = [
                    f"Discover full details and reviews about <strong>{title}</strong> on <strong>{clean_domain}</strong>. Proudly part of the {clean_authority} network.",
                    f"Looking for information on <strong>{title}</strong>? You are on the right page at <strong>{clean_domain}</strong>, a member of the {clean_authority} family.",
                    f"Explore the cast, synopsis, and ratings for <strong>{title}</strong> exclusively brought to you by <strong>{clean_domain}</strong> ({clean_authority} network).",
                    f"Get the latest updates, trailers, and user reviews for <strong>{title}</strong> right here at <strong>{clean_domain}</strong>, powered by {clean_authority}.",
                    f"Dive deep into the world of <strong>{title}</strong> with comprehensive details provided by <strong>{clean_domain}</strong>, a trusted {clean_authority} partner.",
                    f"Find out everything you need to know about <strong>{title}</strong> before you watch. Brought to you by <strong>{clean_domain}</strong> ({clean_authority}).",
                    f"Read our in-depth analysis and community ratings for <strong>{title}</strong>. Exclusively available on <strong>{clean_domain}</strong> via the {clean_authority} ecosystem.",
                    f"Curious about the plot of <strong>{title}</strong>? <strong>{clean_domain}</strong> has all the answers you need, supported by {clean_authority}.",
                    f"Join thousands of movie fans exploring <strong>{title}</strong> on <strong>{clean_domain}</strong>, an official site of the {clean_authority} network.",
                    f"From cast members to release dates, <strong>{clean_domain}</strong> is your ultimate guide for <strong>{title}</strong>. Powered by {clean_authority}.",
                    f"Uncover hidden trivia, behind-the-scenes info, and full reviews of <strong>{title}</strong> at <strong>{clean_domain}</strong> ({clean_authority} group).",
                    f"Make <strong>{clean_domain}</strong> your go-to destination for all things <strong>{title}</strong>. We are proud members of the {clean_authority} digital family.",
                    f"Looking for top-tier entertainment info? Check out our page on <strong>{title}</strong> here at <strong>{clean_domain}</strong>, backed by {clean_authority}.",
                    f"Don't miss out on our exclusive coverage of <strong>{title}</strong>. Read the full synopsis on <strong>{clean_domain}</strong> ({clean_authority} network).",
                    f"Whether it's ratings, runtime, or cast details, <strong>{clean_domain}</strong> has you covered for <strong>{title}</strong>. A {clean_authority} affiliated site.",
                    f"Get comprehensive insights into <strong>{title}</strong> today. Hosted exclusively on <strong>{clean_domain}</strong>, part of the extensive {clean_authority} media group.",
                    f"Stay updated with the best reviews for <strong>{title}</strong> provided by the experts at <strong>{clean_domain}</strong> (A {clean_authority} company).",
                    f"Want to know if <strong>{title}</strong> is worth watching? Find out here on <strong>{clean_domain}</strong>, proudly powered by {clean_authority}.",
                    f"Your search for <strong>{title}</strong> details ends here! Enjoy this complete overview from <strong>{clean_domain}</strong> and the {clean_authority} network.",
                    f"Explore high-quality metadata, posters, and synopses for <strong>{title}</strong> at <strong>{clean_domain}</strong>. Brought to you seamlessly by {clean_authority}."
                ]
                
                # [EN] Dynamic Call-To-Action (CTA) directing users to the streaming site
                # [FIX] URL changed to always point to the dynamic watch.html page
                dynamic_watch_url = f"https://xudomovie.us/watch.html?type={media_type}&id={item['id']}&lang={LANG}"
                
                cta_variations = [
                    f"Ready to watch? Stream <strong>{title}</strong> now on <a href='{dynamic_watch_url}' target='_blank' rel='dofollow'><strong>XUDOMovie</strong></a>.",
                    f"Want to see the full feature? Watch <strong>{title}</strong> in high quality over at <a href='{dynamic_watch_url}' target='_blank' rel='dofollow'><strong>XUDOMovie</strong></a>.",
                    f"Don't just read about it—experience it! Catch <strong>{title}</strong> online at <a href='{dynamic_watch_url}' target='_blank' rel='dofollow'><strong>XUDOMovie</strong></a>.",
                    f"Grab your popcorn and head over to <a href='{dynamic_watch_url}' target='_blank' rel='dofollow'><strong>XUDOMovie</strong></a> to enjoy <strong>{title}</strong> today.",
                    f"Looking for the full episode or movie? Start streaming <strong>{title}</strong> directly on <a href='{dynamic_watch_url}' target='_blank' rel='dofollow'><strong>XUDOMovie</strong></a>."
                ]
                
                # [EN] Combining SEO Spintax with CTA Spintax
                seo_inject_text = f"{random.choice(seo_variations)} {random.choice(cta_variations)}"
                
                poster_path = details.get('poster_path')
                poster_url = f"https://image.tmdb.org/t/p/w500{poster_path}" if poster_path else "https://via.placeholder.com/500x750?text=No+Poster"
                poster_alt = f"{title} ({year}) - {media_type.capitalize()} details on {clean_domain}"
                
                rating = str(details.get('vote_average', 0))[:3]
                runtime = fmt_run(details.get('runtime') if media_type == 'movie' else (details.get('episode_run_time', [0])[0] if details.get('episode_run_time') else 0))
                certification = get_cert(details, media_type)
                trailer_key = get_trailer(details.get('videos', {}))
                
                if trailer_key:
                    display_player = "block"
                    display_backdrop = "none"
                else:
                    display_player = "none"
                    display_backdrop = "block"
                
                genres_html = "".join([f'<span class="genre-tag">{g["name"]}</span>' for g in details.get('genres', [])])
                cast_html = ""
                for cast in details.get('credits', {}).get('cast', [])[:10]:
                    img_src = f"https://image.tmdb.org/t/p/w200{cast['profile_path']}" if cast.get('profile_path') else "https://via.placeholder.com/200"
                    cast_html += f'<div class="cast-card"><img src="{img_src}" class="cast-img"><div class="cast-name">{safe_str(cast["name"])}</div></div>'

                html_content = TEMPLATE \
                    .replace('{{ANALYTICS}}', analytics_code) \
                    .replace('{{API_KEY}}', API_KEY) \
                    .replace('{{TITLE}}', safe_str(title)) \
                    .replace('{{TYPE}}', "Movie" if media_type == "movie" else "TV Show") \
                    .replace('{{SEO_DESCRIPTION}}', seo_description) \
                    .replace('{{OVERVIEW}}', overview + "<br><br>" + seo_inject_text) \
                    .replace('https://image.tmdb.org/t/p/w500{{POSTER_PATH}}', poster_url) \
                    .replace('{{POSTER_ALT}}', safe_str(poster_alt)) \
                    .replace('{{YEAR}}', str(year)) \
                    .replace('{{RATING}}', rating) \
                    .replace('{{VIDEO_KEY}}', trailer_key) \
                    .replace('{{DISPLAY_PLAYER}}', display_player) \
                    .replace('{{DISPLAY_BACKDROP}}', display_backdrop) \
                    .replace('{{RUNTIME}}', runtime) \
                    .replace('{{CERTIFICATION}}', certification) \
                    .replace('{{GENRES}}', genres_html) \
                    .replace('{{CAST_LIST}}', cast_html) \
                    .replace('{{ID}}', str(item['id'])) \
                    .replace('{{MEDIA_TYPE}}', media_type) \
                    .replace('{{SAFE_TITLE}}', safe_str(title)) \
                    .replace('{{FOLDER}}', folder) \
                    .replace('{{SLUG}}', slug) \
                    .replace('{{SCHEMA}}', generate_json_ld(details, media_type, title)) \
                    .replace('{{CANONICAL}}', canonical_url) \
                    .replace('{{AUTHORITY_DOMAIN}}', clean_authority)

                with open(output_path, 'w', encoding='utf-8') as f: f.write(html_content)
                new_files_count += 1
                if is_king: 
                    ping_new_content(title, page_url)
                    
                    # [EN] Append the newly generated URL to new_urls.txt for Google Indexing
                    try:
                        with open("new_urls.txt", "a", encoding="utf-8") as url_file:
                            url_file.write(canonical_url + "\n")
                    except Exception as e:
                        print(f"  ⚠️ [Warning] Failed to write to new_urls.txt: {e}")
                    
            except Exception as e: 
                print(f"    ❌ [Error] Failed to process detail for {title} (ID: {item.get('id')}): {e}")

        print(f"   ✅ Finished. New files generated: {new_files_count}")
        generate_sitemap(root_path, domain, "movies")
        generate_sitemap(root_path, domain, "tvshows")
        generate_master_sitemap(root_path, domain)
        generate_robots_txt(root_path, domain)
        save_search_index(root_path)

if __name__ == "__main__":
    print("🎬 Starting Multi-Cluster Generator...")
    start_time = time.time()
    content_data = fetch_content_from_tmdb()
    if content_data: process_targets(content_data)
    else: print("❌ No data fetched. Aborting.")

    print(f"\n🎉 All tasks completed in {round(time.time() - start_time, 2)} seconds.")

