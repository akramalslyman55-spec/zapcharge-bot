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

    # صار True أول ما ينضاف للمُحيل مكافأة الإحالة (عن أول إيداع لهاد المستخدم)
    # منستخدمه عشان نمنع تكرار المكافأة لو المستخدم أودع أكتر من مرة
    referral_rewarded = db.Column(db.Boolean, default=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Service(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    category = db.Column(db.String(64))
    name = db.Column(db.String(128))
    package_name = db.Column(db.String(128), nullable=True)

    # النص يلي بيبين للزبون كعنوان لحقل الإدخال بنافذة الشراء (مثال: "معرف اللاعب" أو "الإيميل")
    # إذا فاضي، بيستخدم الفرونت إند نص افتراضي عام
    input_label = db.Column(db.String(64), nullable=True)

    # نوع التسعير: "fixed" = باقة بسعر ثابت (زي الألعاب)
    #              "variable" = كمية حرة يكتبها الزبون وبينحسب سعرها بمعدّل (زي كونزات تطبيقات التواصل)
    pricing_type = db.Column(db.String(16), default="fixed", nullable=False)

    # يُستخدم فقط إذا pricing_type == "fixed"
    price = db.Column(db.Float, nullable=True)

    # تُستخدم فقط إذا pricing_type == "variable"
    unit_name = db.Column(db.String(32), nullable=True)   # مثال: "كونزة"
    unit_rate = db.Column(db.Float, nullable=True)         # سعر الوحدة الواحدة بالدولار
    min_qty = db.Column(db.Integer, nullable=True)
    max_qty = db.Column(db.Integer, nullable=True)

    image_url = db.Column(db.String(256), nullable=True)
    active = db.Column(db.Boolean, default=True)


class Order(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_telegram_id = db.Column(db.String(32))
    service_id = db.Column(db.Integer, db.ForeignKey("service.id"))
    player_id = db.Column(db.String(128), nullable=True)

    # الكمية المدخلة من الزبون (تُملأ فقط للخدمات من نوع variable)
    quantity = db.Column(db.Integer, nullable=True)

    price = db.Column(db.Float)
    status = db.Column(db.String(16), default="pending")
    cancel_reason = db.Column(db.String(256), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Deposit(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_telegram_id = db.Column(db.String(32))
    method = db.Column(db.String(32))

    # amount هي دايماً القيمة بالدولار (هاي يلي بتنضاف لرصيد الزبون عند القبول)
    amount = db.Column(db.Float)

    # لو طريقة الإيداع كانت بعملة غير الدولار، منخزن هون المبلغ الأصلي وسعر الصرف
    # يلي استُخدم وقت التقديم (للمراجعة ومطابقة سكرين شوت التحويل). لو الطريقة دولار، تضل فاضية
    currency = db.Column(db.String(8), default="USD", nullable=False)
    original_amount = db.Column(db.Float, nullable=True)
    exchange_rate = db.Column(db.Float, nullable=True)

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


class Setting(db.Model):
    # جدول عام لأي إعداد بسيط (key/value)
    # المفاتيح المستخدمة حالياً: store_active, referral_percent
    # exchange_rates: نص JSON فيه أسعار صرف كل العملات غير الدولار، مثال: {"SYP": 15000, "EGP": 50}
    # (كم وحدة من هاي العملة = دولار واحد)، بتتحدث من لوحة الإدارة وبتضم أي عدد من العملات
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(64), unique=True, nullable=False)
    value = db.Column(db.String(256), nullable=True)


class DepositMethod(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(64), unique=True, nullable=False)  # داخلي وثابت، ما يتغير بعد الإنشاء
    name = db.Column(db.String(64), nullable=False)                # الاسم المعروض للزبون
    display_value = db.Column(db.String(256), nullable=False)      # الرقم/النص يلي يبين للزبون
    copy_value = db.Column(db.String(256), nullable=True)          # القيمة الفعلية يلي بتنسخ لو مختلفة
    instructions = db.Column(db.String(512), nullable=True)        # تعليمات إضافية اختيارية
    active = db.Column(db.Boolean, default=True)
    sort_order = db.Column(db.Integer, default=0)

    # عملة هاي الطريقة: "USD" أو أي رمز عملة تانية (SYP، EGP، إلخ)
    # لو مو USD، بيتحول المبلغ للدولار بسعر الصرف المخزّن بجدول Setting (مفتاح exchange_rates)
    currency = db.Column(db.String(8), default="USD", nullable=False)
