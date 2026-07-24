const tg = window.Telegram?.WebApp;

let currentUser = null;
let allStoreServices = [];
let selectedServiceToBuy = null;

function show(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

function userHeaders(extra = {}) {
  return { "X-Telegram-Init-Data": tg?.initData || "", ...extra };
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

    currentUser = data.user;

    if (data.is_admin) {
      show("admin-view");
      setupAdminNav(data.permissions);
      loadAdminSummary();
    } else {
      updateUserBalanceUI(currentUser.balance);
      show("store-view");
      setupUserNav();
      loadStoreServices();
    }
  } catch (err) {
    show("error-view");
  }
}

function updateUserBalanceUI(bal) {
  if (currentUser) currentUser.balance = bal;
  document.getElementById("store-balance").textContent = bal.toFixed(2) + "$";
}

// ==================== USER STORE LOGIC ====================

function setupUserNav() {
  document.querySelectorAll(".bnav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sectionId = btn.dataset.userSection;
      showUserSection(sectionId);
    });
  });

  document.getElementById("topbar-add-funds").addEventListener("click", () => {
    showUserSection("user-deposit-section");
  });

  document.querySelectorAll(".cat-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".cat-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderStoreServices(btn.dataset.cat);
    });
  });

  document.getElementById("cancel-buy-modal").addEventListener("click", closeBuyModal);
  document.getElementById("confirm-buy").addEventListener("click", processPurchase);

  document.getElementById("submit-deposit").addEventListener("click", submitDepositRequest);
  document.getElementById("copy-ref-link").addEventListener("click", copyReferralLink);
}

function showUserSection(id) {
  document.querySelectorAll(".user-section").forEach((el) => el.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");

  document.querySelectorAll(".bnav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.userSection === id);
  });

  if (id === "user-store-section") loadStoreServices();
  if (id === "user-deposit-section") loadUserDeposits();
  if (id === "user-orders-section") loadUserOrders();
  if (id === "user-referral-section") loadReferralInfo();
}

async function loadStoreServices() {
  const grid = document.getElementById("user-services-grid");
  grid.innerHTML = '<p class="placeholder">جاري تحميل الخدمات...</p>';

  try {
    const res = await fetch("/api/store/services", { headers: userHeaders() });
    allStoreServices = await res.json();

    const activeCatBtn = document.querySelector(".cat-btn.active");
    const activeCat = activeCatBtn ? activeCatBtn.dataset.cat : "all";
    renderStoreServices(activeCat);
  } catch (err) {
    grid.innerHTML = '<p class="placeholder">حدث خطأ أثناء تحميل المتجر.</p>';
  }
}

function renderStoreServices(category = "all") {
  const grid = document.getElementById("user-services-grid");
  
  const filtered = category === "all" 
    ? allStoreServices 
    : allStoreServices.filter((s) => s.category === category);

  if (filtered.length === 0) {
    grid.innerHTML = '<p class="placeholder">لا توجد خدمات متاحة حالياً بهذا القسم.</p>';
    return;
  }

  grid.innerHTML = "";
  filtered.forEach((s) => {
    const card = document.createElement("div");
    card.className = "service-card";
    card.innerHTML = `
      <div class="scard-img-box">
        ${s.image_url ? `<img src="${s.image_url}" alt="${s.name}" class="scard-img" />` : '<div class="scard-icon">⚡</div>'}
      </div>
      <div class="scard-details">
        <h4 class="scard-title">${s.name}</h4>
        <span class="scard-sub">${s.package_name || ""}</span>
        <span class="scard-price">${s.price.toFixed(2)}$</span>
      </div>
      <button class="btn-primary btn-buy" data-id="${s.id}">شراء</button>
    `;
    grid.appendChild(card);

    card.querySelector(".btn-buy").addEventListener("click", () => openBuyModal(s));
  });
}

function openBuyModal(service) {
  selectedServiceToBuy = service;
  document.getElementById("buy-modal-service-name").textContent = service.name + (service.package_name ? " - " + service.package_name : "");
  document.getElementById("buy-modal-service-price").textContent = service.price.toFixed(2) + "$";
  document.getElementById("buy-player-id").value = "";
  document.getElementById("user-buy-modal").classList.remove("hidden");
}

function closeBuyModal() {
  document.getElementById("user-buy-modal").classList.add("hidden");
  selectedServiceToBuy = null;
}

