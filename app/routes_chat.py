import os
import json
import unicodedata
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from flask import Blueprint, session, redirect, url_for, request, jsonify, current_app, Response, stream_with_context
from authlib.integrations.flask_client import OAuth
from .models import User, UserKey, Conversation, UsageLog, ProviderKey, EmailWhitelist
from . import db
from .utils import generate_api_key, extract_tokens, gather_web_context
from datetime import datetime, timedelta
from sqlalchemy import func

WEB_SEARCH_LIMIT_NORMAL = 25
WEB_SEARCH_LIMIT_ULTIMATE = 65

chat_bp = Blueprint('chat', __name__)
oauth = OAuth()

class UpstreamError(Exception):
    def __init__(self, message, status_code=500):
        super().__init__(message)
        self.status_code = status_code

MODE_ALIASES = {
    'general': 'general',
    'altalanos': 'general',
    'normal': 'general',
    'pontos': 'precise',
    'precise': 'precise',
    'turbo': 'turbo',
    'ultimate': 'ultimate',
    'manual': 'manual'
}

DEFAULT_PRECISE_MODEL = os.getenv('PRECISE_MODEL', 'openai/gpt-5.1')
DEFAULT_TURBO_MODEL = os.getenv('TURBO_MODEL', 'google/gemini-3-pro-preview')
DEFAULT_ULTIMATE_MODELS = [
    os.getenv('ULTIMATE_MODEL_A', 'openai/gpt-5.1'),
    os.getenv('ULTIMATE_MODEL_B', 'google/gemini-3-pro-preview'),
    os.getenv('ULTIMATE_MODEL_C', 'deepseek/deepseek-v3.2-exp')
]
DEFAULT_ULTIMATE_FUSION_MODEL = os.getenv('ULTIMATE_FUSION_MODEL', 'moonshotai/kimi-k2-thinking')

def normalize_mode(value):
    if not value:
        return 'general'
    raw = str(value).strip().lower()
    folded = ''.join(ch for ch in unicodedata.normalize('NFKD', raw) if unicodedata.category(ch) != 'Mn')
    return MODE_ALIASES.get(folded, 'general')

def trim_text(value, limit=2000):
    if value is None:
        return ''
    text = str(value).strip()
    if len(text) > limit:
        return text[:limit] + '...'
    return text

def get_model_pricing(model_id):
    try:
        models_path = os.path.join(current_app.root_path, 'available_models.json')
        with open(models_path, 'r') as f:
            data = json.load(f)
        for model in data.get('data', []):
            if model.get('id') == model_id:
                pricing = model.get('pricing', {})
                return {
                    'prompt': float(pricing.get('prompt', 0)),
                    'completion': float(pricing.get('completion', 0)),
                    'image': float(pricing.get('image', 0))
                }
    except Exception:
        pass
    return {'prompt': 0, 'completion': 0, 'image': 0}

def calculate_cost(model_id, prompt_tokens, completion_tokens):
    pricing = get_model_pricing(model_id)
    cost = (prompt_tokens * pricing['prompt']) + (completion_tokens * pricing['completion'])
    return round(cost, 6)

def build_history_digest(history, limit=4):
    digest = []
    slice_source = history[-limit:]
    for entry in slice_source:
        content = entry.get('content') if isinstance(entry, dict) else None
        text = ''
        if isinstance(content, list):
            text = ' '.join(part.get('text', '') for part in content if part.get('type') == 'text').strip()
        elif isinstance(content, str):
            text = content.strip()
        if not text:
            continue
        digest.append(f"{entry.get('role', 'user')}: {trim_text(text, 400)}")
    return '\n'.join(digest)

def execute_completion(model_name, messages, upstream_key, upstream_url, temperature=None, stream=False):
    payload = {'model': model_name, 'messages': messages, 'stream': stream}
    if temperature is not None:
        payload['temperature'] = temperature
    resp = requests.post(
        f"{upstream_url}/chat/completions",
        headers={'Authorization': f'Bearer {upstream_key}', 'Content-Type': 'application/json'},
        data=json.dumps(payload),
        timeout=120,
        stream=stream
    )
    if resp.status_code != 200:
        raise UpstreamError(resp.text or 'Upstream error', resp.status_code)
    
    if stream:
        return resp
    
    data = resp.json()
    choice = data['choices'][0]['message']
    content = choice.get('content')
    response_images = []
    if isinstance(choice.get('images'), list):
        response_images = choice['images']
    elif choice.get('image_url'):
        response_images = [choice['image_url']]
    return content, response_images, data

