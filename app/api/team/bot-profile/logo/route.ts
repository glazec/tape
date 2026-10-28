import { getAdminTeamSettingsWorkspace } from "@/lib/team-settings-access";
import { fetchWebsiteLogo, WebsiteLogoError } from "@/lib/website-logo";

export const runtime = "nodejs";

/** Finds a website's logo so an admin can preview it as the bot avatar. */
export async function GET(request: Request) {
  const workspace = await getAdminTeamSettingsWorkspace(request);

  if (workspace instanceof Response) {
    return workspace;
  }

  const website = new URL(request.url).searchParams.get("url") ?? "";

  try {
    const logo = await fetchWebsiteLogo(website);

    return new Response(Buffer.from(logo.bytes), {
      headers: {
        "cache-control": "private, no-store",
        // An SVG logo is served from our origin; never let it run script.
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "content-type": logo.contentType,
        "x-content-type-options": "nosniff",
        "x-logo-source": logo.sourceUrl,
      },
    });
  } catch (error) {
    if (error instanceof WebsiteLogoError) {
      return Response.json({ error: error.message }, { status: 422 });
    }

    console.error("bot_logo_fetch_failed", { error });
    return Response.json({ error: "Could not fetch that website" }, { status: 502 });
  }
}
