// A flight's live state as the trip page shows it, read from AeroDataBox.
// Times are local to each airport, with that airport's zone abbreviation.

export type Phase = "scheduled" | "checkin" | "boarding" | "departed" | "landed" | "delayed" | "cancelled" | "diverted" | "unknown";

/** A moment at one airport: "2026-11-21" + "10:20" in its own zone, and the instant for maths. */
export type Moment = { date: string; time: string; utc: number };

export type Endpoint = {
  code: string | null;
  name: string | null;
  city: string | null;
  /** "PST", "MST": the zone at that moment. */
  zone: string | null;
  terminal: string | null;
  gate: string | null;
  /** Arrival only: the baggage belt. */
  baggage: string | null;
  scheduled: Moment | null;
  /** The best newer time: actual once it happened, else revised or predicted. */
  latest: Moment | null;
  /** True once `latest` is what happened, not a forecast. */
  actual: boolean;
};

export type FlightStatus = {
  phase: Phase;
  departure: Endpoint;
  arrival: Endpoint;
  aircraft: string | null;
  airline: string | null;
  /** Minutes late at departure (negative when early), from the latest time against the schedule. */
  delay: number | null;
  /** When Lodestar last asked. */
  checkedAt: number;
};
