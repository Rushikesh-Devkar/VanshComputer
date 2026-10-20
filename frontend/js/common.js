const STORE = {
  whatsapp: '919356114946',
  phone: '+919356114946',
  phoneLabel: '+91 93561 14946',
  hours: 'Open daily · 10:00 AM–10:00 PM',
  areaShort: 'Sant Tukaram Nagar, Pimpri-Chinchwad',
  addressFull: 'JRC9+J45, Yashwantrao Chavan Rd, Komal Gruh Rachana Society, Sant Tukaram Nagar, Pimpri Colony, Pimpri-Chinchwad, Maharashtra 411018',
  mapsUrl: 'https://maps.app.goo.gl/LvvZbApBRxbzKYFV8?g_st=ic',
};
const rupee = (n) => '₹ ' + Number(n).toLocaleString('en-IN');
const img = (url, w) => url.replace('/upload/', '/upload/f_auto,q_auto,w_' + w + '/');

// Safe element builder: API ka data hamesha text banke jata hai, HTML nahi
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (typeof v === 'boolean' && k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    const err = new Error((data && data.message) || 'Kuch galat hua, dobara try karo');
    err.data = data;
    throw err;
  }
  return data;
}

// API kabhi array deta hai, kabhi { items: [...] } - dono chalenge
const listOf = (d) => Array.isArray(d) ? d : ((d && d.items) || []);

function productCard(p) {
  const cover = p.images && p.images[0];
  const sold = p.status === 'sold' || p.stock < 1;
  const r = p.refurbished;
  return h('a', { class: 'card', href: 'product.html?slug=' + encodeURIComponent(p.slug) },
    h('div', { class: 'ph' }, cover ? h('img', { src: img(cover.url, 600), alt: cover.alt || p.name, loading: 'lazy' }) : 'Photo jald aayegi'),
    h('div', { class: 'bd' },
      h('div', {}, p.type === 'refurbished'
        ? [r && r.grade ? h('span', { class: 'badge' }, 'Grade ' + r.grade) : h('span', { class: 'badge' }, 'Refurbished'), r && r.batteryHealth != null ? h('span', { class: 'badge soft' }, 'Battery ' + r.batteryHealth + '%') : null]
        : h('span', { class: 'badge' }, 'New')),
      p.section === 'accessories' && p.subcategory ? h('span', { class: 'muted' }, p.subcategory) : null,
      h('b', {}, p.name),
      h('span', { class: 'muted' }, [p.specs && p.specs.cpu, p.specs && p.specs.ram, p.specs && p.specs.storage].filter(Boolean).join(' · ') || p.subcategory || p.category || p.brand),
      h('span', { class: 'price' }, sold ? 'Sold' : rupee(p.price))));
}

const ICON = {
  pin: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  phone: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A15 15 0 013 6a2 2 0 012-2z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  help: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1-1.5 2M12 17h.01"/></svg>',
  menu: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  chev: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
};

