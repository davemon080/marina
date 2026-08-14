import json
import os
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from flask import Flask, abort, jsonify, request, send_file, Response

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder='static', static_url_path='/static')


def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    return response


def load_environment_from_dotenv():
    dotenv_path = Path(BASE_DIR) / '.env'
    if not dotenv_path.exists():
        return

    for line in dotenv_path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


load_environment_from_dotenv()

RECAPTCHA_SECRET_KEY = os.environ.get('RECAPTCHA_SECRET_KEY', '').strip()
SUPABASE_URL = os.environ.get('SUPABASE_URL', '').rstrip('/')
SUPABASE_SECRET_KEY = os.environ.get('SUPABASE_SECRET_KEY', '').strip()
SUPABASE_TABLE = os.environ.get('SUPABASE_TABLE', 'certificate_records')
DOCUMENTS_JSON_PATH = Path(BASE_DIR) / 'documents.json'


def build_verify_response(payload, secret_key=None):
    token = (payload.get('token') or '').strip() if isinstance(payload, dict) else ''
    if not token:
        return {'ok': False, 'error': 'missing token'}, 400

    if not secret_key:
        return {'ok': True, 'message': 'reCAPTCHA verification skipped (no secret configured)'}, 200

    try:
        data = urlencode({'secret': secret_key, 'response': token}).encode('utf-8')
        req = Request(
            'https://www.google.com/recaptcha/api/siteverify',
            data=data,
            headers={'Content-Type': 'application/x-www-form-urlencoded'},
        )
        with urlopen(req, timeout=5) as response:
            result = json.load(response)
    except Exception:
        return {'ok': False, 'error': 'verification request failed'}, 200

    return {'ok': bool(result.get('success'))}, 200


def _send_html_file(path):
    return send_file(path, mimetype='text/html; charset=utf-8')


@app.route('/')
def serve_index():
    return _send_html_file(os.path.join(BASE_DIR, 'index.html'))


@app.route('/<path:path>')
def serve_site(path):
    if path.startswith('static/'):
        return app.send_static_file(path[len('static/'):])

    if path.lower().endswith('.json'):
        abort(404)

    candidate = os.path.normpath(os.path.join(BASE_DIR, path))
    if os.path.commonpath([BASE_DIR, candidate]) != BASE_DIR:
        abort(404)

    if os.path.isdir(candidate):
        candidate = os.path.join(candidate, 'index.html')

    if os.path.isfile(candidate):
        return _send_html_file(candidate)

    html_candidate = os.path.normpath(os.path.join(BASE_DIR, f'{path}.html'))
    if os.path.commonpath([BASE_DIR, html_candidate]) == BASE_DIR and os.path.isfile(html_candidate):
        return _send_html_file(html_candidate)

    abort(404)


@app.route('/verify-recaptcha', methods=['POST', 'OPTIONS'])
def verify_recaptcha():
    if request.method == 'OPTIONS':
        return add_cors_headers(jsonify({'ok': True})), 200

    try:
        payload = request.get_json(silent=True) or {}
        if not isinstance(payload, dict):
            payload = {}
        token = (payload.get('token') or request.form.get('token') or request.args.get('token') or '').strip()
        if token:
            payload['token'] = token
        response, status = build_verify_response(payload, RECAPTCHA_SECRET_KEY)
        return add_cors_headers(jsonify(response)), status
    except Exception:
        return add_cors_headers(jsonify({'ok': False, 'error': 'verification request failed'})), 200


@app.route('/api/verify-recaptcha', methods=['POST', 'OPTIONS'])
def api_verify_recaptcha():
    if request.method == 'OPTIONS':
        return add_cors_headers(jsonify({'ok': True})), 200

    try:
        payload = request.get_json(silent=True) or {}
        if not isinstance(payload, dict):
            payload = {}
        token = (payload.get('token') or request.form.get('token') or request.args.get('token') or '').strip()
        if token:
            payload['token'] = token
        response, status = build_verify_response(payload, RECAPTCHA_SECRET_KEY)
        return add_cors_headers(jsonify(response)), status
    except Exception:
        return add_cors_headers(jsonify({'ok': False, 'error': 'verification request failed'})), 200


