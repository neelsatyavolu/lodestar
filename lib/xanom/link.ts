import { randomUUID } from "node:crypto";
import type { Db } from "../db/client";
import { savePreferences } from "../db/preferences";
import { getUser, findUserByEmail } from "../db/users";
import { attachXanom, insertXanomUser, lockUser, refreshXanomEmail, revokeAccess, userIdForXanomSub } from "../db/xanom";
import { DEFAULT_PREFERENCES } from "../preferences";
import type { XanomIdentity } from "./oidc";
import type { Intent } from "./state";

export type LinkRefusal =
  /** The Xanom account is already linked to a different Lodestar account. */
  | "already_linked"
  /** This Lodestar account is linked to a different Xanom account. */
  | "other_xanom"
  /** Convert needs the Xanom email to be the account's own. */
  | "email_mismatch"
  /** A Lodestar account has this email but is linked to another Xanom account. */
  | "email_taken"
  /** The account that asked to link is gone or no longer signed in. */
  | "signed_out";

export type LinkResult = { ok: true; userId: string; created: boolean } | { ok: false; reason: LinkRefusal };

const done = (userId: string, created = false): LinkResult => ({ ok: true, userId, created });
const refuse = (reason: LinkRefusal): LinkResult => ({ ok: false, reason });

/**
 * Who a verified Xanom identity signs in as, applying the spec's linking rules in order:
 * 1. the account already linked to this sub;
 * 2. for link/convert with someone signed in, that account (refused if the sub is on someone else,
 *    and for convert the emails must match);
 * 3. the account with the same email, with the pre-hijacking guard when the email was never proven;
 * 4. a new account with no password.
 * Rule 2 runs before rule 1 when someone is signed in to link: linking must never switch accounts.
 */
export async function linkXanom(db: Db, id: XanomIdentity, ctx: { intent: Intent; currentUserId: string | null; now: number }): Promise<LinkResult> {
  return db.transaction(async (tx) => {
    const linked = await userIdForXanomSub(tx, id.sub);

    if (ctx.intent !== "signin" && ctx.currentUserId) {
      if (linked) return linked === ctx.currentUserId ? done(linked) : refuse("already_linked");
      await lockUser(tx, ctx.currentUserId);
      const me = await getUser(tx, ctx.currentUserId);
      if (!me) return refuse("signed_out");
      if (me.xanomSub) return refuse("other_xanom");
      if (ctx.intent === "convert" && me.email !== id.email) return refuse("email_mismatch");
      if (!(await attachXanom(tx, me.id, id.sub, id.email))) return refuse("other_xanom");
      return done(me.id);
    }

    if (linked) {
      await refreshXanomEmail(tx, linked, id.email);
      return done(linked);
    }

    const found = await findUserByEmail(tx, id.email);
    if (found) await lockUser(tx, found.id);
    const sameEmail = found && (await getUser(tx, found.id));
    if (sameEmail) {
      if (sameEmail.xanomSub) return refuse("email_taken");
      if (!sameEmail.emailVerified && sameEmail.passwordHash) await revokeAccess(tx, sameEmail.id);
      // Checked under the lock and again in the update: a link racing this one can't overwrite it.
      if (!(await attachXanom(tx, sameEmail.id, id.sub, id.email))) return refuse("email_taken");
      return done(sameEmail.id);
    }

    const userId = randomUUID();
    if (!(await insertXanomUser(tx, { id: userId, email: id.email, sub: id.sub, now: ctx.now }))) return refuse("email_taken");
    await savePreferences(tx, userId, { ...DEFAULT_PREFERENCES, displayName: id.name.slice(0, 60) }, ctx.now);
    return done(userId, true);
  });
}
