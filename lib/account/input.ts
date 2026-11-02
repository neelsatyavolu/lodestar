import { z } from "zod";

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;
const newPassword = z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH);

export const registerSchema = z.object({ email, password: newPassword });
export const loginSchema = z.object({ email, password: z.string().min(1).max(MAX_PASSWORD_LENGTH) });
export const forgotSchema = z.object({ email });
// A real token is 43 characters; one of the wrong shape gets the same answer as any dead link.
export const resetSchema = z.object({ token: z.string().max(100).catch(""), password: newPassword });
export const deleteSchema = z.object({ password: z.string().min(1).max(MAX_PASSWORD_LENGTH) });

/** What asking for a reset link answers, whether or not the address has an account. */
export const RESET_REQUESTED = "If an account exists for that address, a reset link is on its way.";
export const RESET_LINK_DEAD = "This reset link is no longer valid. Request a new one.";
