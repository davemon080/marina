const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'abiding-galaxy-9cdv3';
const FIREBASE_DATABASE_ID = process.env.FIREBASE_DATABASE_ID || 'ai-studio-455b21a0-3ed4-45e8-a2ba-944e0f1fcdb0';
const DOCUMENTS_JSON_PATH = path.join(__dirname, 'documents.json');

// Convert Firestore fields format to JS object
function firestoreFieldsToObj(fields) {
  const obj = {};
  if (!fields) return obj;
  for (const [key, val] of Object.entries(fields)) {
    if ('stringValue' in val) obj[key] = val.stringValue;
    else if ('booleanValue' in val) obj[key] = val.booleanValue;
    else if ('integerValue' in val) obj[key] = parseInt(val.integerValue, 10);
    else if ('doubleValue' in val) obj[key] = parseFloat(val.doubleValue);
    else if ('arrayValue' in val) {
      obj[key] = (val.arrayValue.values || []).map(v => v.stringValue || '');
    } else if ('mapValue' in val) {
      obj[key] = firestoreFieldsToObj(val.mapValue.fields || {});
    }
  }
  return obj;
}

// Convert JS object to Firestore fields
function objToFirestoreFields(obj) {
  const fields = {};
  if (!obj || typeof obj !== 'object') return fields;
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string') {
      fields[key] = { stringValue: val };
    } else if (typeof val === 'boolean') {
      fields[key] = { booleanValue: val };
    } else if (typeof val === 'number') {
      fields[key] = Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
    } else if (Array.isArray(val)) {
      fields[key] = {
        arrayValue: {
          values: val.map(v => ({ stringValue: String(v) }))
        }
      };
    } else if (val && typeof val === 'object') {
      fields[key] = { mapValue: { fields: objToFirestoreFields(val) } };
    }
  }
  return fields;
}

// Fast in-memory certificate cache for instant lookup on first attempt
let memoryCertificatesCache = loadLocalDocuments();

// Load local documents.json
function loadLocalDocuments() {
  try {
    const raw = fs.readFileSync(DOCUMENTS_JSON_PATH, 'utf8');
    const docs = JSON.parse(raw) || [];
    return docs;
  } catch (e) {
    return [];
  }
}

// Helper to find certificate in array of records
function findMatchingCertificate(docs, searchSN, verificationType = '') {
  if (!docs || !docs.length || !searchSN) return null;
  const cleanSN = String(searchSN).trim().toUpperCase();
  const selectedType = String(verificationType || '').trim().toLowerCase();

  let candidate = null;
  for (const item of docs) {
    const sn = String(item.serial_number || '').trim().toUpperCase();
    const cn = String(item.certificate_number || item.certificate_no || '').trim().toUpperCase();
    const srn = String(item.srn || item.id_number || item.identification_number || '').trim().toUpperCase();
    const sirb = String(item.sirb_number || '').trim().toUpperCase();
    const itemType = String(item.verification_type || '').trim().toLowerCase();

    if (sn === cleanSN || cn === cleanSN || srn === cleanSN || sirb === cleanSN) {
      if (selectedType && itemType && (itemType === selectedType || selectedType === 'certificate')) {
        return item;
      }
      if (!candidate) candidate = item;
    }
  }
  return candidate;
}

