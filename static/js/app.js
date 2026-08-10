const tg = window.Telegram?.WebApp;

// عدّل هاد الاسم لاسم البوت الفعلي عندك (بدون @) عشان رابط الإحالة يشتغل صح
const BOT_USERNAME = "ZapchargeBot";

// مفتاح imgbb لرفع صور الخدمات مباشرة من الجهاز (احتياطي)
const IMGBB_API_KEY = "42b366412bbf0a1fa2e013b7e01ec53a";

let currentUser = null; // { telegram_id, first_name, username, balance }
let allServices = [];
let currentBuyService = null;
let currentCategory = "home";
let currentSearchText = "";

function show(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

function showAdminSection(id) {
  document.querySelectorAll(".admin-section").forEach((el) => el.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.adminSection === id);
  });

  if (id === "admin-services-section") loadServices();
  if (id === "admin-deposits-section") loadDeposits();
  if (id === "admin-deposit-methods-section") loadDepositMethods();
  if (id === "admin-orders-section") loadOrders();
  if (id === "admin-admins-section") loadAdmins();
  if (id === "admin-stats-section") loadStats();
  if (id === "admin-logs-section") loadLogs();
}

function adminHeaders(extra = {}) {
  return { "X-Telegram-Init-Data": tg.initData, ...extra };
}

async function init() {
  if (!tg) {
    show("error-view");
    return;
  }

  tg.ready();
  tg.expand();

  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: tg.initData }),
    });
    const data = await res.json();

    if (!data.ok) {
      show("error-view");
      return;
    }

    if (data.is_admin) {
      show("admin-view");
      setupAdminNav(data.permissions);
      loadAdminSummary();
    } else if (data.store_active === false) {
      show("store-paused-view");
    } else {
      currentUser = data.user;
      updateBalanceDisplay();
      show("store-view");
      setupStoreNav();
      loadStoreServices();
    }
  } catch (err) {
    show("error-view");
  }
}

function updateBalanceDisplay() {
  if (!currentUser) return;
  document.getElementById("store-balance").textContent = currentUser.balance.toFixed(2) + "$";
}

async function loadAdminSummary() {
  try {
    const res = await fetch("/api/admin/summary", { headers: adminHeaders() });
    const data = await res.json();
    document.getElementById("stat-orders").textContent = data.pending_orders;
    document.getElementById("stat-deposits").textContent = data.pending_deposits;
  } catch (err) {}

  try {
    const res2 = await fetch("/api/admin/store-status", { headers: adminHeaders() });
    const data2 = await res2.json();
    document.getElementById("store-active-toggle").checked = !!data2.active;
  } catch (err) {}
}

async function toggleStoreStatus() {
  const active = document.getElementById("store-active-toggle").checked;
  try {
    await fetch("/api/admin/store-status", {
      method: "POST",
      headers: adminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ active }),
    });
  } catch (err) {
    alert("تعذّر تحديث حالة المتجر، جرّب مرة ثانية.");
  }
}

function setupAdminNav(permissions) {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    const required = btn.dataset.permission;
    if (required && !permissions[required]) {
      btn.remove();
      return;
    }
    btn.addEventListener("click", () => showAdminSection(btn.dataset.adminSection));
  });

  document.getElementById("open-add-service").addEventListener("click", () => openServiceModal());
  document.getElementById("admin-service-search").addEventListener("input", renderAdminServicesList);
  document.getElementById("cancel-service-modal").addEventListener("click", closeServiceModal);
  document.getElementById("save-service").addEventListener("click", saveService);
  document.getElementById("service-pricing-type").addEventListener("change", updateServicePricingGroups);
  document.getElementById("upload-image-btn").addEventListener("click", () => {
    document.getElementById("service-image-file").click();
  });
  document.getElementById("service-image-file").addEventListener("change", handleImageUpload);
  document.getElementById("service-min-qty").addEventListener("input", recalcUnitRateFromMin);
  document.getElementById("service-min-price").addEventListener("input", recalcUnitRateFromMin);

  document.getElementById("open-add-admin").addEventListener("click", () => openAdminModal());
  document.getElementById("cancel-admin-modal").addEventListener("click", closeAdminModal);
  document.getElementById("save-admin").addEventListener("click", saveAdmin);

  document.getElementById("store-active-toggle").addEventListener("change", toggleStoreStatus);

  document.getElementById("open-add-deposit-method").addEventListener("click", () => openDepositMethodModal());
  document.getElementById("cancel-deposit-method-modal").addEventListener("click", closeDepositMethodModal);
  document.getElementById("save-deposit-method").addEventListener("click", saveDepositMethod);

  document.getElementById("send-broadcast").addEventListener("click", sendBroadcast);
}

const categoryLabels = {
  games: "ألعاب", subscriptions: "اشتراكات", apps: "تطبيقات",
  cards: "بطاقات", recharge: "تعبئة رصيد", bills: "فواتير",
};

let editingServiceId = null;

function updateServicePricingGroups() {
  const type = document.getElementById("service-pricing-type").value;
  document.getElementById("service-fixed-group").classList.toggle("hidden", type !== "fixed");
  document.getElementById("service-variable-group").classList.toggle("hidden", type !== "variable");
}

function recalcUnitRateFromMin() {
  const minQty = parseFloat(document.getElementById("service-min-qty").value);
  const minPrice = parseFloat(document.getElementById("service-min-price").value);

  if (!minQty || minQty <= 0 || !minPrice || minPrice <= 0) {
    document.getElementById("service-unit-rate").value = "";
    return;
  }

  const rate = minPrice / minQty;
  document.getElementById("service-unit-rate").value = rate.toFixed(6);
}

