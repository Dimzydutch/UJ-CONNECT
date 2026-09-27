/* ============================
   UJ CONNECT — SHARED APP LOGIC
   ============================ */

const API_BASE = '/api';

// ---------- Theme (light/dark) ----------
function initTheme() {
  const saved = localStorage.getItem('uj_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcon(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('uj_theme', next);
  updateThemeIcon(next);
}

function updateThemeIcon(theme) {
  const icon = document.getElementById('theme-toggle-icon');
  if (!icon) return;
  icon.innerHTML = theme === 'light'
    ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
    : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
}

// ---------- Toasts ----------
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3800);
}

// ---------- Auth state helpers ----------
function getToken() { return localStorage.getItem('uj_token'); }
function getUser() {
  const raw = localStorage.getItem('uj_user');
  return raw ? JSON.parse(raw) : null;
}
function setSession(token, user) {
  localStorage.setItem('uj_token', token);
  localStorage.setItem('uj_user', JSON.stringify(user));
}
function clearSession() {
  localStorage.removeItem('uj_token');
  localStorage.removeItem('uj_user');
}
function isLoggedIn() { return !!getToken(); }
function isAdmin() {
  const u = getUser();
  return u && u.role === 'admin';
}

function requireAuth() {
  if (!isLoggedIn()) {
    window.location.href = 'login.html';
  }
}

function requireAdmin() {
  if (!isLoggedIn() || !isAdmin()) {
    window.location.href = 'index.html';
  }
}

function logout() {
  clearSession();
  window.location.href = 'index.html';
}

// ---------- API wrapper ----------
async function apiRequest(endpoint, { method = 'GET', body = null, isForm = false } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!isForm && body) headers['Content-Type'] = 'application/json';

  const options = { method, headers };
  if (body) options.body = isForm ? body : JSON.stringify(body);

  const res = await fetch(`${API_BASE}${endpoint}`, options);
  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = { success: false, message: 'Unexpected server response.' };
  }
  if (!res.ok) {
    throw new Error(data.message || 'Something went wrong.');
  }
  return data;
}

// ---------- Money formatting ----------
function formatPrice(price) {
  const num = parseFloat(price);
  return '₦' + num.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function timeAgo(dateStr) {
  const date = new Date(dateStr);
  const seconds = Math.floor((new Date() - date) / 1000);
  const intervals = [
    { label: 'y', secs: 31536000 },
    { label: 'mo', secs: 2592000 },
    { label: 'd', secs: 86400 },
    { label: 'h', secs: 3600 },
    { label: 'm', secs: 60 }
  ];
  for (const i of intervals) {
    const count = Math.floor(seconds / i.secs);
    if (count >= 1) return `${count}${i.label} ago`;
  }
  return 'just now';
}

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
}

// ---------- Sidebar / hamburger (vertical nav) ----------
function initSidebar() {
  const hamburger = document.getElementById('hamburger-btn');
  const sidebar = document.getElementById('sidebar');
  if (!hamburger || !sidebar) return;

  let backdrop = null;

  function isMobile() { return window.innerWidth <= 900; }

  hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('active');
    if (isMobile()) {
      sidebar.classList.toggle('mobile-open');
      if (sidebar.classList.contains('mobile-open')) {
        backdrop = document.createElement('div');
        backdrop.className = 'sidebar-backdrop';
        backdrop.addEventListener('click', () => {
          sidebar.classList.remove('mobile-open');
          hamburger.classList.remove('active');
          backdrop.remove();
        });
        document.body.appendChild(backdrop);
      } else if (backdrop) {
        backdrop.remove();
      }
    } else {
      sidebar.classList.toggle('collapsed');
    }
  });
}

// ---------- Navbar auth-aware rendering ----------
function renderTopbarAuth() {
  const slot = document.getElementById('topbar-auth-slot');
  if (!slot) return;
  const user = getUser();

  slot.innerHTML = `
    <div class="account-menu">
      <button id="account-menu-trigger" class="account-menu-trigger" type="button" aria-label="Open account menu" aria-controls="account-menu-panel" aria-expanded="false">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg>
      </button>
      <nav id="account-menu-panel" class="account-menu-panel hidden" aria-label="Account">
        ${user
           ? `<a class="account-menu-item" href="dashboard.html">My Profile</a>
             <button id="account-logout-btn" class="account-menu-item" type="button">Log Out</button>`
          : `<a class="account-menu-item" href="login.html">Log In</a>
             <a class="account-menu-item" href="signup.html">Sign Up</a>`}
        <a class="account-menu-item" href="index.html">Main Menu</a>
      </nav>
    </div>
  `;

  const trigger = document.getElementById('account-menu-trigger');
  const panel = document.getElementById('account-menu-panel');
  const themeBtn = document.getElementById('theme-toggle-btn');
  if (user) {
    trigger.textContent = initials(user.fullName);
    trigger.title = user.fullName;
  }
  trigger.addEventListener('click', () => {
    const isOpen = trigger.getAttribute('aria-expanded') === 'true';
    trigger.setAttribute('aria-expanded', String(!isOpen));
    panel.classList.toggle('hidden', isOpen);
  });
  document.addEventListener('click', (event) => {
    if (!slot.contains(event.target)) {
      panel.classList.add('hidden');
      trigger.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && trigger.getAttribute('aria-expanded') === 'true') {
      panel.classList.add('hidden');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.focus();
    }
  });

  themeBtn.addEventListener('click', toggleTheme);
  updateThemeIcon(document.documentElement.getAttribute('data-theme') || 'light');

  const logoutBtn = document.getElementById('account-logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);
}

function highlightActiveSidebarLink() {
  const path = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.sidebar-link').forEach(link => {
    const href = link.getAttribute('href');
    if (href === path) link.classList.add('active');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  renderTopbarAuth();
  highlightActiveSidebarLink();
});
