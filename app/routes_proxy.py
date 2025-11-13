import os
import json
import requests
from datetime import datetime
from flask import Blueprint, request, jsonify, make_response
from .models import UsageLog, CorsSettings, UserKey, ProviderKey
from .utils import extract_tokens
from . import db

api_bp = Blueprint('api', __name__)

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
    
    upstream_key_env = os.getenv('UPSTREAM_API_KEY', '')
    if upstream_key_env:
        upstream_key = upstream_key_env
        provider_id = 1
    else:
        provider = ProviderKey.query.filter_by(enabled=True).first()
        if not provider:
            return jsonify({'error': 'no_provider_configured', 'message': 'No upstream provider key configured'}), 500
        upstream_key = provider.api_key
        provider_id = provider.id
    
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