async function handleImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const statusEl = document.getElementById("upload-status");
  const previewEl = document.getElementById("service-image-preview");

  statusEl.textContent = "جاري رفع الصورة...";
  statusEl.classList.remove("hidden");

  try {
    const formData = new FormData();
    formData.append("key", IMGBB_API_KEY);
    formData.append("image", file);

    const res = await fetch("https://api.imgbb.com/1/upload", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();

    if (!data.success) {
      statusEl.textContent = `فشل رفع الصورة: HTTP ${res.status}`;
      return;
    }

    const url = data.data.url;
    document.getElementById("service-image").value = url;
    previewEl.src = url;
    previewEl.classList.remove("hidden");
    statusEl.textContent = "تم رفع الصورة بنجاح ✓";
  } catch (err) {
    statusEl.textContent = "فشل رفع الصورة: " + (err && err.message ? err.message : "خطأ اتصال غير معروف");
  } finally {
    event.target.value = "";
  }
}

let allAdminServices = [];

async function loadServices() {
  const list = document.getElementById("services-list");
  list.innerHTML = '<p class="placeholder">جاري التحميل...</p>';

  try {
    const res = await fetch("/api/admin/services", { headers: adminHeaders() });
    const services = await res.json();

    allAdminServices = Array.isArray(services) ? services : [];
    renderAdminServicesList();
  } catch (err) {
    list.innerHTML = '<p class="placeholder">حدث خطأ أثناء التحميل.</p>';
  }
}

function renderAdminServicesList() {
  const list = document.getElementById("services-list");
  const searchText = document.getElementById("admin-service-search").value.trim().toLowerCase();

  const filtered = searchText
    ? allAdminServices.filter((s) => s.name.toLowerCase().includes(searchText))
    : allAdminServices;

  if (filtered.length === 0) {
    list.innerHTML = `<p class="placeholder">${searchText ? "ما في نتائج مطابقة." : "لا يوجد خدمات مضافة بعد."}</p>`;
    return;
  }

  list.innerHTML = "";
  filtered.forEach((s) => {
    const priceMeta =
      s.pricing_type === "variable"
        ? `يبدأ من ${((s.unit_rate || 0) * (s.min_qty || 1)).toFixed(2)}$ (${s.min_qty || 1} ${s.unit_name || "وحدة"})`
        : `${(s.price || 0).toFixed(2)}$`;

    const row = document.createElement("div");
    row.className = "service-row";
    row.innerHTML = `
      <div class="service-info">
        <span class="service-name">${s.name}${s.package_name ? " — " + s.package_name : ""}</span>
        <span class="service-meta">${categoryLabels[s.category] || s.category} · ${priceMeta}${s.active ? "" : " · موقوفة"}</span>
      </div>
      <div class="service-actions">
        <button class="icon-btn edit-service" data-id="${s.id}">تعديل</button>
        <button class="icon-btn danger delete-service" data-id="${s.id}">حذف</button>
      </div>
    `;
    list.appendChild(row);
    row.querySelector(".edit-service").addEventListener("click", () => openServiceModal(s));
    row.querySelector(".delete-service").addEventListener("click", () => deleteService(s.id));
  });
}

function openServiceModal(service = null) {
  editingServiceId = service ? service.id : null;
  document.getElementById("service-modal-title").textContent = service ? "تعديل خدمة" : "إضافة خدمة";
  document.getElementById("service-category").value = service ? service.category : "games";
  document.getElementById("service-name").value = service ? service.name : "";
  document.getElementById("service-package").value = service ? (service.package_name || "") : "";
  document.getElementById("service-input-label").value = service ? (service.input_label || "") : "";const pricingType = service ? (service.pricing_type || "fixed") : "fixed";
  document.getElementById("service-pricing-type").value = pricingType;

  document.getElementById("service-price").value = service && service.price != null ? service.price : "";
  document.getElementById("service-unit-name").value = service ? (service.unit_name || "") : "";
  document.getElementById("service-min-qty").value = service && service.min_qty != null ? service.min_qty : "";
  document.getElementById("service-max-qty").value = service && service.max_qty != null ? service.max_qty : "";

  if (service && service.unit_rate != null && service.min_qty) {
    document.getElementById("service-min-price").value = (service.unit_rate * service.min_qty).toFixed(4);
  } else {
    document.getElementById("service-min-price").value = "";
  }
  document.getElementById("service-unit-rate").value = service && service.unit_rate != null ? service.unit_rate : "";

  document.getElementById("service-image").value = service ? (service.image_url || "") : "";
  document.getElementById("service-active").checked = service ? service.active : true;

  const previewEl = document.getElementById("service-image-preview");
  const statusEl = document.getElementById("upload-status");
  statusEl.classList.add("hidden");
  statusEl.textContent = "";
  if (service && service.image_url) {
    previewEl.src = service.image_url;
    previewEl.classList.remove("hidden");
  } else {
    previewEl.classList.add("hidden");
    previewEl.src = "";
  }

  updateServicePricingGroups();
  document.getElementById("service-modal").classList.remove("hidden");
}

function closeServiceModal() {
  document.getElementById("service-modal").classList.add("hidden");
}

