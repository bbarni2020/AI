import os
import secrets
from datetime import datetime, timedelta
from flask import Blueprint, jsonify, request, session, current_app
from sqlalchemy import func, cast, Date
from .models import ProviderKey, UserKey, UsageLog, CorsSettings
from . import db
from .utils import mask_key

admin_bp = Blueprint('admin', __name__, url_prefix='/admin')

def generate_api_key():
    return 'sk_' + secrets.token_urlsafe(48)

@admin_bp.get('/')
def admin_index():
    return current_app.send_static_file('admin/index.html')

@admin_bp.post('/login')
def admin_login():
    data = request.get_json(silent=True) or {}
    u = data.get('username')
    p = data.get('password')
    if u == os.getenv('ADMIN_USER', 'admin') and p == os.getenv('ADMIN_PASS', 'admin'):
        session['admin'] = u
        return jsonify({'ok': True})
    return jsonify({'ok': False}), 401

@admin_bp.post('/logout')
def admin_logout():
    session.pop('admin', None)
    return jsonify({'ok': True})

@admin_bp.get('/me')
def admin_me():
    return jsonify({'authenticated': 'admin' in session})

@admin_bp.get('/user-keys')
def list_user_keys():
    if 'admin' not in session:
        return jsonify({'error': 'unauthorized'}), 401
    rows = UserKey.query.order_by(UserKey.id.desc()).all()
    result = []
    for r in rows:
        total_requests = db.session.query(func.count(UsageLog.id)).filter(UsageLog.user_key_id == r.id).scalar() or 0
        total_tokens = db.session.query(func.coalesce(func.sum(UsageLog.total_tokens), 0)).filter(UsageLog.user_key_id == r.id).scalar() or 0
        result.append({
            'id': r.id,
            'name': r.name,
            'key': mask_key(r.key),
            'enabled': r.enabled,
            'rate_limit_enabled': r.rate_limit_enabled,
            'rate_limit_value': r.rate_limit_value,
            'rate_limit_period': r.rate_limit_period,
            'rate_limit_per_min': r.rate_limit_per_min,
            'token_limit_enabled': r.token_limit_enabled,
            'token_limit_value': r.token_limit_value,
            'token_limit_period': r.token_limit_period,
            'token_limit_per_day': r.token_limit_per_day,
            'created_at': r.created_at.isoformat(),
            'last_used_at': r.last_used_at.isoformat() if r.last_used_at else None,
            'total_requests': total_requests,
            'total_tokens': total_tokens,
        })
    return jsonify(result)

@admin_bp.post('/user-keys')
def create_user_key():
    if 'admin' not in session:
        return jsonify({'error': 'unauthorized'}), 401
    data = request.get_json(silent=True) or {}
    api_key = generate_api_key()
    r = UserKey(
        key=api_key,
        name=data.get('name', ''),
        enabled=bool(data.get('enabled', True)),
        rate_limit_enabled=bool(data.get('rate_limit_enabled', False)),
        rate_limit_value=int(data.get('rate_limit_value') or 0),
        rate_limit_period=data.get('rate_limit_period', 'minute'),
        token_limit_enabled=bool(data.get('token_limit_enabled', False)),
        token_limit_value=int(data.get('token_limit_value') or 0),
        token_limit_period=data.get('token_limit_period', 'day'),
        rate_limit_per_min=int(data.get('rate_limit_per_min') or 0),
        token_limit_per_day=int(data.get('token_limit_per_day') or 0),
    )
    db.session.add(r)
    db.session.commit()
    return jsonify({'id': r.id, 'key': api_key})

@admin_bp.put('/user-keys/<int:kid>')
def update_user_key(kid):
    if 'admin' not in session:
        return jsonify({'error': 'unauthorized'}), 401
    r = UserKey.query.get_or_404(kid)
    data = request.get_json(silent=True) or {}
    if 'name' in data:
        r.name = data['name']
    if 'enabled' in data:
        r.enabled = bool(data['enabled'])
    if 'rate_limit_enabled' in data:
        r.rate_limit_enabled = bool(data['rate_limit_enabled'])
    if 'rate_limit_value' in data:
        r.rate_limit_value = int(data['rate_limit_value'] or 0)
    if 'rate_limit_period' in data:
        r.rate_limit_period = data['rate_limit_period']
    if 'rate_limit_per_min' in data:
        r.rate_limit_per_min = int(data['rate_limit_per_min'] or 0)
    if 'token_limit_enabled' in data:
        r.token_limit_enabled = bool(data['token_limit_enabled'])
    if 'token_limit_value' in data:
        r.token_limit_value = int(data['token_limit_value'] or 0)
    if 'token_limit_period' in data:
        r.token_limit_period = data['token_limit_period']
    if 'token_limit_per_day' in data:
        r.token_limit_per_day = int(data['token_limit_per_day'] or 0)
    db.session.commit()
    return jsonify({'ok': True})

@admin_bp.delete('/user-keys/<int:kid>')
def delete_user_key(kid):
    if 'admin' not in session:
        return jsonify({'error': 'unauthorized'}), 401
    r = UserKey.query.get_or_404(kid)
    db.session.delete(r)
    db.session.commit()
    return jsonify({'ok': True})

