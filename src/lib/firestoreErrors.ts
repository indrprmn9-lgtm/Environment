import { auth } from './firebase';

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
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
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
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function isFirestorePermissionError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err || '');
  const lower = raw.toLowerCase();
  return (
    lower.includes('missing or insufficient permissions') ||
    lower.includes('permission-denied') ||
    lower.includes('permission_denied')
  );
}

export function formatFirestoreErrorForUser(
  err: unknown,
  fallback = 'Terjadi kesalahan saat menyimpan ke database.'
): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  if (!raw) return fallback;

  if (raw.startsWith('{') && raw.includes('"error"')) {
    try {
      const parsed = JSON.parse(raw) as Partial<FirestoreErrorInfo>;
      const msgLower = String(parsed.error || '').toLowerCase();
      if (
        msgLower.includes('insufficient permissions') ||
        msgLower.includes('permission')
      ) {
        const op = parsed.operationType ? ` (${parsed.operationType}` : '';
        const target = parsed.path ? `${op ? ' · ' : ' ('}${parsed.path}` : '';
        const suffix = op || target ? `${op}${target})` : '';
        return `Izin penyimpanan ditolak oleh server database${suffix}. Silakan muat ulang halaman atau Keluar lalu Masuk ulang dengan Google, dan pastikan akun serta perusahaan tugas Anda masih aktif di daftar Petugas Admin.`;
      }
      if (parsed.error) return String(parsed.error);
    } catch {
      // fall through to raw check
    }
  }

  if (isFirestorePermissionError(err)) {
    return 'Izin penyimpanan ditolak oleh server database. Silakan muat ulang halaman atau Keluar lalu Masuk ulang dengan Google, dan pastikan akun Anda masih aktif di daftar Petugas Admin.';
  }

  return raw;
}

