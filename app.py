import os
import hmac
import hashlib
import json
from functools import wraps
from urllib.parse import parse_qsl
from flask import Flask, request, jsonify, render_template
from database import db, Admin, User, Service, Order, Deposit

BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
ADMIN_IDS = set(
    x.strip() for x in os.environ.get("ADMIN_IDS", "").split(",") if x.strip()
)

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get(
    "DATABASE_URL", "sqlite:///zapcharge.db"
)
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db.init_app(app)

with app.app_context():
    db.create_all()


def verify_telegram_init_data(init_data: str) -> dict | None:
    if not init_data or not BOT_TOKEN:
        return None

    parsed = dict(parse_qsl(init_data, strict_parsing=True))
    received_hash = parsed.pop("hash", None)
    if not received_hash:
        return None

    data_check_string = "\n".join(
        f"{k}={v}" for k, v in sorted(parsed.items())
    )

    secret_key = hmac.new(
        key=b"WebAppData", msg=BOT_TOKEN.encode(), digestmod=hashlib.sha256
    ).digest()
    computed_hash = hmac.new(
        key=secret_key, msg=data_check_string.encode(), digestmod=hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(computed_hash, received_hash):
        return None

    user_raw = parsed.get("user")
    if not user_raw:
        return None
    return json.loads(user_raw)


def get_admin_record(telegram_id: str):
    if telegram_id in ADMIN_IDS:
        return "owner"
    return Admin.query.filter_by(telegram_id=telegram_id).first()


def is_admin_user(telegram_id: str) -> bool:
    return get_admin_record(telegram_id) is not None


def has_permission(telegram_id: str, field: str) -> bool:
    record = get_admin_record(telegram_id)
    if record == "owner":
        return True
    if record is None:
        return False
    return bool(getattr(record, field, False))


def require_admin(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        init_data = request.headers.get("X-Telegram-Init-Data", "")
        user = verify_telegram_init_data(init_data)
        if user is None or not is_admin_user(str(user.get("id"))):
            return jsonify({"ok": False, "error": "unauthorized"}), 403
        request.telegram_id = str(user.get("id"))
        return f(*args, **kwargs)
    return wrapper


def require_permission(field: str):
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            init_data = request.headers.get("X-Telegram-Init-Data", "")
            user = verify_telegram_init_data(init_data)
            if user is None or not has_permission(str(user.get("id")), field):
                return jsonify({"ok": False, "error": "unauthorized"}), 403
            request.telegram_id = str(user.get("id"))
            return f(*args, **kwargs)
        return wrapper
    return decorator


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/auth", methods=["POST"])
def auth():
    body = request.get_json(silent=True) or {}
    init_data = body.get("initData", "")

    user = verify_telegram_init_data(init_data)
    if user is None:
        return jsonify({"ok": False, "error": "invalid_init_data"}), 401

    telegram_id = str(user.get("id"))
    is_admin = is_admin_user(telegram_id)

    db_user = User.query.filter_by(telegram_id=telegram_id).first()
    if db_user is None:
        db_user = User(
            telegram_id=telegram_id,
            first_name=user.get("first_name", ""),
            username=user.get("username", ""),
        )
        db.session.add(db_user)
        db.session.commit()

    return jsonify(
        {
            "ok": True,
            "is_admin": is_admin,
            "user": {
                "telegram_id": telegram_id,
                "first_name": user.get("first_name", ""),
                "username": user.get("username", ""),
                "balance": db_user.balance,
            },
        }
    )


@app.route("/api/admin/summary")
@require_admin
def admin_summary():
    return jsonify(
        {
            "pending_orders": Order.query.filter_by(status="pending").count(),
            "pending_deposits": Deposit.query.filter_by(status="pending").count(),
        }
    )


@app.route("/api/admin/services", methods=["GET"])
@require_admin
def list_services():
    services = Service.query.order_by(Service.category, Service.name).all()
    return jsonify([
        {
            "id": s.id,
            "category": s.category,
            "name": s.name,
            "package_name": s.package_name,
            "price": s.price,
            "image_url": s.image_url,
            "active": s.active,
        }
        for s in services
    ])


@app.route("/api/admin/services", methods=["POST"])
@require_permission("can_manage_prices")
def add_service():
    body = request.get_json(silent=True) or {}
    service = Service(
        category=body.get("category", ""),
        name=body.get("name", ""),
        package_name=body.get("package_name"),
        price=float(body.get("price", 0)),
        image_url=body.get("image_url"),
        active=bool(body.get("active", True)),
    )
    db.session.add(service)
    db.session.commit()
    return jsonify({"ok": True, "id": service.id})


@app.route("/api/admin/services/<int:service_id>", methods=["PUT"])
@require_permission("can_manage_prices")
def edit_service(service_id):
    service = Service.query.get_or_404(service_id)
    body = request.get_json(silent=True) or {}
    if "category" in body:
        service.category = body["category"]
    if "name" in body:
        service.name = body["name"]
    if "package_name" in body:
        service.package_name = body["package_name"]
    if "price" in body:
        service.price = float(body["price"])
    if "image_url" in body:
        service.image_url = body["image_url"]
    if "active" in body:
        service.active = bool(body["active"])
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/admin/services/<int:service_id>", methods=["DELETE"])
@require_permission("can_manage_prices")
def delete_service(service_id):
    service = Service.query.get_or_404(service_id)
    db.session.delete(service)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/admin/deposits", methods=["GET"])
@require_admin
def list_deposits():
    deposits = Deposit.query.filter_by(status="pending").order_by(Deposit.created_at.desc()).all()
    return jsonify([
        {
            "id": d.id,
            "user_telegram_id": d.user_telegram_id,
            "method": d.method,
            "amount": d.amount,
            "proof_text": d.proof_text,
            "proof_image_url": d.proof_image_url,
        }
        for d in deposits
    ])


@app.route("/api/admin/deposits/<int:deposit_id>/approve", methods=["POST"])
@require_permission("can_approve_deposits")
def approve_deposit(deposit_id):
    deposit = Deposit.query.get_or_404(deposit_id)
    if deposit.status != "pending":
        return jsonify({"ok": False, "error": "already_processed"}), 400

    user = User.query.filter_by(telegram_id=deposit.user_telegram_id).first()
    if user is None:
        return jsonify({"ok": False, "error": "user_not_found"}), 404

    user.balance += deposit.amount
    deposit.status = "approved"
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/admin/deposits/<int:deposit_id>/reject", methods=["POST"])
@require_permission("can_approve_deposits")
def reject_deposit(deposit_id):
    deposit = Deposit.query.get_or_404(deposit_id)
    if deposit.status != "pending":
        return jsonify({"ok": False, "error": "already_processed"}), 400

    body = request.get_json(silent=True) or {}
    deposit.status = "rejected"
    deposit.reject_reason = body.get("reason", "")
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/admin/orders", methods=["GET"])
@require_admin
def list_orders():
    orders = Order.query.filter_by(status="pending").order_by(Order.created_at.desc()).all()
    result = []
    for o in orders:
        service = Service.query.get(o.service_id)
        result.append({
            "id": o.id,
            "user_telegram_id": o.user_telegram_id,
            "service_name": service.name if service else "خدمة محذوفة",
            "package_name": service.package_name if service else None,
            "player_id": o.player_id,
            "price": o.price,
        })
    return jsonify(result)


@app.route("/api/admin/orders/<int:order_id>/complete", methods=["POST"])
@require_permission("can_fulfill_orders")
def complete_order(order_id):
    order = Order.query.get_or_404(order_id)
    if order.status != "pending":
        return jsonify({"ok": False, "error": "already_processed"}), 400

    order.status = "done"
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/admin/orders/<int:order_id>/cancel", methods=["POST"])
@require_permission("can_fulfill_orders")
def cancel_order(order_id):
    order = Order.query.get_or_404(order_id)
    if order.status != "pending":
        return jsonify({"ok": False, "error": "already_processed"}), 400

    body = request.get_json(silent=True) or {}

    user = User.query.filter_by(telegram_id=order.user_telegram_id).first()
    if user is not None:
        user.balance += order.price

    order.status = "cancelled"
    order.cancel_reason = body.get("reason", "")
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/admin/admins", methods=["GET"])
@require_permission("can_manage_admins")
def list_admins():
    admins = Admin.query.all()
    return jsonify([
        {
            "id": a.id,
            "telegram_id": a.telegram_id,
            "can_manage_prices": a.can_manage_prices,
            "can_manage_admins": a.can_manage_admins,
            "can_fulfill_orders": a.can_fulfill_orders,
            "can_approve_deposits": a.can_approve_deposits,
        }
        for a in admins
    ])


@app.route("/api/admin/admins", methods=["POST"])
@require_permission("can_manage_admins")
def add_admin():
    body = request.get_json(silent=True) or {}
    telegram_id = str(body.get("telegram_id", "")).strip()

    if not telegram_id:
        return jsonify({"ok": False, "error": "missing_telegram_id"}), 400

    if telegram_id in ADMIN_IDS or Admin.query.filter_by(telegram_id=telegram_id).first():
        return jsonify({"ok": False, "error": "already_admin"}), 400

    admin = Admin(
        telegram_id=telegram_id,
        can_manage_prices=bool(body.get("can_manage_prices", False)),
        can_manage_admins=bool(body.get("can_manage_admins", False)),
        can_fulfill_orders=bool(body.get("can_fulfill_orders", False)),
        can_approve_deposits=bool(body.get("can_approve_deposits", False)),
    )
    db.session.add(admin)
    db.session.commit()
    return jsonify({"ok": True, "id": admin.id})


@app.route("/api/admin/admins/<int:admin_id>", methods=["PUT"])
@require_permission("can_manage_admins")
def edit_admin(admin_id):
    admin = Admin.query.get_or_404(admin_id)
    body = request.get_json(silent=True) or {}
    if "can_manage_prices" in body:
        admin.can_manage_prices = bool(body["can_manage_prices"])
    if "can_manage_admins" in body:
        admin.can_manage_admins = bool(body["can_manage_admins"])
    if "can_fulfill_orders" in body:
        admin.can_fulfill_orders = bool(body["can_fulfill_orders"])
    if "can_approve_deposits" in body:
        admin.can_approve_deposits = bool(body["can_approve_deposits"])
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/admin/admins/<int:admin_id>", methods=["DELETE"])
@require_permission("can_manage_admins")
def delete_admin(admin_id):
    admin = Admin.query.get_or_404(admin_id)
    db.session.delete(admin)
    db.session.commit()
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
