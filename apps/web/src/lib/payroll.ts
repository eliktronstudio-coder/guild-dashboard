export type PayrollRow = {
  id: string;
  nickname: string;
  payout_weight: number;
  status: string;
  available: string;
  present: string;
  percentage: number | null;
  prime_percentage: number | null;
  mini_percentage: number | null;
  pvp_percentage: number | null;
  eligible: boolean;
  prime_projection: string;
  mini_projection: string;
  prime_fixed: string;
  mini_fixed: string;
  prime_paid: string;
  mini_paid: string;
};
export type PayrollReport = {
  from: string;
  until: string;
  rows: PayrollRow[];
  prime_units: string;
  mini_units: string;
  signature: string | null;
};
export const payrollDue = (row: PayrollRow, source: "prime" | "mini") =>
  (
    BigInt(row[`${source}_projection`]) + BigInt(row[`${source}_fixed`])
  ).toString();
export const attendancePercent = (value: number | null) =>
  value === null ? "—" : `${value.toLocaleString("ru-RU")}%`;
