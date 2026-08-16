const https = require('https');
const querystring = require('querystring');

const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY || '6LcuU3gtAAAAABPNnmJhFV0x73lo1LKymnOOf_2I';

module.exports = async (req, res) => {
  const getValue = (source, key) => {
    if (!source) return '';
    if (typeof source === 'string') return source;
    if (typeof source === 'object') {
      const value = source[key];
      if (typeof value === 'string') return value;
      if (value !== undefined && value !== null) return String(value);
    }
    return '';
  };

  const parseBody = (body) => {
    if (!body) return {};
    if (typeof body === 'string') {
      try {
        return JSON.parse(body);
      } catch (error) {
        return {};
      }
    }
    return body;
  };

  const body = parseBody(req.body || {});
  const token = getValue(req.query, 'token') || getValue(body, 'token');

  if (!token) {
    res.status(400).json({ ok: false, error: 'missing token' });
    return;
  }

  if (!RECAPTCHA_SECRET_KEY) {
    res.status(200).json({ ok: true, message: 'reCAPTCHA verification skipped (no secret configured)' });
    return;
  }

  const postData = querystring.stringify({
    secret: RECAPTCHA_SECRET_KEY,
    response: token,
  });

  const options = {
    hostname: 'www.google.com',
    port: 443,
    path: '/recaptcha/api/siteverify',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData),
    },
  };

  const request = https.request(options, (verifyRes) => {
    let rawData = '';
    verifyRes.on('data', (chunk) => {
      rawData += chunk;
    });
    verifyRes.on('end', () => {
      try {
        const parsedData = JSON.parse(rawData);
        res.status(200).json({ ok: Boolean(parsedData.success) });
      } catch (e) {
        res.status(200).json({ ok: false, error: 'verification response parsing failed' });
      }
    });
  });

  request.on('error', () => {
    res.status(200).json({ ok: false, error: 'verification request failed' });
  });

  request.write(postData);
  request.end();
};
