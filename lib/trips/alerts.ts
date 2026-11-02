// When a saved trip's daily check should email the traveller. Pure, so the
// rules are tested without a database, a fare search or an email service.

export type AlertState = {
  /** The fare a drop is measured from: the saved fare, then the last fare we alerted at. */
  alertPrice: number;
  alertDrop: boolean;
  targetPrice: number | null;
  targetHit: boolean;
  /** YYYY-MM-DD. */
  remindOn: string | null;
  reminded: boolean;
  /** YYYY-MM-DD of the earliest departure among the trip's searches. */
  firstDepart: string;
};

export type AlertReason = "drop" | "target" | "remind";

/** A drop worth an email: at least $10 and at least 3% below the last alert. */
const MIN_DROP = 10;
const MIN_DROP_SHARE = 0.03;

export function isDue(s: AlertState, today: string): boolean {
  if (s.firstDepart <= today) return false;
  return s.alertDrop || (s.targetPrice !== null && !s.targetHit) || (s.remindOn !== null && !s.reminded);
}

export function decideAlerts(s: AlertState, cheapest: number | null, today: string): { reasons: AlertReason[]; next: Pick<AlertState, "alertPrice" | "targetHit" | "reminded"> } {
  const reasons: AlertReason[] = [];
  const drop = cheapest !== null && s.alertDrop && cheapest <= s.alertPrice - Math.max(MIN_DROP, s.alertPrice * MIN_DROP_SHARE);
  const target = cheapest !== null && s.targetPrice !== null && !s.targetHit && cheapest <= s.targetPrice;
  const remind = s.remindOn !== null && !s.reminded && s.remindOn <= today;
  if (drop) reasons.push("drop");
  if (target) reasons.push("target");
  if (remind) reasons.push("remind");
  return {
    reasons,
    next: {
      alertPrice: drop && cheapest !== null ? cheapest : s.alertPrice,
      targetHit: s.targetHit || target,
      reminded: s.reminded || remind,
    },
  };
}
