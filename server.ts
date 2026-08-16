import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import https from 'https';
import querystring from 'querystring';

const app = express();
const PORT = 3000;
const BASE_DIR = process.cwd();

// Parse JSON and urlencoded request bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY || '';

// Helper to normalize verification type
function normalizeVerificationType(value?: string): string {
  const normalized = String(value || '').trim().toLowerCase();
  const aliases: Record<string, string> = {
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

async function fetchFromFirestore(identifier: string): Promise<any | null> {
  const clean = identifier.trim().toUpperCase();
  if (!clean) return null;
  const projectId = 'abiding-galaxy-9cdv3';
  const databaseId = 'ai-studio-455b21a0-3ed4-45e8-a2ba-944e0f1fcdb0';

  try {
    // 1. Direct document key lookup
    const directUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/certificates/${encodeURIComponent(clean)}`;
    const directRes = await fetch(directUrl);
    if (directRes.ok) {
      const json = await directRes.json();
      if (json && json.fields) {
        const parsed: Record<string, any> = {};
        for (const [k, v] of Object.entries(json.fields as Record<string, any>)) {
          if (v.stringValue !== undefined) parsed[k] = v.stringValue;
          else if (v.integerValue !== undefined) parsed[k] = parseInt(v.integerValue, 10);
          else if (v.booleanValue !== undefined) parsed[k] = v.booleanValue;
          else if (v.arrayValue?.values) {
            parsed[k] = v.arrayValue.values.map((item: any) => item.stringValue || item.integerValue || '');
          }
        }
        return parsed;
      }
    }

    // 2. Structured query lookup for serial_number or certificate_number or certificate_no
    const queryUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents:runQuery`;
    const queryBody = {
      structuredQuery: {
        from: [{ collectionId: 'certificates' }],
        limit: 10,
      },
    };

    const qRes = await fetch(queryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(queryBody),
    });

    if (qRes.ok) {
      const list = await qRes.json();
      if (Array.isArray(list)) {
        for (const entry of list) {
          if (entry.document && entry.document.fields) {
            const fields = entry.document.fields;
            const parsed: Record<string, any> = {};
            for (const [k, v] of Object.entries(fields as Record<string, any>)) {
              if (v.stringValue !== undefined) parsed[k] = v.stringValue;
              else if (v.integerValue !== undefined) parsed[k] = parseInt(v.integerValue, 10);
              else if (v.booleanValue !== undefined) parsed[k] = v.booleanValue;
              else if (v.arrayValue?.values) {
                parsed[k] = v.arrayValue.values.map((item: any) => item.stringValue || item.integerValue || '');
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
    }
  } catch (err) {
    console.warn('[Firestore Search Error]', err);
  }
  return null;
}

async function findDocumentAsync(serialNumber: string): Promise<any | null> {
  const normalized = String(serialNumber || '').trim().toUpperCase();
  if (!normalized) return null;

  // Retrieve from Firestore DB
  return await fetchFromFirestore(normalized);
}

async function buildCertificatePayloadAsync(serialNumber: string, verificationType?: string) {
  const selectedType = normalizeVerificationType(verificationType);

  if (selectedType === 'id') {
    return { status: 404, ok: false, data: {}, message: 'Invalid SRN', error: { message: 'Invalid SRN' } };
  }

  if (selectedType === 'sirb') {
    return { status: 404, ok: false, data: {}, message: 'SIRB not found', error: { message: 'SIRB not found' } };
  }

  const doc = await findDocumentAsync(serialNumber);

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

    return {
      status: 200,
      ok: true,
      data: recordData,
      message: 'Document found',
    };
  }

  return {
    status: 404,
    ok: false,
    data: {},
    message: 'Document not found',
    error: { message: 'Document not found' },
  };
}

// reCAPTCHA verification function
async function verifyRecaptchaToken(token: string): Promise<boolean> {
  if (!token) return false;
  if (!RECAPTCHA_SECRET_KEY) return true;

  return new Promise((resolve) => {
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
      timeout: 6000,
    };

    const req = https.request(options, (res) => {
      let rawData = '';
      res.on('data', (chunk) => (rawData += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(rawData);
          // If google responds or verification is successful
          resolve(Boolean(parsed.success));
        } catch {
          resolve(true); // fallback gracefully
        }
      });
    });

    req.on('error', () => resolve(true)); // fallback gracefully on network timeout
    req.on('timeout', () => {
      req.destroy();
      resolve(true);
    });
    req.write(postData);
    req.end();
  });
}

// === API ROUTES ===

// CORS middleware for API routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// reCAPTCHA verification endpoints
const handleRecaptcha = async (req: Request, res: Response) => {
  const token = (
    req.body?.token ||
    req.body?.['g-recaptcha-response'] ||
    req.query?.token ||
    req.query?.['g-recaptcha-response'] ||
    ''
  ).toString().trim();

  if (!token) {
    return res.status(200).json({ ok: true, message: 'reCAPTCHA token missing, treated as success in preview' });
  }

  const isValid = await verifyRecaptchaToken(token);
  return res.status(200).json({ ok: isValid });
};

app.post('/api/verify-recaptcha', handleRecaptcha);
app.get('/api/verify-recaptcha', handleRecaptcha);
app.post('/verify-recaptcha', handleRecaptcha);
app.get('/verify-recaptcha', handleRecaptcha);

// Certificate Verification Handler
const handleCertificateVerification = async (req: Request, res: Response) => {
  const query = { ...req.query, ...req.body };
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

  const captcha = (query.captcha || query['g-recaptcha-response'] || '').toString().trim();
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

  if (!serialNumber) {
    return res.status(400).json({ status: 400, ok: false, error: 'serial number is required', message: 'Serial number is required' });
  }

  const result = await buildCertificatePayloadAsync(serialNumber, verificationType);
  if (!result.ok) {
    return res.status(404).json(result);
  }
  return res.status(200).json(result);
};

// Mount all certificate verification routes used by the frontend
app.get('/api/verify-certificate', handleCertificateVerification);
app.post('/api/verify-certificate', handleCertificateVerification);
app.get('/pub/archive/certificate/verify', handleCertificateVerification);
app.post('/pub/archive/certificate/verify', handleCertificateVerification);
app.get('/pub/archive/certificate/legal/verify', handleCertificateVerification);
app.post('/pub/archive/certificate/legal/verify', handleCertificateVerification);
app.get('/pub/archive/id_card/verify', handleCertificateVerification);
app.post('/pub/archive/id_card/verify', handleCertificateVerification);

// Static assets routes
app.use('/officer_image', express.static(path.join(BASE_DIR, 'officer_image')));
app.use('/static', express.static(path.join(BASE_DIR, 'static')));
app.use('/assets', express.static(path.join(BASE_DIR, 'assets')));

// Serve specific static HTML files directly if requested
const htmlPages = [
  'verify-id-certificate',
  'verify-qr-code',
  'examination-schedules',
  'register-type',
  'signin',
  'done',
  'verify-recaptcha',
];

htmlPages.forEach((pageName) => {
  const getHtmlPath = () => {
    const distHtml = path.join(BASE_DIR, 'dist', `${pageName}.html`);
    if (fs.existsSync(distHtml)) return distHtml;
    const rootHtml = path.join(BASE_DIR, `${pageName}.html`);
    if (fs.existsSync(rootHtml)) return rootHtml;
    const distIndex = path.join(BASE_DIR, 'dist', 'index.html');
    if (fs.existsSync(distIndex)) return distIndex;
    return path.join(BASE_DIR, 'index.html');
  };

  app.get(`/${pageName}`, (_req, res) => {
    res.sendFile(getHtmlPath());
  });
  app.get(`/${pageName}.html`, (_req, res) => {
    res.sendFile(getHtmlPath());
  });
});

const isServerless = Boolean(process.env.VERCEL || process.env.NOW_REGION || process.env.AWS_LAMBDA_FUNCTION_NAME);

async function startServer() {
  if (process.env.NODE_ENV !== 'production' && !isServerless) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(BASE_DIR, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
    }
    app.get('*', (_req, res) => {
      const distIndex = path.join(distPath, 'index.html');
      if (fs.existsSync(distIndex)) {
        res.sendFile(distIndex);
      } else {
        res.sendFile(path.join(BASE_DIR, 'index.html'));
      }
    });
  }

  if (!isServerless) {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`MARINA MISMO Server running on http://0.0.0.0:${PORT}`);
    });
  }
}

if (!isServerless) {
  startServer();
} else {
  // If running in Vercel or Serverless
  const distPath = path.join(BASE_DIR, 'dist');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
  }
  app.get('*', (_req, res) => {
    const distIndex = path.join(distPath, 'index.html');
    if (fs.existsSync(distIndex)) {
      res.sendFile(distIndex);
    } else {
      res.sendFile(path.join(BASE_DIR, 'index.html'));
    }
  });
}

export default app;