async function saveService() {
  const pricingType = document.getElementById("service-pricing-type").value;

  const body = {
    category: document.getElementById("service-category").value,
    name: document.getElementById("service-name").value.trim(),
    package_name: document.getElementById("service-package").value.trim() || null,
    input_label: document.getElementById("service-input-label").value.trim() || null,
    pricing_type: pricingType,
    image_url: document.getElementById("service-image").value.trim() || null,
    active: document.getElementById("service-active").checked,
  };

  if (!body.name) {
    alert("لازم تكتب اسم الخدمة");
    return;
  }

  if (pricingType === "variable") {
    recalcUnitRateFromMin();

    body.unit_name = document.getElementById("service-unit-name").value.trim() || null;
    body.unit_rate = parseFloat(document.getElementById("service-unit-rate").value) || 0;
    const minQty = document.getElementById("service-min-qty").value;
    const maxQty = document.getElementById("service-max-qty").value;
    body.min_qty = minQty !== "" ? parseInt(minQty, 10) : null;
    body.max_qty = maxQty !== "" ? parseInt(maxQty, 10) : null;

    if (!body.unit_name || !body.min_qty || !body.unit_rate) {
      alert("لازم تعبّي اسم الوحدة، الحد الأدنى للكمية، وسعر هاي الكمية");
      return;
    }
  } else {
    body.price = parseFloat(document.getElementById("service-price").value) || 0;
  }

  try {
    const url = editingServiceId ? `/api/admin/services/${editingServiceId}` : "/api/admin/services";
    const method = editingServiceId ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: adminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!data.ok) {
      alert("حدث خطأ، جرّب مرة ثانية.");
      return;
    }

    closeServiceModal();
    loadServices();
  } catch (err) {
    alert("حدث خطأ، جرّب مرة ثانية.");
  }
}

async function deleteService(id) {
  if (!confirm("متأكد إنك بدك تحذف هاي الخدمة؟")) return;

  try {
    const res = await fetch(`/api/admin/services/${id}`, {
      method: "DELETE",
      headers: adminHeaders(),
    });
    const data = await res.json();
    if (data.ok) loadServices();
  } catch (err) {}
}

let methodLabels = {
  sham_cash: "شام كاش",
  syriatel_cash: "سيرياتيل كاش",
  c_wallet: "سي والت",
};

let allDepositMethods = [];
let editingDepositMethodId = null;

async function loadDepositMethods() {
  const list = document.getElementById("deposit-methods-list");
  list.innerHTML = '<p class="placeholder">جاري التحميل...</p>';

  try {
    const res = await fetch("/api/admin/deposit-methods", { headers: adminHeaders() });
    const methods = await res.json();

    allDepositMethods = Array.isArray(methods) ? methods : [];
    methods.forEach((m) => { methodLabels[m.code] = m.name; });
    renderDepositMethodsList();
  } catch (err) {
    list.innerHTML = '<p class="placeholder">حدث خطأ أثناء التحميل.</p>';
  }
}

function renderDepositMethodsList() {
  const list = document.getElementById("deposit-methods-list");

  if (allDepositMethods.length === 0) {
    list.innerHTML = '<p class="placeholder">لا يوجد طرق إيداع مضافة بعد.</p>';
    return;
  }

  list.innerHTML = "";
  allDepositMethods.forEach((m) => {
    const row = document.createElement("div");
    row.className = "service-row";
    row.innerHTML = `
      <div class="service-info">
        <span class="service-name">${m.name}${m.active ? "" : " · موقوفة"}</span>
        <span class="service-meta">${m.display_value}</span>
      </div>
      <div class="service-actions">
        <button class="icon-btn edit-dm" data-id="${m.id}">تعديل</button>
        <button class="icon-btn danger delete-dm" data-id="${m.id}">حذف</button>
      </div>
    `;
    list.appendChild(row);
    row.querySelector(".edit-dm").addEventListener("click", () => openDepositMethodModal(m));
    row.querySelector(".delete-dm").addEventListener("click", () => deleteDepositMethod(m.id));
  });
}

function openDepositMethodModal(method = null) {
  editingDepositMethodId = method ? method.id : null;
  document.getElementById("deposit-method-modal-title").textContent = method ? "تعديل طريقة إيداع" : "إضافة طريقة إيداع";
  document.getElementById("dm-name").value = method ? method.name : "";
  document.getElementById("dm-display-value").value = method ? method.display_value : "";
  document.getElementById("dm-copy-value").value = method ? (method.copy_value || "") : "";
  document.getElementById("dm-instructions").value = method ? (method.instructions || "") : "";
  document.getElementById("dm-active").checked = method ? method.active : true;
  document.getElementById("deposit-method-modal").classList.remove("hidden");
}

function closeDepositMethodModal() {
  document.getElementById("deposit-method-modal").classList.add("hidden");
}

async function saveDepositMethod() {
  const body = {
    name: document.getElementById("dm-name").value.trim(),
    display_value: document.getElementById("dm-display-value").value.trim(),
    copy_value: document.getElementById("dm-copy-value").value.trim(),
    instructions: document.getElementById("dm-instructions").value.trim(),
    active: document.getElementById("dm-active").checked,
  };

  if (!body.name || !body.display_value) {
    alert("لازم تكتب الاسم والرقم/النص المعروض على الأقل");
    return;
  }

  try {
    const url = editingDepositMethodId ? `/api/admin/deposit-methods/${editingDepositMethodId}` : "/api/admin/deposit-methods";
    const method = editingDepositMethodId ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: adminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!data.ok) {
      alert("حدث خطأ، جرّب مرة ثانية.");
      return;
    }

    closeDepositMethodModal();
    loadDepositMethods();
  } catch (err) {
    alert("حدث خطأ، جرّب مرة ثانية.");
  }
}

async function deleteDepositMethod(id) {
  if (!confirm("متأكد إنك بدك تحذف هاي الطريقة؟ (الإيداعات القديمة المرتبطة فيها رح تضل موجودة بسجلاتك)")) return;

  try {
    const res = await fetch(`/api/admin/deposit-methods/${id}`, {
      method: "DELETE",
      headers: adminHeaders(),
    });
    const data = await res.json();
    if (data.ok) loadDepositMethods();
  } catch (err) {}
}