async function processPurchase() {
  if (!selectedServiceToBuy) return;

  const playerId = document.getElementById("buy-player-id").value.trim();

  if (currentUser.balance < selectedServiceToBuy.price) {
    alert("رصيدك الحالي غير كافٍ. اضغط على شحن لشحن رصيدك أولاً.");
    closeBuyModal();
    showUserSection("user-deposit-section");
    return;
  }

  try {
    const res = await fetch("/api/store/order", {
      method: "POST",
      headers: userHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        service_id: selectedServiceToBuy.id,
        player_id: playerId,
      }),
    });

    const data = await res.json();

    if (!data.ok) {
      if (data.error === "insufficient_balance") alert("رصيدك غير كافٍ.");
      else alert("تعذّر إجراء العملية، جرّب لاحقاً.");
      return;
    }

    updateUserBalanceUI(data.new_balance);
    closeBuyModal();
    alert("✅ تم إرسال طلب الشراء بنجاح! يمكنك متابعة حالته من تبويب طلباتي.");
    showUserSection("user-orders-section");
  } catch (err) {
    alert("حدث خطأ أثناء الاتصال.");
  }
}

async function submitDepositRequest() {
  const method = document.getElementById("deposit-method").value;
  const amount = parseFloat(document.getElementById("deposit-amount").value) || 0;
  const proofText = document.getElementById("deposit-proof-text").value.trim();
  const proofImage = document.getElementById("deposit-proof-image").value.trim();

  if (amount <= 0) {
    alert("يرجى إدخال مبلغ صحيح.");
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
        proof_image_url: proofImage,
      }),
    });

    const data = await res.json();
    if (!data.ok) {
      alert("حدث خطأ في الإرسال.");
      return;
    }

    alert("✅ تم إرسال طلب الإيداع. سيتم فحص الطلب وإضافة الرصيد لحسابك بأسرع وقت.");
    document.getElementById("deposit-amount").value = "";
    document.getElementById("deposit-proof-text").value = "";
    document.getElementById("deposit-proof-image").value = "";
    loadUserDeposits();
  } catch (err) {
    alert("حدث خطأ أثناء الإرسال.");
  }
}

async function loadUserDeposits() {
  const list = document.getElementById("user-deposits-list");
  list.innerHTML = '<p class="placeholder">جاري التحميل...</p>';

  try {
    const res = await fetch("/api/store/my-deposits", { headers: userHeaders() });
    const deposits = await res.json();

    if (!Array.isArray(deposits) || deposits.length === 0) {
      list.innerHTML = '<p class="placeholder">لا توجد لديك طلبات إيداع سابقة.</p>';
      return;
    }

    list.innerHTML = "";
    deposits.forEach((d) => {
      let statusBadge = '<span class="status-badge pending">قيد الانتظار ⏳</span>';
      if (d.status === "approved") statusBadge = '<span class="status-badge approved">مقبول ✅</span>';
      if (d.status === "rejected") statusBadge = `<span class="status-badge rejected">مرفوض ❌ ${d.reject_reason ? " (" + d.reject_reason + ")" : ""}</span>`;

      const row = document.createElement("div");
      row.className = "service-row";
      row.innerHTML = `
        <div class="service-info">
          <span class="service-name">${d.amount.toFixed(2)}$ — ${d.method}</span>
          <span class="service-meta">${d.proof_text ? "رقم الإشعار: " + d.proof_text : "طلب عادي"}</span>
        </div>
        <div class="service-actions">${statusBadge}</div>
      `;
      list.appendChild(row);
    });
  } catch (err) {
    list.innerHTML = '<p class="placeholder">حدث خطأ أثناء التحميل.</p>';
  }
}

async function loadUserOrders() {
  const list = document.getElementById("user-orders-list");
  list.innerHTML = '<p class="placeholder">جاري التحميل...</p>';

  try {
    const res = await fetch("/api/store/my-orders", { headers: userHeaders() });
    const orders = await res.json();

    if (!Array.isArray(orders) || orders.length === 0) {
      list.innerHTML = '<p class="placeholder">لا توجد طلبات سابقة.</p>';
      return;
    }

    list.innerHTML = "";
    orders.forEach((o) => {
      let statusBadge = '<span class="status-badge pending">قيد التنفيذ ⏳</span>';
      if (o.status === "done") statusBadge = '<span class="status-badge approved">مكتمل ✅</span>';
      if (o.status === "cancelled") statusBadge = `<span class="status-badge rejected">ملغى ❌ ${o.cancel_reason ? " (" + o.cancel_reason + ")" : ""}</span>`;

      const row = document.createElement("div");
      row.className = "service-row";
      row.innerHTML = `
        <div class="service-info">
          <span class="service-name">${o.service_name}${o.package_name ? " - " + o.package_name : ""}</span>
          <span class="service-meta">السعر: ${o.price.toFixed(2)}$${o.player_id ? " · " + o.player_id : ""}</span>
        </div>
        <div class="service-actions">${statusBadge}</div>
      `;
      list.appendChild(row);
    });
  } catch (err) {
    list.innerHTML = '<p class="placeholder">حدث خطأ أثناء التحميل.</p>';
  }
}