def resolve_ultimate_models():
    configured = current_app.config.get('ULTIMATE_MODELS')
    if isinstance(configured, str):
        values = [item.strip() for item in configured.split(',') if item.strip()]
    elif isinstance(configured, (list, tuple)):
        values = [item for item in configured if item]
    else:
        values = []
    base = values or [m for m in DEFAULT_ULTIMATE_MODELS if m]
    seen = []
    for model_name in base:
        if model_name and model_name not in seen:
            seen.append(model_name)
    return seen

def resolve_fusion_model():
    fusion = current_app.config.get('ULTIMATE_FUSION_MODEL')
    return fusion or DEFAULT_ULTIMATE_FUSION_MODEL

def run_ultimate_ensemble(upstream_messages, history_messages, upstream_key, upstream_url, original_prompt, web_context):
    models = resolve_ultimate_models()
    fusion_model = resolve_fusion_model()
    results = []
    usage = {'prompt': 0, 'response': 0, 'total': 0}

    def call_model(model_name):
        content, images, data = execute_completion(model_name, upstream_messages, upstream_key, upstream_url)
        return model_name, content, images, data

    with ThreadPoolExecutor(max_workers=len(models)) as executor:
        futures = {executor.submit(call_model, m): m for m in models}
        for future in as_completed(futures):
            model_name = futures[future]
            try:
                name, content, images, data = future.result()
                results.append({'model': name, 'content': content or '', 'images': images})
                pt, rt, tt = extract_tokens(data)
                usage['prompt'] += pt
                usage['response'] += rt
                usage['total'] += tt
            except Exception as exc:
                current_app.logger.warning('Ultimate candidate failed (%s): %s', model_name, exc)
    if not results:
        raise UpstreamError('All ultimate candidate models failed', 502)
    if len(results) == 1:
        return {
            'content': results[0]['content'],
            'images': results[0]['images'],
            'model': results[0]['model'],
            'candidates': results,
            'usage': usage,
            'aggregator_model': results[0]['model']
        }
    history_digest = build_history_digest(history_messages)
    candidate_sections = []
    for idx, item in enumerate(results, start=1):
        snippet = trim_text(item['content'], 4000)
        candidate_sections.append(f"Model {idx} ({item['model']}):\n{snippet or '(empty)'}")
    web_section = ''
    if web_context:
        formatted = []
        for idx, entry in enumerate(web_context[:3], start=1):
            title = entry.get('title') or 'Result'
            content = entry.get('content') or ''
            formatted.append(f"[{idx}] {title}: {trim_text(content, 400)}")
        web_section = '\n'.join(formatted)
    prompt_parts = []
    if history_digest:
        prompt_parts.append(f"Conversation summary:\n{history_digest}")
    if original_prompt:
        prompt_parts.append(f"Latest request:\n{original_prompt}")
    if web_section:
        prompt_parts.append(f"Web findings:\n{web_section}")
    prompt_parts.append("Candidate answers:\n" + '\n\n'.join(candidate_sections))
    fusion_messages = [
        {
            'role': 'system',
            'content': 'You merge multiple elite AI answers into one decisive response. Compare their reasoning, resolve conflicts, cite the strongest evidence, and answer in the user\'s language with SAT/Olympiad-level precision. Prefer accuracy over style.'
        },
        {
            'role': 'user',
            'content': '\n\n'.join(prompt_parts)
        }
    ]
    content, images, fusion_data = execute_completion(fusion_model, fusion_messages, upstream_key, upstream_url, temperature=0.2)
    pt, rt, tt = extract_tokens(fusion_data)
    usage['prompt'] += pt
    usage['response'] += rt
    usage['total'] += tt
    return {
        'content': content or '',
        'images': images,
        'model': 'ultimate-ensemble',
        'candidates': results,
        'usage': usage,
        'aggregator_model': fusion_model
    }

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

def check_email_allowed(email):
    if not email:
        return False
    whitelist = EmailWhitelist.query.first()
    if not whitelist:
        return True
    emails_raw = whitelist.whitelisted_emails or ''
    domains_raw = whitelist.whitelisted_domains or ''
    if not emails_raw.strip() and not domains_raw.strip():
        return True
    allowed_emails = [e.strip().lower() for e in emails_raw.split('\n') if e.strip()]
    allowed_domains = [d.strip().lower() for d in domains_raw.split('\n') if d.strip()]
    email_lower = email.lower()
    if email_lower in allowed_emails:
        return True
    for domain in allowed_domains:
        if email_lower.endswith(domain):
            return True
    return False

