import os
import json
import requests
from flask import Blueprint, session, redirect, url_for, request, jsonify, current_app
from authlib.integrations.flask_client import OAuth
from .models import User, UserKey, Conversation, UsageLog, ProviderKey
from . import db
from .utils import generate_api_key, extract_tokens
from datetime import datetime, timedelta
from sqlalchemy import func

chat_bp = Blueprint('chat', __name__)
oauth = OAuth()

def init_oauth(app):
    oauth.init_app(app)
    oauth.register(
        name='google',
        client_id=os.getenv('GOOGLE_CLIENT_ID'),
        client_secret=os.getenv('GOOGLE_CLIENT_SECRET'),
        server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
        client_kwargs={
            'scope': 'openid email profile'
        }
    )

@chat_bp.route('/auth/google')
def google_login():
    redirect_uri = url_for('chat.auth_callback', _external=True)
    return oauth.google.authorize_redirect(redirect_uri)

@chat_bp.route('/login')
def login():
    if 'user_id' in session:
        return redirect(url_for('chat.index'))
    return current_app.send_static_file('chat/login.html')

@chat_bp.route('/auth/callback')
def auth_callback():
    try:
        token = oauth.google.authorize_access_token()
        user_info = token.get('userinfo')
        if not user_info:
            user_info = oauth.google.userinfo()
        
        email = user_info.get('email')
        if not email or not email.endswith('@deakteri.hu'):
            return current_app.send_static_file('chat/denied.html')
        
        user = User.query.filter_by(email=email).first()
        if not user:
            new_key = UserKey(
                key=generate_api_key(),
                name=f"Key for {email}",
                enabled=True,
                rate_limit_enabled=True,
                rate_limit_value=60,
                rate_limit_period='minute'
            )
            db.session.add(new_key)
            db.session.commit()
            
            user = User(
                email=email,
                name=user_info.get('name'),
                picture=user_info.get('picture'),
                google_id=user_info.get('sub'),
                user_key_id=new_key.id
            )
            db.session.add(user)
            db.session.commit()
        else:
            user.name = user_info.get('name')
            user.picture = user_info.get('picture')
            db.session.commit()
        
        session['user_id'] = user.id
        return redirect(url_for('chat.index'))
    except Exception as e:
        return f"Authentication failed: {str(e)}", 400

@chat_bp.route('/logout')
def logout():
    session.pop('user_id', None)
    return redirect(url_for('chat.index'))

@chat_bp.route('/chat')
def index():
    if 'user_id' not in session:
        return redirect(url_for('chat.login'))
    return current_app.send_static_file('chat/index.html')

@chat_bp.route('/api/chat/me')
def get_me():
    if 'user_id' not in session:
        return jsonify({'error': 'unauthorized'}), 401
    user = User.query.get(session['user_id'])
    if not user:
        return jsonify({'error': 'user not found'}), 404
    return jsonify({
        'name': user.name,
        'picture': user.picture,
        'email': user.email
    })

@chat_bp.route('/api/chat/history')
def get_history():
    if 'user_id' not in session:
        return jsonify({'error': 'unauthorized'}), 401
    
    user_id = session['user_id']
    conversations = Conversation.query.filter_by(user_id=user_id).order_by(Conversation.updated_at.desc()).all()
    
    return jsonify([{
        'id': c.id,
        'title': c.title or 'New Chat',
        'updated_at': c.updated_at.isoformat()
    } for c in conversations])

@chat_bp.route('/api/chat/conversation/<int:conv_id>')
def get_conversation(conv_id):
    if 'user_id' not in session:
        return jsonify({'error': 'unauthorized'}), 401
    
    user_id = session['user_id']
    conv = Conversation.query.filter_by(id=conv_id, user_id=user_id).first()
    if not conv:
        return jsonify({'error': 'not found'}), 404
        
    return jsonify({
        'id': conv.id,
        'title': conv.title,
        'messages': conv.messages
    })

@chat_bp.post('/api/chat/message')
def send_message():
    if 'user_id' not in session:
        return jsonify({'error': 'unauthorized'}), 401
    
    user_id = session['user_id']
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'user not found'}), 404
        
    data = request.get_json()
    message = data.get('message')
    conv_id = data.get('conversation_id')
    
    if not message:
        return jsonify({'error': 'message required'}), 400
        
    if conv_id:
        conv = Conversation.query.filter_by(id=conv_id, user_id=user_id).first()
        if not conv:
            return jsonify({'error': 'conversation not found'}), 404
    else:
        conv = Conversation(user_id=user_id, title=message[:30], messages=[])
        db.session.add(conv)
        db.session.commit()
    
    messages = list(conv.messages)
    messages.append({'role': 'user', 'content': message})
    
    user_key = user.user_key
    now = datetime.utcnow()
    
    # Rate limiting
    if user_key.rate_limit_enabled and user_key.rate_limit_value > 0:
        period_seconds = {'second': 1, 'minute': 60, 'hour': 3600, 'day': 86400}.get(user_key.rate_limit_period, 60)
        start_time = now - timedelta(seconds=period_seconds)
        count = db.session.query(func.count(UsageLog.id)).filter(UsageLog.user_key_id == user_key.id, UsageLog.ts >= start_time).scalar() or 0
        if count >= user_key.rate_limit_value:
            return jsonify({'error': 'rate_limit_exceeded'}), 429

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
        
    upstream_models_url = os.getenv('UPSTREAM_URL', 'https://ai.hackclub.com/proxy/v1').rstrip('/') + '/models'
    model = 'gpt-3.5-turbo'
    try:
        r = requests.get(upstream_models_url, headers={'Authorization': f'Bearer {upstream_key}'}, timeout=5)
        if r.status_code == 200:
            m_data = r.json()
            src = m_data.get('data') or m_data.get('models') or []
            if src:
                first = src[0]
                if isinstance(first, dict):
                    model = first.get('id') or first.get('name')
                elif isinstance(first, str):
                    model = first
    except:
        pass

    upstream_chat_url = os.getenv('UPSTREAM_URL', 'https://ai.hackclub.com/proxy/v1').rstrip('/') + '/chat/completions'
    
    try:
        resp = requests.post(
            upstream_chat_url,
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
            resp_data = resp.json()
            assistant_msg = resp_data['choices'][0]['message']['content']
            
            messages.append({'role': 'assistant', 'content': assistant_msg})
            conv.messages = messages
            conv.updated_at = datetime.utcnow()
            
            pt, rt, tt = extract_tokens(resp_data)
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
            
            return jsonify({
                'conversation_id': conv.id,
                'message': assistant_msg,
                'title': conv.title
            })
        else:
            return jsonify({'error': 'Upstream error', 'details': resp.text}), resp.status_code
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500
