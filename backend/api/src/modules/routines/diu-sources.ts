import { DIU_DEPARTMENTS, departmentNoticeUrl } from '@diu/shared';
import type { DB } from '../../db/client.js';
import { routineSources } from '../../db/schema.js';

/** Adds every DIU department's notice page as a source (skips departments that already have one). */
export async function addDiuDepartmentSources(db: DB) {
  const existing = new Set((await db.select({ department: routineSources.department }).from(routineSources)).map((r) => r.department.toLowerCase()));
  const missing = DIU_DEPARTMENTS.filter((d) => !existing.has(d.name.toLowerCase()) && !existing.has(d.code.toLowerCase()));
  if (missing.length) await db.insert(routineSources).values(missing.map((d) => ({ department: d.name, url: departmentNoticeUrl(d.slug), kind: 'html' as const })));
  return missing.length;
}
