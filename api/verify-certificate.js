import https from 'https';

const PROJECT_ID = 'abiding-galaxy-9cdv3';
const DATABASE_ID = 'ai-studio-455b21a0-3ed4-45e8-a2ba-944e0f1fcdb0';

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

function normalizeVerificationType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const aliases = {
    sirb: 'sirb',
    sirbnumber: 'sirb',
    'sirb-no': 'sirb',
    sirb_number: 'sirb',
    srn: 'id',
    id: 'id',
    identification: 'id',
    identificationcard: 'id',
    certificate: 'certificate',
    cert: 'certificate',
    certification: 'certificate',
    serial_number: 'certificate',
    certificate_number: 'certificate',
    legal: 'certificate',
  };
  return aliases[normalized] || normalized || 'certificate';
}

function fetchJson(url, options = {}) {
  return new Promise((resolve) => {
    try {
      const req = https.request(url, options, (res) => {
        let rawData = '';
        res.on('data', (chunk) => (rawData += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(rawData);
            resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, data: parsed });
          } catch (e) {
            resolve({ status: res.statusCode, ok: false, data: null });
          }
        });
      });
      req.on('error', (err) => {
        console.error('[HTTP Request Error]', err);
        resolve({ status: 500, ok: false, data: null, error: err });
      });
      if (options.body) {
        req.write(options.body);
      }
      req.end();
    } catch (err) {
      console.error('[fetchJson Exception]', err);
      resolve({ status: 500, ok: false, data: null, error: err });
    }
  });
}

async function fetchFromFirestore(identifier) {
  const clean = identifier.trim().toUpperCase();
  if (!clean) return null;

  try {
    // 1. Direct document key lookup
    const directUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/certificates/${encodeURIComponent(clean)}`;
    const directRes = await fetchJson(directUrl);
    
    if (directRes.ok && directRes.data && directRes.data.fields) {
      const parsed = {};
      for (const [k, v] of Object.entries(directRes.data.fields)) {
        if (v.stringValue !== undefined) parsed[k] = v.stringValue;
        else if (v.integerValue !== undefined) parsed[k] = parseInt(v.integerValue, 10);
        else if (v.booleanValue !== undefined) parsed[k] = v.booleanValue;
        else if (v.arrayValue && v.arrayValue.values) {
          parsed[k] = v.arrayValue.values.map((item) => item.stringValue || item.integerValue || '');
        }
      }
      return parsed;
    }

    // 2. Structured query lookup
    const queryUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents:runQuery`;
    const queryBody = JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'certificates' }],
        limit: 20,
      },
    });

    const qRes = await fetchJson(queryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(queryBody) },
      body: queryBody,
    });

    if (qRes.ok && Array.isArray(qRes.data)) {
      for (const entry of qRes.data) {
        if (entry.document && entry.document.fields) {
          const fields = entry.document.fields;
          const parsed = {};
          for (const [k, v] of Object.entries(fields)) {
            if (v.stringValue !== undefined) parsed[k] = v.stringValue;
            else if (v.integerValue !== undefined) parsed[k] = parseInt(v.integerValue, 10);
            else if (v.booleanValue !== undefined) parsed[k] = v.booleanValue;
            else if (v.arrayValue && v.arrayValue.values) {
              parsed[k] = v.arrayValue.values.map((item) => item.stringValue || item.integerValue || '');
            }
          }
          const s1 = String(parsed.serial_number || '').trim().toUpperCase();
          const s2 = String(parsed.certificate_no || parsed.certificate_number || '').trim().toUpperCase();
          if (s1 === clean || s2 === clean) {
            return parsed;
          }
        }
      }
    }
  } catch (err) {
    console.error('[Firestore API lookup error]', err);
  }
  return null;
}

