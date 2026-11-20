export type MiniAppPeriod = "week" | "month";
export type MiniAppData = {
  expires_at: number;
  nickname: string;
  period: MiniAppPeriod;
  stats: {
    period_from: string;
    period_through: string;
    present: number;
    applicable: number;
    percentage: number | null;
    earned_units: string;
    paid_units: string;
    pending_units: string;
  };
  events: {
    id: string;
    title: string;
    starts_at: string;
    signed_up: boolean;
  }[];
};
