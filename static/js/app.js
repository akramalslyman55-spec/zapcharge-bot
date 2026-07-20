const tg = window.Telegram?.WebApp;

function show(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
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
      loadAdminSummary();
    } else {
      document.getElementById("store-balance").textContent =
        data.user.balance.toFixed(2) + "$";
      show("store-view");
    }
  } catch (err) {
    show("error-view");
  }
}

async function loadAdminSummary() {
  try {
    const res = await fetch("/api/admin/summary");
    const data = await res.json();
    document.getElementById("stat-orders").textContent = data.pending_orders;
    document.getElementById("stat-deposits").textContent = data.pending_deposits;
  } catch (err) {
    // silent
  }
}

init();
