import { getSilviIdb } from './offlineQueue';
import {
  getTodayDateString,
  type CanopyCover,
  type FieldCondition,
  type PlantRecord,
} from '../types/plant';

const STORE_KV = 'kv';
const KEY_BACKUP_DIR_HANDLE = 'backup_dir_handle';
const KEY_BACKUP_LABEL = 'silvitrack_backup_dir_label_v1';

interface DirectoryHandleWithPerm extends FileSystemDirectoryHandle {
  queryPermission?: (desc: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (desc: { mode: 'readwrite' }) => Promise<PermissionState>;
}

export interface BackupPreferenceInfo {
  folderName: string | null;
  supportsDirectoryPicker: boolean;
  hasDirectoryHandle: boolean;
}

export function supportsDirectoryPickerApi(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { showDirectoryPicker?: unknown })
      .showDirectoryPicker === 'function'
  );
}

export async function getBackupPreferenceInfo(): Promise<BackupPreferenceInfo> {
  let folderName: string | null = null;
  try {
    folderName = localStorage.getItem(KEY_BACKUP_LABEL);
  } catch {
    folderName = null;
  }

  let hasHandle = false;
  try {
    const db = await getSilviIdb();
    const handle = await db.get(STORE_KV, KEY_BACKUP_DIR_HANDLE);
    if (handle) {
      hasHandle = true;
      folderName = (handle as FileSystemDirectoryHandle).name || folderName;
    }
  } catch {
    hasHandle = false;
  }

  return {
    folderName,
    supportsDirectoryPicker: supportsDirectoryPickerApi(),
    hasDirectoryHandle: hasHandle,
  };
}

export async function pickPhoneBackupDirectory(): Promise<{
  folderName: string;
  mode: 'directory_handle' | 'download_fallback';
}> {
  if (!supportsDirectoryPickerApi()) {
    const fallbackLabel = 'Folder Unduhan Perangkat (Download Otomatis)';
    try {
      localStorage.setItem(KEY_BACKUP_LABEL, fallbackLabel);
    } catch {
      // ignore
    }
    return { folderName: fallbackLabel, mode: 'download_fallback' };
  }

  const picker = (
    window as unknown as {
      showDirectoryPicker: (opts?: {
        mode?: 'readwrite';
      }) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;

  const dirHandle = await picker({ mode: 'readwrite' });
  const db = await getSilviIdb();
  await db.put(STORE_KV, dirHandle, KEY_BACKUP_DIR_HANDLE);
  try {
    localStorage.setItem(KEY_BACKUP_LABEL, dirHandle.name);
  } catch {
    // ignore
  }
  return { folderName: dirHandle.name, mode: 'directory_handle' };
}

export interface DailyBackupPayload {
  backupDate: string;
  generatedAt: string;
  officerEmail: string;
  totalPlantRecordsToday: number;
  plantRecords: PlantRecord[];
  fieldConditions: FieldCondition[];
  canopyCovers: CanopyCover[];
}

export function buildTodayBackupPayload(params: {
  officerEmail: string;
  allRecords: PlantRecord[];
  fieldConditions: FieldCondition[];
  canopyCovers: CanopyCover[];
}): DailyBackupPayload {
  const today = getTodayDateString();
  const periodeToday = today.slice(0, 7);
  const todayRecords = params.allRecords.filter(
    (r) => r.tanggalInput === today
  );
  const todayConds = params.fieldConditions.filter(
    (fc) => fc.periode === periodeToday
  );
  const todayCanopy = params.canopyCovers.filter(
    (cc) => cc.periode === periodeToday
  );

  return {
    backupDate: today,
    generatedAt: new Date().toISOString(),
    officerEmail: params.officerEmail,
    totalPlantRecordsToday: todayRecords.length,
    plantRecords: todayRecords,
    fieldConditions: todayConds,
    canopyCovers: todayCanopy,
  };
}

/**
 * Automatically writes today's field data backup to the chosen phone directory handle
 * if permission is already granted (no popup interrupt during field work).
 */
export async function autoWriteDailyBackupToHandle(
  payload: DailyBackupPayload
): Promise<boolean> {
  if (payload.totalPlantRecordsToday === 0) return false;
  try {
    const db = await getSilviIdb();
    const handle = (await db.get(STORE_KV, KEY_BACKUP_DIR_HANDLE)) as
      | DirectoryHandleWithPerm
      | undefined;
    if (!handle) return false;

    if (handle.queryPermission) {
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') return false;
    }

    const fileName = `Environment_Cadangan_${payload.backupDate}.json`;
    const fileHandle = await handle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(payload, null, 2));
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Explicit user-triggered backup save: writes to chosen folder (requesting permission if needed)
 * or triggers a clean daily JSON file download to the phone's Downloads folder.
 */
export async function exportTodayBackupFile(
  payload: DailyBackupPayload
): Promise<{ savedVia: 'directory' | 'download'; fileName: string }> {
  const fileName = `Environment_Cadangan_${payload.backupDate}.json`;
  try {
    const db = await getSilviIdb();
    const handle = (await db.get(STORE_KV, KEY_BACKUP_DIR_HANDLE)) as
      | DirectoryHandleWithPerm
      | undefined;
    if (handle) {
      let perm: PermissionState = 'granted';
      if (handle.queryPermission) {
        perm = await handle.queryPermission({ mode: 'readwrite' });
      }
      if (perm !== 'granted' && handle.requestPermission) {
        perm = await handle.requestPermission({ mode: 'readwrite' });
      }
      if (perm === 'granted') {
        const fileHandle = await handle.getFileHandle(fileName, {
          create: true,
        });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(payload, null, 2));
        await writable.close();
        return { savedVia: 'directory', fileName };
      }
    }
  } catch {
    // Fall back to standard download
  }

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return { savedVia: 'download', fileName };
}
