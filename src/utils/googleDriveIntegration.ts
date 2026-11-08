import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData.map(provider => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate connection to Firestore on boot
async function testFirestoreConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testFirestoreConnection();

export interface FirestoreWorkspaceMetadata {
  exists: boolean;
  ownerEmail?: string;
  orderCount?: number;
  updatedAtIso?: string;
  payloadSizeKb?: number;
}

/**
 * Fetches metadata (and optionally full parsed payload) from /workspaces/{uid} in Firebase Firestore.
 */
export async function getFirestoreWorkspaceSnapshot(uid?: string): Promise<{
  metadata: FirestoreWorkspaceMetadata;
  payload: Record<string, any> | null;
}> {
  const targetUid = uid || auth.currentUser?.uid;
  if (!targetUid) {
    return { metadata: { exists: false }, payload: null };
  }
  const path = `workspaces/${targetUid}`;
  try {
    const snap = await getDoc(doc(db, 'workspaces', targetUid));
    if (!snap.exists()) {
      return { metadata: { exists: false }, payload: null };
    }
    const data = snap.data();
    const rawJson = typeof data.payloadJson === 'string' ? data.payloadJson : '{}';
    let parsed: Record<string, any> | null = null;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      parsed = null;
    }
    return {
      metadata: {
        exists: true,
        ownerEmail: data.ownerEmail,
        orderCount: typeof data.orderCount === 'number' ? data.orderCount : 0,
        updatedAtIso:
          typeof data.updatedAtIso === 'string'
            ? data.updatedAtIso
            : data.updatedAt instanceof Timestamp
            ? data.updatedAt.toDate().toISOString()
            : undefined,
        payloadSizeKb: Number((rawJson.length / 1024).toFixed(1)),
      },
      payload: parsed,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

/**
 * Saves or updates the current user's workspace snapshot at /workspaces/{uid} in Firebase Firestore.
 */
export async function saveWorkspaceToFirestore(
  payload: Record<string, any>
): Promise<FirestoreWorkspaceMetadata> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.email) {
    throw new Error('Please sign in with Google first to save to Firebase Firestore.');
  }
  const path = `workspaces/${currentUser.uid}`;
  const docRef = doc(db, 'workspaces', currentUser.uid);
  const payloadJson = JSON.stringify(payload);
  const orderCount = Array.isArray(payload.orders) ? payload.orders.length : 0;
  const updatedAtIso =
    typeof payload.updatedAt === 'string' ? payload.updatedAt : new Date().toISOString();

  try {
    const existing = await getDoc(docRef);
    if (!existing.exists()) {
      await setDoc(docRef, {
        ownerId: currentUser.uid,
        ownerEmail: currentUser.email,
        payloadJson,
        orderCount,
        updatedAtIso,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existingData = existing.data();
      await updateDoc(docRef, {
        ownerId: existingData.ownerId || currentUser.uid,
        ownerEmail: currentUser.email,
        payloadJson,
        orderCount,
        updatedAtIso,
        createdAt: existingData.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return {
      exists: true,
      ownerEmail: currentUser.email,
      orderCount,
      updatedAtIso,
      payloadSizeKb: Number((payloadJson.length / 1024).toFixed(1)),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Deletes the current user's workspace snapshot at /workspaces/{uid} in Firebase Firestore.
 */
export async function deleteWorkspaceFromFirestore(): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Not signed in to Firebase.');
  }
  const path = `workspaces/${currentUser.uid}`;
  try {
    await deleteDoc(doc(db, 'workspaces', currentUser.uid));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.activity',
  'https://www.googleapis.com/auth/drive.activity.readonly',
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/drive.apps.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.install',
  'https://www.googleapis.com/auth/drive.meet.readonly',
  'https://www.googleapis.com/auth/drive.metadata',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.photos.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.scripts',
];

const provider = new GoogleAuthProvider();
SCOPES.forEach(scope => provider.addScope(scope));

// Flag to indicate if we are in the middle of a sign-in flow.
let isSigningIn = false;
// Cache the access token strictly in memory (never in localStorage or sessionStorage).
let cachedAccessToken: string | null = null;
let cachedFolderId: string | null = null;

export interface GoogleDriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
  iconLink?: string;
}

// Initialize auth state listener. Call this on app load.
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: (firebaseUser: User | null) => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure(user);
      }
    } else {
      cachedAccessToken = null;
      cachedFolderId = null;
      if (onAuthFailure) onAuthFailure(null);
    }
  });
};

// Must be called from a button click or user interaction
export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Firebase Auth');
    }

    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
  cachedFolderId = null;
};

