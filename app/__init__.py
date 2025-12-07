import os
import shutil
from pathlib import Path
from datetime import datetime
from flask import Flask, jsonify, redirect
from flask_sqlalchemy import SQLAlchemy
from dotenv import load_dotenv
from sqlalchemy import inspect, text

db = SQLAlchemy()

def backup_database():
    db_path = 'instance/data.db'
    if not os.path.exists(db_path):
        return
    
    backup_dir = 'instance/backups'
    Path(backup_dir).mkdir(parents=True, exist_ok=True)
    
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_file = os.path.join(backup_dir, f'data_{timestamp}.db')
    
    shutil.copy2(db_path, backup_file)
    
    backups = sorted([f for f in os.listdir(backup_dir) if f.startswith('data_') and f.endswith('.db')])
    if len(backups) > 1:
        oldest = os.path.join(backup_dir, backups[0])
        os.remove(oldest)

def create_app():
    load_dotenv()
    app = Flask(__name__, static_folder='../static', static_url_path='/static')
    app.secret_key = os.getenv('FLASK_SECRET_KEY', 'dev')
    app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'sqlite:///data.db')
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    db.init_app(app)

    from .models import ProviderKey, UsageLog, UserKey, CorsSettings, User, Conversation
    with app.app_context():
        backup_database()
        db.create_all()
        inspector = inspect(db.engine)
        user_columns = {c['name'] for c in inspector.get_columns('users')}
        if 'ultimate_enabled' not in user_columns:
            db.session.execute(text('ALTER TABLE users ADD COLUMN ultimate_enabled BOOLEAN NOT NULL DEFAULT 0'))
            db.session.commit()
        if not CorsSettings.query.first():
            default_cors = CorsSettings()
            db.session.add(default_cors)
            db.session.commit()

    from .routes_admin import admin_bp
    from .routes_proxy import api_bp
    from .routes_chat import chat_bp, init_oauth
    from .routes_search import search_bp
    
    init_oauth(app)
    
    app.register_blueprint(admin_bp)
    app.register_blueprint(api_bp)
    app.register_blueprint(chat_bp)
    app.register_blueprint(search_bp)

    @app.route('/')
    def root():
        return redirect('/chat')

    @app.route('/health')
    def health():
        return jsonify({'ok': True})

    return app

