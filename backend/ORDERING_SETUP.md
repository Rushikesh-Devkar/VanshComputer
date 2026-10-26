# Ordering and payment setup

## Requirements

- Node.js 20.19 or newer (required by the installed Mongoose major version).
- MongoDB configured as a replica set. Checkout uses MongoDB transactions so the order and stock reservation commit together. MongoDB Atlas is already replica-set based; local MongoDB must start with `mongod --replSet rs0 --dbpath <data-directory>` and be initiated once with `mongosh --eval "rs.initiate()"`.
- Razorpay API key ID, API key secret, and webhook secret for the selected mode. The key prefix must match `PAYMENT_MODE`.

## Configure and start

1. From `backend`, copy `.env.example` to `.env` and set `MONGO_URI`, `JWT_SECRET`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`. Configure email with `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` (`true` or `false`), `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, and `APP_BASE_URL`. `APP_BASE_URL` must be the public site origin in production and is never taken from the incoming request. Optional owner alerts use `OWNER_ALERT_EMAIL`. Keep `.env` local and restart the backend after changing it.
2. Set `PAYMENT_MODE=test` for testing or `PAYMENT_MODE=live` for production. `PAYMENT_RESERVATION_MINUTES` is optional and defaults to 15 (allowed range: 5–60).
3. Install dependencies and run checks: `npm install`, then `npm test`.
4. Start the app with `npm run dev`.
5. Sign into `admin.html` with an owner or manager account. If no owner exists, create one from `backend` with `node scripts/createOwner.js owner@example.com "a-password-at-least-10-chars" "Owner"`. In Shipping Settings, configure the Maharashtra courier charge whenever free delivery has a minimum/end date or is turned off. Free delivery starts enabled with no minimum and no end date.
6. In the selected Razorpay mode, configure the webhook URL as `https://<your-host>/api/orders/webhook` and subscribe to payment captured/failed, order paid, and refund processed/failed events. Keep the webhook secret in the server environment only.

The cart quote and final order both use current MongoDB prices and server-side shipping settings. The final order reserves stock inside a transaction. A background worker and payment endpoints release unpaid reservations after the configured period. Customer tracking and return requests require the signed-in customer account that owns the order. Admin order and shipping writes require owner/manager authentication.

## Customer accounts, tracking, and returns

- Staff sessions use the `token` HTTP-only cookie; customer sessions use `ctoken`. Both cookies are independent. Customer routes verify the customer role on the backend.
- Sign in at `/api/customer/login` (or register at `/api/customer/register`). `GET /api/orders/mine` lists the customer's orders; `GET /api/orders/mine/:orderNumber` returns one owned order's details; `POST /api/orders/track` accepts only `{ "orderNumber": "VC..." }` and uses the customer session.
- Create a return with `POST /api/orders/:orderNumber/returns` as multipart form data (`reason`, `details`, 2–6 `proof` images, optional `video`). Check requests with `GET /api/orders/returns/mine` or `POST /api/orders/returns/:requestNumber/status`. Both are scoped to the signed-in account.
- Password reset uses `POST /api/customer/forgot-password` with email and `POST /api/customer/reset-password` with token and a 10+ character password. Links expire after 30 minutes, the raw token is never stored, and each successful reset invalidates earlier customer sessions. Reset and password-change confirmation emails use the configured SMTP sender. The forgot-password response stays generic for unknown accounts and requests are rate limited by IP and email. If SMTP is not configured, development logs a reset link for local testing only; production never logs reset links and prints a generic configuration warning.

### Password reset email setup

- For local development, leave SMTP unconfigured and copy the development-only reset link from the backend console. To exercise actual delivery, use a test SMTP account such as Mailtrap and set all SMTP and sender variables above. If SMTP is configured but delivery fails, the backend logs the SMTP error code/response while the browser still receives the generic response.
- Before production, verify the sending domain's SPF and DKIM DNS records, use a dedicated sender address, set `APP_BASE_URL` to the HTTPS site origin, and test delivery to a real mailbox. Check spam folders during testing.
- Keep SMTP credentials out of source control and logs. Rotate the SMTP password immediately if it is ever exposed.
- `POST /api/customer/logout` clears the customer cookie; `/api/auth/logout` clears the staff cookie.

## Payment and tax behavior

The API creates Razorpay orders server-side in paise. Browser callbacks are signature-checked but do not mark an order paid; verified webhooks make that transition. If credentials are absent, incomplete, or mismatched with `PAYMENT_MODE`, checkout returns a setup message and creates no order or reservation.

Seller GSTIN, optional buyer GSTIN, product HSN codes, and a configured rate are stored as invoice setup fields only. Tax is not calculated, and the customer confirmation page is an order receipt, not a GST tax invoice. Configure and verify the business GSTIN, product HSN classifications, applicable tax rates, and place-of-supply treatment before enabling invoice calculations. Return policy text is configurable in Shipping Settings and starts blank.

## Verification checklist

Automated tests cover server pricing vs. submitted prices, duplicate line items, Maharashtra-only state validation, free delivery on/off, missing courier charge, stock conflicts, refurbished quantity limits, and Razorpay HMAC signature matching.

After configuring Razorpay Test Mode and a reachable webhook endpoint, verify manually:

- Change a product price after adding it to the cart; the quote and payment amount use the new database price.
- Alter local storage prices, stock, shipping, or totals; none of those values changes the server quote or final total.
- Attempt checkout outside Maharashtra and with an invalid PIN; the server rejects it.
- Test free delivery with no minimum, with a minimum above/below subtotal, after its end date, and with the offer turned off.
- Open two checkouts for a single-stock refurbished laptop; only one can reserve it. Let a reservation expire or fail payment and verify that stock returns.
- Complete a Razorpay test payment; only the verified webhook changes status to paid. Replay a webhook event and verify it has no duplicate effect. Submit an invalid signature and verify rejection.
- Test payment failure/expiry, late capture refund review, and a test-mode full refund.
- Sign in as inventory/sales and verify order/shipping admin APIs deny access; verify owner/manager fulfillment updates and tracking fields.
- In Shipping Settings, leave returns disabled until the policy and owner values are reviewed. Configure the return window, eligible reasons, return-shipping mode/charge, original-delivery refund choice, and refund processing days.
- Mark a paid order delivered and verify `deliveredAt` is recorded. Sign in to its customer account to view it, submit 2–6 valid proof images, and verify a duplicate open request is rejected.
- As owner/manager, review the request, approve it, record receipt and inspection, then issue a partial refund. Verify the server-computed breakdown, the refund webhook amount match, and the mismatch path. Verify sales/inventory roles cannot list or modify returns.
- Confirm rejected requests show their reason to the customer and that proof uploads use authenticated Cloudinary resources. No card data is stored by this application.

Run `npm run check:site` before launch. It intentionally fails until every `[TO BE FILLED BY OWNER]` value in `frontend/js/business.js` and the policy pages has been replaced. Policy drafts need legal/CA review.

Git ignores local environment and credential artifacts. Use `scripts/export-project.ps1` to create a ZIP from the working tree; it excludes local env files, credentials, build outputs, dependencies, and nested archives while retaining the sanitized `.env.example`. `.gitattributes` also marks sensitive paths `export-ignore` for Git archive exports. Files already present in older Git history still require rotation of any credentials they contained; this change does not rewrite repository history.