// Ek hi navbar, har page pe. Yahan badlo = sab pages pe badal jayega.
function renderChrome() {
  const S = STORE;
  const wa = /^\d{12}$/.test(S.whatsapp) ? 'https://wa.me/' + S.whatsapp + '?text=' + encodeURIComponent('Hi, mujhe help chahiye') : 'contact.html';
  document.getElementById('hdr').innerHTML =
    '<div class="top"><div class="wrap topin">' +
      '<div class="tl">' +
        '<a href="' + S.mapsUrl + '" target="_blank" rel="noopener">' + ICON.pin + '<span>' + S.areaShort + '</span></a>' +
        '<a href="tel:' + S.phone + '">' + ICON.phone + '<span>' + S.phoneLabel + '</span></a>' +
        '<span class="hrs">' + ICON.clock + '<span>' + S.hours + '</span></span>' +
      '</div>' +
      '<div class="tr">' +
        '<a href="track-order.html">Track Order</a>' +
        '<a href="' + S.mapsUrl + '" target="_blank" rel="noopener">Store Location</a>' +
        '<a href="' + wa + '" target="_blank" rel="noopener" class="helpl">' + ICON.help + '<span>Help</span></a>' +
      '</div>' +
    '</div></div>' +
    '<header class="site"><div class="wrap hd">' +
      '<button class="burger" id="burger" aria-label="Menu" aria-expanded="false">' + ICON.menu + '</button>' +
      '<a class="brand" href="/"><img src="img/logo.jpg" alt="Vansh Computer logo" onerror="this.remove()"><span>VANSH COMPUTER</span></a>' +
      '<form class="hsearch" id="hsearch" role="search"><input type="search" id="hq" placeholder="Search brand, model, e.g. Dell Latitude" aria-label="Search laptops"><button type="submit" aria-label="Search">' + ICON.search + '</button></form>' +
      '<nav class="main" id="mainnav" aria-label="Main">' +
        '<a href="/">Home</a>' +
        '<a href="shop.html">Shop</a>' +
        '<a href="shop.html?section=accessories">Accessories</a>' +
        '<div class="dd"><button type="button" class="ddb">Laptops ' + ICON.chev + '</button><div class="ddm">' +
          '<a href="shop.html?type=refurbished">Refurbished Laptops</a><a href="shop.html?type=new">New Laptops</a>' +
          '<a href="shop.html?type=refurbished&maxPrice=20000">Under ₹20,000</a><a href="shop.html?type=refurbished&maxPrice=30000">Under ₹30,000</a></div></div>' +
        '<div class="dd"><button type="button" class="ddb">Services ' + ICON.chev + '</button><div class="ddm">' +
          '<a href="services.html#laptop">Laptop Repair</a><a href="services.html#computer">Computer Repair</a><a href="services.html#macbook">MacBook Repair</a></div></div>' +
        '<a href="cart.html" id="cartNav" class="cart-link"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/></svg><span class="cart-count">Cart (0)</span></a>' +
      '</nav>' +
    '</div></header>';

  const nav = document.getElementById('mainnav'), bg = document.getElementById('burger');
  updateCartCount();
  window.addEventListener('storage', updateCartCount);
  bg.addEventListener('click', () => { const o = nav.classList.toggle('open'); bg.setAttribute('aria-expanded', o); });
  document.querySelectorAll('.ddb').forEach((b) => b.addEventListener('click', () => b.parentElement.classList.toggle('open')));
  document.getElementById('hsearch').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = document.getElementById('hq').value.trim();
    location.href = 'shop.html' + (v ? '?q=' + encodeURIComponent(v) : '');
  });

  document.getElementById('ftr').innerHTML =
    '<footer class="site"><div class="wrap fgrid">' +
      '<div class="footer-watermark" aria-hidden="true"><svg viewBox="0 0 240 150" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="48" y="18" width="144" height="96" rx="9" stroke="currentColor" stroke-width="7"/><path d="M27 127h186l-12 12H40l-13-12Z" stroke="currentColor" stroke-width="7" stroke-linejoin="round"/><path d="M103 127h34" stroke="currentColor" stroke-width="6" stroke-linecap="round"/></svg></div>' +
      '<div><div class="footer-brand-header"><img src="img/logo.jpg" alt=""><b class="fb">VANSH COMPUTER</b></div><p>Certified refurbished and new laptops, with direct help from our team.</p><a class="footer-contact" href="tel:' + S.phone + '">' + ICON.phone + '<span>' + S.phoneLabel + '</span></a></div>' +
      '<div><b>Shop by need</b><a href="shop.html?type=refurbished">Refurbished Laptops</a><a href="shop.html?type=new">New Laptops</a><a href="shop.html?q=gaming">Gaming laptops</a><a href="shop.html?q=business">Business laptops</a><a href="shop.html?section=accessories">Accessories</a></div>' +
      '<div><b>Repair &amp; support</b><a href="/#repair-support">Repair services</a><a class="footer-contact" href="https://wa.me/' + S.whatsapp + '?text=' + encodeURIComponent('Hi, mujhe repair ya support chahiye') + '" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.5-4.1A8 8 0 1 1 20 11.5Z"/><path d="M9 9c.6 2 2 3.4 4 4l1-1 2 1c-.2 1.4-1.2 2-2.4 1.8-3.3-.6-5.8-3.2-6.2-6.2C7.2 7.4 8 6.5 9.4 6.5L10.5 8 9 9Z"/></svg><span>WhatsApp support</span></a><a class="footer-contact" href="tel:' + S.phone + '">Call our team</a></div>' +
      '<div><b>Visit our store</b><p>' + S.addressFull + '</p><p>' + S.hours + '</p><a href="' + S.mapsUrl + '" target="_blank" rel="noopener">Get directions ↗</a></div>' +
    '</div><div class="wrap fcopy">© 2026 Vansh Computer. All rights reserved.</div></footer>';
}

function getCart() {
  try {
    const items = JSON.parse(localStorage.getItem('vanshCart') || '[]');
    return Array.isArray(items) ? items.filter((item) => item && item.slug && Number.isFinite(Number(item.price)) && Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0) : [];
  } catch (_) { return []; }
}
function updateCartCount() {
  const link = document.getElementById('cartNav');
  const count = link && link.querySelector('.cart-count');
  if (count) count.textContent = 'Cart (' + getCart().reduce((sum, item) => sum + Number(item.quantity), 0) + ')';
}
