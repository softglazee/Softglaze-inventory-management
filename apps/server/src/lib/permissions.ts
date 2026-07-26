/**
 * Runtime permission cache (A2). Reads RolePermission once and keeps it in memory;
 * SUPER_ADMIN always resolves to ALL keys. Cache is invalidated when the matrix
 * is saved (see permissions.routes.ts).
 */
import { Role } from "@prisma/client";
import { prisma } from "./prisma";
import { ALL_PERMISSION_KEYS } from "../data/permissions";

let cache: Map<Role, Set<string>> | null = null;

async function loadCache(): Promise<Map<Role, Set<string>>> {
  const rows = await prisma.rolePermission.findMany();
  const map = new Map<Role, Set<string>>();
  for (const r of rows) {
    if (!map.has(r.role)) map.set(r.role, new Set());
    map.get(r.role)!.add(r.permissionKey);
  }
  cache = map;
  return map;
}

export function invalidatePermissionCache(): void {
  cache = null;
}

async function getCache(): Promise<Map<Role, Set<string>>> {
  return cache ?? (await loadCache());
}

/** All permission keys a role currently holds (SUPER_ADMIN → every key). */
export async function getPermissionsForRole(role: Role): Promise<string[]> {
  if (role === Role.SUPER_ADMIN) return [...ALL_PERMISSION_KEYS];
  const map = await getCache();
  return [...(map.get(role) ?? new Set<string>())];
}

/** Does this role hold the given permission key? */
export async function roleHasPermission(role: Role, key: string): Promise<boolean> {
  if (role === Role.SUPER_ADMIN) return true;
  const map = await getCache();
  return map.get(role)?.has(key) ?? false;
}
