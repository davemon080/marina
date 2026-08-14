import json
import os
import unittest

import server
from server import app, build_verify_response


class RecaptchaEndpointTests(unittest.TestCase):
    def test_missing_token_returns_error(self):
        response, status = build_verify_response({}, secret_key='test-secret')
        self.assertFalse(response['ok'])
        self.assertEqual(status, 400)
        self.assertEqual(response['error'], 'missing token')

    def test_non_empty_token_is_accepted_when_secret_is_not_configured(self):
        response, status = build_verify_response({'token': 'sample-token'}, secret_key=None)
        self.assertTrue(response['ok'])
        self.assertEqual(status, 200)

    def test_root_page_serves_html(self):
        client = app.test_client()
        response = client.get('/')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'Welcome to the MARINA', response.data)

    def test_signin_page_serves_html(self):
        client = app.test_client()
        response = client.get('/signin')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'Sign In', response.data)

    def test_signin_page_includes_recaptcha_loader_hook(self):
        client = app.test_client()
        response = client.get('/signin')
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        self.assertIn('https://www.google.com/recaptcha/api.js?onload=initRecaptcha', html)
        self.assertIn('initRecaptcha', html)

    def test_verify_certificate_proxy_returns_dummy_record_for_serial_001(self):
        client = app.test_client()
        response = client.get('/api/verify-certificate?serial_number=001&captcha=test')
        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.data.decode('utf-8'))
        self.assertTrue(payload['ok'])
        self.assertEqual(payload['data']['serial_number'], '001')
        self.assertEqual(payload['data']['status'], 'active')

    def test_root_json_document_is_not_publicly_served(self):
        client = app.test_client()
        response = client.get('/documents.json')
        self.assertEqual(response.status_code, 404)

    def test_verify_certificate_page_serves_html(self):
        client = app.test_client()
        response = client.get('/verify-id-certificate')
        self.assertEqual(response.status_code, 200)
        self.assertIn('text/html', response.content_type)
        self.assertIn('Sign In', response.get_data(as_text=True))

    def test_certificate_proxy_returns_dummy_data_for_serial_001(self):
        client = app.test_client()
        response = client.get('/api/verify-certificate?serial_number=001&captcha=test')
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['ok'])
        self.assertEqual(payload['data']['serial_number'], '001')
        self.assertIn('Test', payload['data']['full_name'])

    def test_verify_id_certificate_page_serves_html(self):
        client = app.test_client()
        response = client.get('/verify-id-certificate')
        self.assertEqual(response.status_code, 200)
        self.assertIn('text/html', response.content_type)

    def test_verify_certificate_always_fails_for_sirb(self):
        client = app.test_client()
        response = client.get('/api/verify-certificate?serial_number=001&captcha=test&verification_type=sirb')
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertFalse(payload['ok'])
        self.assertEqual(payload['error'], 'SIRB not found')

    def test_verify_certificate_returns_invalid_srn_for_id_verification(self):
        client = app.test_client()
        response = client.get('/api/verify-certificate?serial_number=999&captcha=test&verification_type=id')
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertFalse(payload['ok'])
        self.assertEqual(payload['error'], 'Invalid SRN')

    def test_verify_certificate_returns_invalid_srn_for_id_verification(self):
        client = app.test_client()
        response = client.get('/api/verify-certificate?serial_number=DOC-1001&captcha=test&verification_type=id')
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertFalse(payload['ok'])
        self.assertEqual(payload['error'], 'Invalid SRN')

    def test_verify_certificate_reads_local_documents_json(self):
        client = app.test_client()
        response = client.get('/api/verify-certificate?serial_number=DOC-1001&captcha=test')
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['ok'])
        self.assertEqual(payload['data']['serial_number'], 'DOC-1001')
        self.assertEqual(payload['data']['certificate_number'], 'CERT-1001')
        self.assertEqual(payload['data']['full_name'], 'Maria Santos')
        self.assertEqual(payload['data']['first_name'], 'Maria')
        self.assertEqual(payload['data']['last_name'], 'Santos')
        self.assertEqual(payload['data']['title'], 'COP/COC/COE')
        self.assertEqual(payload['data']['date_issued'], '2026-01-01')
        self.assertEqual(payload['data']['date_expiry'], '2031-01-01')
        self.assertEqual(payload['data']['photo'], '/static/media/sample-certificate.svg')
        self.assertEqual(payload['data']['qr_code'], '/static/media/qrcode.d8c9b936.jpg')
        self.assertEqual(payload['data']['image_url'], '/static/media/sample-certificate.svg')

    def test_verify_certificate_returns_pending_order_fields(self):
        client = app.test_client()
        response = client.get('/api/verify-certificate?serial_number=DOC-1002&captcha=test')
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['ok'])
        self.assertEqual(payload['data']['title_of_certificate'], 'Certificate of Pending Orders')
        self.assertEqual(payload['data']['title'], 'Certificate of Pending Orders')
        self.assertEqual(payload['data']['date_issued'], '2026-01-15')
        self.assertEqual(payload['data']['photo'], '/static/media/sample-certificate.svg')
        self.assertEqual(payload['data']['image_url'], '/static/media/sample-certificate.svg')

    def test_verify_certificate_exposes_frontend_alias_fields(self):
        client = app.test_client()
        response = client.get('/api/verify-certificate?serial_number=DOC-1001&captcha=test')
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['ok'])
        self.assertEqual(payload['data']['level'], 'Chief Mate')
        self.assertEqual(payload['data']['regulation_number'], 'STCW Convention')
        self.assertEqual(payload['data']['limitations'], ['Valid for sea-going service', 'Subject to medical fitness'])

    def test_verify_certificate_rejects_sirb_number_parameter(self):
        client = app.test_client()
        response = client.get('/api/verify-certificate?sirb_number=DOC-1001&captcha=test&verification_type=sirb')
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertFalse(payload['ok'])
        self.assertEqual(payload['error'], 'SIRB not found')

    def test_load_environment_from_dotenv_loads_supabase_values(self):
        server.load_environment_from_dotenv()
        self.assertTrue(bool(os.environ.get('SUPABASE_URL', '')))


if __name__ == '__main__':
    unittest.main()
