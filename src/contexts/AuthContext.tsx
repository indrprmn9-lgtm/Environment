import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithPopup,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  auth,
  firestore,
  googleProvider,
  sheetsGoogleProvider,
} from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrors';
import {
  loadCachedUserProfile,
  saveCachedUserProfile,
} from '../lib/offlineQueue';
import type { AssignedCompany, UserProfile, UserRole } from '../types/plant';

const BOOTSTRAP_ADMIN_EMAIL = 'indrprmn9@gmail.com';
const RESET_META_DOC_ID = 'account_reset_v1';

// Strictly in-memory OAuth token for Google Sheets (never persisted to localStorage/sessionStorage)
let inMemorySheetsAccessToken: string | null = null;

export type AuthStatus =
  | 'loading'
  | 'signed_out'
  | 'authorized'
  | 'unauthorized'
  | 'inactive';

interface AuthContextValue {
  firebaseUser: User | null;
  profile: UserProfile | null;
  authStatus: AuthStatus;
  authError: string | null;
  sheetsAccessToken: string | null;
  signInWithGoogle: () => Promise<void>;
  connectGoogleSheets: () => Promise<string | null>;
  clearSheetsToken: () => void;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function isNetworkOrOfflineError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('offline') ||
    msg.includes('unavailable') ||
    msg.includes('network') ||
    msg.includes('failed to get document')
  );
}

