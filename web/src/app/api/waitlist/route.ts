import { NextResponse } from "next/server";
import { guardApiRequest, genericErrorResponse } from "@/lib/api-guard";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface WaitlistPayload {
  email?: unknown;
  wantsData?: unknown;
  source?: unknown;
  locale?: unknown;
  country?: unknown;
  company?: unknown;
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function countryFromRequest(request: Request, payload: WaitlistPayload): string | null {
  const headerCountry =
    cleanText(request.headers.get("x-vercel-ip-country"), 64) ||
    cleanText(request.headers.get("cf-ipcountry"), 64);
  if (headerCountry && headerCountry.toUpperCase() !== "XX") {
    return headerCountry.toUpperCase();
  }
  return cleanText(payload.country, 64);
}

function localeFromPayload(payload: WaitlistPayload): "es" | "en" | null {
  return payload.locale === "es" || payload.locale === "en"
    ? payload.locale
    : null;
}

export async function POST(request: Request) {
  const blocked = guardApiRequest(request, { limit: 5 });
  if (blocked) return blocked;

  let body: WaitlistPayload;
  try {
    body = (await request.json()) as WaitlistPayload;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const honeypot = cleanText(body.company, 120);
  if (honeypot) {
    return NextResponse.json({ ok: true });
  }

  const email = cleanText(body.email, 320)?.toLowerCase() ?? "";
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }

  try {
    const { error } = await getSupabaseAdmin()
      .from("waitlist")
      .upsert(
        {
          email,
          wants_data: body.wantsData === true,
          source: cleanText(body.source, 120),
          locale: localeFromPayload(body),
          country: countryFromRequest(request, body),
        },
        { onConflict: "email" },
      );

    if (error) {
      throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return genericErrorResponse("waitlist", err, 500);
  }
}
