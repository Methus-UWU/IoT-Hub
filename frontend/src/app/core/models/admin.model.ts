export type AdminUserRole = 'admin' | 'user' | 'operator' | 'viewer';
export type AdminUserStatus = 'active' | 'suspended';

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: AdminUserRole;
  status: AdminUserStatus;
  createdAt: string;
  lastLoginAt: string | null;
  /** Address of the last sign-in, from its Supabase session; null when unknown. */
  lastLoginIp: string | null;
  lastLoginAvailable: boolean;
}

/**
 * What an administrator may change. Email and password belong to the account
 * owner and Supabase Auth; the API rejects them here.
 */
export interface UpdateAdminUserPayload {
  username: string;
  role: AdminUserRole;
}

export interface CreateAdminUserPayload {
  email: string;
  username: string;
  password: string;
  role: AdminUserRole;
}

export interface DatabaseOverview {
  version: string;
  sizeBytes: number;
  databaseConnections: number;
  maxConnections: number;
  checkedAt: string;
}

