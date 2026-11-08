# Firestore Security Specification — PLUTUS Cable Production System

## 1. Access Control Model (Zero-Trust ABAC)
- **Default Deny**: All paths not explicitly matched (`/{document=**}`) deny all read and write access (`allow read, write: if false;`).
- **Authentication & Verification**: All authenticated operations require `request.auth != null` and `request.auth.token.email_verified == true`.
- **Ownership (`/workspaces/{userId}`)**:
  - Each user's workspace backup is stored at `/workspaces/{userId}` where `{userId}` MUST equal `request.auth.uid` (or be accessed by the bootstrapped admin `bibekbhusal387@gmail.com`).
  - Document ID `{userId}` is validated via `isValidId(userId)`.

## 2. Schema & Field Validation (`isValidWorkspaceSnapshot`)
- **Strict Allowed Keys**: `['ownerId', 'ownerEmail', 'payloadJson', 'orderCount', 'updatedAtIso', 'createdAt', 'updatedAt']` using `data.keys().hasAll(...)` and `data.keys().hasOnly(...)`.
- **Field Types & Bounds**:
  - `ownerId`: `string`, `size() >= 1 && size() <= 128`, must equal `userId` and `request.auth.uid`.
  - `ownerEmail`: `string`, `size() >= 3 && size() <= 256`.
  - `payloadJson`: `string`, `size() >= 2 && size() <= 950000` (bounded under Firestore's 1 MiB document limit).
  - `orderCount`: `int`, `>= 0 && <= 50000`.
  - `updatedAtIso`: `string`, `size() >= 10 && size() <= 64`.
  - `createdAt`: `timestamp`, must equal `request.time` on `create` and remain immutable (`request.resource.data.createdAt == resource.data.createdAt`) on `update`.
  - `updatedAt`: `timestamp`, must equal `request.time` on both `create` and `update`.