@chat_bp.route('/auth/callback')
def auth_callback():
    try:
        token = oauth.google.authorize_access_token()
        user_info = token.get('userinfo')
        if not user_info:
            user_info = oauth.google.userinfo()
        
        email = user_info.get('email')
        if not email or not check_email_allowed(email):
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
        'email': user.email,
        'ultimate_enabled': bool(user.ultimate_enabled)
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

@chat_bp.route('/api/chat/names', methods=['POST'])
def get_chat_names_batch():
    if 'user_id' not in session:
        return jsonify({'error': 'unauthorized'}), 401

    user_id = session['user_id']
    data = request.get_json()
    conv_ids = data.get('ids', [])
    
    if not conv_ids:
        return jsonify({'names': {}})
    
    conversations = Conversation.query.filter(
        Conversation.id.in_(conv_ids),
        Conversation.user_id == user_id
    ).all()
    
    conv_map = {c.id: c for c in conversations}
    result = {}
    
    for conv_id in conv_ids:
        conv = conv_map.get(conv_id)
        if not conv:
            continue
        
        current_title = (conv.title or '').strip()
        if current_title and current_title != 'New Chat':
            result[conv_id] = current_title
            continue
        
        history_messages = conv.messages or []
        if history_messages:
            first = history_messages[0]
            content = first.get('content') if isinstance(first, dict) else None
            text = ''
            if isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and part.get('type') == 'text':
                        text = part.get('text', '')
                        break
            elif isinstance(content, str):
                text = content
            text = (text or '').strip()
            if text:
                result[conv_id] = text[:40] + ('...' if len(text) > 40 else '')
                continue
        
        result[conv_id] = current_title or 'New Chat'
    
    return jsonify({'names': result})

@chat_bp.route('/api/chat/name/<int:conv_id>')
def get_chat_name(conv_id):
    if 'user_id' not in session:
        return jsonify({'error': 'unauthorized'}), 401

    user_id = session['user_id']
    conv = Conversation.query.filter_by(id=conv_id, user_id=user_id).first()
    if not conv:
        return jsonify({'error': 'not found'}), 404

    history_messages = conv.messages or []

    def initial_title_guess():
        if not history_messages:
            return None
        first = history_messages[0]
        content = first.get('content') if isinstance(first, dict) else None
        text = ''
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get('type') == 'text':
                    text = part.get('text', '')
                    break
        elif isinstance(content, str):
            text = content
        return (text or '').strip()[:30] or None

    initial_guess = initial_title_guess()
    current_title = (conv.title or '').strip()
    fallback = current_title or 'New Chat'

    if current_title and current_title != 'New Chat' and initial_guess and current_title != initial_guess:
        return jsonify({'name': current_title})

    digest = build_history_digest(history_messages, limit=6)
    if not digest:
        return jsonify({'name': fallback})

    try:
        upstream_key, _, upstream_url = get_upstream_config()
        prompt = (
            "Generate a short 3-5 word title for this chat. "
            "Keep it under 50 characters, no quotes, sentence case. "
            "Stay neutral and specific.\n\nConversation:\n" + digest
        )
        content, _, _ = execute_completion(
            DEFAULT_PRECISE_MODEL,
            [
                {'role': 'system', 'content': 'You write concise chat titles.'},
                {'role': 'user', 'content': prompt}
            ],
            upstream_key,
            upstream_url,
            stream=False
        )
        name = ''
        if isinstance(content, list):
            name = ' '.join(part.get('text', '') for part in content if isinstance(part, dict))
        elif isinstance(content, str):
            name = content
        name = (name or '').strip()
        name = name.split('\n')[0].strip(' "\'')
        if len(name) > 60:
            name = name[:57] + '...'
        if not name:
            return jsonify({'name': fallback})
        conv.title = name
        conv.updated_at = datetime.utcnow()
        db.session.commit()
        return jsonify({'name': name})
    except Exception as exc:
        current_app.logger.warning('chat name generation failed: %s', exc)
        return jsonify({'name': fallback})

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

