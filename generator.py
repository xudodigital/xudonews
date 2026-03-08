import requests, os, re, time, json, random

# Changed API_KEY variable to expect NYT API Key, with fallback
API_KEY = os.getenv('NYT_API_KEY', 'WxLcHPZMAnPr7JCDVtzK751MT2Opabd2LPE5STekNykANA7z')
# Updated Base URL to target NYT Top Stories API
BASE_URL = 'https://api.nytimes.com/svc/topstories/v2'
LANG = 'en'
# Preserved original categories to ensure existing frontend routing and folders DO NOT break
CATEGORIES = ['general', 'world', 'nation', 'business', 'technology', 'entertainment', 'sports', 'science', 'health']

TARGETS = [
    {"domain": "https://xudonews.us", "path": "./public_html", "authority_url": "https://xudonews.us"},
]

GA_MAPPING = {
    "https://xudonews.us": "G-61D4NQPD4N",
}

CURRENT_INDEX_DB = {}

def generate_id(url_str):
    """
    Generates a unique numeric ID from a string URL to match the client-side JavaScript logic.
    """
    hash_val = 0
    for char in url_str:
        hash_val = ((hash_val << 5) - hash_val) + ord(char)
        hash_val = (hash_val ^ 0x80000000) - 0x80000000
    return abs(hash_val)

def slugify(text):
    """
    Converts a given text into a URL-friendly slug.
    """
    text = str(text).lower()
    slug = re.sub(r'[^a-z0-9]+', '-', text).strip('-')
    if not slug:
        return "news-article"
    return slug[:80]

def safe_str(text):
    """
    Escapes single and double quotes to ensure string is safe for HTML/JS injection.
    """
    if not text: return ""
    return str(text).replace("'", "\\'").replace('"', '\\"')

def ping_new_content(title, url):
    """
    Sends a ping to pingomatic service to notify search engines about new content.
    """
    try:
        services = {'title': title, 'blogurl': url, 'chk_weblogscom': 'on', 'chk_blogs': 'on', 'chk_google': 'on'}
        requests.get("http://pingomatic.com/ping/", params=services, timeout=2)
    except requests.exceptions.RequestException:
        pass

def generate_json_ld(article, category, domain):
    """
    Generates valid JSON-LD schema markup for NewsArticle SEO purposes.
    Updated to parse NYT JSON structure and handle CDN images.
    """
    image_url = 'https://placehold.co/900x500/1a1a1a/ffffff?text=No+Image'
    if article.get('multimedia') and isinstance(article['multimedia'], list) and len(article['multimedia']) > 0:
        raw_url = article['multimedia'][0].get('url', '')
        if raw_url:
            if raw_url.startswith('http://') or raw_url.startswith('https://'):
                image_url = raw_url
            else:
                separator = '' if raw_url.startswith('/') else '/'
                image_url = f"https://static01.nyt.com{separator}{raw_url}"

    schema = {
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        "headline": article.get('title', ''),
        "image": [image_url],
        "datePublished": article.get('published_date', ''), # NYT uses published_date
        "author": [{
            "@type": "Organization",
            "name": "The New York Times", # Hardcoded since API source is solely NYT
            "url": "https://www.nytimes.com"
        }],
        "publisher": {
            "@type": "Organization",
            "name": domain,
            "logo": {
                "@type": "ImageObject",
                "url": f"https://{domain}/icon.png"
            }
        },
        "description": article.get('abstract', '') # NYT uses abstract for description
    }
    return json.dumps(schema)

def generate_sitemap(target_path, site_domain, folder_name):
    """
    Generates an XML sitemap for a specific folder containing HTML files.
    """
    full_path = os.path.join(target_path, folder_name)
    if not os.path.exists(full_path): return
    
    try:
        xml_content = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        files = [f for f in os.listdir(full_path) if f.endswith('.html')]
        for filename in files:
            file_path = os.path.join(full_path, filename)
            mod_time = time.strftime('%Y-%m-%d', time.gmtime(os.path.getmtime(file_path)))
            xml_content += f'  <url>\n    <loc>{site_domain}/{folder_name}/{filename}</loc>\n    <lastmod>{mod_time}</lastmod>\n    <changefreq>daily</changefreq>\n  </url>\n'
        xml_content += '</urlset>'
        
        with open(os.path.join(target_path, f"{folder_name}_sitemap.xml"), 'w', encoding='utf-8') as f:
            f.write(xml_content)
    except IOError:
        pass

