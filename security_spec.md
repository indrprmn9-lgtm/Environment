# Security Specification — SilviTrack Firestore Rules

## 1. Data Invariants
1. Only authenticated users with verified emails (`email_verified == true`) who are either the bootstrapped administrator (`indrprmn9@gmail.com`), listed in `/admins/{uid}`, or registered as `active: true` in `/users/{uid}` (backed by `/staff_whitelist`) may read or create field data.
2. Field officers (`petugas`) can create `plant_records`, `field_conditions`, `canopy_covers`, and `locations_master`, and update `field_conditions`/`canopy_covers` for their active work, but **cannot** update or delete existing `plant_records` (anti-overwrite & audit protection). Only `admin` can update or delete `plant_records` or manage `staff_whitelist`.
3. `createdByUid` and `createdAt` are immutable once created. All timestamps (`createdAt`, `updatedAt`) must match `request.time`.
4. `plant_records` strictly validates the 2 plant groups (`FGS` vs `LOKAL_MPTS`), all 19 allowed species names, positive height/diameter bounds, and 4 health conditions (`Sehat`, `Kurang Sehat`, `Merana`, `Mati`).
5. PII (`staff_whitelist` and `users` containing `email`) is never readable via blanket `isSignedIn()`; non-admins may only read their own email/UID record.

## 2. The "Dirty Dozen" Attack Payloads (All Must Return PERMISSION_DENIED)
1. **Unauthenticated Write**: Creating `plant_records/sensus__lok__1` with `request.auth == null`.
2. **Unverified Email Spoof**: Creating `plant_records/sensus__lok__1` with `email == 'indrprmn9@gmail.com'` and `email_verified == false`.
3. **Unauthorized Outsider Write**: Signed-in Google user not in `staff_whitelist` or `users` attempting to create a `plant_records` doc.
4. **Self-Privilege Escalation (User Profile)**: Petugas creating `/users/{uid}` with `role: 'admin'` when their `staff_whitelist` entry has `role: 'petugas'`.
5. **Self-Privilege Escalation (Admins Collection)**: Petugas creating `/admins/{uid}` without an active `role: 'admin'` doc in `staff_whitelist`.
6. **Shadow Field Injection**: Creating `plant_records` with an extra ghost key `{ ..., isApproved: true }`.
7. **Identity Spoofing**: Petugas creating `plant_records` with `createdByUid` set to another user's UID.
8. **Client Timestamp Forgery**: Creating `plant_records` with `createdAt` set to a past client timestamp instead of `request.time`.
9. **Petugas Overwriting Plant Record**: Petugas calling `update` or `delete` on an existing `plant_records` document (e.g., to alter another officer's measurement or bypass uniqueness).
10. **Invalid Species / Negative Dimension Poisoning**: Creating `plant_records` with `tinggiCm: -50` or `jenisTanaman: "Pohon X"`.
11. **ID Poisoning**: Writing to `plant_records` with a 500-character invalid document ID containing `$` or spaces.
12. **PII Scraping (`staff_whitelist` / `users`)**: Non-admin Petugas running a blanket `list` query on `staff_whitelist` without `where('email', '==', ownEmail)`.