def load_available_models():
    try:
        models_path = os.path.join(current_app.root_path, 'available_models.json')
        with open(models_path, 'r') as f:
            data = json.load(f)
        models = data.get('data', [])
        model_list = []
        for model in models:
            model_id = model.get('id', '')
            name = model.get('name', '')
            description = model.get('description', '')
            modality = model.get('architecture', {}).get('modality', '')
            model_list.append({
                'id': model_id,
                'name': name,
                'description': description,
                'modality': modality
            })
        return model_list
    except Exception as e:
        current_app.logger.warning('Failed to load available models: %s', e)
        return []

def route_request(message, has_files, upstream_key, upstream_url):
    try:
        available = load_available_models()
        if not available:
            return 'google/gemini-2.5-flash'
        
        models_text = "Available models:\n"
        for idx, m in enumerate(available, 1):
            models_text += f"{idx}. {m['id']} - {m['name']}\n   Modality: {m['modality']}\n"
        
        router_prompt = (
            "You are an intelligent model router. Based on the user's request and available models, "
            "select the BEST model for the task.\n\n"
            f"{models_text}\n\n"
            "Selection Rules:\n"
            "1. If user asks to generate/create/draw images: choose image-capable models (check modality for 'image' in output).\n"
            "2. If user uploads files/images: choose multimodal models with 'image' in modality.\n"
            "3. For coding/complex reasoning: prefer models with strong reasoning capabilities.\n"
            "4. For general chat: prefer fast, efficient models.\n"
            "5. For video/document analysis: prefer models with 'video' or 'file' in input modalities.\n\n"
            "Return ONLY the model ID (e.g., 'google/gemini-3-pro-preview'), nothing else."
        )
        
        resp = requests.post(
            f"{upstream_url}/chat/completions",
            headers={'Authorization': f'Bearer {upstream_key}', 'Content-Type': 'application/json'},
            data=json.dumps({
                'model': 'google/gemini-2.5-flash',
                'messages': [
                    {'role': 'system', 'content': router_prompt},
                    {'role': 'user', 'content': f"Request: {message[:500]}\nUser has uploaded files: {has_files}"}
                ],
                'temperature': 0.0
            }),
            timeout=10
        )
        if resp.status_code == 200:
            model = resp.json()['choices'][0]['message']['content'].strip()
            if model:
                return model
    except Exception as e:
        current_app.logger.warning('Model routing failed: %s', e)
    
    return 'google/gemini-2.5-flash'

