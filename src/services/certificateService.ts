import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  query, 
  where 
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, defaultDb, storage } from '../firebase';

export interface CertificateRecord {
  serial_number: string;
  certificate_no?: string;
  certificate_number?: string;
  full_name: string;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  certificate_type?: string;
  title_of_certificate?: string;
  function?: string;
  level_of_responsibility?: string;
  regulation_no?: string;
  capacity?: string;
  status?: string;
  issue_date?: string;
  expiry_date?: string;
  revalidation_date?: string;
  document_url?: string;
  image_url?: string;
  remarks?: string;
  limitations?: string[];
  requirements?: string[];
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Fetch a certificate by serial number or certificate number from Firestore.
 */
export async function getCertificateFromFirestore(serialNumber: string): Promise<CertificateRecord | null> {
  const cleanNumber = String(serialNumber || '').trim().toUpperCase();
  if (!cleanNumber) return null;

  const databases = [db, defaultDb];

  for (const firestoreInstance of databases) {
    try {
      // 1. Direct doc lookup by ID
      const directRef = doc(firestoreInstance, 'certificates', cleanNumber);
      const directSnap = await getDoc(directRef);
      if (directSnap.exists()) {
        return directSnap.data() as CertificateRecord;
      }

      // 2. Query by serial_number
      const certsCol = collection(firestoreInstance, 'certificates');
      const qSerial = query(certsCol, where('serial_number', '==', cleanNumber));
      const snapSerial = await getDocs(qSerial);
      if (!snapSerial.empty) {
        return snapSerial.docs[0].data() as CertificateRecord;
      }

      // 3. Query by certificate_no
      const qCertNo = query(certsCol, where('certificate_no', '==', cleanNumber));
      const snapCertNo = await getDocs(qCertNo);
      if (!snapCertNo.empty) {
        return snapCertNo.docs[0].data() as CertificateRecord;
      }

      // 4. Query by certificate_number
      const qCertNumber = query(certsCol, where('certificate_number', '==', cleanNumber));
      const snapCertNumber = await getDocs(qCertNumber);
      if (!snapCertNumber.empty) {
        return snapCertNumber.docs[0].data() as CertificateRecord;
      }
    } catch (err) {
      console.warn('Firestore query note:', err);
    }
  }

  return null;
}

/**
 * Save or update a certificate record in Firestore.
 */
export async function saveCertificateToFirestore(data: CertificateRecord): Promise<boolean> {
  try {
    const docId = (data.serial_number || data.certificate_no || data.certificate_number || Date.now().toString()).toUpperCase();
    const docRef = doc(db, 'certificates', docId);
    
    await setDoc(docRef, {
      ...data,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    
    return true;
  } catch (err) {
    console.error('Error saving certificate to Firestore:', err);
    return false;
  }
}

/**
 * Upload an officer or certificate image to Firebase Storage.
 */
export async function uploadCertificateImage(file: File, pathName: string): Promise<string | null> {
  try {
    const storageRef = ref(storage, `certificates/${Date.now()}_${pathName}`);
    const snapshot = await uploadBytes(storageRef, file);
    const downloadUrl = await getDownloadURL(snapshot.ref);
    return downloadUrl;
  } catch (err) {
    console.error('Error uploading image to Firebase Storage:', err);
    return null;
  }
}