def generate_master_sitemap(target_path, site_domain):
    """
    Generates the main sitemap index pointing to specific category sitemaps.
    """
    today = time.strftime('%Y-%m-%d')
    try:
        xml_content = '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        for cat in CATEGORIES:
            xml_content += f'  <sitemap>\n    <loc>{site_domain}/{cat}_sitemap.xml</loc>\n    <lastmod>{today}</lastmod>\n  </sitemap>\n'
        xml_content += '</sitemapindex>'
        with open(os.path.join(target_path, 'sitemap.xml'), 'w', encoding='utf-8') as f:
            f.write(xml_content)
    except IOError:
        pass

def generate_robots_txt(target_path, site_domain):
    """
    Generates a robots.txt file to instruct search engine crawlers.
    """
    content = f"User-agent: *\nAllow: /\nDisallow: /*?search=\nDisallow: /*&search=\nDisallow: /*?type=\nSitemap: {site_domain}/sitemap.xml\n"
    try:
        with open(os.path.join(target_path, 'robots.txt'), 'w', encoding='utf-8') as f:
            f.write(content)
    except IOError:
        pass

def load_existing_index(target_path):
    """
    Loads the existing local JSON search index into memory to avoid duplicates.
    """
    global CURRENT_INDEX_DB
    CURRENT_INDEX_DB = {}
    index_file = os.path.join(target_path, 'search_index.json')
    if os.path.exists(index_file):
        try:
            with open(index_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                for item in data:
                    CURRENT_INDEX_DB[str(item['id'])] = item
        except:
            pass

def save_search_index(target_path):
    """
    Dumps the global index buffer back to a JSON file for local client-side searching and rendering.
    """
    final_list = list(CURRENT_INDEX_DB.values())
    try:
        with open(os.path.join(target_path, 'search_index.json'), 'w', encoding='utf-8') as f:
            json.dump(final_list, f)
    except IOError:
        pass

def fetch_content_from_nyt():
    """
    Fetches latest news articles grouped by mapped category from the NYT Top Stories API.
    Uses a mapping dictionary to translate local categories to NYT specific sections
    to prevent breaking existing frontend logic and folder structures.
    """
    content_dict = {cat: [] for cat in CATEGORIES}
    print("📡 Connecting to NYT Top Stories API...")
    
    # Mapping existing local categories to valid NYT sections
    nyt_section_map = {
        'general': 'home',      # Translates general to home
        'world': 'world',
        'nation': 'us',         # Translates nation to us
        'business': 'business',
        'technology': 'technology',
        'entertainment': 'arts', # Translates entertainment to arts
        'sports': 'sports',
        'science': 'science',
        'health': 'health'
    }

    for cat in CATEGORIES:
        nyt_section = nyt_section_map.get(cat, 'home')
        try:
            # Constructing URL based on NYT docs
            url = f"{BASE_URL}/{nyt_section}.json?api-key={API_KEY}"
            res = requests.get(url)
            response = res.json()
            
            # NYT Top Stories returns an array inside the 'results' key
            if 'results' in response:
                content_dict[cat] = response['results'][:20] # Limit to 20
                print(f"  ✅ Successfully fetched category: {cat}")
            else:
                print(f"  ⚠️ [Warning] NYT Error on {cat} (mapped to {nyt_section}): {response}") 
                
        except Exception as e: 
            print(f"  ❌ [Error] Network/Request failed on {cat}: {e}")
            
        # --- NEW ADDITION: 12 SECOND DELAY ---
        print("  ⏳ Pausing for 12 seconds to prevent NYT API rate limiting...")
        time.sleep(12) 
            
    return content_dict

def process_targets(articles_by_category):
    """
    Iterates through cluster targets and generates static HTML files and a rich JSON database based on NYT data.
    """
    try:
        with open('template.html', 'r', encoding='utf-8') as f: TEMPLATE = f.read()
    except FileNotFoundError:
        print("❌ CRITICAL ERROR: template.html not found!")
        return

    for target in TARGETS:
        domain = target['domain']
        root_path = target['path']
        authority_url = target['authority_url']
        is_king = (domain == authority_url)
        clean_authority = authority_url.replace('https://', '').replace('http://', '').strip('/')
        clean_domain = domain.replace('https://', '').replace('http://', '').strip('/')

        analytics_code = ""
        if is_king and authority_url in GA_MAPPING:
            ga_id = GA_MAPPING[authority_url]
            analytics_code = f"""<script async src="https://www.googletagmanager.com/gtag/js?id={ga_id}"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}gtag('js',new Date());gtag('config','{ga_id}');</script>"""

        if not os.path.exists(root_path):
            continue
            
        load_existing_index(root_path)
        new_files_count = 0
        
        for cat, articles in articles_by_category.items():
            os.makedirs(os.path.join(root_path, cat), exist_ok=True)
            
            for item in articles:
                title = item.get('title')
                original_url = item.get('url')
                if not title or not original_url: continue
                
                article_id = generate_id(original_url)
                
                # NYT uses 'published_date' instead of 'publishedAt'
                raw_date = item.get('published_date', '')
                year = raw_date.split('T')[0] if raw_date else 'NA'
                
                # NYT places images inside a 'multimedia' array
                image_url = 'https://placehold.co/900x500/1a1a1a/ffffff?text=No+Image'
                if item.get('multimedia') and isinstance(item['multimedia'], list) and len(item['multimedia']) > 0:
                    raw_url = item['multimedia'][0].get('url', '')
                    if raw_url:
                        if raw_url.startswith('http://') or raw_url.startswith('https://'):
                            image_url = raw_url
                        else:
                            separator = '' if raw_url.startswith('/') else '/'
                            image_url = f"https://static01.nyt.com{separator}{raw_url}"
                
                # NYT provides 'abstract' instead of full description/content
                desc = item.get('abstract', '')
                content = desc # Using abstract as the main body content fallback
                source_name = "The New York Times"
                
                slug = f"{slugify(title)}-{article_id}"
                
                CURRENT_INDEX_DB[str(article_id)] = {
                    "id": article_id, 
                    "slug": slug, 
                    "type": "news", 
                    "folder": cat,
                    "title": title,
                    "image": image_url,
                    "publishedAt": raw_date,
                    "description": desc,
                    "url": f"{cat}/{slug}.html",
                    "original_url": original_url,
                    "source_name": source_name
                }
                
                output_filename = f"{slug}.html"
                output_path = os.path.join(root_path, cat, output_filename)
                
                if os.path.exists(output_path): continue
                
                try:
                    page_url = f"{domain}/{cat}/{slug}.html"
                    canonical_url = f"{authority_url}/{cat}/{slug}.html"
                    
                    # --- ENTERPRISE ANTI-THIN CONTENT INJECTION ---
                    # Professional journalistic prefixes to contextualize the news
                    prefix_variations = [
                        f"In the rapidly evolving landscape of global events, staying informed is paramount. Today's briefing brings critical attention to the developments surrounding <strong>{title}</strong>. As the situation unfolds, understanding the nuances becomes essential for our audience at {clean_domain}.",
                        f"XUDONews continuously monitors key international and domestic developments. Our latest aggregated coverage highlights significant updates regarding <strong>{title}</strong>. The following executive summary provides essential context drawn directly from our trusted syndication network.",
                        f"Navigating today's complex news cycle requires reliable, high-fidelity insights. We have aggregated vital information concerning <strong>{title}</strong>. Below is the primary briefing detailing the core elements of this developing story.",
                        f"As part of our commitment to delivering timely intelligence, {clean_domain} presents the latest findings on <strong>{title}</strong>. Analyzing these initial reports is crucial for grasping the broader geopolitical or socioeconomic implications."
                    ]
                    
                    # Professional journalistic suffixes to encourage full reading
                    suffix_variations = [
                        f"This executive brief is part of {clean_domain}'s ongoing mission to deliver high-impact information. To explore the comprehensive details and in-depth journalistic analysis regarding <strong>{title}</strong>, we strongly encourage readers to consult the original full-length publication provided by {source_name}.",
                        f"While this summary captures the primary aspects of the event, the full narrative contains crucial granular details. For a complete and definitive understanding of the implications, access the original reporting via the source link provided below.",
                        f"The information presented in this digest highlights the immediate facts available at the time of publication. {clean_domain} remains dedicated to curating impactful stories. Proceed to the official material by {source_name} to engage with the complete editorial piece.",
                        f"Understanding the full scope of this issue requires looking beyond the executive summary. We invite our readers to dive deeper into the verified reporting and expert commentary on the original platform."
                    ]

                    # Randomly select one prefix and one suffix for dynamic generation
                    selected_prefix = random.choice(prefix_variations)
                    selected_suffix = random.choice(suffix_variations)
                    
                    # Combine into a robust HTML structure to avoid thin content penalties
                    enhanced_html_content = (
                        f"<p class='seo-prefix' style='color: #aaa; font-size: 1rem; margin-bottom: 25px; border-left: 3px solid #333; padding-left: 15px; font-style: italic; line-height: 1.6;'>{selected_prefix}</p>"
                        f"<p style='font-weight:600; font-size:1.25rem; color:#fff; line-height: 1.8; margin-bottom: 25px;'>{safe_str(desc)}</p>"
                        f"<p class='seo-suffix' style='color: #aaa; font-size: 1rem; margin-top: 25px; margin-bottom: 10px; line-height: 1.6;'>{selected_suffix}</p>"
                    )
                    # ----------------------------------------------

                    html_content = TEMPLATE \
                        .replace('{{ANALYTICS}}', analytics_code) \
                        .replace('{{API_KEY}}', API_KEY) \
                        .replace('{{TITLE}}', safe_str(title)) \
                        .replace('{{IMAGE_URL}}', image_url) \
                        .replace('{{IMAGE_ALT}}', safe_str(f"{title} - Cover Image")) \
                        .replace('{{SOURCE_NAME}}', safe_str(source_name)) \
                        .replace('{{PUBLISHED_DATE}}', year) \
                        .replace('{{SEO_DESCRIPTION}}', safe_str(desc[:150] + "...")) \
                        .replace('{{CONTENT_HTML}}', enhanced_html_content) \
                        .replace('{{ORIGINAL_URL}}', original_url) \
                        .replace('{{ID}}', str(article_id)) \
                        .replace('{{YEAR}}', year) \
                        .replace('{{SAFE_TITLE}}', safe_str(title)) \
                        .replace('{{CANONICAL}}', canonical_url) \
                        .replace('{{AUTHORITY_DOMAIN}}', clean_authority) \
                        .replace('{{SCHEMA}}', generate_json_ld(item, cat, clean_domain))

                    with open(output_path, 'w', encoding='utf-8') as f: 
                        f.write(html_content)
                    new_files_count += 1
                    
                    if is_king: 
                        ping_new_content(title, page_url)
                        try:
                            with open("new_urls.txt", "a", encoding="utf-8") as url_file:
                                url_file.write(canonical_url + "\n")
                        except Exception:
                            pass
                except Exception:
                    pass

        print(f"   ✅ Finished {domain}. New articles generated: {new_files_count}")
        for cat in CATEGORIES:
            generate_sitemap(root_path, domain, cat)
        generate_master_sitemap(root_path, domain)
        generate_robots_txt(root_path, domain)
        save_search_index(root_path)

if __name__ == "__main__":
    print("📰 Starting Static JSON & News HTML Generator with NYT API...")
    # Switched caller to use the new NYT fetcher
    articles_data = fetch_content_from_nyt()
    if any(articles_data.values()): 
        process_targets(articles_data)
    else: 
        print("❌ No data fetched. Aborting.")