@chat_bp.post('/api/chat/message')
def send_message():
    if 'user_id' not in session:
        return jsonify({'error': 'unauthorized'}), 401
    
    user_id = session['user_id']
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'user not found'}), 404
        
    data = request.get_json() or {}
    message = data.get('message')
    conv_id = data.get('conversation_id')
    requested_model = data.get('model')
    attachments = data.get('attachments', [])
    use_web_search = bool(data.get('use_web_search'))
    mode = normalize_mode(data.get('mode'))
    use_stream = bool(data.get('stream', True))
    
    if mode == 'ultimate' and not user.ultimate_enabled:
        return jsonify({'error': 'ultimate_not_allowed'}), 403
    web_context = []
    
    if not message and not attachments:
        return jsonify({'error': 'message or attachments required'}), 400

    if use_web_search and message:
        now = datetime.utcnow()
        if user.web_search_reset is None or user.web_search_reset <= now:
            first_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            if now.month == 12:
                next_month = first_of_month.replace(year=now.year + 1, month=1)
            else:
                next_month = first_of_month.replace(month=now.month + 1)
            user.web_search_reset = next_month
            user.web_search_count = 0
            db.session.commit()
        limit = WEB_SEARCH_LIMIT_ULTIMATE if user.ultimate_enabled else WEB_SEARCH_LIMIT_NORMAL
        if user.web_search_count >= limit:
            return jsonify({'error': 'web_search_limit_exceeded', 'limit': limit}), 429
        try:
            web_context = gather_web_context(message)
            user.web_search_count += 1
            db.session.commit()
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

    meta = {'mode': mode}
    
    if mode == 'general':
        if requested_model and requested_model != 'AI':
            final_model = requested_model
        else:
            final_model = route_request(message or "Image analysis", bool(attachments), upstream_key, upstream_url)
    elif mode == 'precise':
        final_model = DEFAULT_PRECISE_MODEL
    elif mode == 'turbo':
        final_model = DEFAULT_TURBO_MODEL
    elif mode == 'manual':
        if requested_model and requested_model != 'AI':
            final_model = requested_model
        else:
            final_model = route_request(message or "Image analysis", bool(attachments), upstream_key, upstream_url)
    else:
        final_model = DEFAULT_PRECISE_MODEL

    if mode == 'ultimate' or not use_stream:
        response_images = []
        assistant_msg_content = ''
        usage_prompt = 0
        usage_response = 0
        usage_total = 0
        try:
            if mode == 'ultimate':
                ensemble = run_ultimate_ensemble(upstream_messages, messages, upstream_key, upstream_url, message or '', web_context)
                assistant_msg_content = ensemble['content']
                response_images = ensemble['images']
                final_model = ensemble['model']
                usage_prompt = ensemble['usage']['prompt']
                usage_response = ensemble['usage']['response']
                usage_total = ensemble['usage']['total']
                meta['ultimate_candidates'] = [
                    {
                        'model': item['model'],
                        'excerpt': trim_text(item['content'], 1200)
                    }
                    for item in ensemble['candidates']
                ]
                meta['aggregator_model'] = ensemble['aggregator_model']
            else:
                assistant_msg_content, response_images, resp_data = execute_completion(final_model, upstream_messages, upstream_key, upstream_url)
                usage_prompt, usage_response, usage_total = extract_tokens(resp_data)
        except UpstreamError as exc:
            return jsonify({'error': 'Upstream error', 'details': str(exc)}), exc.status_code
        except Exception as exc:
            return jsonify({'error': str(exc)}), 500

        assistant_message_obj = {
            'role': 'assistant',
            'content': assistant_msg_content or '',
            'model': final_model
        }
        if response_images:
            assistant_message_obj['images'] = response_images
        if web_context:
            assistant_message_obj['sources'] = web_context
        
        meta['request_tokens'] = usage_prompt
        meta['response_tokens'] = usage_response
        
        if meta:
            assistant_message_obj['meta'] = meta

        messages.append(assistant_message_obj)
        conv.messages = messages
        conv.updated_at = datetime.utcnow()

        cost = calculate_cost(final_model, usage_prompt, usage_response)
        ul = UsageLog(
            provider_key_id=provider_id,
            user_key_id=user_key.id,
            request_tokens=usage_prompt,
            response_tokens=usage_response,
            total_tokens=usage_total,
            model=final_model,
            cost=cost
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
            'sources': web_context,
            'meta': meta,
            'mode': mode
        })
    
    def generate_stream():
        try:
            stream_resp = execute_completion(final_model, upstream_messages, upstream_key, upstream_url, stream=True)
            
            initial_data = {
                'conversation_id': conv.id,
                'model': final_model,
                'title': conv.title,
                'sources': web_context,
                'meta': meta,
                'mode': mode,
                'images': []
            }
            yield f"data: {json.dumps({'type': 'start', 'data': initial_data})}\n\n"
            
            accumulated_content = ''
            response_images = []
            usage_prompt = 0
            usage_response = 0
            usage_total = 0
            
            for line in stream_resp.iter_lines():
                if line:
                    line_str = line.decode('utf-8')
                    if line_str.startswith('data: '):
                        chunk_data = line_str[6:]
                        if chunk_data.strip() == '[DONE]':
                            break
                        try:
                            chunk = json.loads(chunk_data)
                            if 'choices' in chunk and len(chunk['choices']) > 0:
                                choice = chunk['choices'][0]
                                delta = choice.get('delta', {})
                                content = delta.get('content', '')
                                if content:
                                    accumulated_content += content
                                    yield f"data: {json.dumps({'type': 'content', 'content': content})}\n\n"
                                
                                if 'images' in choice and isinstance(choice['images'], list):
                                    response_images.extend(choice['images'])
                                elif 'image_url' in choice:
                                    response_images.append(choice['image_url'])
                            
                            if 'usage' in chunk:
                                usage_prompt = chunk['usage'].get('prompt_tokens', 0)
                                usage_response = chunk['usage'].get('completion_tokens', 0)
                                usage_total = chunk['usage'].get('total_tokens', 0)
                        except json.JSONDecodeError:
                            pass
            
            assistant_message_obj = {
                'role': 'assistant',
                'content': accumulated_content,
                'model': final_model
            }
            if response_images:
                assistant_message_obj['images'] = response_images
                yield f"data: {json.dumps({'type': 'images', 'images': response_images})}\n\n"
            if web_context:
                assistant_message_obj['sources'] = web_context
            
            meta['request_tokens'] = usage_prompt
            meta['response_tokens'] = usage_response
            
            if meta:
                assistant_message_obj['meta'] = meta

            messages.append(assistant_message_obj)
            conv.messages = messages
            conv.updated_at = datetime.utcnow()

            cost = calculate_cost(final_model, usage_prompt, usage_response)
            ul = UsageLog(
                provider_key_id=provider_id,
                user_key_id=user_key.id,
                request_tokens=usage_prompt,
                response_tokens=usage_response,
                total_tokens=usage_total,
                model=final_model,
                cost=cost
            )
            db.session.add(ul)
            user_key.last_used_at = datetime.utcnow()
            db.session.commit()
            
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
    
    return Response(stream_with_context(generate_stream()), mimetype='text/event-stream')

