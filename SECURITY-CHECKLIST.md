# Security checklist

## Rotation order

Rotate credentials in this order. Perform each change, verify it, and then move to the next item.

1. **MongoDB Atlas database user password**
   - In MongoDB Atlas, rotate the database user's password.
   - Review the IP access list and remove old or unexpected addresses.
   - Update `MONGO_URI` on Render with the new password.
2. **JWT secret**
   - Generate a new random secret of at least 32 characters.
   - Update `JWT_SECRET` on Render and redeploy.
   - Changing this secret invalidates existing signed JWT sessions and logs users and staff out.
3. **Razorpay live API key and webhook secret**
   - Rotate the live API key pair in the Razorpay dashboard.
   - Generate a new webhook secret and update it on Render.
   - Update the Razorpay webhook in the dashboard with the new secret and required events.
   - Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and `PAYMENT_MODE=live` on Render.
4. **Cloudinary API secret**
   - Rotate the Cloudinary API secret in the Cloudinary dashboard.
   - Update `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` on Render.
5. **Brevo API key**
   - Revoke or rotate the old Brevo API key.
   - Update `BREVO_API_KEY` and `MAIL_FROM` on Render.
6. **ADMIN_KEY**
   - If an `ADMIN_KEY` exists in any environment or deployment configuration, rotate it and update it on Render.
   - Remove any unused `ADMIN_KEY` entry.

## Updating Render

In the Render dashboard:

1. Open the service and select Environment.
2. Replace one secret at a time.
3. Do not place secrets in source files, logs, mail bodies, or screenshots.
4. Save the environment change and redeploy.
5. Use the application health endpoint and test a small login/payment workflow after each related credential group is updated.
6. Restart or redeploy after removing an environment variable that is no longer needed.

## Repository and history checks

Run:

```sh
git log --all -- '*.env'
git log --all --oneline -- '*/.env' '*env'
```

Removing a file from the current checkout or adding it to `.gitignore` does not remove it from old Git history. If the command finds an environment file in history, rotate every credential that could have appeared in it. Consider repository history rewriting only after rotating the credentials; rotation is mandatory even if rewriting succeeds.
