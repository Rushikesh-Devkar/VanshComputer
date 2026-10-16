// Apna WhatsApp number 91 ke saath, bina + ya space (jaise 919876543210). Jab tak X hain, button nahi dikhega.
const STORE = { whatsapp: '91XXXXXXXXXX' };

const rupee = (n) => '₹ ' + Number(n).toLocaleString('en-IN');
const img = (url, w) => url.replace('/upload/', '/upload/f_auto,q_auto,w_' + w + '/');

// Safe element builder: API ka data hamesha text banke jata hai, HTML nahi
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
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

function renderChrome() {
  document.getElementById('hdr').innerHTML =
    '<div class="top">6 Months Warranty on every laptop · Online payment secured by Razorpay</div>' +
    '<header class="site"><div class="wrap"><a class="brand" href="/"><img src="img/logo.png" alt="" onerror="this.remove()">VANSH COMPUTER</a>' +
    '<nav class="main"><a href="shop.html?type=refurbished">Refurbished</a><a href="shop.html?type=new">New Laptops</a></nav></div></header>';
  document.getElementById('ftr').innerHTML =
    '<footer class="site"><div class="wrap">© 2026 Vansh Computer. All rights reserved.</div></footer>';
}
