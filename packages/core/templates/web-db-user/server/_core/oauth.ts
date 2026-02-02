import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs")
);

export function registerOAuthRoutes(app: Express) {
  app.post("/api/auth/google", async (req: Request, res: Response) => {
    const { token } = req.body;

    if (!token) {
      res.status(400).json({ error: "Token is required" });
      return;
    }

    try {
      const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
      });

      const openId = payload.sub;
      if (!openId) {
        throw new Error("Missing sub in payload");
      }

      // Upsert user based on Google profile
      await db.upsertUser({
        id: openId,
        name: (payload.name as string) || null,
        email: (payload.email as string) || null,
        loginMethod: "google",
        lastSignedIn: new Date(),
      });

      // Create session
      const sessionToken = await sdk.createSessionToken(openId, {
        name: (payload.name as string) || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: ONE_YEAR_MS,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("[OAuth] Verification failed", error);
      res.status(401).json({ error: "Authentication failed" });
    }
  });
}
