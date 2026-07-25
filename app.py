from __future__ import annotations
import os
import hmac
import hashlib
import json
import urllib.request
from typing import Optional, Dict
from functools import wraps
from urllib.parse import parse_qsl
from flask import Flask, request, jsonify, render_template
from database import db, Admin, User, Service, Order, Deposit, OperationLog

BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
ADMIN_IDS = set(
    x.strip() for x in os.environ.get("ADMIN_IDS", "").split(",") if x.strip()
)

app = Flask(__name__)

# إصلاح رابط قاعدة البيانات المأخوذ من Railway ليتوافق مع SQLAlchemy
db_url = os.environ.get("DATABASE_URL", "sqlite:///zapcharge.db")
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

app.config["SQLALCHEMY_DATABASE_URI"] = db_url
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db.init_app(app)

with app.app_context():
    db.create_all()


def verify_telegram_init_data(init_data: str) -> Optional[dict]:
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


def get_permissions(telegram_id: str) -> dict:
    record = get_admin_record(telegram_id)
    if record == "owner":
        return {
            "can_manage_prices": True,
            "can_approve_deposits": True,
            "can_fulfill_orders": True,
            "can_manage_admins": True,
        }
    if record is None:
        return {
            "can_manage_prices": False,
            "can_approve_deposits": False,
            "can_fulfill_orders": False,
            "can_manage_admins": False,
        }
    return {
        "can_manage_prices": record.can_manage_prices,
        "can_approve_deposits": record.can_approve_deposits,
        "can_fulfill_orders": record.can_fulfill_orders,
        "can_manage_admins": record.can_manage_admins,
    }


def log_action(admin_telegram_id: str, action: str, details: str = ""):
    entry = OperationLog(
        admin_telegram_id=admin_telegram_id,
        action=action,
        details=details,
    )
    db.session.add(entry)


def send_telegram_message(chat_id: str, text: str) -> bool:
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    data = json.dumps({"chat_id": chat_id, "text": text}).encode()
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}
    )
    try:
        urllib.request.urlopen(req, timeout=10)
        return True
    except Exception:
        return False


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


def require_user(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        init_data = request.headers.get("X-Telegram-Init-Data", "")
        user = verify_telegram_init_data(init_data)
        if user is None:
            return jsonify({"ok": False, "error": "unauthorized"}), 401
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
            "permissions": get_permissions(telegram_id) if is_admin else None,
            "user": {
                "telegram_id": telegram_id,
                "first_name": user.get("first_name", ""),
                "username": user.get("username", ""),
                "balance": db_user.balance,
            },
        }
    )


# ==================== STORE (USER) ENDPOINTS ====================

@app.route("/api/store/services", methods=["GET"])
@require_user
def store_services():
    services = Service.query.filter_by(active=True).order_by(Service.category, Service.name).all()
    return jsonify([
        {
            "id": s.id,
            "category": s.category,
            "name": s.name,
            "package_name": s.package_name,
            "pricing_type": s.pricing_type,
            "price": s.price,
            "unit_name": s.unit_name,
            "unit_rate": s.unit_rate,
            "min_qty": s.min_qty,
            "max_qty": s.max_qty,
            "image_url": s.image_url,
        }
        for s in services
    ])


@app.route("/api/store/order", methods=["POST"])
@require_user
def store_order():
    body = request.get_json(silent=True) or {}
    service_id = body.get("service_id")
    player_id = str(body.get("player_id", "")).strip()

    if not service_id:
        return jsonify({"ok": False, "error": "missing_service"}), 400

    service = Service.query.get(service_id)
    if not service or not service.active:
        return jsonify({"ok": False, "error": "service_not_available"}), 404

    user = User.query.filter_by(telegram_id=request.telegram_id).first()
    if not user:
        return jsonify({"ok": False, "error": "user_not_found"}), 404

    quantity = None

    if service.pricing_type == "variable":
        try:
            quantity = int(body.get("quantity", 0))
        except (ValueError, TypeError):
            quantity = 0

        if quantity <= 0:
            return jsonify({"ok": False, "error": "invalid_quantity"}), 400

        if service.min_qty and quantity < service.min_qty:
            return jsonify({"ok": False, "error": "below_min_qty", "min_qty": service.min_qty}), 400

        if service.max_qty and quantity > service.max_qty:
            return jsonify({"ok": False, "error": "above_max_qty", "max_qty": service.max_qty}), 400

        if not service.unit_rate:
            return jsonify({"ok": False, "error": "service_misconfigured"}), 400

        final_price = round(quantity * service.unit_rate, 2)
    else:
        if service.price is None:
            return jsonify({"ok": False, "error": "service_misconfigured"}), 400
        final_price = service.price

    if user.balance < final_price:
        return jsonify({"ok": False, "error": "insufficient_balance"}), 400

    user.balance -= final_price
    order = Order(
        user_telegram_id=request.telegram_id,
        service_id=service.id,
        player_id=player_id,
        quantity=quantity,
        price=final_price,
        status="pending"
    )
    db.session.add(order)
    db.session.commit()

    return jsonify({"ok": True, "new_balance": user.balance, "order_id": order.id})


