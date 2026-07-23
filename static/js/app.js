const tg = window.Telegram?.WebApp;

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
  if (id === "admin-orders-section") loadOrders();
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
      setupAdminNav();
      loadAdminSummary();
    } else {
      document.getElementById("store-balance").textContent = data.user.balance.toFixed(2) + "$";
      show("store-view");
    }
  } catch (err) {
    show("error-view");
  }
}

async function loadAdminSummary() {
  try {
    const res = await fetch("/api/admin/summary", { headers: adminHeaders() });
    const data = await res.json();
    document.getElementById("stat-orders").textContent = data.pending_orders;
    document.getElementById("stat-deposits").textContent = data.pending_deposits;
  } catch (err) {}
}

function setupAdminNav() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => showAdminSection(btn.dataset.adminSection));
  });

  document.getElementById("open-add-service").addEventListener("click", () => openServiceModal());
  document.getElementById("cancel-service-modal").addEventListener("click", closeServiceModal);
  document.getElementById("save-service").addEventListener("click", saveService);
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
      const row = document.createElement("div");
      row.className = "service-row";
      row.innerHTML = `
        <div class="service-info">
          <span class="service-name">${o.service_name}${o.package_name ? " — " + o.package_name : ""}</span>
          <span class="service-meta">مستخدم: ${o.user_telegram_id}${o.player_id ? " · معرّف اللاعب: " + o.player_id : ""} · ${o.price.toFixed(2)}$</span>
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

init();
