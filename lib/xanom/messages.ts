// What each Xanom sign-in failure tells the traveller. The callback redirects with ?xanom_error=<code>.

export const XANOM_ERRORS = {
  denied: "Xanom sign-in was cancelled.",
  expired: "That Xanom sign-in took too long or was started elsewhere. Try again.",
  failed: "Xanom sign-in didn't work. Try again in a moment.",
  unavailable: "Xanom sign-in isn't available right now. Use your email and password.",
  already_linked: "That Xanom account is already linked to a different Lodestar account.",
  other_xanom: "This Lodestar account is already linked to a different Xanom account.",
  email_mismatch: "To convert, sign in to Xanom with the same email as this Lodestar account. To use a different email, choose Link an existing Xanom account.",
  email_taken: "A Lodestar account with that email is linked to a different Xanom account. Sign in with its password.",
  signed_out: "Sign in to Lodestar first, then try again.",
  too_many: "Too many attempts. Try again in a few minutes.",
} as const;

export type XanomErrorCode = keyof typeof XANOM_ERRORS;

export const xanomErrorMessage = (code: string | null): string | null =>
  code && Object.hasOwn(XANOM_ERRORS, code) ? XANOM_ERRORS[code as XanomErrorCode] : code ? XANOM_ERRORS.failed : null;