async function parseIncomingParams(req) {
  const params = {};

  // Extract from query object if present
  if (req.query && typeof req.query === 'object') {
    Object.assign(params, req.query);
  }

  // Extract from URL query string if present
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

  // Extract from body if already parsed
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
    // Read stream if body was not parsed by middleware
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
    // CORS support
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

    const query = await parseIncomingParams(req);
    const serialNumber = (
      query.serial_number ||
      query.sirb_number ||
      query.srn ||
      query.certificate_number ||
      query.certificate_no ||
      query.legal ||
      query.id_number ||
      ''
    ).toString().trim();

    let verificationType = (query.verification_type || query.type || '').toString().trim();
    if (!verificationType) {
      if (query.srn || query.id_number) {
        verificationType = 'id';
      } else if (query.sirb_number) {
        verificationType = 'sirb';
      } else if (query.certificate_number || query.serial_number || query.legal) {
        verificationType = 'certificate';
      }
    }

    const selectedType = normalizeVerificationType(verificationType);

    if (!serialNumber) {
      return sendJson(res, 400, {
        status: 400,
        ok: false,
        error: 'serial number is required',
        message: 'Serial number is required',
      });
    }

    if (selectedType === 'id') {
      return sendJson(res, 404, {
        status: 404,
        ok: false,
        data: {},
        message: 'Invalid SRN',
        error: { message: 'Invalid SRN' },
      });
    }

    if (selectedType === 'sirb') {
      return sendJson(res, 404, {
        status: 404,
        ok: false,
        data: {},
        message: 'SIRB not found',
        error: { message: 'SIRB not found' },
      });
    }

    const doc = await fetchFromFirestore(serialNumber);

    if (doc) {
      const fullName = doc.full_name || doc.name || 'Unknown';
      const parts = fullName.split(/\s+/).filter(Boolean);
      const firstName = doc.first_name || parts[0] || 'Unknown';
      const lastName = doc.last_name || (parts.length > 1 ? parts[parts.length - 1] : '');
      const middleName = doc.middle_name || (parts.length > 2 ? parts.slice(1, -1).join(' ') : '');

      const recordData = {
        serial_number: String(doc.serial_number || serialNumber),
        certificate_no: String(doc.certificate_no || doc.certificate_number || doc.serial_number || serialNumber),
        certificate_number: String(doc.certificate_number || doc.certificate_no || doc.serial_number || serialNumber),
        full_name: fullName,
        name: fullName,
        first_name: firstName,
        middle_name: middleName,
        last_name: lastName,
        certificate_type: doc.certificate_type || 'Certificate',
        title_of_certificate: doc.title_of_certificate || doc.certificate_type || 'Certificate',
        title: doc.title_of_certificate || doc.certificate_type || 'Certificate',
        function: doc.function || 'N/A',
        level_of_responsibility: doc.level_of_responsibility || doc['Level of Responsibility'] || 'N/A',
        level: doc.level_of_responsibility || doc['Level of Responsibility'] || 'N/A',
        regulation_no: doc.regulation_no || 'N/A',
        regulation: doc.regulation_no || 'N/A',
        regulation_number: doc.regulation_no || 'N/A',
        capacity: doc.capacity || '',
        status: doc.status || 'VALID',
        issue_date: doc.issue_date || '',
        date_issued: doc.issue_date || '',
        expiry_date: doc.expiry_date || '',
        date_expiry: doc.expiry_date || '',
        revalidation_date: doc.revalidation_date || '',
        document_url: doc.document_url || doc.image_url || '/officer_image/adamu.png',
        image_url: doc.image_url || doc.document_url || '/officer_image/adamu.png',
        photo: doc.image_url || doc.document_url || '/officer_image/adamu.png',
        qr_code: doc.qr_code || '/static/media/sample-certificate.svg',
        remarks: doc.remarks || 'Verified Record',
        limitations: Array.isArray(doc.limitations) ? doc.limitations : [],
        requirements: Array.isArray(doc.requirements) ? doc.requirements : [],
        verification_type: selectedType,
      };

      return sendJson(res, 200, {
        status: 200,
        ok: true,
        data: recordData,
        message: 'Document found',
      });
    }

    return sendJson(res, 404, {
      status: 404,
      ok: false,
      data: {},
      message: 'Document not found',
      error: { message: 'Document not found' },
    });
  } catch (globalError) {
    console.error('[Unhandled API Error in verify-certificate]', globalError);
    return sendJson(res, 500, {
      status: 500,
      ok: false,
      data: {},
      message: 'Internal server error occurred during verification',
      error: { message: globalError?.message || 'Internal Server Error' },
    });
  }
}
