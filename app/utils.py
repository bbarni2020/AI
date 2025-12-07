import datetime
import os
import secrets

import requests
from bs4 import BeautifulSoup
from sqlalchemy import func

from . import db
from .models import ProviderKey, UsageLog

def generate_api_key():
    return 'sk_' + secrets.token_urlsafe(48)

def mask_key(k):
    if not k or len(k) < 8:
        return '****'
    return k[:4] + '****' + k[-4:]

def today_range():
    now = datetime.datetime.utcnow()
    start = datetime.datetime(now.year, now.month, now.day)
    end = start + datetime.timedelta(days=1)
    return start, end

def eligible_keys():
    now = datetime.datetime.utcnow()
    minute_ago = now - datetime.timedelta(seconds=60)
    start, end = today_range()
    rows = ProviderKey.query.filter_by(enabled=True).all()
    out = []
    for r in rows:
        count_min = db.session.query(func.count(UsageLog.id)).filter(UsageLog.provider_key_id == r.id, UsageLog.ts >= minute_ago).scalar()
        if r.rate_limit_per_min and count_min >= r.rate_limit_per_min:
            continue
        tokens_today = db.session.query(func.coalesce(func.sum(UsageLog.total_tokens), 0)).filter(UsageLog.provider_key_id == r.id, UsageLog.ts >= start, UsageLog.ts < end).scalar() or 0
        if r.token_limit_per_day and tokens_today >= r.token_limit_per_day:
            continue
        out.append((r, count_min, tokens_today))
    out.sort(key=lambda x: (x[1], x[2]))
    return [x[0] for x in out]

def extract_tokens(data):
    try:
        u = data.get('usage')
        if not u:
            return 0, 0, 0
        pt = int(u.get('prompt_tokens') or 0)
        ct = int(u.get('completion_tokens') or 0)
        tt = int(u.get('total_tokens') or (pt + ct))
        return pt, ct, tt
    except Exception:
        return 0, 0, 0


def tavily_search(query, max_results=3):
    api_key = os.getenv('SEARCH_API_KEY', '').strip()
    if not api_key or not query:
        return []
    params = {
        'q': query,
        'count': min(max_results, 20)
    }
    headers = {
        'Authorization': f'Bearer {api_key}'
    }
    try:
        resp = requests.get('https://search.hackclub.com/res/v1/web/search', params=params, headers=headers, timeout=10)
        if resp.status_code != 200:
            return []
        data = resp.json()
        web_results = data.get('web', {}).get('results', [])
        return [{'url': r.get('url'), 'title': r.get('title'), 'content': r.get('description')} for r in web_results]
    except Exception:
        return []


def scrape_url(url, max_chars=1200):
    if not url:
        return ''
    headers = {'User-Agent': 'DeakteriChatBot/1.0'}
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        content_type = resp.headers.get('Content-Type', '')
        if resp.status_code != 200 or 'text' not in content_type:
            return ''
        soup = BeautifulSoup(resp.text, 'html.parser')
        for tag in soup(['script', 'style', 'noscript']):
            tag.extract()
        text = ' '.join(chunk.strip() for chunk in soup.get_text(separator=' ', strip=True).split())
        return text[:max_chars]
    except Exception:
        return ''


def gather_web_context(query, limit=3):
    results = tavily_search(query, max_results=limit)
    context = []
    for item in results:
        url = item.get('url')
        content = scrape_url(url)
        snippet = content or item.get('content') or item.get('snippet') or ''
        if not snippet:
            continue
        context.append({
            'title': item.get('title') or url,
            'url': url,
            'content': snippet[:600]
        })
    return context