async function loadDeposits() {
  const list = document.getElementById("deposits-list");
  list.innerHTML = '<p class="placeholder">جاري التحميل...</p>';

  try {
    const res = await fetch("/api/admin/deposits", { headers: adminHeaders() });
    const deposits = await res.json();

    if (!Array.isArray(deposits) || deposits.length === 0) {
      list.innerHTML = '<p class="placeholder">لا يوجد إيداعات معلّقة حالياً.</p>';
      return;
    }

    list.innerHTML = "";
    deposits.forEach((d) => {
      const row = document.createElement("div");
      row.className = "service-row";
      row.innerHTML = `
        <div class="service-info">
          <span class="service-name">${methodLabels[d.method] || d.method} — ${d.amount.toFixed(2)}$</span>
          <span class="service-meta">مستخدم: ${d.user_telegram_id}${d.proof_text ? " · رقم العملية: " + d.proof_text : ""}</span>
        </div>
        <div class="service-actions">
          ${d.proof_image_url ? '<button class="icon-btn view-proof">الإثبات</button>' : ""}
          <button class="icon-btn approve-deposit">قبول</button>
          <button class="icon-btn danger reject-deposit">رفض</button>
        </div>
      `;
      list.appendChild(row);

      if (d.proof_image_url) {
        row.querySelector(".view-proof").addEventListener("click", () => {
          tg.openLink(d.proof_image_url);
        });
      }
      row.querySelector(".approve-deposit").addEventListener("click", () => approveDeposit(d.id));
      row.querySelector(".reject-deposit").addEventListener("click", () => rejectDeposit(d.id));
    });
  } catch (err) {
    list.innerHTML = '<p class="placeholder">حدث خطأ أثناء التحميل.</p>';
  }
}

async function approveDeposit(id) {if (!confirm("متأكد إنك بدك تقبل هاي الإيداع؟ رح تضاف القيمة لرصيد المستخدم.")) return;

  try {
    const res = await fetch(`/api/admin/deposits/${id}/approve`, {
      method: "POST",
      headers: adminHeaders(),
    });
    const data = await res.json();
    if (data.ok) loadDeposits();
    else alert("تعذّر قبول الإيداع.");
  } catch (err) {}
}

async function rejectDeposit(id) {
  const reason = prompt("سبب الرفض (اختياري):") || "";

  try {
    const res = await fetch(`/api/admin/deposits/${id}/reject`, {
      method: "POST",
      headers: adminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ reason }),
    });
    const data = await res.json();
    if (data.ok) loadDeposits();
    else alert("تعذّر رفض الإيداع.");
  } catch (err) {}
}

async function loadOrders() {
  const list = document.getElementById("orders-list");
  list.innerHTML = '<p class="placeholder">جاري التحميل...</p>';

  try {
    const res = await fetch("/api/admin/orders", { headers: adminHeaders() });
    const orders = await res.json();

    if (!Array.isArray(orders) || orders.length === 0) {
      list.innerHTML = '<p class="placeholder">لا يوجد طلبات معلّقة حالياً.</p>';
      return;
    }

    list.innerHTML = "";
    orders.forEach((o) => {
      const qtyMeta = o.quantity ? ` · الكمية: ${o.quantity} ${o.unit_name || ""}` : "";
      const row = document.createElement("div");
      row.className = "service-row";
      row.innerHTML = `
        <div class="service-info">
          <span class="service-name">${o.service_name}${o.package_name ? " — " + o.package_name : ""}</span>
          <span class="service-meta">مستخدم: ${o.user_telegram_id}${o.player_id ? " · معرّف: " + o.player_id : ""}${qtyMeta} · ${o.price.toFixed(2)}$</span>
        </div>
        <div class="service-actions">
          <button class="icon-btn complete-order">تم التنفيذ</button>
          <button class="icon-btn danger cancel-order">إلغاء</button>
        </div>
      `;
      list.appendChild(row);

      row.querySelector(".complete-order").addEventListener("click", () => completeOrder(o.id));
      row.querySelector(".cancel-order").addEventListener("click", () => cancelOrder(o.id));
    });
  } catch (err) {
    list.innerHTML = '<p class="placeholder">حدث خطأ أثناء التحميل.</p>';
  }
}

async function completeOrder(id) {
  if (!confirm("متأكد إنك نفّذت هاد الطلب؟")) return;

  try {
    const res = await fetch(`/api/admin/orders/${id}/complete`, {
      method: "POST",
      headers: adminHeaders(),
    });
    const data = await res.json();
    if (data.ok) loadOrders();
    else alert("تعذّر تنفيذ العملية.");
  } catch (err) {}
}

async function cancelOrder(id) {
  const reason = prompt("سبب الإلغاء (اختياري):") || "";

  try {
    const res = await fetch(`/api/admin/orders/${id}/cancel`, {
      method: "POST",
      headers: adminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ reason }),
    });
    const data = await res.json();
    if (data.ok) loadOrders();
    else alert("تعذّر إلغاء الطلب.");
  } catch (err) {}
}

const permissionLabels = {
  can_manage_prices: "الأسعار",
  can_approve_deposits: "الإيداعات",
  can_fulfill_orders: "الطلبات",
  can_manage_admins: "المشرفين",
};

let editingAdminId = null;

async function loadAdmins() {
  const list = document.getElementById("admins-list");
  list.innerHTML = '<p class="placeholder">جاري التحميل...</p>';

  try {
    const res = await fetch("/api/admin/admins", { headers: adminHeaders() });
    const admins = await res.json();

    if (!Array.isArray(admins) || admins.length === 0) {
      list.innerHTML = '<p class="placeholder">لا يوجد مشرفين إضافيين بعد.</p>';
      return;
    }

    list.innerHTML = "";
    admins.forEach((a) => {
      const perms = Object.keys(permissionLabels)
        .filter((k) => a[k])
        .map((k) => permissionLabels[k])
        .join("، ") || "بدون صلاحيات";

      const row = document.createElement("div");
      row.className = "service-row";
      row.innerHTML = `
        <div class="service-info">
          <span class="service-name">${a.telegram_id}</span>
          <span class="service-meta">${perms}</span>
        </div>
        <div class="service-actions">
          <button class="icon-btn edit-admin">تعديل</button>
          <button class="icon-btn danger delete-admin">حذف</button>
        </div>
      `;
      list.appendChild(row);

      row.querySelector(".edit-admin").addEventListener("click", () => openAdminModal(a));
      row.querySelector(".delete-admin").addEventListener("click", () => deleteAdmin(a.id));
    });
  } catch (err) {
    list.innerHTML = '<p class="placeholder">حدث خطأ أثناء التحميل.</p>';
  }
}

