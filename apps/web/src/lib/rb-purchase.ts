export type RbParticipant = {
  id: string;
  nickname: string;
  attendance_tenths: number;
};
export type RbPurchaseReport = {
  from: string;
  until: string;
  participants: RbParticipant[];
};
export const MAX_RB_EXPERIENCE = 1_000_000_000_000_000_000n;
export function parseRbExperience(value: string): bigint | null {
  const normalized = value.replace(/[ \u00a0\u202f]/g, "");
  if (!/^\d{1,19}$/.test(normalized)) return null;
  const amount = BigInt(normalized);
  return amount > 0n && amount <= MAX_RB_EXPERIENCE ? amount : null;
}
export const formatRbExperience = (amount: bigint) =>
  amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f");
export const miniAttendance = (tenths: number) =>
  `${(tenths / 10).toLocaleString("ru-RU")}%`;
export function allocateRbExperience(
  total: bigint,
  participants: RbParticipant[],
) {
  if (total < 1n || total > MAX_RB_EXPERIENCE)
    throw new Error("INVALID_EXPERIENCE");
  if (!participants.length) return [];
  const seen = new Set<string>();
  for (const p of participants) {
    if (
      seen.has(p.id) ||
      !Number.isInteger(p.attendance_tenths) ||
      p.attendance_tenths < 200 ||
      p.attendance_tenths > 1000
    )
      throw new Error("INVALID_PARTICIPANTS");
    seen.add(p.id);
  }
  const weight = participants.reduce(
    (sum, p) => sum + BigInt(p.attendance_tenths),
    0n,
  );
  const shares = participants.map((p) => {
    const product = total * BigInt(p.attendance_tenths);
    return {
      ...p,
      units: product / weight,
      remainder: product % weight,
    };
  });
  const spare = Number(total - shares.reduce((sum, p) => sum + p.units, 0n));
  const priority = [...shares].sort((a, b) =>
    a.remainder === b.remainder
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (let i = 0; i < spare; i++) priority[i].units++;
  return shares.map(({ remainder, ...p }) => p);
}