@app.route("/api/store/my-orders", methods=["GET"])
@require_user
def store_my_orders():
    orders = Order.query.filter_by(user_telegram_id=request.telegram_id).order_by(Order.created_at.desc()).all()
    result = []
    for o in orders:
        service = Service.query.get(o.service_id)
        result.append({
            "id": o.id,
            "service_name": service.name if service else "خدمة محذوفة",
            "package_name": service.package_name if service else None,
            "player_id": o.player_id,
            "quantity": o.quantity,
            "unit_name": service.unit_name if service else None,
            "price": o.price,
            "status": o.status,
            "cancel_reason": o.cancel_reason,
            "created_at": o.created_at.isoformat(),
        })
    return jsonify(result)


@app.route("/api/store/deposit", methods=["POST"])
@require_user
def store_deposit():
    body = request.get_json(silent=True) or {}
    method = body.get("method", "").strip()
    try:
        amount = float(body.get("amount", 0))
    except (ValueError, TypeError):
        amount = 0.0

    proof_text = body.get("proof_text", "").strip()
    proof_image_url = body.get("proof_image_url", "").strip()

    if not method or amount <= 0:
        return jsonify({"ok": False, "error": "invalid_data"}), 400

    deposit = Deposit(
        user_telegram_id=request.telegram_id,
        method=method,
        amount=amount,
        proof_text=proof_text or None,
        proof_image_url=proof_image_url or None,
        status="pending"
    )
    db.session.add(deposit)
    db.session.commit()

    return jsonify({"ok": True, "deposit_id": deposit.id})


@app.route("/api/store/my-deposits", methods=["GET"])
@require_user
def store_my_deposits():
    deposits = Deposit.query.filter_by(user_telegram_id=request.telegram_id).order_by(Deposit.created_at.desc()).all()
    return jsonify([
        {
            "id": d.id,
            "method": d.method,
            "amount": d.amount,
            "proof_text": d.proof_text,
            "status": d.status,
            "reject_reason": d.reject_reason,
            "created_at": d.created_at.isoformat(),
        }
        for d in deposits
    ])


# ==================== ADMIN ENDPOINTS ====================

@app.route("/api/admin/summary")
@require_admin
def admin_summary():
    return jsonify(
        {
            "pending_orders": Order.query.filter_by(status="pending").count(),
            "pending_deposits": Deposit.query.filter_by(status="pending").count(),
        }
    )


@app.route("/api/admin/stats")
@require_admin
def admin_stats():
    total_sales = db.session.query(
        db.func.coalesce(db.func.sum(Order.price), 0.0)
    ).filter(Order.status == "done").scalar()

    total_deposits = db.session.query(
        db.func.coalesce(db.func.sum(Deposit.amount), 0.0)
    ).filter(Deposit.status == "approved").scalar()

    total_balance = db.session.query(
        db.func.coalesce(db.func.sum(User.balance), 0.0)
    ).scalar()

    return jsonify(
        {
            "total_sales": total_sales,
            "completed_orders": Order.query.filter_by(status="done").count(),
            "cancelled_orders": Order.query.filter_by(status="cancelled").count(),
            "total_deposits": total_deposits,
            "approved_deposits": Deposit.query.filter_by(status="approved").count(),
            "rejected_deposits": Deposit.query.filter_by(status="rejected").count(),
            "total_balance": total_balance,
            "total_users": User.query.count(),
        }
    )


@app.route("/api/admin/logs")
@require_admin
def admin_logs():
    logs = OperationLog.query.order_by(OperationLog.created_at.desc()).limit(100).all()
    return jsonify(
        [
            {
                "id": l.id,
                "admin_telegram_id": l.admin_telegram_id,
                "action": l.action,
                "details": l.details,
                "created_at": l.created_at.isoformat(),
            }
            for l in logs
        ]
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
            "pricing_type": s.pricing_type,
            "price": s.price,
            "unit_name": s.unit_name,
            "unit_rate": s.unit_rate,
            "min_qty": s.min_qty,
            "max_qty": s.max_qty,
            "image_url": s.image_url,
            "active": s.active,
        }
        for s in services
    ])


