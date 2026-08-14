from server import app

client = app.test_client()
for serial in ['DOC-1001', 'DOC-1002']:
    resp = client.get(f'/api/verify-certificate?serial_number={serial}&captcha=test')
    payload = resp.get_json()
    print(serial, payload['data']['first_name'], payload['data']['middle_name'], payload['data']['last_name'], payload['data']['image_url'])
