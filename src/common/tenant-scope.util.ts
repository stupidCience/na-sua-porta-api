export type TenantScopeWhere = { condominiumId: string } | { condominiumId: null };

// Centraliza o escopo de tenancy para evitar duplicacao em consultas Prisma.
export function tenantScope(condominiumId?: string): TenantScopeWhere {
  return condominiumId ? { condominiumId } : { condominiumId: null };
}
