import React, { useState, useEffect, useCallback } from 'react';
import { User } from 'firebase/auth';
import {
  Cloud,
  Database,
  RefreshCw,
  UploadCloud,
  DownloadCloud,
  Trash2,
  ExternalLink,
  FolderOpen,
  CheckCircle2,
  AlertTriangle,
  X,
  LogOut,
  FileJson,
  FileSpreadsheet,
  FileText,
} from 'lucide-react';
import {
  googleSignIn,
  logout,
  getAccessToken,
  listPlutusDriveFiles,
  uploadFileContentToGoogleDrive,
  downloadDriveFileText,
  deleteGoogleDriveFile,
  getFirestoreWorkspaceSnapshot,
  saveWorkspaceToFirestore,
  deleteWorkspaceFromFirestore,
  FirestoreWorkspaceMetadata,
  GoogleDriveFileItem,
  PLUTUS_DRIVE_FOLDER_NAME,
} from '../utils/googleDriveIntegration';
import { getAttachedLiveUrl } from '../utils/generateStandaloneLaptopApp';

interface GoogleDriveModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  needsAuth: boolean;
  onAuthChange: (user: User | null, token: string | null, needsAuth: boolean) => void;
  getCurrentFullBackupPayload: () => Record<string, any>;
  getCurrentCsvString: () => string;
  onRestoreBackupFromDrive: (data: any, sourceLabel: string) => void;
  showNotice: (msg: string) => void;
}

interface PendingConfirmAction {
  type:
    | 'delete_drive_file'
    | 'overwrite_drive_file'
    | 'restore_into_app'
    | 'restore_from_firestore'
    | 'delete_from_firestore';
  file?: GoogleDriveFileItem;
  title: string;
  description: string;
  confirmLabel: string;
}

