import https from 'https';
import querystring from 'querystring';

const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY || '';

function sendJson(res, statusCode, data) {
  try {
    if (typeof res.status === 'function' && typeof res.json === 'function') {
      return res.status(statusCode).json(data);
    }
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end(JSON.stringify(data));
  } catch (e) {
    try {
      res.statusCode = statusCode;
      res.end(JSON.stringify(data));
    } catch (_) {}
  }
}

async function parseIncomingParams(req) {
  const params = {};

  if (req.query && typeof req.query === 'object') {
    Object.assign(params, req.query);
  }

  try {
    const rawUrl = req.url || '';
    const qIndex = rawUrl.indexOf('?');
    if (qIndex !== -1) {
      const searchParams = new URLSearchParams(rawUrl.slice(qIndex));
      for (const [k, v] of searchParams.entries()) {
        if (!params[k]) params[k] = v;
      }
    }
  } catch (_) {}

  if (req.body) {
    if (typeof req.body === 'object') {
      Object.assign(params, req.body);
    } else if (typeof req.body === 'string') {
      try {
        const parsed = JSON.parse(req.body);
        if (parsed && typeof parsed === 'object') Object.assign(params, parsed);
      } catch (_) {
        const bodyParams = new URLSearchParams(req.body);
        for (const [k, v] of bodyParams.entries()) {
          if (!params[k]) params[k] = v;
        }
      }
    }
  } else if (req.method === 'POST' || req.method === 'PUT') {
    try {
      const raw = await new Promise((resolve) => {
        let str = '';
        req.on('data', (chunk) => (str += chunk));
        req.on('end', () => resolve(str));
        req.on('error', () => resolve(''));
      });
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') Object.assign(params, parsed);
        } catch (_) {
          const bodyParams = new URLSearchParams(raw);
          for (const [k, v] of bodyParams.entries()) {
            if (!params[k]) params[k] = v;
          }
        }
      }
    } catch (_) {}
  }

  return params;
}

export default async function handler(req, res) {
  try {
    if (typeof res.setHeader === 'function') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }

    if (req.method === 'OPTIONS') {
      if (typeof res.status === 'function') return res.status(200).end();
      if (typeof res.writeHead === 'function') {
        res.writeHead(200);
        return res.end();
      }
      return;
    }

    const params = await parseIncomingParams(req);
    const token = params.token || params.response || '';

    if (!token) {
      return sendJson(res, 400, { ok: false, error: 'missing token' });
    }

    if (!RECAPTCHA_SECRET_KEY) {
      return sendJson(res, 200, { ok: true, message: 'reCAPTCHA verification skipped (no secret configured)' });
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

    return new Promise((resolve) => {
      try {
        const request = https.request(options, (verifyRes) => {
          let rawData = '';
          verifyRes.on('data', (chunk) => {
            rawData += chunk;
          });
          verifyRes.on('end', () => {
            try {
              const parsedData = JSON.parse(rawData);
              sendJson(res, 200, { ok: Boolean(parsedData.success) });
            } catch (e) {
              sendJson(res, 200, { ok: false, error: 'verification response parsing failed' });
            }
            resolve();
          });
        });

        request.on('error', () => {
          sendJson(res, 200, { ok: false, error: 'verification request failed' });
          resolve();
        });

        request.write(postData);
        request.end();
      } catch (err) {
        sendJson(res, 200, { ok: false, error: 'verification request exception' });
        resolve();
      }
    });
  } catch (err) {
    console.error('[Unhandled API Error in verify-recaptcha]', err);
    return sendJson(res, 500, { ok: false, error: err?.message || 'internal server error' });
  }
}