function openAdminModal(admin = null) {
  editingAdminId = admin ? admin.id : null;
  const idField = document.getElementById("admin-telegram-id");
  idField.value = admin ? admin.telegram_id : "";
  idField.disabled = !!admin;
  document.getElementById("admin-can-prices").checked = admin ? admin.can_manage_prices : false;
  document.getElementById("admin-can-deposits").checked = admin ? admin.can_approve_deposits : false;
  document.getElementById("admin-can-orders").checked = admin ? admin.can_fulfill_orders : false;
  document.getElementById("admin-can-admins").checked = admin ? admin.can_manage_admins : false;
  document.getElementById("admin-modal").classList.remove("hidden");
}

function closeAdminModal() {
  document.getElementById("admin-modal").classList.add("hidden");
  document.getElementById("admin-telegram-id").disabled = false;
}

async function saveAdmin() {
  const body = {
    can_manage_prices: document.getElementById("admin-can-prices").checked,
    can_approve_deposits: document.getElementById("admin-can-deposits").checked,
    can_fulfill_orders: document.getElementById("admin-can-orders").checked,
    can_manage_admins: document.getElementById("admin-can-admins").checked,
  };

  if (!editingAdminId) {
    const telegramId = document.getElementById("admin-telegram-id").value.trim();
    if (!telegramId) {
      alert("لازم تكتب آيدي تيليجرام");
      return;
    }
    body.telegram_id = telegramId;
  }

  try {
    const url = editingAdminId ? `/api/admin/admins/${editingAdminId}` : "/api/admin/admins";
    const method = editingAdminId ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: adminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!data.ok) {
      alert(data.error === "already_admin" ? "هاد الآيدي مشرف أصلاً" : "حدث خطأ، جرّب مرة ثانية.");
      return;
    }

    closeAdminModal();
    loadAdmins();
  } catch (err) {
    alert("حدث خطأ، جرّب مرة ثانية.");
  }
}

async function deleteAdmin(id) {
  if (!confirm("متأكد إنك بدك تحذف هاد المشرف؟")) return;

  try {
    const res = await fetch(`/api/admin/admins/${id}`, {
      method: "DELETE",
      headers: adminHeaders(),
    });
    const data = await res.json();
    if (data.ok) loadAdmins();
  } catch (err) {}
}

