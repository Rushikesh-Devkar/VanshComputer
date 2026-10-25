# Razorpay setup

Online payments are disabled unless `PAYMENT_MODE` and matching Razorpay credentials are configured. Use `test` with `rzp_test_` credentials for testing or `live` with `rzp_live_` credentials for production. The backend rejects credentials whose key prefix does not match the selected mode.

## Configure credentials

1. Sign in to the shop owner's [Razorpay Dashboard](https://dashboard.razorpay.com/) and select the mode that matches the deployment.
2. Open **Account & Settings → API Keys → Generate Key**. Put the mode's Key ID in `RAZORPAY_KEY_ID` and its secret in `RAZORPAY_KEY_SECRET` in `backend/.env`.
3. Set `PAYMENT_MODE=test` for test credentials or `PAYMENT_MODE=live` for production credentials. Set a distinct, random `RAZORPAY_WEBHOOK_SECRET`; it is not the API secret.
4. Never commit `.env`, paste secrets into frontend files, or share the API secret. `.env.example` contains placeholders only.

## Configure webhooks

In the selected mode, open **Account & Settings → Webhooks**, add the reachable endpoint `https://YOUR_BACKEND_DOMAIN/api/orders/webhook`, and enter the exact same value configured as `RAZORPAY_WEBHOOK_SECRET`. Enable only events handled by this app: `payment.captured`, `order.paid`, `payment.failed`, `refund.processed`, and `refund.failed` (if refunds are enabled for the account). Configure Test and Live webhooks separately when both modes are used.

Razorpay cannot reach `localhost` directly. For local testing, expose the local backend using a reputable HTTPS tunnel such as [ngrok](https://ngrok.com/docs/getting-started/) and use its HTTPS forwarding URL plus `/api/orders/webhook` as the Test Mode endpoint. Treat the temporary public URL as sensitive, use a temporary test secret, and remove the tunnel/webhook when finished. A staging deployment with HTTPS is preferable for repeatable testing.

## Before considering checkout verified

For Test Mode, use only the owner's test payment methods. Verify a successful capture, a failed payment, dismissed checkout, delayed webhook, duplicate webhook delivery, amount mismatch, reservation expiry, and full refund. Confirm the order remains pending until the verified capture webhook, receipts use server data, and stock is not released for a paid order. This repository has not been connected to an owner's transaction or deployed HTTPS webhook, so no end-to-end payment success is claimed.

## Database requirement

Order creation and stock release use MongoDB transactions. Use a replica set or sharded MongoDB deployment (the local example URI requests replica set rs0); a standalone MongoDB server cannot support these operations. Verify the deployed MongoDB topology before enabling checkout.
