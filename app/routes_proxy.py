import os
import json
import requests
from flask import Blueprint, request, jsonify, make_response
from .models import UsageLog, CorsSettings
from .utils import eligible_keys, extract_tokens
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
        return jsonify({'error': 'missing token'}), 401
    proxy_token = auth.split(' ', 1)[1]
    if proxy_token != os.getenv('PROXY_AUTH_TOKEN', ''):
        return jsonify({'error': 'unauthorized'}), 401
    body = request.get_json(force=True)
    keys = eligible_keys()
    if not keys:
        return jsonify({'error': 'no_available_keys'}), 503
    key = keys[0]
    upstream = os.getenv('UPSTREAM_URL', 'https://ai.hackclub.com/proxy/v1').rstrip('/') + '/chat/completions'
    try:
        resp = requests.post(
            upstream,
            headers={'Authorization': f'Bearer {key.api_key}', 'Content-Type': 'application/json'},
            data=json.dumps(body),
            timeout=120,
        )
    except Exception:
        return jsonify({'error': 'upstream_error'}), 502
    ct = resp.headers.get('Content-Type', '')
    if 'application/json' in ct:
        data = resp.json()
        pt, rt, tt = extract_tokens(data)
        ul = UsageLog(provider_key_id=key.id, request_tokens=pt, response_tokens=rt, total_tokens=tt)
        db.session.add(ul)
        db.session.commit()
        response = make_response(jsonify(data), resp.status_code)
        return apply_cors_headers(response)
    ul = UsageLog(provider_key_id=key.id)
    db.session.add(ul)
    db.session.commit()
    response = make_response(resp.content, resp.status_code, {'Content-Type': ct})
    return apply_cors_headers(response)
