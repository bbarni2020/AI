import os
from flask import Blueprint, jsonify, send_from_directory, request, session, redirect, url_for
import requests

search_bp = Blueprint('search', __name__)

@search_bp.route('/search')
def search_page():
    if 'user_id' not in session:
        return redirect(url_for('chat.login'))
    return send_from_directory('../static/search', 'index.html')

@search_bp.route('/api/search/<search_type>', methods=['GET'])
def search_api(search_type):
    if 'user_id' not in session:
        return jsonify({'error': 'unauthorized'}), 401
    
    api_key = os.getenv('SEARCH_API_KEY', '').strip()
    if not api_key:
        return jsonify({'error': 'Search API not configured'}), 500
    
    query = request.args.get('q', '').strip()
    if not query:
        return jsonify({'error': 'Query parameter required'}), 400
    
    endpoint_map = {
        'web': '/res/v1/web/search',
        'images': '/res/v1/images/search',
        'videos': '/res/v1/videos/search',
        'news': '/res/v1/news/search'
    }
    
    if search_type not in endpoint_map:
        return jsonify({'error': 'Invalid search type'}), 400
    
    params = {'q': query}
    
    if search_type == 'web':
        params['count'] = min(int(request.args.get('count', 20)), 20)
        params['offset'] = min(int(request.args.get('offset', 0)), 9)
        if request.args.get('country'):
            params['country'] = request.args.get('country')
        if request.args.get('freshness'):
            params['freshness'] = request.args.get('freshness')
    elif search_type == 'images':
        params['count'] = min(int(request.args.get('count', 50)), 200)
        params['safesearch'] = request.args.get('safesearch', 'strict')
    elif search_type == 'videos':
        params['count'] = min(int(request.args.get('count', 20)), 50)
        params['offset'] = min(int(request.args.get('offset', 0)), 9)
        if request.args.get('freshness'):
            params['freshness'] = request.args.get('freshness')
    elif search_type == 'news':
        params['count'] = min(int(request.args.get('count', 20)), 50)
        params['offset'] = min(int(request.args.get('offset', 0)), 9)
        if request.args.get('freshness'):
            params['freshness'] = request.args.get('freshness')
    
    headers = {'Authorization': f'Bearer {api_key}'}
    
    try:
        resp = requests.get(
            f'https://search.hackclub.com{endpoint_map[search_type]}',
            params=params,
            headers=headers,
            timeout=10
        )
        if resp.status_code != 200:
            return jsonify({'error': f'Search API error: {resp.status_code}'}), resp.status_code
        return jsonify(resp.json())
    except Exception as e:
        return jsonify({'error': str(e)}), 500
