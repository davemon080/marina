const fs = require('fs');
const path = require('path');

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

module.exports = (req, res) => {
  const {
    serial_number,
    captcha,
    verification_type,
    type,
    sirb_number,
    srn,
    certificate_number,
    certificate_no,
    id_number,
  } = req.query;
  const resolvedSerialNumber = String(
    serial_number || sirb_number || srn || certificate_number || certificate_no || id_number || ''
  ).trim();
  const inferredType = sirb_number
    ? 'sirb_number'
    : srn
    ? 'srn'
    : certificate_number || certificate_no
    ? 'serial_number'
    : id_number
    ? 'id'
    : serial_number
    ? 'serial_number'
    : '';

  if (!resolvedSerialNumber || !captcha) {
    res.status(400).json({ ok: false, error: 'serial number and captcha are required' });
    return;
  }

  const documentsPath = path.join(__dirname, '..', 'documents.json');
  let documents = [];

  try {
    documents = JSON.parse(fs.readFileSync(documentsPath, 'utf8'));
  } catch (error) {
    documents = [];
  }

  const selectedType = normalizeVerificationType(verification_type || type || inferredType);

  if (selectedType === 'id') {
    res.status(200).json({ ok: false, data: {}, error: 'Invalid SRN' });
    return;
  }

  if (selectedType === 'sirb') {
    res.status(200).json({ ok: false, data: {}, error: 'SIRB not found' });
    return;
  }

  const normalizedSerial = resolvedSerialNumber.toUpperCase();
  const match = documents.find((item) => {
    const serialMatch = String(item.serial_number || '').trim().toUpperCase() === normalizedSerial;
    const certNoMatch = String(item.certificate_no || '').trim().toUpperCase() === normalizedSerial;
    const certNumberMatch = String(item.certificate_number || '').trim().toUpperCase() === normalizedSerial;
    return serialMatch || certNoMatch || certNumberMatch;
  });

  if (!match) {
    const errorMessage = 'serial number does not exist';
    res.status(404).json({ status: 404, ok: false, message: errorMessage, error: errorMessage, data: {} });
    return;
  }

  const rowValues = [match.verification_type, match.certificate_type, match.record_type].join(' ').toLowerCase();
  const isIdType = selectedType === 'id';
  const isCertificateType = selectedType === 'certificate' || selectedType === 'sirb';

  const matchesType = isIdType
    ? rowValues.includes('id') || rowValues.includes('identification') || rowValues.includes('srn')
    : rowValues.includes('certificate') || rowValues.includes('cert') || rowValues.includes('cop') || rowValues.includes('coc') || rowValues.includes('coe') || rowValues.includes('sirb');

  if (!matchesType) {
    const errorMessage = 'serial number does not exist';
    res.status(404).json({ status: 404, ok: false, message: errorMessage, error: errorMessage, data: {} });
    return;
  }

  const fullName = match.full_name || match.name || 'Unknown';
  const [firstNameFromFullName, middleNameFromFullName, lastNameFromFullName] = fullName.split(/\s+/).filter(Boolean);
  const firstName = match.first_name || firstNameFromFullName || 'Unknown';
  const middleName = match.middle_name || middleNameFromFullName || '';
  const lastName = match.last_name || lastNameFromFullName || '';

  res.status(200).json({
    ok: true,
    data: {
      serial_number: match.serial_number,
      certificate_no: match.certificate_no || match.certificate_number || match.serial_number,
      certificate_number:
        match.certificate_number || match.certificate_no || match.serial_number,
      full_name: fullName,
      name: fullName,
      first_name: firstName,
      middle_name: middleName,
      last_name: lastName,
      certificate_type: match.certificate_type || 'Certificate',
      title_of_certificate: match.title_of_certificate || match.certificate_type || 'Certificate',
      title: match.title_of_certificate || match.certificate_type || 'Certificate',
      function: match.function || 'N/A',
      level_of_responsibility: match.level_of_responsibility || match['Level of Responsibility'] || 'N/A',
      level: match.level_of_responsibility || match['Level of Responsibility'] || 'N/A',
      regulation_no: match.regulation_no || 'N/A',
      regulation: match.regulation_no || 'N/A',
      regulation_number: match.regulation_no || 'N/A',
      status: match.status || 'active',
      issue_date: match.issue_date || '',
      date_issued: match.issue_date || '',
      expiry_date: match.expiry_date || '',
      date_expiry: match.expiry_date || '',
      revalidation_date: match.revalidation_date || '',
      document_url: match.document_url || '/static/media/sample-certificate.svg',
      image_url: match.image_url || '/static/media/sample-certificate.svg',
      photo: match.image_url || '/static/media/sample-certificate.svg',
      qr_code: '/static/media/sample-certificate.svg',
      remarks: match.remarks || 'Loaded from local documents.json',
      limitations: Array.isArray(match.limitations) ? match.limitations : [],
      requirements: Array.isArray(match.requirements) ? match.requirements : [],
      capacity: match.capacity || '',
      verification_type: selectedType || 'certificate'
    }
  });
};