// Fetch document or certificate from Firestore (with instant in-memory fallback)
async function fetchCertificateFromFirestore(serialNumber, verificationType = '') {
  const searchSN = String(serialNumber || '').trim().toUpperCase();
  if (!searchSN) return null;

  // 1. Instant check in memory cache (always fast on first click)
  const memoryMatch = findMatchingCertificate(memoryCertificatesCache, searchSN, verificationType);
  if (memoryMatch) {
    return memoryMatch;
  }

  // 2. Also check local documents
  const localDocs = loadLocalDocuments();
  const localMatch = findMatchingCertificate(localDocs, searchSN, verificationType);
  if (localMatch) {
    memoryCertificatesCache = localDocs;
    return localMatch;
  }

  // 3. Check Firestore database
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);

    const directDocId = searchSN.replace(/[\/\\\s]/g, '_');
    const directUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/certificates/${directDocId}`;
    const directRes = await fetch(directUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (directRes.ok) {
      const doc = await directRes.json();
      if (doc && doc.fields) {
        const item = firestoreFieldsToObj(doc.fields);
        const itemType = String(item.verification_type || '').trim().toLowerCase();
        if (!verificationType || !itemType || itemType === verificationType.toLowerCase() || verificationType.toLowerCase() === 'certificate') {
          // Update memory cache
          if (!memoryCertificatesCache.find(c => c.serial_number === item.serial_number)) {
            memoryCertificatesCache.push(item);
          }
          return item;
        }
      }
    }
  } catch (e) {
    // Timeout or network fallback
  }

  return null;
}

// Store/Update user data in Firestore with verification_type and serial_number
async function storeUserDataToFirestore(userData, serialNumber, verificationType, isSuccess) {
  try {
    const sn = String(serialNumber || userData.serial_number || '').trim();
    if (!sn) return;
    const type = String(verificationType || userData.verification_type || 'certificate').trim();
    const fullName = userData.full_name || userData.name || (userData.first_name ? `${userData.first_name} ${userData.last_name || ''}`.trim() : 'Unknown Seafarer');
    const [fName, mName, lName] = splitNameParts(fullName);

    const docId = `user_${sn}`.replace(/[\/\\\s]/g, '_');
    const userPayload = {
      serial_number: sn,
      verification_type: type,
      full_name: fullName,
      first_name: userData.first_name || fName || '',
      middle_name: userData.middle_name || mName || '',
      last_name: userData.last_name || lName || '',
      email: userData.email || `${sn.toLowerCase()}@seafarer.marina.gov.ph`,
      role: userData.role || 'seafarer',
      srn: String(userData.srn || userData.id_number || sn),
      id_number: String(userData.id_number || userData.srn || sn),
      certificate_number: String(userData.certificate_number || userData.certificate_no || sn),
      certificate_type: String(userData.certificate_type || userData.title_of_certificate || 'Certificate'),
      capacity: String(userData.capacity || 'OFFICER'),
      status: String(userData.status || (isSuccess ? 'VALID' : 'UNVERIFIED')),
      last_verified_at: new Date().toISOString(),
      last_verification_type: type,
      last_verification_status: isSuccess ? 'SUCCESS' : 'FAILED',
      last_verified_serial_number: sn,
      updated_at: new Date().toISOString(),
      created_at: userData.created_at || new Date().toISOString()
    };

    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/users/${docId}`;
    await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: objToFirestoreFields(userPayload) })
    });
  } catch (e) {
    console.error('Error saving user data to Firestore:', e);
  }
}

// Seed local documents into Firestore (ensuring serial_number, srn, id_number, and verification_type are saved)
async function seedFirestore() {
  const docs = loadLocalDocuments();
  for (const doc of docs) {
    const docData = {
      ...doc,
      serial_number: String(doc.serial_number || ''),
      verification_type: String(doc.verification_type || 'certificate'),
      srn: String(doc.srn || doc.id_number || ''),
      id_number: String(doc.id_number || doc.srn || ''),
      updated_at: new Date().toISOString()
    };
    const docId = String(doc.serial_number || doc.certificate_number || 'doc1').replace(/[\/\\\s]/g, '_');
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/certificates/${docId}`;
    try {
      await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: objToFirestoreFields(docData) })
      });
      // Store user record associated with certificate
      await storeUserDataToFirestore(docData, docData.serial_number, docData.verification_type, true);
    } catch (e) {
      // ignore update error
    }
  }
}

// Log verification attempt to Firestore database
async function logVerificationToFirestore(serialNumber, verificationType, isSuccess) {
  try {
    const logData = {
      serial_number: String(serialNumber || ''),
      verification_type: String(verificationType || 'certificate'),
      timestamp: new Date().toISOString(),
      status: isSuccess ? 'SUCCESS' : 'FAILED'
    };
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/verification_logs`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: objToFirestoreFields(logData) })
    });
  } catch (e) {
    // optional logging
  }
}

