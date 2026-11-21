const mailer = require('./mailer');
const { escapeHtml } = require('./ownerAlerts');
function appUrl(path) {
  return `${String(process.env.APP_BASE_URL || 'http://localhost:4000').replace(/\/+$/, '')}${path}`;
}

function sendCustomerMail(order, { subject, text, html }) {
  const email = String(order?.customer?.email || '').trim();
  if (!email) return;
  setImmediate(() => {
    Promise.resolve(mailer.sendMail({ to: email, subject, text, html }))
      .catch((error) => console.warn(`Customer order email failed: ${error.message || 'unknown error'}`));
  });
}

function orderDetailLink(order) {
  return appUrl(`/order-detail.html?order=${encodeURIComponent(order.orderNumber || '')}`);
}

function sendOrderConfirmed(order) {
  const items = (order.items || []).map((item) =>
    `${item.name || 'Item'} × ${Number(item.quantity || 0)}`
  );
  const address = order.address || {};
  const fullAddress = [address.line1, address.line2, address.city, address.district, address.state, address.pinCode].filter(Boolean).join(', ');
  const link = orderDetailLink(order);
  sendCustomerMail(order, {
    subject: `Order confirmed: ${order.orderNumber || ''}`,
    text: `Thank you for your order.\n\nOrder: ${order.orderNumber || ''}\nItems:\n${items.join('\n') || 'None'}\n\nSubtotal: ₹${Number(order.subtotal || 0).toLocaleString('en-IN')}\nDiscount: ₹${Number(order.discount || 0).toLocaleString('en-IN')}\nDelivery: ₹${Number(order.shippingCharge || 0).toLocaleString('en-IN')}\nTotal: ₹${Number(order.total || 0).toLocaleString('en-IN')}\n\nDelivery address:\n${fullAddress}\n\nTrack: ${link}`,
    html: `<p>Thank you for your order.</p><p><strong>Order:</strong> ${escapeHtml(order.orderNumber || '')}</p><p><strong>Items:</strong><br>${items.map((item) => escapeHtml(item)).join('<br>') || 'None'}</p><p><strong>Subtotal:</strong> ${escapeHtml(`₹${Number(order.subtotal || 0).toLocaleString('en-IN')}`)}<br><strong>Discount:</strong> ${escapeHtml(`₹${Number(order.discount || 0).toLocaleString('en-IN')}`)}<br><strong>Delivery:</strong> ${escapeHtml(`₹${Number(order.shippingCharge || 0).toLocaleString('en-IN')}`)}<br><strong>Total:</strong> ${escapeHtml(`₹${Number(order.total || 0).toLocaleString('en-IN')}`)}</p><p><strong>Delivery address:</strong><br>${escapeHtml(fullAddress)}</p><p><a href="${escapeHtml(link)}">View order and track it</a></p>`,
  });
}

function sendShipped(order) {
  const link = orderDetailLink(order);
  sendCustomerMail(order, {
    subject: `Order shipped: ${order.orderNumber || ''}`,
    text: `Your order ${order.orderNumber || ''} has been shipped.\nCourier: ${order.courierName || ''}\nTracking number: ${order.trackingNumber || ''}\nTrack: ${link}`,
    html: `<p>Your order <strong>${escapeHtml(order.orderNumber || '')}</strong> has been shipped.</p><p>Courier: ${escapeHtml(order.courierName || '')}<br>Tracking number: ${escapeHtml(order.trackingNumber || '')}</p><p><a href="${escapeHtml(link)}">Track your order</a></p>`,
  });
}

function sendDelivered(order, settings = {}) {
  const link = orderDetailLink(order);
  const returnInfo = settings.returnsEnabled
    ? `Returns are enabled${settings.returnWindowDays != null ? ` for ${settings.returnWindowDays} days after delivery` : ''}.`
    : 'Returns are not currently enabled.';
  sendCustomerMail(order, {
    subject: `Order delivered: ${order.orderNumber || ''}`,
    text: `Thank you. Your order ${order.orderNumber || ''} has been delivered.\n${returnInfo}\nView order: ${link}`,
    html: `<p>Thank you. Your order <strong>${escapeHtml(order.orderNumber || '')}</strong> has been delivered.</p><p>${escapeHtml(returnInfo)}</p><p><a href="${escapeHtml(link)}">View order</a></p>`,
  });
}

function sendRefundProcessed(order, amount) {
  const link = orderDetailLink(order);
  sendCustomerMail(order, {
    subject: `Refund processed: ${order.orderNumber || ''}`,
    text: `A refund of ₹${Number(amount || 0).toLocaleString('en-IN')} was processed for order ${order.orderNumber || ''}.\nView order: ${link}`,
    html: `<p>A refund of <strong>${escapeHtml(`₹${Number(amount || 0).toLocaleString('en-IN')}`)}</strong> was processed for order <strong>${escapeHtml(order.orderNumber || '')}</strong>.</p><p><a href="${escapeHtml(link)}">View order</a></p>`,
  });
}

function sendReturnStatus(returnRequest, order, status, reason = '') {
  const email = String(order?.customer?.email || '').trim();
  if (!email) return;
  const link = appUrl('/account.html');
  if (status === 'approved') {
    sendCustomerMail({ customer: { email } }, {
      subject: `Return approved: ${returnRequest.requestNumber}`,
      text: `Your return request ${returnRequest.requestNumber} was approved. Please ship the product and submit courier/tracking details.\nManage return: ${link}`,
      html: `<p>Your return request <strong>${escapeHtml(returnRequest.requestNumber)}</strong> was approved.</p><p>Please ship the product and submit courier/tracking details.</p><p><a href="${escapeHtml(link)}">Manage return</a></p>`,
    });
  } else if (status === 'rejected') {
    sendCustomerMail({ customer: { email } }, {
      subject: `Return rejected: ${returnRequest.requestNumber}`,
      text: `Your return request ${returnRequest.requestNumber} was rejected.${reason ? ` Reason: ${reason}` : ''}\nManage return: ${link}`,
      html: `<p>Your return request <strong>${escapeHtml(returnRequest.requestNumber)}</strong> was rejected.</p>${reason ? `<p>Reason: ${escapeHtml(reason)}</p>` : ''}<p><a href="${escapeHtml(link)}">View return</a></p>`,
    });
  } else if (status === 'refund_pending') {
    sendCustomerMail({ customer: { email } }, {
      subject: `Return refund issued: ${returnRequest.requestNumber}`,
      text: `Refund issued for return request ${returnRequest.requestNumber}. The final refund status follows the payment provider.\nManage return: ${link}`,
      html: `<p>Refund issued for return request <strong>${escapeHtml(returnRequest.requestNumber)}</strong>.</p><p>The final refund status follows the payment provider.</p><p><a href="${escapeHtml(link)}">View return</a></p>`,
    });
  }
}

module.exports = {
  sendOrderConfirmed,
  sendShipped,
  sendDelivered,
  sendRefundProcessed,
  sendReturnStatus,
  sendCustomerMail,
};
