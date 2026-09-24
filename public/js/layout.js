/* ============================
   LAYOUT INJECTOR — topbar + sidebar
   Include this before app.js on every page,
   with a <div id="layout-root"></div> placeholder,
   and a <main id="page-content"></main> for page-specific content.
   ============================ */

function renderLayout(activePage) {
  const root = document.getElementById('layout-root');
  if (!root) return;

  root.innerHTML = `
    <header class="topbar">
      <div class="topbar-left">
        <button id="hamburger-btn" class="hamburger-btn" aria-label="Toggle menu">
          <span></span><span></span><span></span>
        </button>
        <a href="index.html" class="brand">
          <span class="logo-badge">UJ</span>
          <span>UJ Connect</span>
        </a>
      </div>
      <div class="search-box">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input id="global-search" type="text" placeholder="Search goods & services..." />
      </div>
      <div class="topbar-right">
        <button id="mobile-search-btn" class="theme-toggle mobile-search-btn" aria-label="Search">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        </button>
        <button id="theme-toggle-btn" class="theme-toggle" aria-label="Toggle theme"></button>
        <div id="topbar-auth-slot" class="flex gap-8"></div>
      </div>
    </header>
    <div id="mobile-search-bar" class="mobile-search-bar">
      <div class="search-box">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input id="mobile-search-input" type="text" placeholder="Search goods & services..." />
      </div>
    </div>
    <div class="app-shell">
      <aside id="sidebar" class="sidebar">
        <div class="sidebar-section-label">Browse</div>
        <a href="marketplace.html" class="sidebar-link" data-page="marketplace">
          ${icon('grid')} Marketplace
        </a>
        <a href="marketplace.html?type=good" class="sidebar-link" data-page="goods">
          ${icon('box')} Goods
        </a>
        <a href="marketplace.html?type=service" class="sidebar-link" data-page="services">
          ${icon('tool')} Services
        </a>

        <div class="sidebar-section-label">My Account</div>
        <a href="dashboard.html" class="sidebar-link" data-page="dashboard">
          ${icon('layout')} My Dashboard
        </a>
        <a href="dashboard.html#upload" class="sidebar-link" data-page="upload">
          ${icon('upload')} Upload Listing
        </a>
        <a href="dashboard.html#inbox" class="sidebar-link" data-page="inbox">
          ${icon('mail')} Messages
        </a>

        <div id="admin-sidebar-section" class="hidden">
          <div class="sidebar-divider"></div>
          <div class="sidebar-section-label">Admin</div>
          <a href="admin.html" class="sidebar-link" data-page="admin">
            ${icon('shield')} Admin Dashboard
          </a>
        </div>

        <div class="sidebar-divider"></div>
        <div class="sidebar-section-label">Info</div>
        <a href="index.html#about" class="sidebar-link" data-page="about">
          ${icon('info')} About UJ Connect
        </a>
      </aside>
      <main class="main-content" id="page-content"></main>
    </div>
    <nav class="mobile-bottom-nav">
      <div class="mobile-bottom-nav-inner">
        <a href="index.html" class="mobile-nav-item" data-mnav="home">
          ${icon('home')}
          <span>Home</span>
        </a>
        <a href="marketplace.html?type=good" class="mobile-nav-item" data-mnav="products">
          ${icon('box')}
          <span>Products</span>
        </a>
        <a href="marketplace.html?type=service" class="mobile-nav-item" data-mnav="services">
          ${icon('tool')}
          <span>Services</span>
        </a>
        <a href="dashboard.html" class="mobile-nav-item" data-mnav="profile">
          ${icon('user')}
          <span>Profile</span>
        </a>
      </div>
    </nav>
  `;

  // Mark active link
  document.querySelectorAll(`.sidebar-link[data-page="${activePage}"]`).forEach(l => l.classList.add('active'));
  highlightMobileNav(activePage);

  // Show admin link if admin
  const user = getUser();
  if (user && user.role === 'admin') {
    document.getElementById('admin-sidebar-section').classList.remove('hidden');
  }

  // Global search -> go to marketplace with query
  const searchInput = document.getElementById('global-search');
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && searchInput.value.trim()) {
        window.location.href = `marketplace.html?search=${encodeURIComponent(searchInput.value.trim())}`;
      }
    });
  }

  // Mobile search toggle: shows a full-width search bar below the topbar
  const mobileSearchBtn = document.getElementById('mobile-search-btn');
  const mobileSearchBar = document.getElementById('mobile-search-bar');
  const mobileSearchInput = document.getElementById('mobile-search-input');
  if (mobileSearchBtn && mobileSearchBar) {
    mobileSearchBtn.addEventListener('click', () => {
      mobileSearchBar.classList.toggle('open');
      if (mobileSearchBar.classList.contains('open')) mobileSearchInput.focus();
    });
  }
  if (mobileSearchInput) {
    mobileSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && mobileSearchInput.value.trim()) {
        window.location.href = `marketplace.html?search=${encodeURIComponent(mobileSearchInput.value.trim())}`;
      }
    });
  }
}

function icon(name) {
  const icons = {
    grid: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
    box: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8V21H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>',
    tool: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
    layout: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>',
    upload: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
    mail: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="m22 6-10 7L2 6"/></svg>',
    shield: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    home: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>',
    user: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
  };
  return icons[name] || '';
}

function highlightMobileNav(activePage) {
  const map = { home: 'home', marketplace: 'products', goods: 'products', services: 'services', dashboard: 'profile', upload: 'profile', inbox: 'profile', admin: 'profile' };
  const key = map[activePage];
  if (!key) return;
  document.querySelectorAll('.mobile-nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.mnav === key);
  });
}
