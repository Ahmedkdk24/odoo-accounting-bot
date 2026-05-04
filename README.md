
# Odoo Accounting Bot

An automated invoice processing and accounting system that uses OCR and AI to extract data from invoices and create bills in Odoo ERP. Now includes a **serverless Telegram bot** powered by Cloudflare Workers for instant invoice processing via chat.


## Features

- **OCR Processing**: Extracts text from PDF and image files using Tesseract (supports Arabic and English)
- **AI-Powered Parsing**: Uses Gemini AI (or Groq Llama) to intelligently parse invoice data into structured JSON
- **Odoo Integration**: Automatically creates partners and bills in your Odoo instance via XML-RPC (Python) or JSON-RPC (Worker)
- **File Monitoring**: Continuously monitors an input folder for new invoice files (Python)
- **Telegram Bot**: Send invoices directly to a Telegram bot and get them processed instantly
- **Serverless Cloudflare Worker**: Handles Telegram webhooks, OCR, AI parsing, and Odoo integration with zero server maintenance
- **Error Handling**: Moves failed files to a separate directory for manual review (Python) and sends error messages in chat (Worker)
- **Bilingual Support**: Handles invoices in both Arabic and English


## Prerequisites

### For Python Script
- Python 3.8+
- Tesseract OCR installed on your system
- Google Gemini API key
- Access to an Odoo instance with XML-RPC enabled

### For Telegram Bot (Cloudflare Worker)
- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install/)
- Cloudflare account (for deploying the Worker)
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- Odoo instance with JSON-RPC enabled
- Gemini API key (or Groq API key)


### Installing Tesseract OCR (for Python script)

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install tesseract-ocr tesseract-ocr-ara
```

**macOS:**
```bash
brew install tesseract tesseract-lang
```

**Windows:** Download from [https://github.com/UB-Mannheim/tesseract/wiki](https://github.com/UB-Mannheim/tesseract/wiki)


## Installation & Setup

### 1. Clone the repository

```bash
git clone https://github.com/Ahmedkdk24/odoo-accounting-bot.git
cd odoo-accounting-bot
```

---

### 2. Python Script (Local Invoice Processing)

1. **Create a virtual environment:**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```
2. **Install dependencies:**
   ```bash
   pip install pytesseract google-genai Pillow pdf2image python-dotenv
   ```
3. **Set up environment variables:**
   Create a `.env` file in the root directory:
   ```env
   ODOO_URL=your-odoo-instance.com
   ODOO_DB=your-database-name
   ODOO_USER=your-username
   ODOO_PWD=your-api-key
   GEMINI_API_KEY=your-gemini-api-key
   ```
4. **Run the script:**
   - Place invoice files (PDF or images) in the `input/` folder
   - Run:
     ```bash
     python script.py
     ```
   - Processed files move to `processed/`, failures to `failed/`

---

### 3. Telegram Bot (Cloudflare Worker)

1. **Install Wrangler CLI:**
   ```bash
   npm install -g wrangler
   ```
2. **Install dependencies:**
   ```bash
   cd worker
   npm install
   ```
3. **Set up Cloudflare secrets:**
   ```bash
   wrangler secret put TELEGRAM_TOKEN         # Telegram Bot token from @BotFather
   wrangler secret put TELEGRAM_SECRET        # Any random string (used for webhook security)
   wrangler secret put ODOO_PWD               # Odoo API key
   wrangler secret put GEMINI_API_KEY         # Gemini or Groq API key
   wrangler secret put CLOUDCONVERT_API_KEY   # (Optional, for PDF to image)
   ```
4. **Configure wrangler.toml:**
   - Edit `worker/wrangler.toml` and set:
     - `ODOO_URL`, `ODOO_DB`, `ODOO_USER` (Odoo instance details)
     - `R2_PUBLIC_BASE_URL` (Cloudflare R2 public bucket URL, if using R2)
5. **Deploy the Worker:**
   ```bash
   wrangler deploy
   ```
6. **Register the Telegram webhook:**
   ```bash
   curl "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=https://<worker-url>/endpoint&secret_token=<YOUR_SECRET>"
   ```
   - Replace `<YOUR_TOKEN>`, `<worker-url>`, and `<YOUR_SECRET>` accordingly.

---

