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
    rate_limit_value = db.Column(db.Integer, default=0, nullable=False)
    rate_limit_period = db.Column(db.String(20), default='minute', nullable=False)
    token_limit_enabled = db.Column(db.Boolean, default=False, nullable=False)
    token_limit_value = db.Column(db.Integer, default=0, nullable=False)
    token_limit_period = db.Column(db.String(20), default='day', nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow, nullable=False)
    last_used_at = db.Column(db.DateTime, nullable=True)
    rate_limit_per_min = db.Column(db.Integer, default=0, nullable=False)
    token_limit_per_day = db.Column(db.Integer, default=0, nullable=False)

class UsageLog(db.Model):
    __tablename__ = 'usage_logs'
    id = db.Column(db.Integer, primary_key=True)
    provider_key_id = db.Column(db.Integer, db.ForeignKey('provider_keys.id'), nullable=False)
    user_key_id = db.Column(db.Integer, db.ForeignKey('user_keys.id'), nullable=True)
    ts = db.Column(db.DateTime, default=datetime.datetime.utcnow, nullable=False)
    request_tokens = db.Column(db.Integer, default=0, nullable=False)
    response_tokens = db.Column(db.Integer, default=0, nullable=False)
    total_tokens = db.Column(db.Integer, default=0, nullable=False)
    model = db.Column(db.String(256), nullable=True)
    cost = db.Column(db.Float, default=0.0, nullable=False)

class CorsSettings(db.Model):
    __tablename__ = 'cors_settings'
    id = db.Column(db.Integer, primary_key=True)
    allowed_origins = db.Column(db.Text, default='*', nullable=False)
    allowed_methods = db.Column(db.String(256), default='GET,POST,PUT,DELETE,OPTIONS', nullable=False)
    allowed_headers = db.Column(db.Text, default='*', nullable=False)
    allow_credentials = db.Column(db.Boolean, default=False, nullable=False)
    max_age = db.Column(db.Integer, default=3600, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow, nullable=False)

class EmailWhitelist(db.Model):
    __tablename__ = 'email_whitelist'
    id = db.Column(db.Integer, primary_key=True)
    whitelisted_emails = db.Column(db.Text, default='', nullable=False)
    whitelisted_domains = db.Column(db.Text, default='', nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow, nullable=False)

class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    name = db.Column(db.String(120), nullable=True)
    picture = db.Column(db.String(512), nullable=True)
    google_id = db.Column(db.String(120), unique=True, nullable=True)
    user_key_id = db.Column(db.Integer, db.ForeignKey('user_keys.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow, nullable=False)
    ultimate_enabled = db.Column(db.Boolean, default=False, nullable=False)
    web_search_count = db.Column(db.Integer, default=0, nullable=False)
    web_search_reset = db.Column(db.DateTime, nullable=True)
    
    user_key = db.relationship('UserKey', backref='user', uselist=False)

class Conversation(db.Model):
    __tablename__ = 'conversations'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    title = db.Column(db.String(200), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow, nullable=False)
    messages = db.Column(db.JSON, default=list, nullable=False)

    user = db.relationship('User', backref='conversations')


class CollabRoom(db.Model):
    __tablename__ = 'collab_rooms'
    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(24), unique=True, nullable=False, index=True)
    name = db.Column(db.String(120), nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow, nullable=False)
    system_prompt = db.Column(db.Text, default='', nullable=False)

    creator = db.relationship('User')


class CollabMembership(db.Model):
    __tablename__ = 'collab_memberships'
    id = db.Column(db.Integer, primary_key=True)
    room_id = db.Column(db.Integer, db.ForeignKey('collab_rooms.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    joined_at = db.Column(db.DateTime, default=datetime.datetime.utcnow, nullable=False)

    room = db.relationship('CollabRoom', backref='memberships')
    user = db.relationship('User')
    __table_args__ = (db.UniqueConstraint('room_id', 'user_id', name='uq_collab_room_user'),)


class CollabMessage(db.Model):
    __tablename__ = 'collab_messages'
    id = db.Column(db.Integer, primary_key=True)
    room_id = db.Column(db.Integer, db.ForeignKey('collab_rooms.id'), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    role = db.Column(db.String(20), nullable=False)
    content = db.Column(db.Text, nullable=False)
    model = db.Column(db.String(256), nullable=True)
    meta = db.Column(db.JSON, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow, nullable=False)

    room = db.relationship('CollabRoom', backref='messages')
    user = db.relationship('User')