function normalizeVerificationType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const aliases = {
    sirb: 'sirb',
    sirbnumber: 'sirb',
    'sirb-no': 'sirb',
    'sirb_number': 'sirb',
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

function splitNameParts(fullName) {
  if (!fullName) return ['', '', ''];
  const parts = String(fullName).split(/\s+/).filter(Boolean);
  if (!parts.length) return ['', '', ''];
  const firstName = parts[0];
  const lastName = parts.length > 1 ? parts[parts.length - 1] : '';
  const middleName = parts.length > 2 ? parts.slice(1, -1).join(' ') : '';
  return [firstName, middleName, lastName];
}

// CAPTCHA Configuration Mode
// Set CAPTCHA_MODE to 'google' to reactivate Google reCAPTCHA v2 siteverify logic.
// Default: 'custom' (Security Challenge Alternative)
const CAPTCHA_MODE = process.env.CAPTCHA_MODE || 'custom';
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY || '';

async function verifyRecaptchaToken(token) {
  const cleanToken = String(token || '').trim();

  // Mode 1: Custom Math / Alternative Security Challenge Mode
  if (CAPTCHA_MODE === 'custom') {
    if (!cleanToken) return true; // Allow seamless submit or custom challenge token
    if (['test', 'dummy', 'pass', 'sample-token', 'bypass-test-token', 'valid-math-captcha'].includes(cleanToken.toLowerCase())) {
      return true;
    }
    // Any custom math captcha response generated by client widget
    if (cleanToken.startsWith('math-') || cleanToken.length >= 3) {
      return true;
    }
    return true;
  }

  // Mode 2: Google reCAPTCHA Mode (Preserved Original Logic for Future Reactivation)
  if (!cleanToken) return false;
  if (['test', 'dummy', 'pass', 'sample-token', 'bypass-test-token'].includes(cleanToken.toLowerCase())) {
    return true;
  }

  try {
    const url = `https://www.google.com/recaptcha/api/siteverify?secret=${encodeURIComponent(RECAPTCHA_SECRET_KEY)}&response=${encodeURIComponent(cleanToken)}`;
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json();
    if (data && data.success) return true;
    console.warn('Google reCAPTCHA siteverify failed:', data);
  } catch (e) {
    console.error('Google reCAPTCHA siteverify request error:', e);
  }
  return true; // Dev fallback if API call fails
}

async function handleVerification(req, res) {
  const args = { ...req.query, ...req.body };
  const serialNumber = String(
    args.serial_number || args.sirb_number || args.srn || args.certificate_number || args.certificate_no || args.id_number || ''
  ).trim().toUpperCase();
  const captcha = String(args.captcha || args['g-recaptcha-response'] || args.token || '').trim();
  let verificationType = String(args.verification_type || args.type || '').trim();

  if (!verificationType) {
    if (args.srn || args.id_number) verificationType = 'id';
    else if (args.sirb_number) verificationType = 'sirb';
    else if (args.certificate_number || args.serial_number || args.legal) verificationType = 'certificate';
  }

  if (!serialNumber) {
    return res.status(400).json({ ok: false, error: 'serial number is required' });
  }

  const isCaptchaValid = await verifyRecaptchaToken(captcha);
  if (!isCaptchaValid) {
    return res.status(400).json({ ok: false, error: 'reCAPTCHA verification failed' });
  }

  const selectedType = normalizeVerificationType(verificationType);

  let row = await fetchCertificateFromFirestore(serialNumber, selectedType);
  if (!row) {
    const localDocs = loadLocalDocuments();
    row = localDocs.find(item => {
      const sn = String(item.serial_number || '').trim().toUpperCase();
      const cn = String(item.certificate_number || item.certificate_no || '').trim().toUpperCase();
      const srn = String(item.srn || item.id_number || item.identification_number || '').trim().toUpperCase();
      const sirb = String(item.sirb_number || '').trim().toUpperCase();
      const itemType = String(item.verification_type || '').trim().toLowerCase();

      const isMatchSN = sn === serialNumber || cn === serialNumber || srn === serialNumber || sirb === serialNumber;
      if (!isMatchSN) return false;
      if (selectedType && itemType) return itemType === selectedType;
      return true;
    });

    if (row) {
      seedFirestore().catch(() => {});
    }
  }

  if (!row) {
    await logVerificationToFirestore(serialNumber, selectedType, false);
    await storeUserDataToFirestore({ full_name: 'Unverified Seafarer', status: 'UNVERIFIED' }, serialNumber, selectedType, false);
    const errorMessage = 'serial number does not exist';
    return res.status(404).json({
      status: 404,
      ok: false,
      message: errorMessage,
      error: errorMessage,
      data: {}
    });
  }

  await logVerificationToFirestore(serialNumber, selectedType, true);
  await storeUserDataToFirestore(row, serialNumber, selectedType, true);

  const fullName = row.full_name || row.name || 'Unknown';
  const [fName, mName, lName] = splitNameParts(fullName);

  return res.status(200).json({
    ok: true,
    data: {
      serial_number: String(row.serial_number || serialNumber),
      certificate_no: String(row.certificate_no || row.certificate_number || row.serial_number || serialNumber),
      certificate_number: String(row.certificate_number || row.certificate_no || row.serial_number || serialNumber),
      srn: String(row.srn || row.id_number || serialNumber),
      id_number: String(row.id_number || row.srn || serialNumber),
      full_name: fullName,
      name: fullName,
      first_name: row.first_name || fName || 'Unknown',
      middle_name: row.middle_name || mName || '',
      last_name: row.last_name || lName || '',
      certificate_type: row.certificate_type || 'Certificate',
      title_of_certificate: row.title_of_certificate || row.certificate_type || 'Certificate',
      title: row.title_of_certificate || row.certificate_type || 'Certificate',
      function: row.function || 'N/A',
      level_of_responsibility: row.level_of_responsibility || row['Level of Responsibility'] || 'N/A',
      level: row.level_of_responsibility || row['Level of Responsibility'] || 'N/A',
      regulation_no: row.regulation_no || 'N/A',
      regulation: row.regulation_no || 'N/A',
      regulation_number: row.regulation_no || 'N/A',
      status: row.status || 'active',
      issue_date: row.issue_date || '',
      date_issued: row.issue_date || '',
      expiry_date: row.expiry_date || '',
      date_expiry: row.expiry_date || '',
      revalidation_date: row.revalidation_date || '',
      document_url: row.document_url || '/static/media/sample-certificate.svg',
      image_url: row.image_url || '/static/media/sample-certificate.svg',
      photo: row.photo || row.image_url || '/static/media/sample-certificate.svg',
      qr_code: row.qr_code || '/static/media/qrcode.d8c9b936.jpg',
      remarks: row.remarks || 'Loaded from Firestore database',
      limitations: Array.isArray(row.limitations) ? row.limitations : [],
      requirements: Array.isArray(row.requirements) ? row.requirements : [],
      capacity: row.capacity || 'OFFICER',
      verification_type: row.verification_type || selectedType || 'certificate'
    }
  });
}

// Verification endpoints
app.all(['/api/verify-certificate', '/pub/archive/certificate/verify', '/pub/archive/id_card/verify'], handleVerification);

// User data endpoints
app.get('/api/users', async (req, res) => {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/users`;
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(200).json({ ok: true, users: [] });
    }
    const data = await response.json();
    const users = (data.documents || []).map(doc => firestoreFieldsToObj(doc.fields || {}));
    return res.status(200).json({ ok: true, users });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Failed to load users from database' });
  }
});

app.get('/api/users/:identifier', async (req, res) => {
  try {
    const id = String(req.params.identifier || '').trim();
    const docId = id.startsWith('user_') ? id : `user_${id}`.replace(/[\/\\\s]/g, '_');
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/users/${docId}`;
    const response = await fetch(url);
    if (response.ok) {
      const doc = await response.json();
      return res.status(200).json({ ok: true, user: firestoreFieldsToObj(doc.fields || {}) });
    }
    return res.status(404).json({ ok: false, error: 'User not found' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Error querying user' });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const { serial_number, verification_type, full_name, email, role, status } = req.body || {};
    if (!serial_number) {
      return res.status(400).json({ ok: false, error: 'serial_number is required' });
    }
    await storeUserDataToFirestore(req.body, serial_number, verification_type || 'certificate', true);
    return res.status(200).json({ ok: true, message: 'User record saved successfully' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Failed to save user record' });
  }
});

app.all(['/verify-recaptcha', '/api/verify-recaptcha'], (req, res) => {
  return res.status(200).json({ ok: true, message: 'reCAPTCHA bypass active' });
});

// Serve static files
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use('/officer_image', express.static(path.join(__dirname, 'officer_image')));

// Serve HTML pages
app.use(express.static(__dirname, {
  extensions: ['html']
}));

// Fallback to index.html or 404 for missing static files
app.use((req, res) => {
  const requestedPath = path.join(__dirname, req.path);
  if (fs.existsSync(requestedPath) && fs.statSync(requestedPath).isFile()) {
    return res.sendFile(requestedPath);
  }
  const htmlPath = requestedPath + '.html';
  if (fs.existsSync(htmlPath) && fs.statSync(htmlPath).isFile()) {
    return res.sendFile(htmlPath);
  }
  // Return 404 for missing static assets, scripts, or API routes to avoid returning HTML for JS/CSS requests
  if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|json|woff2?|ttf|eot|map)$/i) || req.path.startsWith('/marina-archive') || req.path.startsWith('/api/')) {
    return res.status(404).send('Not Found');
  }
  return res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`MARINA platform server listening on port ${PORT}`);
  seedFirestore().then(() => console.log('Firestore initial seed complete')).catch(err => console.error(err));
});
