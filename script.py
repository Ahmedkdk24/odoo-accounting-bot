import os
import time
import json
import shutil
import xmlrpc.client as xmlrpc
import pytesseract
from google import genai
from PIL import Image
from pdf2image import convert_from_path
from dotenv import load_dotenv


# 1. Environment Setup
load_dotenv()
ODOO_URL = os.getenv('ODOO_URL')  # e.g., 'omc.sa'
ODOO_DB = os.getenv('ODOO_DB')
ODOO_USER = os.getenv('ODOO_USER')
ODOO_PWD = os.getenv('ODOO_PWD') # Use an API Key

# Path configuration
INPUT_DIR = './input'
PROCESSED_DIR = './processed'
FAILED_DIR = './failed'

# Ensure directories exist
for d in [INPUT_DIR, PROCESSED_DIR, FAILED_DIR]:
    os.makedirs(d, exist_ok=True)

# 2. Odoo Connection
try:
    url = f"https://{ODOO_URL}"
    common = xmlrpc.ServerProxy(f"{url}/xmlrpc/2/common")
    uid = common.authenticate(ODOO_DB, ODOO_USER, ODOO_PWD, {})
    if uid:
        models = xmlrpc.ServerProxy(f"{url}/xmlrpc/2/object")
        print("Odoo login successful")
    else:
        raise Exception("Authentication failed")
except Exception as e:
    print("Odoo connection failed:", e)
    
# Configure Gemini
client = genai.Client()

def extract_invoice_json(raw_text):
    prompt = f"""
    You are a professional Saudi accountant. Extract financial data from the following OCR text
    derived from a bilingual (Arabic/English) invoice.

    Return ONLY a valid JSON object with these keys:
    'partner_name', 'date' (YYYY-MM-DD), 'amount' (float), 'reference' (invoice number), 'vat_no'.

    OCR TEXT:
    {raw_text}
    """

    response = client.models.generate_content(model='gemini-2.5-flash', contents=prompt)

    # Clean the response to ensure it only contains JSON
    text_response = response.text.strip().replace('```json', '').replace('```', '')
    return json.loads(text_response)


def process_file(file_path):
    print(f"--- Processing: {file_path} ---")
    try:
        # Step A: OCR Extraction
        if file_path.lower().endswith('.pdf'):
            pages = convert_from_path(file_path)
            raw_text = "".join([pytesseract.image_to_string(p, lang='ara+eng') for p in pages])
        else:
            raw_text = pytesseract.image_to_string(Image.open(file_path), lang='ara+eng')

        # Step B: AI Parsing
        extracted_data = extract_invoice_json(raw_text)
        print("Extracted:", extracted_data)

        # Step C: Partner
        partner_ids = models.execute_kw(ODOO_DB, uid, ODOO_PWD, 'res.partner', 'search', [[('name', 'ilike', extracted_data['partner_name'])]], {'limit': 1})

        if not partner_ids:
            partner_ids = [models.execute_kw(ODOO_DB, uid, ODOO_PWD, 'res.partner', 'create', [{
                'name': extracted_data['partner_name'],
                'supplier_rank': 1
            }])]

        # Step D: Product
        product_ids = models.execute_kw(ODOO_DB, uid, ODOO_PWD, 'product.product', 'search', [[('name', '=', 'AI Automated Entry')]], {'limit': 1})

        if not product_ids:
            raise Exception("Product not found. Create it in Odoo first.")

        product_id = product_ids[0]

        # Step E: Create Bill
        bill_vals = {
            'move_type': 'in_invoice',
            'partner_id': partner_ids[0],
            'invoice_date': extracted_data.get('date'),
            'ref': extracted_data.get('reference'),
            'invoice_line_ids': [(0, 0, {
                'product_id': product_id,
                'name': 'AI Automated Entry / إدخال آلي',
                'quantity': 1,
                'price_unit': extracted_data.get('amount', 0.0),
            })]
        }

        new_bill = models.execute_kw(ODOO_DB, uid, ODOO_PWD, 'account.move', 'create', [bill_vals])
        print(f"Success! Created Bill ID: {new_bill}")

        shutil.move(file_path, os.path.join(PROCESSED_DIR, os.path.basename(file_path)))

    except Exception as e:
        print(f"Failed to process {file_path}: {e}")
        shutil.move(file_path, os.path.join(FAILED_DIR, os.path.basename(file_path)))
        
# 3. Main Watcher Loop
if __name__ == "__main__":
    print("Script started")
    print("Monitoring 'input' folder... Press Ctrl+C to stop.")

    while True:
        try:
            files = [f for f in os.listdir(INPUT_DIR) if os.path.isfile(os.path.join(INPUT_DIR, f))]
            print(f"Found {len(files)} files")

            for file in files:
                process_file(os.path.join(INPUT_DIR, file))

        except Exception as e:
            print("Loop error:", e)

        time.sleep(5)