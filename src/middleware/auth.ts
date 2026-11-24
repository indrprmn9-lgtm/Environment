import type { NextFunction, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../lib/firebase-admin.ts';
import { resolveAuthorizedUser } from '../db/users.ts';
import type { UserProfile } from '../types/plant.ts';

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
  staffProfile?: UserProfile;
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token otentikasi tidak ditemukan.' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    if (!decodedToken.email || !decodedToken.email_verified) {
      return res
        .status(403)
        .json({ error: 'Email akun Google harus terverifikasi.' });
    }
    req.user = decodedToken;

    const access = await resolveAuthorizedUser({
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: Boolean(decodedToken.email_verified),
      displayName: decodedToken.name,
    });

    if (access.status === 'unauthorized') {
      return res.status(403).json({
        error: 'Akun Google Anda belum didaftarkan oleh Administrator.',
        code: 'UNAUTHORIZED_EMAIL',
      });
    }
    if (access.status === 'inactive' || !access.profile) {
      return res.status(403).json({
        error: 'Akun petugas Anda sedang dinonaktifkan oleh Administrator.',
        code: 'INACTIVE_STAFF',
      });
    }

    req.staffProfile = access.profile;
    next();
  } catch (error) {
    console.error('Auth verification error:', error);
    return res.status(401).json({
      error: 'Sesi login tidak valid atau sudah berakhir. Silakan login ulang.',
    });
  }
};

export const requireAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.staffProfile || req.staffProfile.role !== 'admin') {
    return res.status(403).json({
      error: 'Akses ditolak: fitur ini khusus Administrator.',
    });
  }
  next();
};
