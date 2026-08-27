export interface Role {
  id: string;
  name: string;
}

/** Persistence contract for roles. See docs/adr/ADR-001-database-access.md. */
export abstract class RoleRepository {
  abstract findByName(name: string): Promise<Role | null>;

  abstract listNames(): Promise<string[]>;
}
