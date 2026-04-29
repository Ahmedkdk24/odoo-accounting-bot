# Odoo Invoice Parser

An automated invoice processing system that uses OCR and AI to extract data from invoices and create bills in Odoo ERP.

## Features

- **OCR Processing**: Extracts text from PDF and image files using Tesseract (supports Arabic and English)
- **AI-Powered Parsing**: Uses Google's Gemini AI to intelligently parse invoice data into structured JSON
- **Odoo Integration**: Automatically creates partners and bills in your Odoo instance via XML-RPC
- **File Monitoring**: Continuously monitors an input folder for new invoice files
- **Error Handling**: Moves failed files to a separate directory for manual review
- **Bilingual Support**: Handles invoices in both Arabic and English

## Prerequisites

- Python 3.8+
- Tesseract OCR installed on your system
- Google Gemini API key
- Access to an Odoo instance with XML-RPC enabled

### Installing Tesseract OCR

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

## Installation

1. Clone the repository:
```bash
git clone https://github.com/Ahmedkdk24/odoo-parser.git
cd odoo-parser
```

2. Create a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install dependencies:
```bash
pip install pytesseract google-genai Pillow pdf2image python-dotenv
```

4. Set up environment variables by creating a `.env` file:
```env
ODOO_URL=your-odoo-instance.com
ODOO_DB=your-database-name
ODOO_USER=your-username
ODOO_PWD=your-api-key
GEMINI_API_KEY=your-gemini-api-key
```

## Usage

1. Place invoice files (PDF or images) in the `input/` folder
2. Run the script:
```bash
python script.py
```
3. The script will continuously monitor the input folder and process new files
4. Successfully processed files will be moved to `processed/`
5. Failed files will be moved to `failed/` for manual review

## Configuration

### Environment Variables

- `ODOO_URL`: Your Odoo instance URL (without https://)
- `ODOO_DB`: Database name
- `ODOO_USER`: Username or email
- `ODOO_PWD`: API key (recommended) or password
- `GEMINI_API_KEY`: Your Google Gemini API key

### Odoo Setup

1. Enable XML-RPC in your Odoo instance
2. Create an API key for your user (recommended over password)
3. Ensure your user has permissions to create partners and account moves
4. Create a product named "AI Automated Entry" in Odoo (or modify the script)

## Project Structure

```
.
├── script.py          # Main processing script
├── input/             # Folder to place invoice files for processing
├── processed/         # Successfully processed files
├── failed/            # Files that failed processing
├── .env               # Environment variables (create this file)
├── .gitignore         # Git ignore rules
└── README.md          # This file
```

## How It Works

1. **File Detection**: Monitors the `input/` folder for new files
2. **OCR Extraction**: Converts PDFs to images and extracts text using Tesseract
3. **AI Parsing**: Sends the extracted text to Gemini AI with a prompt to extract specific fields
4. **Data Validation**: Parses the AI response into structured JSON
5. **Odoo Integration**:
   - Searches for existing partners by name
   - Creates new partners if not found
   - Creates a bill (supplier invoice) with the extracted data
6. **File Management**: Moves processed files to appropriate folders

## Supported File Types

- PDF files
- Image files (PNG, JPG, JPEG, etc.)

## Telegram Chatbot Integration

This repository now includes a **fully serverless** Cloudflare Worker that turns the Odoo invoice parser into a Telegram chatbot.

### Worker
- `worker/` contains the Cloudflare Worker that handles everything:
  - Receives Telegram webhooks
  - Downloads invoice PDFs/images
  - Performs OCR using Tesseract.js
  - Parses data with Gemini AI
  - Creates bills in Odoo via JSON-RPC
  - Sends replies to users

### Setup
1. Install Wrangler: `npm install -g wrangler`
2. Authenticate: `wrangler login`
3. Set secrets in `worker/`:
   ```bash
   wrangler secret put TELEGRAM_TOKEN
   wrangler secret put TELEGRAM_SECRET
   wrangler secret put ODOO_PWD
   wrangler secret put GEMINI_API_KEY
   ```
4. Update `worker/wrangler.toml` with your Odoo URL, DB, and user.
5. Install deps: `cd worker && npm install`
6. Deploy: `wrangler deploy`
7. Register webhook: `curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<WORKER_URL>/endpoint&secret_token=<SECRET>"`

### Usage
Send a PDF or image invoice to the bot. It will process it and create a bill in Odoo.

## Error Handling

- Files that fail processing are moved to `failed/` with error details logged
- Network issues, OCR failures, or invalid data will trigger failure handling
- Check `script.log` for detailed error information

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Disclaimer

This tool is provided as-is. Always verify the accuracy of processed invoices before posting them in your accounting system. The AI parsing may not be 100% accurate for all invoice formats.