# Ordering and payment setup

## Requirements

- Node.js 20.19 or newer (required by the installed Mongoose major version).
- MongoDB configured as a replica set. Checkout uses MongoDB transactions so the order and stock reservation commit together. MongoDB Atlas is already replica-set based; local MongoDB must start with `mongod --replSet rs0 --dbpath <data-directory>` and be initiated once with `mongosh --eval "rs.initiate()"`.
- Razorpay test-mode API key ID, API key secret, and webhook secret. Live keys are rejected by the application.

## Configure and start

1. From `backend`, copy `.env.example` to `.env` and set `MONGO_URI`, `JWT_SECRET`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`. Keep `.env` local.
2. Set `PAYMENT_MODE=test`. `PAYMENT_RESERVATION_MINUTES` is optional and defaults to 15 (allowed range: 5–60).
3. Install dependencies and run checks: `npm install`, then `npm test`.
4. Start the app with `npm run dev`.
5. Sign into `admin.html` with an owner or manager account. In Shipping Settings, configure the Maharashtra courier charge whenever free delivery has a minimum/end date or is turned off. Free delivery starts enabled with no minimum and no end date.
6. In Razorpay Test Mode, configure the webhook URL as `https://<your-host>/api/orders/webhook` and subscribe to payment captured/failed, order paid, and refund processed/failed events. Keep the webhook secret in the server environment only.

The cart quote and final order both use current MongoDB prices and server-side shipping settings. The final order reserves stock inside a transaction. A background worker and payment endpoints release unpaid reservations after the configured period. Customer tracking requires the order number and checkout mobile number. Admin order and shipping writes require owner/manager authentication.

## Payment and tax behavior

The API creates Razorpay orders server-side in paise. Browser callbacks are signature-checked but do not mark an order paid; verified webhooks make that transition. If test credentials are absent or incomplete, checkout returns a setup message and creates no order or reservation.

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

Git ignores local environment and credential artifacts. Use `scripts/export-project.ps1` to create a ZIP from the working tree; it excludes local env files, credentials, build outputs, dependencies, and nested archives while retaining the sanitized `.env.example`. `.gitattributes` also marks sensitive paths `export-ignore` for Git archive exports. Files already present in older Git history still require rotation of any credentials they contained; this change does not rewrite repository history.
