import os
import json
import time
import requests
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify, make_response
from sqlalchemy import func
from .models import UsageLog, CorsSettings, UserKey, ProviderKey
from .utils import extract_tokens
from . import db

api_bp = Blueprint('api', __name__)
_models_cache = {'items': [], 'fetched_at': 0}
_models_hits = {}

def _resolve_upstream_key():
    upstream_key_env = os.getenv('UPSTREAM_API_KEY', '')
    if upstream_key_env:
        return upstream_key_env, 1
    provider = ProviderKey.query.filter_by(enabled=True).first()
    if not provider:
        return '', 0
    return provider.api_key, provider.id

def fetch_models(force=False):
    now = time.time()
    ttl = int(os.getenv('MODEL_CACHE_TTL', '300'))
    if not force and _models_cache['items'] and now - _models_cache['fetched_at'] < ttl:
        return _models_cache['items']
    key, _pid = _resolve_upstream_key()
    if not key:
        return _models_cache['items']
    url = os.getenv('UPSTREAM_URL', 'https://ai.hackclub.com/proxy/v1').rstrip('/') + '/models'
    try:
        r = requests.get(url, headers={'Authorization': f'Bearer {key}'}, timeout=30)
        data = r.json() if 'application/json' in r.headers.get('Content-Type','') else {}
        out = []
        if isinstance(data, dict):
            src = data.get('data') or data.get('models') or []
            if isinstance(src, list):
                for m in src:
                    if isinstance(m, dict):
                        mid = m.get('id') or m.get('name') or None
                        if mid:
                            out.append(mid)
                    elif isinstance(m, str):
                        out.append(m)
        _models_cache['items'] = out
        _models_cache['fetched_at'] = now
    except Exception:
        pass
    return _models_cache['items']

@api_bp.route('/models', methods=['GET'])
def list_models():
    ip = request.headers.get('X-Forwarded-For', request.remote_addr) or 'x'
    now = time.time()
    window = now - 60
    hits = _models_hits.get(ip, [])
    hits = [h for h in hits if h > window]
    limit = int(os.getenv('MODELS_RATE_LIMIT_PER_MIN','30'))
    if len(hits) >= limit:
        return jsonify({'error': 'rate_limited'}), 429
    hits.append(now)
    _models_hits[ip] = hits
    refresh = request.args.get('refresh') == '1'
    items = fetch_models(force=refresh)
    response = make_response(jsonify({'models': items, 'count': len(items)}), 200)
    return apply_cors_headers(response)

@api_bp.get('/api/stats')
def stats():
    keys = UserKey.query.filter_by(enabled=True).count()
    requests_count = db.session.query(func.count(UsageLog.id)).scalar() or 0
    tokens_sum = db.session.query(func.coalesce(func.sum(UsageLog.total_tokens), 0)).scalar() or 0
    today = datetime.utcnow().date()
    start_day = today - timedelta(days=6)
    rows = db.session.query(UsageLog.ts, UsageLog.total_tokens).filter(UsageLog.ts >= datetime.combine(start_day, datetime.min.time())).all()
    agg = {}
    for ts, tok in rows:
        d = ts.date()
        if d not in agg:
            agg[d] = {'date': d.isoformat(), 'requests': 0, 'tokens': 0}
        agg[d]['requests'] += 1
        agg[d]['tokens'] += int(tok or 0)
    graph = []
    for i in range(7):
        d = start_day + timedelta(days=i)
        graph.append(agg.get(d, {'date': d.isoformat(), 'requests': 0, 'tokens': 0}))
    response = make_response(jsonify({'keys': keys, 'requests': requests_count, 'tokens': tokens_sum, 'graph': graph}), 200)
    return apply_cors_headers(response)

def apply_cors_headers(response):
    settings = CorsSettings.query.first()
    if not settings:
        return response
    
    origin = request.headers.get('Origin')
    allowed_origins = settings.allowed_origins.strip()
    
    if allowed_origins == '*':
        response.headers['Access-Control-Allow-Origin'] = '*'
    elif origin and (origin in allowed_origins or allowed_origins == '*'):
        response.headers['Access-Control-Allow-Origin'] = origin
        if settings.allow_credentials:
            response.headers['Access-Control-Allow-Credentials'] = 'true'
    
    response.headers['Access-Control-Allow-Methods'] = settings.allowed_methods
    response.headers['Access-Control-Allow-Headers'] = settings.allowed_headers
    response.headers['Access-Control-Max-Age'] = str(settings.max_age)
    
    return response

@api_bp.route('/api/proxy/chat/completions', methods=['OPTIONS'])
def proxy_chat_options():
    response = make_response('', 204)
    return apply_cors_headers(response)

@api_bp.post('/api/proxy/chat/completions')
def proxy_chat():
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return jsonify({'error': 'missing_token'}), 401
    
    user_token = auth.split(' ', 1)[1]
    
    user_key = UserKey.query.filter_by(key=user_token, enabled=True).first()
    if not user_key:
        return jsonify({'error': 'unauthorized', 'message': 'Invalid or disabled API key'}), 401
    
    user_key.last_used_at = datetime.utcnow()
    db.session.commit()
    
    body = request.get_json(force=True)
    
    upstream_key, provider_id = _resolve_upstream_key()
    if not upstream_key:
        return jsonify({'error': 'no_provider_configured', 'message': 'No upstream provider key configured'}), 500
    models = fetch_models()
    if isinstance(body, dict):
        chosen = body.get('model')
        if not chosen or (models and chosen not in models):
            if models:
                body['model'] = models[0]
    
    upstream = os.getenv('UPSTREAM_URL', 'https://ai.hackclub.com/proxy/v1').rstrip('/') + '/chat/completions'
    
    try:
        resp = requests.post(
            upstream,
            headers={'Authorization': f'Bearer {upstream_key}', 'Content-Type': 'application/json'},
            data=json.dumps(body),
            timeout=120,
        )
    except Exception as e:
        return jsonify({'error': 'upstream_error', 'message': str(e)}), 502
    
    ct = resp.headers.get('Content-Type', '')
    if 'application/json' in ct:
        data = resp.json()
        pt, rt, tt = extract_tokens(data)
        ul = UsageLog(provider_key_id=provider_id, request_tokens=pt, response_tokens=rt, total_tokens=tt)
        db.session.add(ul)
        db.session.commit()
        response = make_response(jsonify(data), resp.status_code)
        return apply_cors_headers(response)
    
    ul = UsageLog(provider_key_id=provider_id)
    db.session.add(ul)
    db.session.commit()
    response = make_response(resp.content, resp.status_code, {'Content-Type': ct})
    return apply_cors_headers(response)