async function loadStats() {
  const container = document.getElementById("stats-content");
  container.innerHTML = '<p class="placeholder">جاري التحميل...</p>';

  try {
    const res = await fetch("/api/admin/stats", { headers: adminHeaders() });
    const s = await res.json();

    container.innerHTML = `
      <div class="stat-row">
        <div class="stat-card">
          <span class="stat-label">إجمالي المبيعات</span>
          <span class="stat-value">${s.total_sales.toFixed(2)}$</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">طلبات منفّذة</span>
          <span class="stat-value">${s.completed_orders}</span>
        </div>
      </div>
      <div class="stat-row">
        <div class="stat-card">
          <span class="stat-label">طلبات ملغاة</span>
          <span class="stat-value">${s.cancelled_orders}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">إجمالي الإيداعات المقبولة</span>
          <span class="stat-value">${s.total_deposits.toFixed(2)}$</span>
        </div>
      </div>
      <div class="stat-row">
        <div class="stat-card">
          <span class="stat-label">إيداعات مقبولة</span>
          <span class="stat-value">${s.approved_deposits}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">إيداعات مرفوضة</span>
          <span class="stat-value">${s.rejected_deposits}</span>
        </div>
      </div>
      <div class="stat-row">
        <div class="stat-card">
          <span class="stat-label">إجمالي أرصدة المستخدمين</span>
          <span class="stat-value">${s.total_balance.toFixed(2)}$</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">عدد المستخدمين</span>
          <span class="stat-value">${s.total_users}</span>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = '<p class="placeholder">حدث خطأ أثناء التحميل.</p>';
  }
}

function formatLogDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString("ar-SY", { dateStyle: "short", timeStyle: "short" });
}

async function loadLogs() {
  const list = document.getElementById("logs-list");list.innerHTML = '<p class="placeholder">جاري التحميل...</p>';

  try {
    const res = await fetch("/api/admin/logs", { headers: adminHeaders() });
    const logs = await res.json();

    if (!Array.isArray(logs) || logs.length === 0) {
      list.innerHTML = '<p class="placeholder">لا يوجد عمليات مسجّلة بعد.</p>';
      return;
    }

    list.innerHTML = "";
    logs.forEach((l) => {
      const row = document.createElement("div");
      row.className = "service-row";
      row.innerHTML = `
        <div class="service-info">
          <span class="service-name">${l.action}${l.details ? " — " + l.details : ""}</span>
          <span class="service-meta">${l.admin_telegram_id} · ${formatLogDate(l.created_at)}</span>
        </div>
      `;
      list.appendChild(row);
    });
  } catch (err) {
    list.innerHTML = '<p class="placeholder">حدث خطأ أثناء التحميل.</p>';
  }
}

async function sendBroadcast() {
  const message = document.getElementById("broadcast-message").value.trim();
  const resultEl = document.getElementById("broadcast-result");

  if (!message) {
    alert("لازم تكتب نص الرسالة");
    return;
  }

  if (!confirm("متأكد إنك بدك تبعت هاي الرسالة لكل المستخدمين؟")) return;

  resultEl.textContent = "جاري الإرسال...";

  try {
    const res = await fetch("/api/admin/broadcast", {
      method: "POST",
      headers: adminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ message }),
    });
    const data = await res.json();

    if (!data.ok) {
      resultEl.textContent = "حدث خطأ أثناء الإرسال.";
      return;
    }

    resultEl.textContent =
      `تم الإرسال لـ ${data.sent} مستخدم` +
      (data.failed ? ` (فشل الإرسال لـ ${data.failed})` : "");
    document.getElementById("broadcast-message").value = "";
  } catch (err) {
    resultEl.textContent = "حدث خطأ أثناء الإرسال.";
  }
}

// ==================== STORE (CUSTOMER) LOGIC ====================

function userHeaders(extra = {}) {
  return { "X-Telegram-Init-Data": tg.initData, ...extra };
}

function setupStoreNav() {
  // التنقل بالقائمة السفلية
  document.querySelectorAll(".bnav-btn").forEach((btn) => {
    btn.addEventListener("click", () => showUserSection(btn.dataset.userSection));
  });

  // زر "شحن" بأعلى الشاشة
  document.getElementById("topbar-add-funds").addEventListener("click", () => {
    showUserSection("user-deposit-section");
  });

  // فلاتر التصنيفات
  document.querySelectorAll(".cat-btn").forEach((btn) => {
    btn.addEventListener("click", () => selectCategory(btn.dataset.cat));
  });

  // حقل البحث
  document.getElementById("service-search").addEventListener("input", (e) => {
    currentSearchText = e.target.value;
    renderServicesGrid(currentCategory);
  });

  // أرقام المحافظ وطرق الدفع بشاشة الرئيسية ونافذة الإيداع
  loadCustomerDepositMethods();

  // مودال اختيار الباقة
  document.getElementById("cancel-package-select").addEventListener("click", closePackageSelectModal);

  // مودال الشراء
  document.getElementById("cancel-buy-modal").addEventListener("click", closeBuyModal);
  document.getElementById("confirm-buy").addEventListener("click", confirmBuy);
  document.getElementById("buy-quantity").addEventListener("input", updateBuyModalComputedPrice);

  // نموذج الإيداع
  document.getElementById("submit-deposit").addEventListener("click", submitDeposit);
  document.getElementById("deposit-method").addEventListener("change", updateDepositInstructions);

  // الإحالة
  document.getElementById("copy-ref-link").addEventListener("click", copyReferralLink);
}

function showUserSection(id) {
  document.querySelectorAll(".user-section").forEach((el) => el.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");

  document.querySelectorAll(".bnav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.userSection === id);
  });

  if (id === "user-deposit-section") loadMyDeposits();
  if (id === "user-orders-section") loadMyOrders();
  if (id === "user-referral-section") setupReferralLink();
}

async function loadStoreServices() {
  const grid = document.getElementById("user-services-grid");
  grid.innerHTML = '<p class="placeholder">جاري التحميل...</p>';

  try {
    const res = await fetch("/api/store/services", { headers: userHeaders() });
    const services = await res.json();

    allServices = Array.isArray(services) ? services : [];
    renderStoreView();
  } catch (err) {
    grid.innerHTML = '<p class="placeholder">حدث خطأ أثناء تحميل الخدمات.</p>';
  }
}

function selectCategory(cat) {
  currentCategory = cat;
  document.querySelectorAll(".cat-btn").forEach((b) => b.classList.toggle("active", b.dataset.cat === cat));
  renderStoreView();
}

function renderStoreView() {
  const homeSection = document.getElementById("user-home-section");
  const searchWrap = document.getElementById("store-search-wrap");
  const grid = document.getElementById("user-services-grid");

  if (currentCategory === "home") {
    homeSection.classList.remove("hidden");
    searchWrap.classList.add("hidden");
    grid.classList.add("hidden");
  } else {
    homeSection.classList.add("hidden");
    searchWrap.classList.remove("hidden");
    grid.classList.remove("hidden");
    renderServicesGrid(currentCategory);
  }
}

let customerDepositMethods = [];

async function loadCustomerDepositMethods() {
  try {
    const res = await fetch("/api/store/deposit-methods", { headers: userHeaders() });
    const methods = await res.json();
    customerDepositMethods = Array.isArray(methods) ? methods : [];
  } catch (err) {
    customerDepositMethods = [];
  }

  // بطاقات المحافظ بشاشة الرئيسية
  const walletList = document.getElementById("wallet-cards-list");
  walletList.innerHTML = "";
  customerDepositMethods.forEach((m) => {
    const card = document.createElement("div");
    card.className = "wallet-card";
    card.innerHTML = `
      <div class="wallet-card-header">
        <span class="wallet-name">${m.name}</span>
        <button class="icon-btn copy-wallet">نسخ الرقم</button>
      </div>
      <span class="wallet-number">${m.display_value}</span>
    `;
    walletList.appendChild(card);
    card.querySelector(".copy-wallet").addEventListener("click", () => copyWalletNumber(m.id));
  });

  // قائمة طرق الدفع بنافذة الإيداع
  const select = document.getElementById("deposit-method");
  select.innerHTML = "";
  customerDepositMethods.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.code;
    opt.textContent = m.name;
    select.appendChild(opt);
  });

  updateDepositInstructions();
}

async function copyWalletNumber(methodId) {
  const method = customerDepositMethods.find((m) => m.id === methodId);
  const number = (method && (method.copy_value || method.display_value)) || "";
  try {
    await navigator.clipboard.writeText(number);
    alert("تم نسخ الرقم!");
  } catch (err) {
    alert("تعذّر نسخ الرقم.");
  }
}

function groupServicesByName(list) {
  const groups = {};
  list.forEach((s) => {
    const key = s.name;
    if (!groups[key]) groups[key] = [];
    groups[key].push(s);
  });
  return groups;
}

function servicePriceForSort(s) {
  return s.pricing_type === "variable" ? (s.unit_rate || 0) * (s.min_qty || 1) : s.price || 0;
}

function renderServicesGrid(category) {
  const grid = document.getElementById("user-services-grid");
  let filtered = category === "all" ? allServices : allServices.filter((s) => s.category === category);

  if (currentSearchText.trim()) {
    const q = currentSearchText.trim().toLowerCase();
    filtered = filtered.filter((s) => s.name.toLowerCase().includes(q));
  }

  if (filtered.length === 0) {
    grid.innerHTML = `<p class="placeholder">${currentSearchText.trim() ? "ما في نتائج مطابقة." : "لا يوجد خدمات بهاد التصنيف حالياً."}</p>`;
    return;
  }

  const groups = groupServicesByName(filtered);
  grid.innerHTML = "";

  Object.keys(groups).forEach((name) => {
    const group = groups[name];
    const representative = group.find((s) => s.image_url) || group[0];

    let priceLabel;
    let subLabel;

    if (group.length > 1) {
      const prices = group.map(servicePriceForSort);
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      priceLabel = min === max ? `${min.toFixed(2)}$` : `من ${min.toFixed(2)}$`;
      subLabel = `${group.length} باقات متاحة`;
    } else {
      const s = group[0];
      priceLabel = `${servicePriceForSort(s).toFixed(2)}$`;
      subLabel = s.pricing_type === "variable" ? `يبدأ من ${s.min_qty || 1} ${s.unit_name || "وحدة"}` : s.package_name || "";
    }

    const card = document.createElement("div");
    card.className = "service-card";
    card.innerHTML = `
      <div class="scard-img-box">
        ${
          representative.image_url
            ? `<img class="scard-img" src="${representative.image_url}" alt="" />`
            : `<svg class="scard-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`
        }
      </div>
      <div class="scard-details">
        <p class="scard-title">${name}</p>${subLabel ? `<span class="scard-sub">${subLabel}</span>` : ""}
        <span class="scard-price">${priceLabel}</span>
      </div>
      <button class="btn-primary btn-buy">اشتري</button>
    `;
    grid.appendChild(card);

    card.querySelector(".btn-buy").addEventListener("click", () => {
      if (group.length > 1) {
        openPackageSelectModal(name, group);
      } else {
        openBuyModal(group[0]);
      }
    });
  });
}

function openPackageSelectModal(name, services) {
  document.getElementById("package-select-title").textContent = name;
  const list = document.getElementById("package-select-list");
  list.innerHTML = "";

  services.forEach((s) => {
    const priceLabel = `${servicePriceForSort(s).toFixed(2)}$`;

    const row = document.createElement("div");
    row.className = "service-row package-row";
    row.innerHTML = `
      <div class="service-info">
        <span class="service-name">${s.package_name || s.name}</span>
        <span class="service-meta">${priceLabel}</span>
      </div>
    `;
    row.addEventListener("click", () => {
      closePackageSelectModal();
      openBuyModal(s);
    });
    list.appendChild(row);
  });

  document.getElementById("package-select-modal").classList.remove("hidden");
}

function closePackageSelectModal() {
  document.getElementById("package-select-modal").classList.add("hidden");
}

function openBuyModal(service) {
  currentBuyService = service;

  document.getElementById("buy-modal-service-name").textContent =
    service.name + (service.package_name ? " — " + service.package_name : "");
  document.getElementById("buy-player-id").value = "";
  document.getElementById("buy-modal-input-label").textContent =
    service.input_label || "معرّف اللاعب / رقم الحساب / الإيميل";

  const quantityGroup = document.getElementById("buy-modal-quantity-group");
  const quantityInput = document.getElementById("buy-quantity");
  const quantityHint = document.getElementById("buy-quantity-hint");
  const priceEl = document.getElementById("buy-modal-service-price");

  if (service.pricing_type === "variable") {
    quantityGroup.classList.remove("hidden");
    document.getElementById("buy-quantity-label").textContent = `الكمية (${service.unit_name || "وحدة"})`;
    quantityInput.value = "";

    let hint = "";
    if (service.min_qty) hint += `الحد الأدنى: ${service.min_qty} (${servicePriceForSort(service).toFixed(2)}$)`;
    if (service.max_qty) hint += `${hint ? " · " : ""}الحد الأقصى: ${service.max_qty}`;
    quantityHint.textContent = hint;

    priceEl.textContent = "0.00$";
  } else {
    quantityGroup.classList.add("hidden");
    priceEl.textContent = (service.price || 0).toFixed(2) + "$";
  }

  document.getElementById("user-buy-modal").classList.remove("hidden");
}

function updateBuyModalComputedPrice() {
  if (!currentBuyService || currentBuyService.pricing_type !== "variable") return;

  const qty = parseInt(document.getElementById("buy-quantity").value, 10) || 0;
  const total = qty * (currentBuyService.unit_rate || 0);
  document.getElementById("buy-modal-service-price").textContent = total.toFixed(2) + "$";
}

function closeBuyModal() {
  document.getElementById("user-buy-modal").classList.add("hidden");
  currentBuyService = null;
}

async function confirmBuy() {
  if (!currentBuyService) return;

  const playerId = document.getElementById("buy-player-id").value.trim();
  if (!playerId) {
    alert("لازم تدخل المعرّف/البيانات المطلوبة");
    return;
  }

  const body = {
    service_id: currentBuyService.id,
    player_id: playerId,
  };

  if (currentBuyService.pricing_type === "variable") {
    const qty = parseInt(document.getElementById("buy-quantity").value, 10) || 0;

    if (qty <= 0) {
      alert("لازم تدخل كمية صحيحة");
      return;
    }
    if (currentBuyService.min_qty && qty < currentBuyService.min_qty) {
      alert(`الحد الأدنى للكمية هو ${currentBuyService.min_qty}`);
      return;
    }
    if (currentBuyService.max_qty && qty > currentBuyService.max_qty) {
      alert(`الحد الأقصى للكمية هو ${currentBuyService.max_qty}`);
      return;
    }

    body.quantity = qty;
  }

  try {
    const res = await fetch("/api/store/order", {
      method: "POST",
      headers: userHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!data.ok) {
      const errorMessages = {
        insufficient_balance: "رصيدك غير كافي لهاي العملية.",
        below_min_qty: `الكمية أقل من الحد الأدنى.`,
        above_max_qty: `الكمية أكبر من الحد الأقصى.`,
        invalid_quantity: "الكمية المدخلة غير صحيحة.",
      };
      alert(errorMessages[data.error] || "حدث خطأ، جرّب مرة ثانية.");
      return;
    }

    currentUser.balance = data.new_balance;
    updateBalanceDisplay();
    closeBuyModal();
    alert("تم إرسال طلبك بنجاح! رح ينفّذ قريباً.");
  } catch (err) {
    alert("حدث خطأ، جرّب مرة ثانية.");
  }
}

async function loadMyOrders() {
  const list = document.getElementById("user-orders-list");
  list.innerHTML = '<p class="placeholder">جاري التحميل...</p>';

  try {
    const res = await fetch("/api/store/my-orders", { headers: userHeaders() });
    const orders = await res.json();

    if (!Array.isArray(orders) || orders.length === 0) {
      list.innerHTML = '<p class="placeholder">لا يوجد طلبات بعد.</p>';
      return;
    }

    const statusLabels = { pending: "قيد التنفيذ", done: "منفّذ", cancelled: "ملغي" };

    list.innerHTML = "";
    orders.forEach((o) => {
      const qtyMeta = o.quantity ? ` · الكمية: ${o.quantity} ${o.unit_name || ""}` : "";
      const row = document.createElement("div");
      row.className = "service-row";
      row.innerHTML = `
        <div class="service-info">
          <span class="service-name">${o.service_name}${o.package_name ? " — " + o.package_name : ""}</span>
          <span class="service-meta">${o.price.toFixed(2)}$${qtyMeta}${o.cancel_reason ? " · السبب: " + o.cancel_reason : ""}</span>
        </div>
        <span class="status-badge ${o.status === "done" ? "approved" : o.status === "cancelled" ? "rejected" : "pending"}">
          ${statusLabels[o.status] || o.status}
        </span>
      `;
      list.appendChild(row);
    });
  } catch (err) {
    list.innerHTML = '<p class="placeholder">حدث خطأ أثناء التحميل.</p>';
  }
}

function updateDepositInstructions() {
  const code = document.getElementById("deposit-method").value;
  const method = customerDepositMethods.find((m) => m.code === code);
  const name = (method && method.name) || methodLabels[code] || code;

  let text = `قم بالتحويل عبر ${name} للحساب المعتمد، ثم أدخل المبلغ ورقم العملية بالأسفل. رح تنراجع الإيداع وتُضاف القيمة لرصيدك بعد القبول.`;
  if (method && method.instructions) {
    text += ` ${method.instructions}`;
  }
  document.getElementById("payment-instructions").textContent = text;
}

async function submitDeposit() {
  const method = document.getElementById("deposit-method").value;
  const amount = parseFloat(document.getElementById("deposit-amount").value) || 0;
  const proofText = document.getElementById("deposit-proof-text").value.trim();

  if (amount <= 0) {
    alert("لازم تدخل مبلغ صحيح");
    return;
  }

  try {
    const res = await fetch("/api/store/deposit", {
      method: "POST",
      headers: userHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        method,
        amount,
        proof_text: proofText,
      }),
    });
    const data = await res.json();

    if (!data.ok) {
      alert("حدث خطأ، جرّب مرة ثانية.");
      return;
    }

    document.getElementById("deposit-amount").value = "";
    document.getElementById("deposit-proof-text").value = "";

    alert("تم إرسال طلب الإيداع، رح ينراجع من الإدارة قريباً.");
    loadMyDeposits();
  } catch (err) {
    alert("حدث خطأ، جرّب مرة ثانية.");
  }
}

async function loadMyDeposits() {
  const list = document.getElementById("user-deposits-list");
  list.innerHTML = '<p class="placeholder">جاري التحميل...</p>';

  try {
    const res = await fetch("/api/store/my-deposits", { headers: userHeaders() });
    const deposits = await res.json();

    if (!Array.isArray(deposits) || deposits.length === 0) {
      list.innerHTML = '<p class="placeholder">لا يوجد إيداعات بعد.</p>';
      return;
    }

    const statusLabels = { pending: "قيد المراجعة", approved: "مقبول", rejected: "مرفوض" };

    list.innerHTML = "";
    deposits.forEach((d) => {
      const row = document.createElement("div");
      row.className = "service-row";
      row.innerHTML = `
        <div class="service-info">
          <span class="service-name">${methodLabels[d.method] || d.method} — ${d.amount.toFixed(2)}$</span>
          <span class="service-meta">${d.reject_reason ? "السبب: " + d.reject_reason : ""}</span>
        </div>
        <span class="status-badge ${d.status}">${statusLabels[d.status] || d.status}</span>
      `;
      list.appendChild(row);
    });
  } catch (err) {
    list.innerHTML = '<p class="placeholder">حدث خطأ أثناء التحميل.</p>';
  }
}

function setupReferralLink() {
  if (!currentUser) return;
  const link = `https://t.me/${BOT_USERNAME}?start=ref_${currentUser.telegram_id}`;
  document.getElementById("referral-link").value = link;
}

async function copyReferralLink() {
  const linkField = document.getElementById("referral-link");
  try {
    await navigator.clipboard.writeText(linkField.value);
    alert("تم نسخ الرابط!");
  } catch (err) {
    linkField.select();
    document.execCommand("copy");
    alert("تم نسخ الرابط!");
  }
}

init();