@app.route("/api/admin/services", methods=["POST"])
@require_permission("can_manage_prices")
def add_service():
    body = request.get_json(silent=True) or {}
    pricing_type = body.get("pricing_type", "fixed")
    if pricing_type not in ("fixed", "variable"):
        pricing_type = "fixed"

    service = Service(
        category=body.get("category", ""),
        name=body.get("name", ""),
        package_name=body.get("package_name"),
        pricing_type=pricing_type,
        image_url=body.get("image_url"),
        active=bool(body.get("active", True)),
    )

    if pricing_type == "variable":
        service.price = None
        service.unit_name = body.get("unit_name") or None
        service.unit_rate = float(body.get("unit_rate", 0)) if body.get("unit_rate") not in (None, "") else None
        service.min_qty = int(body.get("min_qty")) if body.get("min_qty") not in (None, "") else None
        service.max_qty = int(body.get("max_qty")) if body.get("max_qty") not in (None, "") else None
    else:
        service.price = float(body.get("price", 0))
        service.unit_name = None
        service.unit_rate = None
        service.min_qty = None
        service.max_qty = None

    db.session.add(service)
    log_action(request.telegram_id, "إضافة خدمة", service.name)
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
    if "image_url" in body:
        service.image_url = body["image_url"]
    if "active" in body:
        service.active = bool(body["active"])

    if "pricing_type" in body:
        pricing_type = body["pricing_type"]
        if pricing_type not in ("fixed", "variable"):
            pricing_type = "fixed"
        service.pricing_type = pricing_type

    if service.pricing_type == "variable":
        if "unit_name" in body:
            service.unit_name = body.get("unit_name") or None
        if "unit_rate" in body:
            service.unit_rate = float(body["unit_rate"]) if body.get("unit_rate") not in (None, "") else None
        if "min_qty" in body:
            service.min_qty = int(body["min_qty"]) if body.get("min_qty") not in (None, "") else None
        if "max_qty" in body:
            service.max_qty = int(body["max_qty"]) if body.get("max_qty") not in (None, "") else None
        service.price = None
    else:
        if "price" in body:
            service.price = float(body["price"])
        service.unit_name = None
        service.unit_rate = None
        service.min_qty = None
        service.max_qty = None

    log_action(request.telegram_id, "تعديل خدمة", service.name)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/admin/services/<int:service_id>", methods=["DELETE"])
@require_permission("can_manage_prices")
def delete_service(service_id):
    service = Service.query.get_or_404(service_id)
    name = service.name
    db.session.delete(service)
    log_action(request.telegram_id, "حذف خدمة", name)
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
    log_action(request.telegram_id, "قبول إيداع", f"{deposit.amount:.2f}$ - {deposit.user_telegram_id}")
    db.session.commit()

    send_telegram_message(deposit.user_telegram_id, f"✅ تم قبول إيداعك بقيمة {deposit.amount:.2f}$ وتمت إضافتها لحسابك!")
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
    log_action(request.telegram_id, "رفض إيداع", f"{deposit.amount:.2f}$ - {deposit.user_telegram_id}")
    db.session.commit()

    reason_msg = f"\nالسبب: {deposit.reject_reason}" if deposit.reject_reason else ""
    send_telegram_message(deposit.user_telegram_id, f"❌ تم رفض طلب الإيداع بقيمة {deposit.amount:.2f}$.{reason_msg}")
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
            "quantity": o.quantity,
            "unit_name": service.unit_name if service else None,
            "price": o.price,
        })
    return jsonifdef list_orders():
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
            "quantity": o.quantity,
            "unit_name": service.unit_name if service else None,
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
    log_action(request.telegram_id, "تنفيذ طلب", f"طلب #{order.id}")
    db.session.commit()

    service = Service.query.get(order.service_id)
    s_name = service.name if service else "خدمتك"
    send_telegram_message(order.user_telegram_id, f"✅ تم إكمال طلبك #{order.id} ({s_name}) بنجاح!")
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
    log_action(request.telegram_id, "إلغاء طلب", f"طلب #{order.id}")
    db.session.commit()

    reason_msg = f"\nالسبب: {order.cancel_reason}" if order.cancel_reason else ""
    send_telegram_message(order.user_telegram_id, f"❌ تم إلغاء طلبك #{order.id} وإعادة المبلغ ({order.price:.2f}$) لحسابك.{reason_msg}")
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
    log_action(request.telegram_id, "إضافة مشرف", telegram_id)
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
    log_action(request.telegram_id, "تعديل صلاحيات مشرف", admin.telegram_id)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/admin/admins/<int:admin_id>", methods=["DELETE"])
@require_permission("can_manage_admins")
def delete_admin(admin_id):
    admin = Admin.query.get_or_404(admin_id)
    tg_id = admin.telegram_id
    db.session.delete(admin)
    log_action(request.telegram_id, "حذف مشرف", tg_id)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/admin/broadcast", methods=["POST"])
@require_permission("can_manage_admins")
def broadcast_message():
    body = request.get_json(silent=True) or {}
    message = body.get("message", "").strip()

    if not message:
        return jsonify({"ok": False, "error": "empty_message"}), 400

    users = User.query.all()
    sent = 0
    failed = 0
    for u in users:
        if send_telegram_message(u.telegram_id, message):
            sent += 1
        else:
            failed += 1

    details = f"أُرسلت لـ {sent} مستخدم"
    if failed:
        details += f"، فشلت لـ {failed}"
    log_action(request.telegram_id, "رسالة جماعية", details)
    db.session.commit()

    return jsonify({"ok": True, "sent": sent, "failed": failed})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
