import os
import json
import requests
from flask import Blueprint, session, redirect, url_for, request, jsonify, current_app
from authlib.integrations.flask_client import OAuth
from .models import User, UserKey, Conversation, UsageLog, ProviderKey
from . import db
from .utils import generate_api_key, extract_tokens, gather_web_context
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
    env = os.getenv('ENVIRONMENT', 'development')
    scheme = 'https' if env == 'production' else None
    redirect_uri = url_for('chat.auth_callback', _external=True, _scheme=scheme)
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

@chat_bp.route('/api/chat/conversation/<int:conv_id>', methods=['DELETE'])
def delete_conversation(conv_id):
    if 'user_id' not in session:
        return jsonify({'error': 'unauthorized'}), 401

    user_id = session['user_id']
    conv = Conversation.query.filter_by(id=conv_id, user_id=user_id).first()
    if not conv:
        return jsonify({'error': 'not found'}), 404

    db.session.delete(conv)
    db.session.commit()
    return jsonify({'deleted': True})

@chat_bp.route('/api/chat/models')
def get_models():
    if 'user_id' not in session:
        return jsonify({'error': 'unauthorized'}), 401
        
    try:
        with open(os.path.join(current_app.root_path, 'available_models.json'), 'r') as f:
            models_data = json.load(f)
        return jsonify(models_data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def get_upstream_config():
    upstream_key_env = os.getenv('UPSTREAM_API_KEY', '')
    if upstream_key_env:
        upstream_key = upstream_key_env
        provider_id = 1
    else:
        provider = ProviderKey.query.filter_by(enabled=True).first()
        if not provider:
            raise Exception('No upstream provider configured')
        upstream_key = provider.api_key
        provider_id = provider.id
    
    upstream_url = os.getenv('UPSTREAM_URL', 'https://ai.hackclub.com/proxy/v1').rstrip('/')
    return upstream_key, provider_id, upstream_url

def route_request(message, has_files, upstream_key, upstream_url):
    router_prompt = (
        "You are a model router. Decide which AI model to use for the user's request.\n"
        "Available models: \n"
        "- google/gemini-3-pro-image-preview (Image Generation)\n"
        "- google/gemini-3-pro-preview (Complex Multimodal, Reasoning, Coding, Files)\n"
        "- openai/gpt-5.1 (Complex Reasoning, Coding)\n"
        "- openai/gpt-5-mini (General Chat, Fast)\n"
        "- nvidia/nemotron-nano-12b-v2-vl (Video/Document Understanding)\n"
        "Rules:\n"
        "1. If the user asks to generate, create, or draw an image, use 'google/gemini-3-pro-image-preview'.\n"
        "2. If the user provides files/images (has_files=True), use 'google/gemini-3-pro-preview'.\n"
        "3. For complex reasoning or coding, use 'openai/gpt-5.1'.\n"
        "4. For general chat, use 'openai/gpt-5-mini'.\n"
        "Return ONLY the model name."
    )
    
    try:
        resp = requests.post(
            f"{upstream_url}/chat/completions",
            headers={'Authorization': f'Bearer {upstream_key}', 'Content-Type': 'application/json'},
            data=json.dumps({
                'model': 'openai/gpt-5-mini',
                'messages': [
                    {'role': 'system', 'content': router_prompt},
                    {'role': 'user', 'content': f"Request: {message[:500]}\nHas files: {has_files}"}
                ],
                'temperature': 0.0
            }),
            timeout=10
        )
        if resp.status_code == 200:
            model = resp.json()['choices'][0]['message']['content'].strip()
            return model
    except:
        pass
    return 'openai/gpt-5.1'

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
    requested_model = data.get('model')
    attachments = data.get('attachments', [])
    use_web_search = bool(data.get('use_web_search'))
    web_context = []
    
    if not message and not attachments:
        return jsonify({'error': 'message or attachments required'}), 400

    if use_web_search and message:
        try:
            web_context = gather_web_context(message)
        except Exception:
            web_context = []
        
    if conv_id:
        conv = Conversation.query.filter_by(id=conv_id, user_id=user_id).first()
        if not conv:
            return jsonify({'error': 'conversation not found'}), 404
    else:
        title = message[:30] if message else "New Chat"
        conv = Conversation(user_id=user_id, title=title, messages=[])
        db.session.add(conv)
        db.session.commit()
    
    user_content = message
    if attachments:
        user_content = [{"type": "text", "text": message or ""}]
        for att in attachments:
            user_content.append({
                "type": "image_url",
                "image_url": {"url": att}
            })
    
    messages = list(conv.messages)
    messages.append({'role': 'user', 'content': user_content, 'images': attachments if attachments else None})
    
    user_key = user.user_key
    now = datetime.utcnow()
    
    if user_key.rate_limit_enabled and user_key.rate_limit_value > 0:
        period_seconds = {'second': 1, 'minute': 60, 'hour': 3600, 'day': 86400}.get(user_key.rate_limit_period, 60)
        start_time = now - timedelta(seconds=period_seconds)
        count = db.session.query(func.count(UsageLog.id)).filter(UsageLog.user_key_id == user_key.id, UsageLog.ts >= start_time).scalar() or 0
        if count >= user_key.rate_limit_value:
            return jsonify({'error': 'rate_limit_exceeded'}), 429

    try:
        upstream_key, provider_id, upstream_url = get_upstream_config()
    except Exception as e:
        return jsonify({'error': str(e)}), 500

    final_model = requested_model
    if not final_model or final_model == 'AI':
        final_model = route_request(message or "Image analysis", bool(attachments), upstream_key, upstream_url)

    context_message = None
    if web_context:
        snippets = []
        for idx, item in enumerate(web_context, start=1):
            title = item.get('title') or 'Result'
            url = item.get('url') or ''
            content = item.get('content') or ''
            snippets.append(f"[{idx}] {title} ({url}): {content}")
        context_message = {
            'role': 'system',
            'content': 'Use the following fresh web results to ground your answer. Cite the matching bracket number in your response when relevant.\n' + '\n\n'.join(snippets)
        }

    upstream_messages = []
    for m in messages:
        content = m.get('content')
        if isinstance(content, list):
            valid_content = []
            for part in content:
                if part.get('type') == 'image_url' and part.get('image_url', {}).get('url', '').startswith('data:'):
                    valid_content.append(part)
                elif part.get('type') == 'text':
                    valid_content.append(part)
            upstream_messages.append({'role': m['role'], 'content': valid_content})
        else:
            upstream_messages.append({'role': m['role'], 'content': content})

    if context_message:
        upstream_messages.insert(0, context_message)

    try:
        resp = requests.post(
            f"{upstream_url}/chat/completions",
            headers={
                'Authorization': f'Bearer {upstream_key}',
                'Content-Type': 'application/json'
            },
            data=json.dumps({
                'model': final_model,
                'messages': upstream_messages
            }),
            timeout=120
        )
        
        if resp.status_code == 200:
            resp_data = resp.json()
            choice = resp_data['choices'][0]
            assistant_msg_content = choice['message']['content']
            
            response_images = []
            if 'images' in choice['message']:
                response_images = choice['message']['images']
            elif 'image_url' in choice['message']:
                 response_images = [choice['message']['image_url']]
            
            assistant_message_obj = {
                'role': 'assistant', 
                'content': assistant_msg_content,
                'model': final_model
            }
            if response_images:
                assistant_message_obj['images'] = response_images
            if web_context:
                assistant_message_obj['sources'] = web_context

            messages.append(assistant_message_obj)
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
                'message': assistant_msg_content,
                'images': response_images,
                'title': conv.title,
                'model': final_model,
                'sources': web_context
            })
        else:
            return jsonify({'error': 'Upstream error', 'details': resp.text}), resp.status_code
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500
