import { randomInt } from "crypto";

export function generateSecureOTP(): string {
  return randomInt(100000, 1000000).toString();
}