@chat_bp.route('/admin/spending/total')
def admin_total_spending():
    if 'admin' not in session:
        return jsonify({'error': 'unauthorized'}), 401
    
    total_cost = 0.0
    
    users = User.query.all()
    for user in users:
        conversations = Conversation.query.filter_by(user_id=user.id).all()
        for conv in conversations:
            messages = conv.messages or []
            for msg in messages:
                if isinstance(msg, dict) and msg.get('role') == 'assistant':
                    model = msg.get('model')
                    if not model:
                        continue
                    
                    content = msg.get('content', '')
                    meta = msg.get('meta', {})
                    
                    request_tokens = 0
                    response_tokens = 0
                    
                    if isinstance(meta, dict):
                        request_tokens = meta.get('request_tokens', 0)
                        response_tokens = meta.get('response_tokens', 0)
                    
                    if request_tokens > 0 or response_tokens > 0:
                        cost = calculate_cost(model, request_tokens, response_tokens)
                        total_cost += cost
    
    usage_logs_cost = db.session.query(func.sum(UsageLog.cost)).scalar() or 0.0
    total_cost += usage_logs_cost
    
    return jsonify({'total_cost': round(total_cost, 2)})

def calculate_user_spending(user_id):
    total_cost = 0.0
    request_count = 0
    total_prompt_tokens = 0
    total_completion_tokens = 0
    model_breakdown = {}
    
    conversations = Conversation.query.filter_by(user_id=user_id).all()
    for conv in conversations:
        messages = conv.messages or []
        for msg in messages:
            if isinstance(msg, dict) and msg.get('role') == 'assistant':
                model = msg.get('model')
                if not model:
                    continue
                
                meta = msg.get('meta', {})
                
                request_tokens = 0
                response_tokens = 0
                
                if isinstance(meta, dict):
                    request_tokens = meta.get('request_tokens', 0)
                    response_tokens = meta.get('response_tokens', 0)
                
                if request_tokens > 0 or response_tokens > 0:
                    cost = calculate_cost(model, request_tokens, response_tokens)
                    total_cost += cost
                    request_count += 1
                    total_prompt_tokens += request_tokens
                    total_completion_tokens += response_tokens
                    
                    if model not in model_breakdown:
                        model_breakdown[model] = {
                            'cost': 0.0,
                            'requests': 0,
                            'prompt_tokens': 0,
                            'completion_tokens': 0
                        }
                    model_breakdown[model]['cost'] += cost
                    model_breakdown[model]['requests'] += 1
                    model_breakdown[model]['prompt_tokens'] += request_tokens
                    model_breakdown[model]['completion_tokens'] += response_tokens
    
    return {
        'total_cost': round(total_cost, 2),
        'request_count': request_count,
        'prompt_tokens': total_prompt_tokens,
        'completion_tokens': total_completion_tokens,
        'model_breakdown': model_breakdown
    }

@chat_bp.route('/admin/spending/by-user')
def admin_spending_by_user():
    if 'admin' not in session:
        return jsonify({'error': 'unauthorized'}), 401
    
    users = User.query.all()
    user_spending = []
    
    for user in users:
        spending = calculate_user_spending(user.id)
        if spending['request_count'] > 0 or spending['total_cost'] > 0:
            user_spending.append({
                'user_id': user.id,
                'email': user.email,
                'name': user.name,
                'total_cost': spending['total_cost'],
                'request_count': spending['request_count'],
                'prompt_tokens': spending['prompt_tokens'],
                'completion_tokens': spending['completion_tokens']
            })
    
    user_spending.sort(key=lambda x: x['total_cost'], reverse=True)
    
    return jsonify({'users': user_spending})