async function deleteCollectionInBatches(
  collectionName: string,
  keepIds: Set<string> = new Set()
): Promise<void> {
  const snap = await getDocs(collection(firestore, collectionName));
  const toDelete = snap.docs.filter((d) => !keepIds.has(d.id));
  for (let i = 0; i < toDelete.length; i += 400) {
    const batch = writeBatch(firestore);
    toDelete.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>('loading');
  const [authError, setAuthError] = useState<string | null>(null);
  const [sheetsAccessToken, setSheetsAccessToken] = useState<string | null>(
    inMemorySheetsAccessToken
  );

  const setMemorySheetsToken = (token: string | null) => {
    inMemorySheetsAccessToken = token;
    setSheetsAccessToken(token);
  };

  const resolveUserAccess = async (user: User) => {
    const emailLower = (user.email || '').trim().toLowerCase();
    const isBootstrapAdmin =
      user.emailVerified && emailLower === BOOTSTRAP_ADMIN_EMAIL;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const cached = loadCachedUserProfile(user.uid);
      if (cached) {
        setProfile({
          ...cached,
          assignedCompany: cached.assignedCompany || 'ALL',
        });
        setAuthStatus('authorized');
        return;
      }
      if (isBootstrapAdmin) {
        const fallbackAdmin: UserProfile = {
          uid: user.uid,
          email: emailLower,
          name: user.displayName || 'Administrator',
          role: 'admin',
          assignedCompany: 'ALL',
          rangeStart: null,
          rangeEnd: null,
          active: true,
          staffId: 'bootstrap_admin',
        };
        setProfile(fallbackAdmin);
        setAuthStatus('authorized');
        return;
      }
    }

    if (!user.emailVerified || !emailLower) {
      saveCachedUserProfile(null);
      setProfile(null);
      setAuthError('Email akun Google belum terverifikasi.');
      setAuthStatus('unauthorized');
      return;
    }

    try {
      if (isBootstrapAdmin) {
        // One-time global account reset upon first bootstrap admin login
        const metaRef = doc(firestore, 'system_meta', RESET_META_DOC_ID);
        let metaExists = false;
        try {
          const metaSnap = await getDoc(metaRef);
          metaExists = metaSnap.exists();
        } catch (err) {
          handleFirestoreError(
            err,
            OperationType.GET,
            `system_meta/${RESET_META_DOC_ID}`
          );
        }

        if (!metaExists) {
          try {
            await deleteCollectionInBatches('staff_whitelist');
            await deleteCollectionInBatches('users');
            await deleteCollectionInBatches('admins');
            await setDoc(metaRef, {
              resetByUid: user.uid,
              resetAt: serverTimestamp(),
            });
          } catch (err) {
            handleFirestoreError(
              err,
              OperationType.WRITE,
              `system_meta/${RESET_META_DOC_ID}`
            );
          }
        }

        const staffRef = doc(firestore, 'staff_whitelist', 'bootstrap_admin');
        let staffData: Record<string, unknown> | null = null;
        try {
          const staffSnap = await getDoc(staffRef);
          if (!staffSnap.exists()) {
            const payload = {
              email: emailLower,
              name: (user.displayName || 'Administrator').slice(0, 100),
              role: 'admin',
              assignedCompany: 'ALL',
              rangeStart: null,
              rangeEnd: null,
              active: true,
              createdByUid: user.uid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            };
            await setDoc(staffRef, payload);
            staffData = payload;
          } else {
            staffData = staffSnap.data();
          }
        } catch (err) {
          handleFirestoreError(
            err,
            OperationType.WRITE,
            'staff_whitelist/bootstrap_admin'
          );
        }

        const adminRef = doc(firestore, 'admins', user.uid);
        try {
          const adminSnap = await getDoc(adminRef);
          if (!adminSnap.exists()) {
            await setDoc(adminRef, {
              uid: user.uid,
              email: emailLower,
              staffId: 'bootstrap_admin',
              createdAt: serverTimestamp(),
            });
          }
        } catch (err) {
          handleFirestoreError(
            err,
            OperationType.WRITE,
            `admins/${user.uid}`
          );
        }

        const adminName = String(
          staffData?.name || user.displayName || 'Administrator'
        ).slice(0, 100);
        const assignedCompany =
          (staffData?.assignedCompany as AssignedCompany) || 'ALL';
        const rangeStart =
          typeof staffData?.rangeStart === 'number'
            ? staffData.rangeStart
            : null;
        const rangeEnd =
          typeof staffData?.rangeEnd === 'number' ? staffData.rangeEnd : null;

        const userRef = doc(firestore, 'users', user.uid);
        try {
          const userSnap = await getDoc(userRef);
          if (!userSnap.exists()) {
            await setDoc(userRef, {
              uid: user.uid,
              email: emailLower,
              name: adminName,
              role: 'admin',
              assignedCompany,
              rangeStart,
              rangeEnd,
              active: true,
              staffId: 'bootstrap_admin',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } else {
            const existing = userSnap.data();
            if (
              existing.role !== 'admin' ||
              existing.active !== true ||
              existing.staffId !== 'bootstrap_admin' ||
              existing.assignedCompany !== assignedCompany
            ) {
              await updateDoc(userRef, {
                name: adminName,
                role: 'admin',
                assignedCompany,
                rangeStart,
                rangeEnd,
                active: true,
                staffId: 'bootstrap_admin',
                updatedAt: serverTimestamp(),
              });
            }
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
        }

        const resolved: UserProfile = {
          uid: user.uid,
          email: emailLower,
          name: adminName,
          role: 'admin',
          assignedCompany,
          rangeStart,
          rangeEnd,
          active: true,
          staffId: 'bootstrap_admin',
        };
        saveCachedUserProfile(resolved);
        setProfile(resolved);
        setAuthStatus('authorized');
        return;
      }

      // Non-bootstrap user: verify via staff_whitelist
      let staffDocId = '';
      let staffData: Record<string, unknown> | null = null;
      try {
        const wlQuery = query(
          collection(firestore, 'staff_whitelist'),
          where('email', '==', emailLower),
          limit(1)
        );
        const wlSnap = await getDocs(wlQuery);
        if (!wlSnap.empty) {
          staffDocId = wlSnap.docs[0].id;
          staffData = wlSnap.docs[0].data();
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'staff_whitelist');
      }

      if (!staffData || !staffDocId) {
        saveCachedUserProfile(null);
        setProfile(null);
        setAuthStatus('unauthorized');
        return;
      }

      if (staffData.active !== true) {
        saveCachedUserProfile(null);
        setProfile(null);
        setAuthStatus('inactive');
        return;
      }

      const staffRole: UserRole =
        staffData.role === 'admin' ? 'admin' : 'petugas';
      const staffName = String(
        staffData.name || user.displayName || emailLower
      ).slice(0, 100);
      const assignedCompany: AssignedCompany =
        (staffData.assignedCompany as AssignedCompany) || 'ALL';
      const rangeStart =
        typeof staffData.rangeStart === 'number' ? staffData.rangeStart : null;
      const rangeEnd =
        typeof staffData.rangeEnd === 'number' ? staffData.rangeEnd : null;

      if (staffRole === 'admin') {
        const adminRef = doc(firestore, 'admins', user.uid);
        try {
          const adminSnap = await getDoc(adminRef);
          if (!adminSnap.exists()) {
            await setDoc(adminRef, {
              uid: user.uid,
              email: emailLower,
              staffId: staffDocId,
              createdAt: serverTimestamp(),
            });
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `admins/${user.uid}`);
        }
      }

      const userRef = doc(firestore, 'users', user.uid);
      try {
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          await setDoc(userRef, {
            uid: user.uid,
            email: emailLower,
            name: staffName,
            role: staffRole,
            assignedCompany,
            rangeStart,
            rangeEnd,
            active: true,
            staffId: staffDocId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          const existing = userSnap.data();
          if (staffRole === 'admin') {
            if (
              existing.role !== 'admin' ||
              existing.active !== true ||
              existing.staffId !== staffDocId ||
              existing.assignedCompany !== assignedCompany ||
              existing.name !== staffName
            ) {
              await updateDoc(userRef, {
                name: staffName,
                role: 'admin',
                assignedCompany,
                rangeStart,
                rangeEnd,
                active: true,
                staffId: staffDocId,
                updatedAt: serverTimestamp(),
              });
            }
          } else if (
            existing.name !== staffName ||
            existing.assignedCompany !== assignedCompany ||
            existing.active !== true ||
            (existing.rangeStart ?? null) !== rangeStart ||
            (existing.rangeEnd ?? null) !== rangeEnd
          ) {
            await updateDoc(userRef, {
              name: staffName,
              assignedCompany,
              rangeStart,
              rangeEnd,
              active: true,
              updatedAt: serverTimestamp(),
            });
          }
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
      }

      const resolved: UserProfile = {
        uid: user.uid,
        email: emailLower,
        name: staffName,
        role: staffRole,
        assignedCompany,
        rangeStart,
        rangeEnd,
        active: true,
        staffId: staffDocId,
      };
      saveCachedUserProfile(resolved);
      setProfile(resolved);
      setAuthStatus('authorized');
    } catch (err) {
      if (isNetworkOrOfflineError(err)) {
        const cached = loadCachedUserProfile(user.uid);
        if (cached) {
          setProfile({
            ...cached,
            assignedCompany: cached.assignedCompany || 'ALL',
          });
          setAuthStatus('authorized');
          return;
        }
      }

      let displayError =
        err instanceof Error
          ? err.message
          : 'Gagal memverifikasi akses akun ke database.';
      if (displayError.startsWith('{') && displayError.includes('"error"')) {
        displayError =
          'Akses akun belum diizinkan oleh aturan keamanan database. Silakan hubungi Administrator.';
      }
      setAuthError(displayError);
      setProfile(null);
      setAuthStatus('unauthorized');
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      setAuthError(null);
      if (!user) {
        setMemorySheetsToken(null);
        setProfile(null);
        setAuthStatus('signed_out');
        return;
      }
      setAuthStatus('loading');
      await resolveUserAccess(user);
    });
    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
      // Do NOT store googleProvider token as sheetsAccessToken:
      // googleProvider only requests basic profile/email, not Google Sheets scope.
      setMemorySheetsToken(null);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Gagal masuk dengan Google.';
      if (!msg.includes('popup-closed-by-user')) {
        setAuthError(msg);
      }
    }
  };

  const connectGoogleSheets = async (): Promise<string | null> => {
    setAuthError(null);
    try {
      const result = auth.currentUser
        ? await reauthenticateWithPopup(auth.currentUser, sheetsGoogleProvider)
        : await signInWithPopup(auth, sheetsGoogleProvider);
      const cred = GoogleAuthProvider.credentialFromResult(result);
      const token = cred?.accessToken || null;
      if (!token) {
        setMemorySheetsToken(null);
        throw new Error(
          'Token akses Google Sheets tidak diterima. Silakan coba lagi dan izinkan akses Google Sheets.'
        );
      }

      // Verify granted OAuth scopes include spreadsheets before saving in memory
      try {
        const infoRes = await fetch(
          `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(token)}`
        );
        if (infoRes.ok) {
          const info = (await infoRes.json()) as { scope?: string };
          const scopeStr = info.scope || '';
          if (
            !scopeStr.includes('https://www.googleapis.com/auth/spreadsheets')
          ) {
            setMemorySheetsToken(null);
            throw new Error(
              'Izin Google Sheets belum dicentang pada jendela persetujuan Google. Klik "Hubungkan Google Sheets" lalu centang kotak izin Google Sheets.'
            );
          }
        }
      } catch (scopeErr) {
        if (
          scopeErr instanceof Error &&
          scopeErr.message.includes('Izin Google Sheets belum dicentang')
        ) {
          throw scopeErr;
        }
        // Ignore transient tokeninfo network hiccups; Sheets API call itself will verify
      }

      setMemorySheetsToken(token);
      return token;
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Gagal menghubungkan izin Google Spreadsheet.';
      if (!msg.includes('popup-closed-by-user')) {
        throw new Error(msg);
      }
      return null;
    }
  };

  const clearSheetsToken = () => {
    setMemorySheetsToken(null);
  };

  const logout = async () => {
    setMemorySheetsToken(null);
    saveCachedUserProfile(null);
    await signOut(auth);
  };

  const refreshProfile = async () => {
    if (firebaseUser) {
      setAuthStatus('loading');
      await resolveUserAccess(firebaseUser);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        authStatus,
        authError,
        sheetsAccessToken,
        signInWithGoogle,
        connectGoogleSheets,
        clearSheetsToken,
        logout,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
