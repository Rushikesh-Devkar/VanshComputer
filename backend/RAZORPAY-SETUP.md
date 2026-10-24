# Razorpay test setup

Online payments are disabled unless `PAYMENT_MODE=test` and a matching Razorpay Test Key ID, API Secret, and separate Webhook Secret are configured. The backend accepts only `rzp_test_` key IDs; live keys are rejected. Live payment support is not implemented or enabled.

## Configure test credentials

1. Sign in to the shop owner's [Razorpay Dashboard](https://dashboard.razorpay.com/) and switch to **Test Mode**.
2. Open **Account & Settings → API Keys → Generate Key**. Put the Test Key ID in `RAZORPAY_KEY_ID` and its secret in `RAZORPAY_KEY_SECRET` in `backend/.env`.
3. Set `PAYMENT_MODE=test` and `PAYMENT_RESERVATION_MINUTES=15`. Set a distinct, random `RAZORPAY_WEBHOOK_SECRET`; it is not the API secret.
4. Never commit `.env`, paste secrets into frontend files, or share the API secret. `.env.example` contains placeholders only.

## Configure test webhooks

In Test Mode, open **Account & Settings → Webhooks**, add the reachable endpoint `https://YOUR_BACKEND_DOMAIN/api/orders/webhook`, and enter the exact same value configured as `RAZORPAY_WEBHOOK_SECRET`. Enable only events handled by this app: `payment.captured`, `order.paid`, `payment.failed`, `refund.processed`, and `refund.failed` (if refunds are enabled for the account). Save the endpoint and secret in Test Mode.

Razorpay cannot reach `localhost` directly. For local testing, expose the local backend using a reputable HTTPS tunnel such as [ngrok](https://ngrok.com/docs/getting-started/) and use its HTTPS forwarding URL plus `/api/orders/webhook` as the Test Mode endpoint. Treat the temporary public URL as sensitive, use a temporary test secret, and remove the tunnel/webhook when finished. A staging deployment with HTTPS is preferable for repeatable testing.

## Before considering checkout verified

Use only the owner's Test Mode account and test payment methods. Verify a successful capture, a failed payment, dismissed checkout, delayed webhook, duplicate webhook delivery, amount mismatch, reservation expiry, and full refund. Confirm the order remains pending until the verified capture webhook, receipts use server data, and stock is not released for a paid order. This repository has not been connected to an owner's test transaction or deployed HTTPS webhook, so no end-to-end payment success is claimed.

## Database requirement

Order creation and stock release use MongoDB transactions. Use a replica set or sharded MongoDB deployment (the local example URI requests replica set rs0); a standalone MongoDB server cannot support these operations. Verify the deployed MongoDB topology before enabling checkout.
