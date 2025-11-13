import datetime
from sqlalchemy import func
from . import db
from .models import ProviderKey, UsageLog

def mask_key(k):
    if not k or len(k) < 8:
        return '****'
    return k[:4] + '****' + k[-4:]

def today_range():
    now = datetime.datetime.utcnow()
    start = datetime.datetime(now.year, now.month, now.day)
    end = start + datetime.timedelta(days=1)
    return start, end

def eligible_keys():
    now = datetime.datetime.utcnow()
    minute_ago = now - datetime.timedelta(seconds=60)
    start, end = today_range()
    rows = ProviderKey.query.filter_by(enabled=True).all()
    out = []
    for r in rows:
        count_min = db.session.query(func.count(UsageLog.id)).filter(UsageLog.provider_key_id == r.id, UsageLog.ts >= minute_ago).scalar()
        if r.rate_limit_per_min and count_min >= r.rate_limit_per_min:
            continue
        tokens_today = db.session.query(func.coalesce(func.sum(UsageLog.total_tokens), 0)).filter(UsageLog.provider_key_id == r.id, UsageLog.ts >= start, UsageLog.ts < end).scalar() or 0
        if r.token_limit_per_day and tokens_today >= r.token_limit_per_day:
            continue
        out.append((r, count_min, tokens_today))
    out.sort(key=lambda x: (x[1], x[2]))
    return [x[0] for x in out]

def extract_tokens(data):
    try:
        u = data.get('usage')
        if not u:
            return 0, 0, 0
        pt = int(u.get('prompt_tokens') or 0)
        ct = int(u.get('completion_tokens') or 0)
        tt = int(u.get('total_tokens') or (pt + ct))
        return pt, ct, tt
    except Exception:
        return 0, 0, 0