def fetch_certificate_from_supabase(serial_number):
    if not SUPABASE_URL or not SUPABASE_SECRET_KEY:
        return None

    try:
        url = f"{SUPABASE_URL}/rest/v1/{SUPABASE_TABLE}?select=*&serial_number=eq.{serial_number}"
        req = Request(
            url,
            headers={
                'Accept': 'application/json',
                'apikey': SUPABASE_SECRET_KEY,
                'Authorization': f'Bearer {SUPABASE_SECRET_KEY}',
            },
        )
        with urlopen(req, timeout=5) as response:
            rows = json.load(response)
    except Exception:
        return None

    if isinstance(rows, list) and rows:
        return rows[0]
    return None


def load_documents_from_json():
    try:
        with DOCUMENTS_JSON_PATH.open('r', encoding='utf-8') as handle:
            data = json.load(handle)
            if isinstance(data, list):
                return data
    except Exception:
        return []
    return []


def fetch_certificate_from_local_json(serial_number):
    serial_number = (serial_number or '').strip().upper()
    documents = load_documents_from_json()
    for item in documents:
        if str(item.get('serial_number') or '').strip().upper() == serial_number:
            return item
        if str(item.get('certificate_number') or item.get('certificate_no') or '').strip().upper() == serial_number:
            return item
    return None


def normalize_verification_type(value):
    normalized = (value or '').strip().lower()
    aliases = {
        'sirb': 'sirb',
        'sirbnumber': 'sirb',
        'sirb-no': 'sirb',
        'sirb_number': 'sirb',
        'srn': 'id',
        'id': 'id',
        'identification': 'id',
        'identificationcard': 'id',
        'certificate': 'certificate',
        'cert': 'certificate',
        'certification': 'certificate',
        'serial_number': 'certificate',
        'certificate_number': 'certificate',
        'legal': 'certificate',
    }
    return aliases.get(normalized, normalized or 'certificate')


def verification_type_matches(row, verification_type):
    if not row:
        return False

    selected_type = normalize_verification_type(verification_type)
    row_values = ' '.join([
        str(row.get('verification_type') or ''),
        str(row.get('certificate_type') or ''),
        str(row.get('record_type') or ''),
    ]).lower()

    if selected_type == 'sirb':
        return 'sirb' in row_values or 'certificate' in row_values or 'cop' in row_values or 'coc' in row_values or 'coe' in row_values

    if selected_type == 'id':
        return 'id' in row_values or 'identification' in row_values

    return 'certificate' in row_values or 'cert' in row_values or 'cop' in row_values or 'coc' in row_values or 'coe' in row_values


def split_name_parts(full_name):
    if not full_name:
        return '', '', ''

    parts = [part for part in str(full_name).split() if part]
    if not parts:
        return '', '', ''

    first_name = parts[0]
    last_name = parts[-1] if len(parts) > 1 else ''
    middle_name = ' '.join(parts[1:-1]) if len(parts) > 2 else ''
    return first_name, middle_name, last_name


