import { eq } from 'drizzle-orm';
import { db } from './index.ts';
import { staffWhitelist, users } from './schema.ts';
import type { AssignedCompany, UserProfile, UserRole } from '../types/plant.ts';

export const BOOTSTRAP_ADMIN_EMAIL = 'indrprmn9@gmail.com';

function normalizeAssignedCompany(raw?: string | null): AssignedCompany {
  if (raw === 'PT. NBSS' || raw === 'PT. DTSA' || raw === 'PT. DTR') {
    return raw;
  }
  return 'ALL';
}

function normalizeRole(raw?: string | null): UserRole {
  return raw === 'admin' ? 'admin' : 'petugas';
}

export async function resolveAuthorizedUser(params: {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
}): Promise<{
  status: 'authorized' | 'unauthorized' | 'inactive';
  profile: UserProfile | null;
}> {
  const emailLower = params.email.trim().toLowerCase();
  const isBootstrapAdmin =
    params.emailVerified && emailLower === BOOTSTRAP_ADMIN_EMAIL;

  try {
    if (isBootstrapAdmin) {
      const existingUsers = await db
        .select()
        .from(users)
        .where(eq(users.uid, params.uid))
        .limit(1);

      const resolvedName =
        existingUsers[0]?.name || params.displayName || 'Administrator';

      const staffRows = await db
        .insert(staffWhitelist)
        .values({
          id: 'bootstrap_admin',
          email: emailLower,
          name: resolvedName,
          role: 'admin',
          assignedCompany: 'ALL',
          active: true,
          createdByUid: params.uid,
        })
        .onConflictDoUpdate({
          target: staffWhitelist.email,
          set: {
            role: 'admin',
            active: true,
            updatedAt: new Date(),
          },
        })
        .returning();

      const staffRow = staffRows[0];

      const upserted = await db
        .insert(users)
        .values({
          uid: params.uid,
          email: emailLower,
          name: resolvedName,
          role: 'admin',
          assignedCompany: 'ALL',
          rangeStart: staffRow?.rangeStart ?? null,
          rangeEnd: staffRow?.rangeEnd ?? null,
          active: true,
          staffId: 'bootstrap_admin',
        })
        .onConflictDoUpdate({
          target: users.uid,
          set: {
            email: emailLower,
            role: 'admin',
            assignedCompany: 'ALL',
            rangeStart: staffRow?.rangeStart ?? null,
            rangeEnd: staffRow?.rangeEnd ?? null,
            active: true,
            updatedAt: new Date(),
          },
        })
        .returning();

      const u = upserted[0];
      return {
        status: 'authorized',
        profile: {
          uid: u.uid,
          email: u.email,
          name: u.name,
          role: 'admin',
          assignedCompany: normalizeAssignedCompany(u.assignedCompany),
          rangeStart: u.rangeStart ?? null,
          rangeEnd: u.rangeEnd ?? null,
          active: u.active,
          staffId: u.staffId,
        },
      };
    }

    const staffRows = await db
      .select()
      .from(staffWhitelist)
      .where(eq(staffWhitelist.email, emailLower))
      .limit(1);

    if (staffRows.length === 0) {
      return { status: 'unauthorized', profile: null };
    }

    const staff = staffRows[0];
    if (!staff.active) {
      await db
        .update(users)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(users.uid, params.uid));
      return { status: 'inactive', profile: null };
    }

    const resolvedName =
      staff.name || params.displayName || emailLower.split('@')[0];
    const resolvedRole = normalizeRole(staff.role);
    const resolvedCompany = normalizeAssignedCompany(staff.assignedCompany);

    const upserted = await db
      .insert(users)
      .values({
        uid: params.uid,
        email: emailLower,
        name: resolvedName,
        role: resolvedRole,
        assignedCompany: resolvedCompany,
        rangeStart: staff.rangeStart ?? null,
        rangeEnd: staff.rangeEnd ?? null,
        active: true,
        staffId: staff.id,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: emailLower,
          name: resolvedName,
          role: resolvedRole,
          assignedCompany: resolvedCompany,
          rangeStart: staff.rangeStart ?? null,
          rangeEnd: staff.rangeEnd ?? null,
          active: true,
          staffId: staff.id,
          updatedAt: new Date(),
        },
      })
      .returning();

    const u = upserted[0];
    return {
      status: 'authorized',
      profile: {
        uid: u.uid,
        email: u.email,
        name: u.name,
        role: normalizeRole(u.role),
        assignedCompany: normalizeAssignedCompany(u.assignedCompany),
        rangeStart: u.rangeStart ?? null,
        rangeEnd: u.rangeEnd ?? null,
        active: u.active,
        staffId: u.staffId,
      },
    };
  } catch (error) {
    console.error('Database user resolution failed:', error);
    throw new Error('Gagal memverifikasi akses akun di server database.', {
      cause: error,
    });
  }
}
