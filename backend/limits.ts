/** Explicit operator tuning; defaults protect the existing small deployment. */
export function positiveLimit(name: string, fallback: number, ceiling: number) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0
    ? Math.min(value, ceiling)
    : fallback;
}
export function documentLimits(owner: string, cloud: boolean) {
  return owner.startsWith("institution:")
    ? {
        count: positiveLimit("INSTITUTION_DOCUMENT_LIMIT", 100, 10000),
        bytes:
          positiveLimit("INSTITUTION_STORAGE_MB", cloud ? 80 : 500, 10000) *
          1024 ** 2,
        total:
          positiveLimit("TOTAL_STORAGE_MB", cloud ? 100 : 1024, 100000) *
          1024 ** 2,
      }
    : {
        count: cloud ? 10 : 30,
        bytes: (cloud ? 20 : 100) * 1024 ** 2,
        total: (cloud ? 100 : 1024) * 1024 ** 2,
      };
}
