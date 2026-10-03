import crypto from "node:crypto";
import type { Request } from "express";

export interface Institution {
  id: string;
  name: string;
  location: string;
  website: string;
}
export interface AppOptions {
  mode?: "college" | "workspace";
  institution?: Institution;
  adminKey?: string;
  /** Host-owned authentication: validate the host's session/JWT before returning a role. */
  authenticate?: (req: Request) => Promise<{
    subject: string;
    role: "admin" | "student";
    institutionId: string;
  } | null>;
}
export const defaultInstitution: Institution = {
  id: process.env.INSTITUTION_ID || "sfc-brooklyn",
  name: process.env.INSTITUTION_NAME || "St. Francis College",
  location: process.env.INSTITUTION_LOCATION || "Brooklyn, New York",
  website: process.env.INSTITUTION_WEBSITE || "https://www.sfc.edu",
};
export function institutionOwner(id: string) {
  if (!/^[a-z0-9-]{1,64}$/.test(id)) throw new Error("Invalid institution ID");
  return "institution:" + id;
}
export function equalSecret(a: string, b: string) {
  return crypto.timingSafeEqual(
    crypto.createHash("sha256").update(a).digest(),
    crypto.createHash("sha256").update(b).digest(),
  );
}
export function cookie(req: Request, name: string) {
  return req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(name + "="))
    ?.slice(name.length + 1);
}
export function signAdmin(
  key: string,
  owner: string,
  institution: string,
  expires: number,
) {
  return crypto
    .createHmac("sha256", key)
    .update(JSON.stringify(["admin", owner, institution, expires]))
    .digest("hex");
}
export function isAdmin(
  req: Request,
  key: string,
  owner: string,
  institution: string,
) {
  if (key.length < 32) return false;
  const [expiry, signature] = (cookie(req, "terrier_admin") || "").split(".");
  const expires = Number(expiry);
  return (
    !!signature &&
    Number.isSafeInteger(expires) &&
    expires > Date.now() &&
    expires <= Date.now() + 8 * 3600000 &&
    equalSecret(signature, signAdmin(key, owner, institution, expires))
  );
}
