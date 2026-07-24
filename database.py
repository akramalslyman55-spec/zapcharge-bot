from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    telegram_id = db.Column(db.String(32), unique=True, nullable=False)
    first_name = db.Column(db.String(128))
    username = db.Column(db.String(128))
    balance = db.Column(db.Float, default=0.0)
    referred_by = db.Column(db.String(32), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Service(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    category = db.Column(db.String(64))
    name = db.Column(db.String(128))
    package_name = db.Column(db.String(128), nullable=True)
    price = db.Column(db.Float)
    image_url = db.Column(db.String(256), nullable=True)
    active = db.Column(db.Boolean, default=True)


class Order(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_telegram_id = db.Column(db.String(32))
    service_id = db.Column(db.Integer, db.ForeignKey("service.id"))
    player_id = db.Column(db.String(128), nullable=True)
    price = db.Column(db.Float)
    status = db.Column(db.String(16), default="pending")
    cancel_reason = db.Column(db.String(256), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Deposit(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_telegram_id = db.Column(db.String(32))
    method = db.Column(db.String(32))
    amount = db.Column(db.Float)
    proof_text = db.Column(db.String(256), nullable=True)
    proof_image_url = db.Column(db.String(256), nullable=True)
    status = db.Column(db.String(16), default="pending")
    reject_reason = db.Column(db.String(256), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Admin(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    telegram_id = db.Column(db.String(32), unique=True, nullable=False)
    can_manage_prices = db.Column(db.Boolean, default=False)
    can_manage_admins = db.Column(db.Boolean, default=False)
    can_fulfill_orders = db.Column(db.Boolean, default=True)
    can_approve_deposits = db.Column(db.Boolean, default=True)


class OperationLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    admin_telegram_id = db.Column(db.String(32))
    action = db.Column(db.String(64))
    details = db.Column(db.String(256), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