export const GoogleDriveModal: React.FC<GoogleDriveModalProps> = ({
  isOpen,
  onClose,
  user,
  needsAuth,
  onAuthChange,
  getCurrentFullBackupPayload,
  getCurrentCsvString,
  onRestoreBackupFromDrive,
  showNotice,
}) => {
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [driveFiles, setDriveFiles] = useState<GoogleDriveFileItem[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [firestoreMeta, setFirestoreMeta] = useState<FirestoreWorkspaceMetadata | null>(null);
  const [isLoadingFirestore, setIsLoadingFirestore] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmAction | null>(null);

  const loadFirestoreStatus = useCallback(async (uid?: string) => {
    const targetUid = uid || user?.uid;
    if (!targetUid) {
      setFirestoreMeta(null);
      return;
    }
    setIsLoadingFirestore(true);
    try {
      const res = await getFirestoreWorkspaceSnapshot(targetUid);
      setFirestoreMeta(res.metadata);
    } catch (err: any) {
      console.error('Failed to read Firestore workspace status:', err);
    } finally {
      setIsLoadingFirestore(false);
    }
  }, [user?.uid]);

  const loadFilesFromDrive = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      onAuthChange(user, null, true);
      return;
    }
    setIsLoadingFiles(true);
    setErrorMsg(null);
    try {
      const res = await listPlutusDriveFiles();
      setFolderId(res.folderId);
      setDriveFiles(res.files);
    } catch (err: any) {
      console.error('Failed to load Google Drive files:', err);
      const msg = String(err?.message || 'Could not load files from Google Drive');
      if (msg.includes('401') || msg.includes('Not authenticated')) {
        onAuthChange(user, null, true);
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setIsLoadingFiles(false);
    }
  }, [onAuthChange, user]);

  useEffect(() => {
    if (isOpen && user) {
      loadFirestoreStatus(user.uid);
      if (!needsAuth) {
        loadFilesFromDrive();
      }
    }
  }, [isOpen, needsAuth, user, loadFilesFromDrive, loadFirestoreStatus]);

  if (!isOpen) return null;

  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    setErrorMsg(null);
    try {
      const result = await googleSignIn();
      if (result) {
        onAuthChange(result.user, result.accessToken, false);
        setStatusBanner(
          `Connected to Firebase & Google Drive as ${result.user.email || result.user.displayName}`
        );
        await Promise.all([
          loadFirestoreStatus(result.user.uid),
          loadFilesFromDrive(),
        ]);
      }
    } catch (err: any) {
      console.error('Google Sign-In failed:', err);
      setErrorMsg(err?.message || 'Google Sign-In was cancelled or failed.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
    setDriveFiles([]);
    setFolderId(null);
    setFirestoreMeta(null);
    onAuthChange(null, null, true);
    showNotice('Signed out of Firebase & Google Drive.');
  };

  // Save current workspace directly to Firebase Firestore (/workspaces/{uid})
  const handleSaveToFirestore = async () => {
    if (!user) {
      setErrorMsg('Please sign in with Google first.');
      return;
    }
    setIsUploading(true);
    setErrorMsg(null);
    try {
      const payload = getCurrentFullBackupPayload();
      const meta = await saveWorkspaceToFirestore(payload);
      setFirestoreMeta(meta);
      setStatusBanner(
        `Saved workspace (${meta.orderCount || 0} orders, ${meta.payloadSizeKb || 0} KB) to Firebase Firestore!`
      );
      showNotice(
        `🔥 Synced workspace (${meta.orderCount || 0} orders) to Firebase Firestore database!`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save workspace to Firebase Firestore.');
    } finally {
      setIsUploading(false);
    }
  };

  // Save a brand new timestamped JSON backup to Google Drive (and sync to Firestore)
  const handleSaveNewBackupToDrive = async () => {
    const token = await getAccessToken();
    if (!token) {
      onAuthChange(user, null, true);
      return;
    }
    setIsUploading(true);
    setErrorMsg(null);
    try {
      const payload = getCurrentFullBackupPayload();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const fileName = `PLUTUS_BACKUP_${stamp}.json`;
      const content = JSON.stringify(payload, null, 2);
      const created = await uploadFileContentToGoogleDrive({
        fileName,
        content,
        mimeType: 'application/json',
        description: `PLUTUS Cable Production & Requisition System Full Backup (${new Date().toLocaleString()})`,
      });
      if (user) {
        const meta = await saveWorkspaceToFirestore(payload).catch(() => null);
        if (meta) setFirestoreMeta(meta);
      }
      setStatusBanner(`Saved "${created.name}" to Google Drive & synced to Firebase!`);
      showNotice(`☁️ Saved "${created.name}" to Google Drive (${PLUTUS_DRIVE_FOLDER_NAME})!`);
      await loadFilesFromDrive();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to upload backup to Google Drive.');
    } finally {
      setIsUploading(false);
    }
  };

  // Save or update the master backup file (prompts for confirmation if overwriting existing master file)
  const handleSaveOrUpdateMasterBackup = async () => {
    const existingMaster = driveFiles.find(f => f.name === 'PLUTUS_MASTER_BACKUP.json');
    if (existingMaster) {
      setPendingConfirm({
        type: 'overwrite_drive_file',
        file: existingMaster,
        title: `Update existing "${existingMaster.name}" in Google Drive?`,
        description: `This will overwrite the contents of "${existingMaster.name}" in your Google Drive and update your Firebase Firestore workspace with your current orders, stock ledger, container plans, and settings.`,
        confirmLabel: 'Confirm & Update File in Drive',
      });
      return;
    }

    setIsUploading(true);
    setErrorMsg(null);
    try {
      const payload = getCurrentFullBackupPayload();
      const created = await uploadFileContentToGoogleDrive({
        fileName: 'PLUTUS_MASTER_BACKUP.json',
        content: JSON.stringify(payload, null, 2),
        mimeType: 'application/json',
        description: 'PLUTUS Master Cloud Backup File',
      });
      if (user) {
        const meta = await saveWorkspaceToFirestore(payload).catch(() => null);
        if (meta) setFirestoreMeta(meta);
      }
      setStatusBanner(`Created "${created.name}" in Google Drive & Firebase Firestore!`);
      showNotice(`☁️ Created "${created.name}" in Google Drive!`);
      await loadFilesFromDrive();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save master backup to Google Drive.');
    } finally {
      setIsUploading(false);
    }
  };

  // Save CSV export directly to Google Drive
  const handleUploadCsvToDrive = async () => {
    const token = await getAccessToken();
    if (!token) {
      onAuthChange(user, null, true);
      return;
    }
    setIsUploading(true);
    setErrorMsg(null);
    try {
      const csvContent = getCurrentCsvString();
      const stamp = new Date().toISOString().slice(0, 10);
      const fileName = `PLUTUS_ORDERS_AND_RECORD_${stamp}.csv`;
      const created = await uploadFileContentToGoogleDrive({
        fileName,
        content: csvContent,
        mimeType: 'text/csv',
        description: 'PLUTUS Orders & Engineering Master Record CSV Export',
      });
      setStatusBanner(`Saved "${created.name}" to Google Drive!`);
      showNotice(`📊 Saved "${created.name}" to Google Drive!`);
      await loadFilesFromDrive();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to upload CSV to Google Drive.');
    } finally {
      setIsUploading(false);
    }
  };

  // Save Click-to-Run Google Drive Launcher (.doc) directly into the user's Google Drive
  const handleSaveLauncherToDrive = async () => {
    const token = await getAccessToken();
    if (!token) {
      onAuthChange(user, null, true);
      return;
    }
    setIsUploading(true);
    setErrorMsg(null);
    try {
      const liveUrl = getAttachedLiveUrl();
      const docHtml = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Launch PLUTUS Cable Production App</title></head>
<body style="font-family: Arial, sans-serif; padding: 32px; background: #f8fafc; color: #0f172a;">
  <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border: 2px solid #2563eb; border-radius: 14px; padding: 28px;">
    <h1 style="margin-top: 0; color: #0f172a;">⚡ PLUTUS Cable Production &amp; Requisition System</h1>
    <p style="font-size: 14px; color: #334155;">Click the button below to launch the live PLUTUS application with real-time Google Drive &amp; Firebase Cloud synchronization:</p>
    <p style="margin: 24px 0;">
      <a href="${liveUrl}" target="_blank" style="background: #2563eb; color: #ffffff; text-decoration: none; padding: 14px 24px; border-radius: 8px; font-weight: bold; font-size: 15px; display: inline-block;">
        🚀 Launch PLUTUS Cable Production App ↗
      </a>
    </p>
    <p style="font-size: 12px; color: #64748b;">Official App Link: <a href="${liveUrl}">${liveUrl}</a></p>
  </div>
</body>
</html>`;
      const created = await uploadFileContentToGoogleDrive({
        fileName: 'PLUTUS_GOOGLE_DRIVE_CLICK_TO_RUN_APP.doc',
        content: docHtml,
        mimeType: 'text/html',
        description: 'Click-to-Run Launcher for PLUTUS Cable Production App',
      });
      setStatusBanner(`Uploaded "${created.name}" to Google Drive!`);
      showNotice(`🚀 Uploaded "${created.name}" to your Google Drive!`);
      await loadFilesFromDrive();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to upload launcher to Google Drive.');
    } finally {
      setIsUploading(false);
    }
  };

  // Execute confirmed mutating/destructive operation
  const handleExecuteConfirmedAction = async () => {
    if (!pendingConfirm) return;
    const action = pendingConfirm;
    setPendingConfirm(null);
    setIsUploading(true);
    setErrorMsg(null);

    try {
      if (action.type === 'delete_drive_file' && action.file) {
        await deleteGoogleDriveFile(action.file.id);
        setStatusBanner(`Deleted "${action.file.name}" from Google Drive.`);
        showNotice(`🗑️ Deleted "${action.file.name}" from Google Drive.`);
        await loadFilesFromDrive();
      } else if (action.type === 'overwrite_drive_file' && action.file) {
        const payload = getCurrentFullBackupPayload();
        const updated = await uploadFileContentToGoogleDrive({
          fileName: action.file.name,
          content: JSON.stringify(payload, null, 2),
          mimeType: 'application/json',
          existingFileId: action.file.id,
          description: `Updated by PLUTUS at ${new Date().toLocaleString()}`,
        });
        if (user) {
          const meta = await saveWorkspaceToFirestore(payload).catch(() => null);
          if (meta) setFirestoreMeta(meta);
        }
        setStatusBanner(`Updated "${updated.name}" on Google Drive & Firebase!`);
        showNotice(`☁️ Updated "${updated.name}" on Google Drive!`);
        await loadFilesFromDrive();
      } else if (action.type === 'restore_into_app' && action.file) {
        const text = await downloadDriveFileText(action.file.id);
        const parsed = JSON.parse(text);
        onRestoreBackupFromDrive(parsed, `Google Drive (${action.file.name})`);
        setStatusBanner(`Restored "${action.file.name}" from Google Drive!`);
        showNotice(`✅ Restored "${action.file.name}" from Google Drive!`);
      } else if (action.type === 'restore_from_firestore' && user) {
        const res = await getFirestoreWorkspaceSnapshot(user.uid);
        if (!res.payload) {
          throw new Error('No workspace snapshot found in Firebase Firestore.');
        }
        onRestoreBackupFromDrive(res.payload, 'Firebase Firestore Cloud Database');
        setStatusBanner('Restored workspace from Firebase Firestore!');
        showNotice('🔥 Restored workspace from Firebase Firestore Cloud Database!');
      } else if (action.type === 'delete_from_firestore') {
        await deleteWorkspaceFromFirestore();
        setFirestoreMeta({ exists: false });
        setStatusBanner('Deleted workspace snapshot from Firebase Firestore.');
        showNotice('🗑️ Deleted workspace snapshot from Firebase Firestore.');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Operation failed.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs no-print">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-3xl w-full overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 rounded-xl">
              <Cloud className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-extrabold tracking-wide flex items-center gap-2">
                <span>Google Drive &amp; Firebase Firestore Cloud Manager</span>
                {user && (
                  <span className="text-[10px] px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-full font-bold">
                    {needsAuth ? 'Firebase Active' : 'Drive + Firebase Connected'}
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-300 mt-0.5">
                Sync your PLUTUS Cable Production workspace with Firebase Firestore and your Google Drive folder
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-300 rounded-xl text-xs text-rose-900 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{errorMsg}</span>
              </div>
              <button
                type="button"
                onClick={() => setErrorMsg(null)}
                className="text-rose-500 hover:text-rose-800 font-bold"
              >
                ✕
              </button>
            </div>
          )}

          {statusBanner && (
            <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-xs text-emerald-900 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{statusBanner}</span>
              </div>
              <button
                type="button"
                onClick={() => setStatusBanner(null)}
                className="text-emerald-600 hover:text-emerald-900 font-bold"
              >
                ✕
              </button>
            </div>
          )}

          {/* Mandatory Explicit User Confirmation Dialog for Destructive / Mutating Operations */}
          {pendingConfirm && (
            <div className="p-4 bg-amber-50 border-2 border-amber-400 rounded-xl space-y-3 shadow-md">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="text-sm font-black text-amber-950">{pendingConfirm.title}</div>
                  <p className="text-xs text-amber-900 leading-relaxed">{pendingConfirm.description}</p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPendingConfirm(null)}
                  className="px-3.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExecuteConfirmedAction}
                  className={`px-4 py-1.5 text-white rounded-lg text-xs font-black cursor-pointer shadow-xs ${
                    pendingConfirm.type === 'delete_drive_file' ||
                    pendingConfirm.type === 'delete_from_firestore'
                      ? 'bg-rose-600 hover:bg-rose-700'
                      : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {pendingConfirm.confirmLabel}
                </button>
              </div>
            </div>
          )}

          {/* Authentication State */}
          {!user ? (
            <div className="border-2 border-blue-200 bg-blue-50/50 rounded-2xl p-6 text-center space-y-4">
              <div className="mx-auto w-12 h-12 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center">
                <Cloud className="w-6 h-6" />
              </div>
              <div className="space-y-1 max-w-md mx-auto">
                <h3 className="text-sm font-extrabold text-slate-900">
                  Connect Google Account for Firebase Firestore &amp; Google Drive
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Sign in with Google to persist your workspace in <strong>Firebase Firestore</strong> and save backups/CSV exports directly into your <strong>{PLUTUS_DRIVE_FOLDER_NAME}</strong> folder in Google Drive.
                </p>
              </div>

              <div className="flex justify-center pt-1">
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={isLoggingIn}
                  className="gsi-material-button inline-flex items-center gap-3 px-5 py-2.5 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-full shadow-sm font-semibold text-xs transition-all cursor-pointer disabled:opacity-60"
                >
                  <div className="gsi-material-button-state" />
                  <div className="gsi-material-button-content-wrapper flex items-center gap-2.5">
                    <div className="gsi-material-button-icon w-4 h-4">
                      <svg
                        version="1.1"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 48 48"
                        xmlnsXlink="http://www.w3.org/1999/xlink"
                        style={{ display: 'block', width: '16px', height: '16px' }}
                      >
                        <path
                          fill="#EA4335"
                          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                        />
                        <path
                          fill="#4285F4"
                          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                        />
                        <path
                          fill="#34A853"
                          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                        />
                        <path fill="none" d="M0 0h48v48H0z" />
                      </svg>
                    </div>
                    <span className="gsi-material-button-contents font-bold text-slate-800">
                      {isLoggingIn ? 'Connecting to Google...' : 'Sign in with Google'}
                    </span>
                    <span style={{ display: 'none' }}>Sign in with Google</span>
                  </div>
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Connected User Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
                <div className="flex items-center gap-2.5">
                  {user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt={user.displayName || 'User'}
                      className="w-8 h-8 rounded-full border border-slate-300"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center">
                      {(user.email || 'G')[0].toUpperCase()}
                    </div>
                  )}
                  <div>
                    <div className="text-xs font-extrabold text-slate-900">
                      {user.displayName || 'Google Cloud Account'}
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium">{user.email}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {folderId && (
                    <a
                      href={`https://drive.google.com/drive/folders/${folderId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 bg-white hover:bg-slate-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-bold flex items-center gap-1.5"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span>Open Drive Folder ↗</span>
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="px-3 py-1.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>

              {/* Firebase Firestore Cloud Database Panel */}
              <div className="border-2 border-amber-300 bg-amber-50/60 rounded-xl p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-amber-500 text-white rounded-lg">
                      <Database className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs font-black text-slate-900 flex items-center gap-2">
                        <span>🔥 Firebase Firestore Cloud Workspace</span>
                        <span className="text-[10px] px-2 py-0.5 bg-amber-200/80 text-amber-950 rounded-full font-extrabold">
                          impressive-seat-s0z9n
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600">
                        {isLoadingFirestore ? (
                          'Checking Firestore workspace...'
                        ) : firestoreMeta?.exists ? (
                          <>
                            Last synced:{' '}
                            <strong>
                              {firestoreMeta.updatedAtIso
                                ? new Date(firestoreMeta.updatedAtIso).toLocaleString()
                                : 'Recently'}
                            </strong>{' '}
                            • <strong>{firestoreMeta.orderCount ?? 0}</strong> orders (
                            {firestoreMeta.payloadSizeKb ?? 0} KB)
                          </>
                        ) : (
                          'No snapshot saved in Firestore yet. Click Sync to Firestore below.'
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={isUploading}
                      onClick={handleSaveToFirestore}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white rounded-lg text-xs font-extrabold flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <UploadCloud className="w-3.5 h-3.5" />
                      <span>Sync to Firestore</span>
                    </button>
                    {firestoreMeta?.exists && (
                      <>
                        <button
                          type="button"
                          disabled={isUploading}
                          onClick={() =>
                            setPendingConfirm({
                              type: 'restore_from_firestore',
                              title: 'Restore Workspace from Firebase Firestore?',
                              description:
                                'This will load your saved orders, stock ledger, container plans, and settings from Firebase Firestore into the application.',
                              confirmLabel: 'Confirm & Restore from Firestore',
                            })
                          }
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-extrabold flex items-center gap-1 cursor-pointer"
                        >
                          <DownloadCloud className="w-3.5 h-3.5" />
                          <span>Restore</span>
                        </button>
                        <button
                          type="button"
                          disabled={isUploading}
                          onClick={() =>
                            setPendingConfirm({
                              type: 'delete_from_firestore',
                              title: 'Delete Workspace Snapshot from Firebase Firestore?',
                              description:
                                'Are you sure you want to delete your cloud workspace document from Firebase Firestore? Your local data will remain untouched.',
                              confirmLabel: 'Delete from Firestore',
                            })
                          }
                          className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold cursor-pointer"
                          title="Delete Firestore snapshot"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Google Drive Section (prompts token refresh if Drive OAuth token expired) */}
              {needsAuth ? (
                <div className="border border-blue-200 bg-blue-50/60 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-extrabold text-slate-900">
                      Reconnect Google Drive Session to Browse &amp; Upload Drive Files
                    </div>
                    <div className="text-[11px] text-slate-600">
                      Your Firebase session is active, but Google Drive requires a fresh OAuth access token to list or upload files.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    disabled={isLoggingIn}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-extrabold cursor-pointer shrink-0"
                  >
                    {isLoggingIn ? 'Connecting Drive...' : 'Authorize Google Drive'}
                  </button>
                </div>
              ) : (
                <>
                  {/* Save / Upload Actions Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      disabled={isUploading}
                      onClick={handleSaveOrUpdateMasterBackup}
                      className="p-3.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl font-extrabold text-xs flex items-center gap-3 shadow-sm cursor-pointer text-left"
                    >
                      <UploadCloud className="w-5 h-5 shrink-0" />
                      <div>
                        <div>☁️ Save / Update Master Backup (.json)</div>
                        <div className="text-[10.5px] text-blue-100 font-normal">
                          Saves PLUTUS_MASTER_BACKUP.json in Google Drive &amp; Firestore
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      disabled={isUploading}
                      onClick={handleSaveNewBackupToDrive}
                      className="p-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-xl font-extrabold text-xs flex items-center gap-3 shadow-sm cursor-pointer text-left"
                    >
                      <FileJson className="w-5 h-5 shrink-0" />
                      <div>
                        <div>📸 Save New Timestamped Snapshot (.json)</div>
                        <div className="text-[10.5px] text-emerald-100 font-normal">
                          Creates a dated backup point in Google Drive
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      disabled={isUploading}
                      onClick={handleUploadCsvToDrive}
                      className="p-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-xl font-extrabold text-xs flex items-center gap-3 shadow-sm cursor-pointer text-left"
                    >
                      <FileSpreadsheet className="w-5 h-5 shrink-0" />
                      <div>
                        <div>📊 Save Orders &amp; Master Record (.csv)</div>
                        <div className="text-[10.5px] text-indigo-100 font-normal">
                          Uploads spreadsheet-ready CSV to Google Drive
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      disabled={isUploading}
                      onClick={handleSaveLauncherToDrive}
                      className="p-3.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white rounded-xl font-extrabold text-xs flex items-center gap-3 shadow-sm cursor-pointer text-left"
                    >
                      <FileText className="w-5 h-5 shrink-0" />
                      <div>
                        <div>🚀 Save Click-to-Run App Launcher (.doc)</div>
                        <div className="text-[10.5px] text-amber-100 font-normal">
                          Opens as a clickable Launch button in Google Drive
                        </div>
                      </div>
                    </button>
                  </div>

                  {/* Files in Google Drive */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="bg-slate-100 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                      <div className="text-xs font-extrabold text-slate-800 flex items-center gap-2">
                        <FolderOpen className="w-4 h-4 text-blue-600" />
                        <span>Files in Google Drive ({PLUTUS_DRIVE_FOLDER_NAME})</span>
                      </div>
                      <button
                        type="button"
                        onClick={loadFilesFromDrive}
                        disabled={isLoadingFiles}
                        className="px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <RefreshCw className={`w-3 h-3 ${isLoadingFiles ? 'animate-spin' : ''}`} />
                        <span>Refresh</span>
                      </button>
                    </div>

                    {isLoadingFiles ? (
                      <div className="p-6 text-center text-xs text-slate-500 font-semibold flex items-center justify-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
                        <span>Loading files from your Google Drive...</span>
                      </div>
                    ) : driveFiles.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500">
                        No PLUTUS backup files found in your Google Drive yet. Click <strong>Save / Update Master Backup</strong> above to store your current data in Google Drive.
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-200 max-h-64 overflow-y-auto">
                        {driveFiles.map(file => {
                          const isJson = file.name.endsWith('.json') || file.mimeType.includes('json');
                          return (
                            <div
                              key={file.id}
                              className="px-4 py-2.5 bg-white hover:bg-slate-50 flex flex-wrap items-center justify-between gap-2 text-xs"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="font-bold text-slate-900 truncate" title={file.name}>
                                  {file.name}
                                </div>
                                <div className="text-[10.5px] text-slate-500 flex items-center gap-2">
                                  {file.modifiedTime && (
                                    <span>Modified: {new Date(file.modifiedTime).toLocaleString()}</span>
                                  )}
                                  {file.size && (
                                    <span>• {(Number(file.size) / 1024).toFixed(1)} KB</span>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                {isJson && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setPendingConfirm({
                                          type: 'restore_into_app',
                                          file,
                                          title: `Restore "${file.name}" from Google Drive?`,
                                          description: `This will load the orders, stock ledger, and settings from "${file.name}" into the application.`,
                                          confirmLabel: 'Confirm & Restore Backup',
                                        })
                                      }
                                      className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                                      title="Restore this backup file into the app"
                                    >
                                      <DownloadCloud className="w-3 h-3" />
                                      <span>Restore</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setPendingConfirm({
                                          type: 'overwrite_drive_file',
                                          file,
                                          title: `Overwrite "${file.name}" in Google Drive?`,
                                          description: `Are you sure you want to update "${file.name}" in Google Drive with your current app state?`,
                                          confirmLabel: 'Confirm Overwrite',
                                        })
                                      }
                                      className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 rounded font-bold text-[11px] cursor-pointer"
                                      title="Overwrite this file in Google Drive with current app data"
                                    >
                                      Update
                                    </button>
                                  </>
                                )}
                                {file.webViewLink && (
                                  <a
                                    href={file.webViewLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-semibold text-[11px] flex items-center gap-1"
                                    title="View file in Google Drive"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPendingConfirm({
                                      type: 'delete_drive_file',
                                      file,
                                      title: `Delete "${file.name}" from Google Drive?`,
                                      description: `Are you sure you want to permanently delete "${file.name}" from your Google Drive? This action cannot be undone.`,
                                      confirmLabel: 'Delete File from Drive',
                                    })
                                  }
                                  className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded font-bold text-[11px] cursor-pointer"
                                  title="Delete file from Google Drive"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 border-t border-slate-200 px-6 py-3 flex items-center justify-between shrink-0">
          <span className="text-[11px] text-slate-500 font-medium">
            Firebase Firestore (asia-east1) • Google Drive API v3
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold rounded-lg cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