## Obtaining Required Credentials

### Odoo
- Log in to your Odoo instance as an admin
- Go to your user profile > My Profile > Account Security > New API Key
- Copy the API key and use it as `ODOO_PWD`
- Ensure your user has permissions to create partners and bills
- Enable XML-RPC (for Python) or ensure JSON-RPC is accessible (for Worker)
- Create a product named "AI Automated Entry" in Odoo (or update the script to match your product)

### Google Gemini / Groq API
- [Sign up for Gemini API](https://aistudio.google.com/app/apikey) or [Groq API](https://console.groq.com/)
- Copy your API key and use as `GEMINI_API_KEY` or `GROQ_API_KEY`

### Telegram Bot
- Open [@BotFather](https://t.me/BotFather) in Telegram
- Create a new bot and copy the token
- Use this as `TELEGRAM_TOKEN` secret in the Worker

### Cloudflare
- [Create a Cloudflare account](https://dash.cloudflare.com/)
- Set up a Worker project and (optionally) an R2 bucket for file storage
- Install Wrangler and authenticate: `wrangler login`


## Configuration Reference

### Environment Variables (Python)
- `ODOO_URL`: Your Odoo instance URL (without https://)
- `ODOO_DB`: Database name
- `ODOO_USER`: Username or email
- `ODOO_PWD`: API key (recommended) or password
- `GEMINI_API_KEY`: Your Google Gemini or Groq API key

### Cloudflare Worker Secrets & Vars
- `TELEGRAM_TOKEN`: Telegram bot token
- `TELEGRAM_SECRET`: Any random string (must match webhook registration)
- `ODOO_PWD`: Odoo API key
- `GEMINI_API_KEY` or `GROQ_API_KEY`: Gemini or Groq API key
- `CLOUDCONVERT_API_KEY`: (Optional) CloudConvert API key for PDF to image
- `ODOO_URL`, `ODOO_DB`, `ODOO_USER`: Odoo instance details (in wrangler.toml)
- `R2_PUBLIC_BASE_URL`: (Optional) Cloudflare R2 public bucket URL


## Project Structure

```
.
├── script.py            # Main Python processing script
├── input/               # Folder to place invoice files for processing
├── processed/           # Successfully processed files
├── failed/              # Files that failed processing
├── .env                 # Environment variables (Python)
├── worker/              # Cloudflare Worker (Telegram bot)
│   ├── src/             # Worker source code (handlers, router, utils)
│   ├── wrangler.toml    # Worker config (set Odoo vars here)
│   └── package.json     # Worker dependencies
└── README.md            # This file
```


## How It Works

### Python Script
1. **File Detection**: Monitors the `input/` folder for new files
2. **OCR Extraction**: Converts PDFs to images and extracts text using Tesseract
3. **AI Parsing**: Sends the extracted text to Gemini AI with a prompt to extract specific fields
4. **Data Validation**: Parses the AI response into structured JSON
5. **Odoo Integration**: Searches for existing partners, creates new ones if needed, and creates a bill (supplier invoice)
6. **File Management**: Moves processed files to appropriate folders

### Telegram Bot (Cloudflare Worker)
1. **Receives Telegram webhook**: Handles `/endpoint` for Telegram updates
2. **Downloads invoice files**: Supports PDF and images
3. **OCR & AI Parsing**: Uses Tesseract.js and Gemini/Groq for data extraction
4. **Odoo Integration**: Creates bills in Odoo via JSON-RPC
5. **Replies to user**: Sends success or error messages in chat


## Supported File Types

- PDF files
- Image files (PNG, JPG, JPEG, etc.)


## Telegram Chatbot Integration (Cloudflare Worker)

- Send a PDF or image invoice to your Telegram bot
- The bot will process it and create a bill in Odoo
- You will receive a reply in chat with the result (success or error)


## Error Handling

- Python: Files that fail processing are moved to `failed/` with error details logged
- Worker: User receives error messages in Telegram chat; logs are available in Cloudflare dashboard


## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly (Python and Worker)
5. Submit a pull request


## License

This project is licensed under the MIT License - see the LICENSE file for details.


## Disclaimer

This tool is provided as-is. Always verify the accuracy of processed invoices before posting them in your accounting system. The AI parsing may not be 100% accurate for all invoice formats.