@chat_bp.route('/admin/spending/by-key')
def admin_spending_by_key():
    if 'admin' not in session:
        return jsonify({'error': 'unauthorized'}), 401
    
    results = db.session.query(
        UserKey.id,
        UserKey.name,
        User.email,
        func.sum(UsageLog.cost).label('total_cost'),
        func.count(UsageLog.id).label('request_count'),
        func.sum(UsageLog.request_tokens).label('prompt_tokens'),
        func.sum(UsageLog.response_tokens).label('completion_tokens')
    ).join(
        User, User.user_key_id == UserKey.id
    ).join(
        UsageLog, UsageLog.user_key_id == UserKey.id
    ).group_by(
        UserKey.id, UserKey.name, User.email
    ).all()
    
    key_spending = []
    for row in results:
        key_spending.append({
            'key_id': row[0],
            'key_name': row[1],
            'user_email': row[2],
            'total_cost': round(row[3] or 0, 2),
            'request_count': row[4] or 0,
            'prompt_tokens': row[5] or 0,
            'completion_tokens': row[6] or 0
        })
    
    return jsonify({'keys': key_spending})

@chat_bp.route('/admin/spending/by-model')
def admin_spending_by_model():
    if 'admin' not in session:
        return jsonify({'error': 'unauthorized'}), 401
    
    model_spending = {}
    
    users = User.query.all()
    for user in users:
        spending = calculate_user_spending(user.id)
        for model, breakdown in spending['model_breakdown'].items():
            if model not in model_spending:
                model_spending[model] = {
                    'total_cost': 0.0,
                    'request_count': 0,
                    'prompt_tokens': 0,
                    'completion_tokens': 0
                }
            model_spending[model]['total_cost'] += breakdown['cost']
            model_spending[model]['request_count'] += breakdown['requests']
            model_spending[model]['prompt_tokens'] += breakdown['prompt_tokens']
            model_spending[model]['completion_tokens'] += breakdown['completion_tokens']
    
    usage_logs = db.session.query(
        UsageLog.model,
        func.sum(UsageLog.cost).label('total_cost'),
        func.count(UsageLog.id).label('request_count'),
        func.sum(UsageLog.request_tokens).label('prompt_tokens'),
        func.sum(UsageLog.response_tokens).label('completion_tokens')
    ).filter(UsageLog.model.isnot(None)).group_by(UsageLog.model).all()
    
    for row in usage_logs:
        model = row[0]
        if model not in model_spending:
            model_spending[model] = {
                'total_cost': 0.0,
                'request_count': 0,
                'prompt_tokens': 0,
                'completion_tokens': 0
            }
        model_spending[model]['total_cost'] += row[1] or 0
        model_spending[model]['request_count'] += row[2] or 0
        model_spending[model]['prompt_tokens'] += row[3] or 0
        model_spending[model]['completion_tokens'] += row[4] or 0
    
    result = []
    for model, data in model_spending.items():
        result.append({
            'model': model,
            'total_cost': round(data['total_cost'], 2),
            'request_count': data['request_count'],
            'prompt_tokens': data['prompt_tokens'],
            'completion_tokens': data['completion_tokens']
        })
    
    result.sort(key=lambda x: x['total_cost'], reverse=True)
    
    return jsonify({'models': result})

@chat_bp.route('/admin/spending/user/<int:user_id>')
def admin_user_spending_detail(user_id):
    if 'admin' not in session:
        return jsonify({'error': 'unauthorized'}), 401
    
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'user not found'}), 404
    
    spending = calculate_user_spending(user_id)
    
    model_breakdown = []
    for model, data in spending['model_breakdown'].items():
        model_breakdown.append({
            'model': model,
            'total_cost': round(data['cost'], 2),
            'request_count': data['requests'],
            'prompt_tokens': data['prompt_tokens'],
            'completion_tokens': data['completion_tokens']
        })
    
    model_breakdown.sort(key=lambda x: x['total_cost'], reverse=True)
    
    return jsonify({
        'user_id': user.id,
        'email': user.email,
        'name': user.name,
        'total_cost': spending['total_cost'],
        'total_requests': spending['request_count'],
        'model_breakdown': model_breakdown
    })

