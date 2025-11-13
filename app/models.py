import datetime
from . import db

class ProviderKey(db.Model):
    __tablename__ = 'provider_keys'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    api_key = db.Column(db.String(512), nullable=False)
    enabled = db.Column(db.Boolean, default=True, nullable=False)
    rate_limit_per_min = db.Column(db.Integer, default=0, nullable=False)
    token_limit_per_day = db.Column(db.Integer, default=0, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow, nullable=False)

class UserKey(db.Model):
    __tablename__ = 'user_keys'
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(128), unique=True, nullable=False)
    name = db.Column(db.String(120), nullable=False)
    enabled = db.Column(db.Boolean, default=True, nullable=False)
    rate_limit_enabled = db.Column(db.Boolean, default=False, nullable=False)
    rate_limit_per_min = db.Column(db.Integer, default=0, nullable=False)
    token_limit_enabled = db.Column(db.Boolean, default=False, nullable=False)
    token_limit_per_day = db.Column(db.Integer, default=0, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow, nullable=False)
    last_used_at = db.Column(db.DateTime, nullable=True)

class UsageLog(db.Model):
    __tablename__ = 'usage_logs'
    id = db.Column(db.Integer, primary_key=True)
    provider_key_id = db.Column(db.Integer, db.ForeignKey('provider_keys.id'), nullable=False)
    ts = db.Column(db.DateTime, default=datetime.datetime.utcnow, nullable=False)
    request_tokens = db.Column(db.Integer, default=0, nullable=False)
    response_tokens = db.Column(db.Integer, default=0, nullable=False)
    total_tokens = db.Column(db.Integer, default=0, nullable=False)

class CorsSettings(db.Model):
    __tablename__ = 'cors_settings'
    id = db.Column(db.Integer, primary_key=True)
    allowed_origins = db.Column(db.Text, default='*', nullable=False)
    allowed_methods = db.Column(db.String(256), default='GET,POST,PUT,DELETE,OPTIONS', nullable=False)
    allowed_headers = db.Column(db.Text, default='*', nullable=False)
    allow_credentials = db.Column(db.Boolean, default=False, nullable=False)
    max_age = db.Column(db.Integer, default=3600, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow, nullable=False)
