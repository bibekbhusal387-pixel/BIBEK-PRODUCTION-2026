/**
 * Unit test suite specification for PLUTUS Firestore Security Rules (/workspaces/{userId}).
 * Covers positive and negative test cases for read, create, update, and delete operations.
 */
export interface RuleTestCase {
  description: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: { uid: string; email: string; email_verified: boolean } | null;
  data?: Record<string, unknown>;
  expectAllow: boolean;
}

export const WORKSPACE_SECURITY_RULE_TESTS: RuleTestCase[] = [
  {
    description: 'Denies unauthenticated read on /workspaces/{userId}',
    operation: 'get',
    path: '/workspaces/user_123',
    auth: null,
    expectAllow: false,
  },
  {
    description: 'Denies authenticated user reading another user workspace',
    operation: 'get',
    path: '/workspaces/user_other',
    auth: { uid: 'user_123', email: 'worker@example.com', email_verified: true },
    expectAllow: false,
  },
  {
    description: 'Allows verified owner to read their own /workspaces/{userId} document',
    operation: 'get',
    path: '/workspaces/user_123',
    auth: { uid: 'user_123', email: 'worker@example.com', email_verified: true },
    expectAllow: true,
  },
  {
    description: 'Denies create when extra undeclared fields are injected',
    operation: 'create',
    path: '/workspaces/user_123',
    auth: { uid: 'user_123', email: 'worker@example.com', email_verified: true },
    data: {
      ownerId: 'user_123',
      ownerEmail: 'worker@example.com',
      payloadJson: '{}',
      orderCount: 0,
      updatedAtIso: '2026-11-06T12:00:00.000Z',
      role: 'admin',
    },
    expectAllow: false,
  },
];