export const PLUTUS_DRIVE_FOLDER_NAME = 'PLUTUS Cable Production System';

/**
 * Finds or creates the dedicated "PLUTUS Cable Production System" folder in the user's Google Drive.
 */
export async function ensurePlutusDriveFolder(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated with Google Drive');

  if (cachedFolderId) return cachedFolderId;

  const q = encodeURIComponent(
    `name = '${PLUTUS_DRIVE_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  );
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=5`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  if (!searchRes.ok) {
    throw new Error(`Drive folder lookup failed (${searchRes.status})`);
  }
  const searchData = await searchRes.json();
  if (Array.isArray(searchData.files) && searchData.files.length > 0) {
    cachedFolderId = searchData.files[0].id;
    return cachedFolderId!;
  }

  // Create folder
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: PLUTUS_DRIVE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  if (!createRes.ok) {
    throw new Error(`Could not create PLUTUS folder on Google Drive (${createRes.status})`);
  }
  const created = await createRes.json();
  cachedFolderId = created.id;
  return created!;
}

/**
 * Lists files inside the PLUTUS Google Drive folder (plus any PLUTUS backup/HTML files in Drive).
 */
export async function listPlutusDriveFiles(): Promise<{
  folderId: string;
  files: GoogleDriveFileItem[];
}> {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated with Google Drive');

  const folderId = await ensurePlutusDriveFolder();
  const q = encodeURIComponent(
    `('${folderId}' in parents or name contains 'PLUTUS') and mimeType != 'application/vnd.google-apps.folder' and trashed = false`
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime desc&pageSize=30&fields=files(id,name,mimeType,modifiedTime,size,webViewLink,iconLink)`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  if (!res.ok) {
    throw new Error(`Failed to list Google Drive files (${res.status})`);
  }
  const data = await res.json();
  return {
    folderId,
    files: Array.isArray(data.files) ? data.files : [],
  };
}

/**
 * Uploads or updates a file in the user's PLUTUS Google Drive folder using multipart upload.
 */
export async function uploadFileContentToGoogleDrive(params: {
  fileName: string;
  content: string;
  mimeType: string;
  existingFileId?: string;
  description?: string;
}): Promise<GoogleDriveFileItem> {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated with Google Drive');

  const folderId = await ensurePlutusDriveFolder();
  const metadata: Record<string, any> = {
    name: params.fileName,
    mimeType: params.mimeType,
  };
  if (params.description) {
    metadata.description = params.description;
  }
  if (!params.existingFileId) {
    metadata.parents = [folderId];
  }

  const boundary = '-------PlutusDriveBoundary' + Date.now().toString(16);
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const multipartBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    `Content-Type: ${params.mimeType}; charset=UTF-8\r\n\r\n` +
    params.content +
    closeDelimiter;

  const url = params.existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(
        params.existingFileId
      )}?uploadType=multipart&fields=id,name,mimeType,modifiedTime,size,webViewLink`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,size,webViewLink';

  const res = await fetch(url, {
    method: params.existingFileId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Google Drive upload failed (${res.status}): ${errText}`);
  }

  return await res.json();
}

/**
 * Downloads the raw text content of a file from Google Drive.
 */
export async function downloadDriveFileText(fileId: string): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated with Google Drive');

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  if (!res.ok) {
    throw new Error(`Failed to download file from Google Drive (${res.status})`);
  }
  return await res.text();
}

/**
 * Deletes a file from Google Drive.
 * IMPORTANT: Caller MUST present an explicit user confirmation modal before calling this function.
 */
export async function deleteGoogleDriveFile(fileId: string): Promise<void> {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated with Google Drive');

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  if (!res.ok) {
    throw new Error(`Failed to delete file from Google Drive (${res.status})`);
  }
}