@admin_bp.get('/user-keys/<int:kid>/stats')
def get_user_key_stats(kid):
    if 'admin' not in session:
        return jsonify({'error': 'unauthorized'}), 401
    
    user_key = UserKey.query.get_or_404(kid)
    
    total_requests = db.session.query(func.count(UsageLog.id)).filter(UsageLog.user_key_id == kid).scalar() or 0
    total_tokens = db.session.query(func.coalesce(func.sum(UsageLog.total_tokens), 0)).filter(UsageLog.user_key_id == kid).scalar() or 0
    
    last_7_days = datetime.utcnow().date() - timedelta(days=6)
    logs = db.session.query(UsageLog.ts, UsageLog.total_tokens).filter(
        UsageLog.user_key_id == kid,
        UsageLog.ts >= datetime.combine(last_7_days, datetime.min.time())
    ).order_by(UsageLog.ts.desc()).limit(100).all()
    
    usage_by_day = {}
    for ts, tokens in logs:
        d = ts.date()
        if d not in usage_by_day:
            usage_by_day[d] = {'date': d.isoformat(), 'requests': 0, 'tokens': 0}
        usage_by_day[d]['requests'] += 1
        usage_by_day[d]['tokens'] += int(tokens or 0)
    
    graph = []
    for i in range(7):
        d = last_7_days + timedelta(days=i)
        graph.append(usage_by_day.get(d, {'date': d.isoformat(), 'requests': 0, 'tokens': 0}))
    
    recent_logs = [{'timestamp': log.ts.isoformat(), 'tokens': log.total_tokens} for log in logs[:20]]
    
    return jsonify({
        'total_requests': total_requests,
        'total_tokens': total_tokens,
        'graph': graph,
        'recent': recent_logs
    })

@admin_bp.get('/usage')
def get_usage():
    if 'admin' not in session:
        return jsonify({'error': 'unauthorized'}), 401
    
    usage_data = db.session.query(
        cast(UsageLog.ts, Date).label('date'),
        func.count(UsageLog.id).label('requests'),
        func.sum(UsageLog.total_tokens).label('tokens')
    ).group_by(cast(UsageLog.ts, Date)).order_by(cast(UsageLog.ts, Date).desc()).limit(30).all()
    
    return jsonify([
        {
            'date': row.date.isoformat(),
            'requests': row.requests,
            'tokens': row.tokens or 0
        }
        for row in usage_data
    ])

@admin_bp.get('/cors')
def get_cors_settings():
    if 'admin' not in session:
        return jsonify({'error': 'unauthorized'}), 401
    
    settings = CorsSettings.query.first()
    if not settings:
        settings = CorsSettings()
        db.session.add(settings)
        db.session.commit()
    
    return jsonify({
        'id': settings.id,
        'allowed_origins': settings.allowed_origins,
        'allowed_methods': settings.allowed_methods,
        'allowed_headers': settings.allowed_headers,
        'allow_credentials': settings.allow_credentials,
        'max_age': settings.max_age,
        'updated_at': settings.updated_at.isoformat() if settings.updated_at else None
    })

@admin_bp.put('/cors')
def update_cors_settings():
    if 'admin' not in session:
        return jsonify({'error': 'unauthorized'}), 401
    
    settings = CorsSettings.query.first()
    if not settings:
        settings = CorsSettings()
        db.session.add(settings)
    
    data = request.get_json(silent=True) or {}
    
    if 'allowed_origins' in data:
        settings.allowed_origins = data['allowed_origins'].strip()
    if 'allowed_methods' in data:
        settings.allowed_methods = data['allowed_methods'].strip()
    if 'allowed_headers' in data:
        settings.allowed_headers = data['allowed_headers'].strip()
    if 'allow_credentials' in data:
        settings.allow_credentials = bool(data['allow_credentials'])
    if 'max_age' in data:
        settings.max_age = int(data['max_age'])
    
    db.session.commit()
    return jsonify({'ok': True})

@admin_bp.post('/playground/chat')
def playground_chat():
    if 'admin' not in session:
        return jsonify({'error': 'unauthorized'}), 401
    
    data = request.get_json(silent=True) or {}
    user_key_id = data.get('key_id')
    model = data.get('model')
    messages = data.get('messages', [])
    
    if not user_key_id:
        return jsonify({'error': 'key_id is required'}), 400
    if not model:
        return jsonify({'error': 'model is required'}), 400
    if not messages:
        return jsonify({'error': 'messages is required'}), 400
    
    user_key = UserKey.query.get(user_key_id)
    if not user_key:
        return jsonify({'error': 'Key not found'}), 404
    
    import requests
    import json
    from datetime import datetime, timedelta
    from sqlalchemy import func
    from .models import UsageLog, ProviderKey
    from .utils import extract_tokens
    
    upstream_key_env = os.getenv('UPSTREAM_API_KEY', '')
    if upstream_key_env:
        upstream_key = upstream_key_env
        provider_id = 1
    else:
        provider = ProviderKey.query.filter_by(enabled=True).first()
        if not provider:
            return jsonify({'error': 'No upstream provider configured'}), 500
        upstream_key = provider.api_key
        provider_id = provider.id
    
    upstream_url = os.getenv('UPSTREAM_URL', 'https://ai.hackclub.com/proxy/v1').rstrip('/') + '/chat/completions'
    
    try:
        resp = requests.post(
            upstream_url,
            headers={
                'Authorization': f'Bearer {upstream_key}',
                'Content-Type': 'application/json'
            },
            data=json.dumps({
                'model': model,
                'messages': messages
            }),
            timeout=120
        )
        
        if resp.status_code == 200:
            response_data = resp.json()
            pt, rt, tt = extract_tokens(response_data)
            ul = UsageLog(
                provider_key_id=provider_id,
                user_key_id=user_key.id,
                request_tokens=pt,
                response_tokens=rt,
                total_tokens=tt
            )
            db.session.add(ul)
            user_key.last_used_at = datetime.utcnow()
            db.session.commit()
            
            return jsonify(response_data)
        else:
            return jsonify({'error': 'Upstream request failed', 'status': resp.status_code}), resp.status_code
            
    except Exception as e:
        return jsonify({'error': str(e)}), 502

