/** A planner change refused for a reason the traveller or agent can act on; `status` is the HTTP status. */
export class PlanError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 429 = 400,
  ) {
    super(message);
  }
}
