# OMC Odoo Telegram Worker

This folder contains the **fully serverless** Cloudflare Worker that handles the entire Odoo invoice processing pipeline.

## Features
- Receives Telegram webhook updates
- Downloads invoice files (PDFs and images)
- Performs OCR using Tesseract.js
- Parses invoice data with Gemini AI
- Creates bills in Odoo via JSON-RPC
- Sends status messages back to Telegram users

## Setup

1. Install Wrangler globally if not already installed:
```bash
npm install -g wrangler
```

2. Install local dev dependencies:
```bash
cd worker
npm install
```

3. Set the secrets:
```bash
wrangler secret put TELEGRAM_TOKEN
wrangler secret put TELEGRAM_SECRET
wrangler secret put ODOO_PWD
wrangler secret put GEMINI_API_KEY
```

4. Update `wrangler.toml` with your Odoo details (URL, DB, user).

5. Deploy:
```bash
wrangler deploy
```

6. Register the webhook with Telegram:
```bash
curl "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=https://<worker-url>/endpoint&secret_token=<YOUR_SECRET>"
```

## Endpoints

- `/endpoint` receives Telegram webhook updates
- `/registerWebhook` registers the webhook with Telegram
- `/unRegisterWebhook` removes the webhook

## Notes

- Ensure your Odoo instance has a product named "AI Automated Entry".
- The worker uses Odoo JSON-RPC for integration.