function loadReferralInfo() {
  if (currentUser) {
    const linkInput = document.getElementById("referral-link");
    const botName = window.Telegram?.WebApp?.initDataUnsafe?.bot_username || "ZapchargeBot";
    linkInput.value = `https://t.me/${botName}?start=${currentUser.telegram_id}`;
  }
}

function copyReferralLink() {
  const linkInput = document.getElementById("referral-link");
  linkInput.select();
  navigator.clipboard.writeText(linkInput.value);
  alert("📋 تم نسخ رابط الإحالة الخاص بك بنجاح!");
}

// ==================== ADMIN LOGIC ====================

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
  document.getElementById("cancel-service-modal").addEventListener("click", closeServiceModal);
  document.getElementById("save-service").addEventListener("click", saveService);

  document.getElementById("open-add-admin").addEventListener("click", () => openAdminModal());
  document.getElementById("cancel-admin-modal").addEventListener("click", closeAdminModal);
  document.getElementById("save-admin").addEventListener("click", saveAdmin);

  document.getElementById("send-broadcast").addEventListener("click", sendBroadcast);
}

function showAdminSection(id) {
  document.querySelectorAll(".admin-section").forEach((el) => el.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.adminSection === id);
  });

  if (id === "admin-services-section") loadServices();
  if (id === "admin-deposits-section") loadDeposits();
  if (id === "admin-orders-section") loadOrders();
  if (id === "admin-admins-section") loadAdmins();
  if (id === "admin-stats-section") loadStats();
  if (id === "admin-logs-section") loadLogs();
}

function adminHeaders(extra = {}) {
  return { "X-Telegram-Init-Data": tg.initData, ...extra };
}

async function loadAdminSummary() {
  try {
    const res = await fetch("/api/admin/summary", { headers: adminHeaders() });
    const data = await res.json();
    document.getElementById("stat-orders").textContent = data.pending_orders;
    document.getElementById("stat-deposits").textContent = data.pending_deposits;
  } catch (err) {}
}

const categoryLabels = {
  games: "ألعاب", subscriptions: "اشتراكات", apps: "تطبيقات",
  cards: "بطاقات", recharge: "تعبئة رصيد", bills: "فواتير",
};

let editingServiceId = null;

async function loadServices() {
  const list = document.getElementById("services-list");
  list.innerHTML = '<p class="placeholder">جاري التحميل...</p>';

  try {
    const res = await fetch("/api/admin/services", { headers: adminHeaders() });
    const services = await res.json();

    if (!Array.isArray(services) || services.length === 0) {
      list.innerHTML = '<p class="placeholder">لا يوجد خدمات مضافة بعد.</p>';
      return;
    }

    list.innerHTML = "";
    services.forEach((s) => {
      const row = document.createElement("div");
      row.className = "service-row";
      row.innerHTML = `
        <div class="service-info">
          <span class="service-name">${s.name}${s.package_name ? " — " + s.package_name : ""}</span>
          <span class="service-meta">${categoryLabels[s.category] || s.category} · ${s.price.toFixed(2)}$${s.active ? "" : " · موقوفة"}</span>
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
  } catch (err) {
    list.innerHTML = '<p class="placeholder">حدث خطأ أثناء التحميل.</p>';
  }
}

function openServiceModal(service = null) {
  editingServiceId = service ? service.id : null;
  document.getElementById("service-modal-title").textContent = service ? "تعديل خدمة" : "إضافة خدمة";
  document.getElementById("service-category").value = service ? service.category : "games";
  document.getElementById("service-name").value = service ? service.name : "";
  document.getElementById("service-package").value = service ? (service.package_name || "") : "";
  document.getElementById("service-price").value = service ? service.price : "";
  document.getElementById("service-image").value = service ? (service.image_url || "") : "";
  document.getElementById("service-active").checked = service ? service.active : true;
  document.getElementById("service-modal").classList.remove("hidden");
}

function closeServiceModal() {
  document.getElementById("service-modal").classList.add("hidden");
}

async function saveService() {
  const body = {
    category: document.getElementById("service-category").value,
    name: document.getElementById("service-name").value.trim(),
    package_name: document.getElementById("service-package").value.trim() || null,
    price: parseFloat(document.getElementById("service-price").value) || 0,
    image_url: document.getElementById("service-image").value.trim() || null,
    active: document.getElementById("service-active").checked,
  };

  if (!body.name) {
    alert("لازم تكتب اسم الخدمة");
    return;
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

const methodLabels = {
  sham_cash: "شام كاش",
  syriatel_cash: "سيرياتيل كاش",
  c_wallet: "سي والت",
};

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

async function approveDeposit(id) {
  if (!confirm("متأكد إنك بدك تقبل هاي الإيداع؟ رح تضاف القيمة لرصيد المستخدم.")) return;

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
      const row = document.createE
