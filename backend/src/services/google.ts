import { OAuth2Client } from "google-auth-library";
import { GOOGLE_CLIENT_IDS } from "../config";
import { HttpError } from "../util";

export interface GoogleProfile { sub: string; email?: string; emailVerified: boolean; name?: string; picture?: string }
type Verifier = (idToken: string) => Promise<GoogleProfile>;

const client = new OAuth2Client();

const realVerifier: Verifier = async idToken => {
  if (!GOOGLE_CLIENT_IDS.length) throw new HttpError(501, "Google sign-in is not configured on the server (GOOGLE_CLIENT_IDS)");
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_IDS });
    const p = ticket.getPayload();
    if (!p?.sub) throw new Error("no subject");
    return { sub: p.sub, email: p.email, emailVerified: !!p.email_verified, name: p.name, picture: p.picture };
  } catch {
    throw new HttpError(401, "Invalid Google token");
  }
};

let verifier: Verifier = realVerifier;
export const verifyGoogleToken = (t: string) => verifier(t);
/** Test hook: replace the verifier (e.g. in the smoke test). */
export const setGoogleVerifier = (v: Verifier | null) => { verifier = v ?? realVerifier; };
export const googleConfigured = () => GOOGLE_CLIENT_IDS.length > 0;
