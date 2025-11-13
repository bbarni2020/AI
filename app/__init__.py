import os
from flask import Flask, jsonify, redirect
from flask_sqlalchemy import SQLAlchemy
from dotenv import load_dotenv

db = SQLAlchemy()

def create_app():
    load_dotenv()
    app = Flask(__name__, static_folder='../static', static_url_path='/static')
    app.secret_key = os.getenv('FLASK_SECRET_KEY', 'dev')
    app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'sqlite:///data.db')
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    db.init_app(app)

    from .models import ProviderKey, UsageLog, UserKey, CorsSettings
    with app.app_context():
        db.create_all()
        if not CorsSettings.query.first():
            default_cors = CorsSettings()
            db.session.add(default_cors)
            db.session.commit()

    from .routes_admin import admin_bp
    from .routes_proxy import api_bp
    app.register_blueprint(admin_bp)
    app.register_blueprint(api_bp)

    @app.route('/')
    def root():
        return redirect('/admin')

    @app.route('/health')
    def health():
        return jsonify({'ok': True})

    return app
