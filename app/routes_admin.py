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
    return jsonify([
        {
            'id': r.id,
            'name': r.name,
            'key': mask_key(r.key),
            'enabled': r.enabled,
            'rate_limit_enabled': r.rate_limit_enabled,
            'rate_limit_per_min': r.rate_limit_per_min,
            'token_limit_enabled': r.token_limit_enabled,
            'token_limit_per_day': r.token_limit_per_day,
            'created_at': r.created_at.isoformat(),
            'last_used_at': r.last_used_at.isoformat() if r.last_used_at else None,
        }
        for r in rows
    ])

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
        rate_limit_per_min=int(data.get('rate_limit_per_min') or 0),
        token_limit_enabled=bool(data.get('token_limit_enabled', False)),
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
    if 'rate_limit_per_min' in data:
        r.rate_limit_per_min = int(data['rate_limit_per_min'] or 0)
    if 'token_limit_enabled' in data:
        r.token_limit_enabled = bool(data['token_limit_enabled'])
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