def build_certificate_payload(serial_number, verification_type=None):
    serial_number = (serial_number or '').strip().upper()
    selected_type = normalize_verification_type(verification_type)
    row = fetch_certificate_from_local_json(serial_number)

    if selected_type == 'id':
        return {'ok': False, 'data': {}, 'error': 'Invalid SRN'}

    if selected_type == 'sirb':
        return {'ok': False, 'data': {}, 'error': 'SIRB not found'}

    # Hard fail all SIRB validation attempts so the frontend never shows a valid result.
    if selected_type == 'sirb':
        return {'ok': False, 'data': {}, 'error': 'SIRB not found'}

    if row and verification_type_matches(row, selected_type):
        full_name = row.get('full_name') or row.get('name') or 'Unknown'
        first_name, middle_name, last_name = split_name_parts(full_name)
        if row.get('first_name'):
            first_name = str(row.get('first_name'))
        if row.get('middle_name'):
            middle_name = str(row.get('middle_name'))
        if row.get('last_name'):
            last_name = str(row.get('last_name'))

        return {
            'ok': True,
            'data': {
                'serial_number': str(row.get('serial_number') or serial_number),
                'certificate_no': str(row.get('certificate_no') or row.get('certificate_number') or row.get('serial_number') or serial_number),
                'certificate_number': str(row.get('certificate_number') or row.get('certificate_no') or row.get('serial_number') or serial_number),
                'full_name': full_name,
                'name': full_name,
                'first_name': first_name or 'Unknown',
                'middle_name': middle_name or '',
                'last_name': last_name or '',
                'certificate_type': row.get('certificate_type') or 'Certificate',
                'title_of_certificate': row.get('title_of_certificate') or row.get('certificate_type') or 'Certificate',
                'title': row.get('title_of_certificate') or row.get('certificate_type') or 'Certificate',
                'function': row.get('function') or 'N/A',
                'level_of_responsibility': row.get('level_of_responsibility') or row.get('Level of Responsibility') or row.get('level_of_responsibility') or 'N/A',
                'level': row.get('level_of_responsibility') or row.get('Level of Responsibility') or 'N/A',
                'regulation_no': row.get('regulation_no') or 'N/A',
                'regulation': row.get('regulation_no') or 'N/A',
                'regulation_number': row.get('regulation_no') or 'N/A',
                'status': row.get('status') or 'active',
                'issue_date': row.get('issue_date') or '',
                'date_issued': row.get('issue_date') or '',
                'expiry_date': row.get('expiry_date') or '',
                'date_expiry': row.get('expiry_date') or '',
                'revalidation_date': row.get('revalidation_date') or '',
                'document_url': row.get('document_url') or '/static/media/sample-certificate.svg',
                'image_url': row.get('image_url') or '/static/media/sample-certificate.svg',
                'photo': row.get('image_url') or '/static/media/sample-certificate.svg',
                'qr_code': row.get('qr_code') or '/static/media/qrcode.d8c9b936.jpg',
                'remarks': row.get('remarks') or 'Loaded from local documents.json',
                'limitations': row.get('limitations') if isinstance(row.get('limitations'), list) else [],
                'requirements': row.get('requirements') if isinstance(row.get('requirements'), list) else [],
                'capacity': row.get('capacity') or '',
                'verification_type': selected_type,
            }
        }

    if serial_number == '001':
        return {
            'ok': True,
            'data': {
                'serial_number': '001',
                'certificate_no': '001',
                'certificate_number': '001',
                'full_name': 'Test User',
                'certificate_type': 'COP/COC/COE',
                'status': 'active',
                'issue_date': '2026-01-01',
                'expiry_date': '2031-01-01',
                'document_url': '/static/media/sample-certificate.svg',
                'image_url': '/static/media/sample-certificate.svg',
                'remarks': 'Dummy test record from local backend proxy.',
                'verification_type': selected_type,
            }
        }

    return {'status': 404, 'ok': False, 'message': 'serial number does not exist', 'error': 'serial number does not exist', 'data': {}}


@app.route('/api/verify-certificate', methods=['GET', 'POST', 'OPTIONS'])
@app.route('/pub/archive/certificate/verify', methods=['GET', 'POST', 'OPTIONS'])
@app.route('/pub/archive/id_card/verify', methods=['GET', 'POST', 'OPTIONS'])
def verify_certificate_proxy():
    if request.method == 'OPTIONS':
        return add_cors_headers(jsonify({'ok': True})), 200

    payload = request.get_json(silent=True) or {}
    args = request.args.to_dict()
    if isinstance(payload, dict):
        args.update(payload)

    serial_number = (
        args.get('serial_number')
        or args.get('sirb_number')
        or args.get('srn')
        or args.get('certificate_number')
        or args.get('id_number')
        or ''
    ).strip().upper()
    captcha = (args.get('captcha') or '').strip()
    verification_type = (args.get('verification_type') or args.get('type') or '').strip()
    if not verification_type:
        if args.get('srn') or args.get('id_number'):
            verification_type = 'id'
        elif args.get('sirb_number'):
            verification_type = 'sirb'
        elif args.get('certificate_number') or args.get('serial_number') or args.get('legal'):
            verification_type = 'certificate'

    if not serial_number or not captcha:
        return jsonify({'ok': False, 'error': 'serial number and captcha are required'}), 400

    if normalize_verification_type(verification_type) == 'id':
        response_payload = {'ok': False, 'data': {}, 'error': 'Invalid SRN'}
        response = add_cors_headers(jsonify(response_payload))
        return response, 200

    if normalize_verification_type(verification_type) == 'sirb':
        response_payload = {'ok': False, 'data': {}, 'error': 'SIRB not found'}
        response = add_cors_headers(jsonify(response_payload))
        return response, 200

    response_payload = build_certificate_payload(serial_number, verification_type)
    response = add_cors_headers(jsonify(response_payload))
    return response, 200


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
