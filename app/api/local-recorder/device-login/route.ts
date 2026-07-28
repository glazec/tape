import { createLocalRecorderDeviceSession } from "@/lib/local-recorder-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const deviceId = url.searchParams.get("deviceId")?.trim();
  const callbackUrl = url.searchParams.get("callbackUrl")?.trim();

  if (!deviceId || !callbackUrl) {
    return Response.json({ error: "Invalid device login" }, { status: 400 });
  }

  const result = await createLocalRecorderDeviceSession({
    callbackUrl,
    deviceId,
    requestUrl: request.url,
  });

  if ("error" in result) {
    if (result.error === "Unauthorized") {
      const signInUrl = buildSignInRedirectUrl(request.url);

      if (acceptsHtml(request)) {
        return buildSignInBridgeResponse(signInUrl);
      }

      return Response.redirect(signInUrl);
    }

    return Response.json(
      { error: result.error },
      { status: "status" in result ? result.status : 401 },
    );
  }

  if (acceptsHtml(request)) {
    return buildRecorderHandoffResponse(result.redirectUrl);
  }

  return Response.redirect(result.redirectUrl);
}

function buildSignInRedirectUrl(requestUrl: string) {
  const url = new URL(requestUrl);
  const signInUrl = new URL("/auth/sign-in", url.origin);

  signInUrl.searchParams.set("callbackUrl", `${url.pathname}${url.search}`);
  return signInUrl;
}

function acceptsHtml(request: Request) {
  return request.headers.get("accept")?.toLowerCase().includes("text/html");
}

function buildSignInBridgeResponse(signInUrl: URL) {
  const href = escapeHtml(signInUrl.toString());
  const scriptUrl = JSON.stringify(signInUrl.toString()).replaceAll(
    "<",
    "\\u003c",
  );

  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="0;url=${href}">
  <title>Opening sign in</title>
  <script>window.location.replace(${scriptUrl});</script>
</head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#ffffff;color:#111827;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <main style="max-width:32rem;padding:2rem;text-align:center;">
    <h1 style="font-size:1.5rem;line-height:2rem;margin:0 0 0.75rem;">Opening sign in</h1>
    <p style="margin:0 0 1.25rem;color:#4b5563;">Continue in your browser to finish connecting the recorder.</p>
    <a href="${href}" style="display:inline-block;border-radius:0.5rem;background:#2563eb;color:#ffffff;padding:0.625rem 1rem;text-decoration:none;font-weight:600;">Continue to sign in</a>
  </main>
</body>
</html>`,
    {
      headers: {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
      },
    },
  );
}

function buildRecorderHandoffResponse(redirectUrl: string) {
  const href = escapeHtml(redirectUrl);
  const scriptUrl = JSON.stringify(redirectUrl).replaceAll("<", "\\u003c");

  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Opening Tape Desktop</title>
</head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#ffffff;color:#111827;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <main style="max-width:32rem;padding:2rem;text-align:center;">
    <h1 style="font-size:1.5rem;line-height:2rem;margin:0 0 0.75rem;">Opening Tape Desktop</h1>
    <p style="margin:0 0 1.25rem;color:#4b5563;">Sign in is complete. You can close this page after Tape Desktop opens.</p>
    <a href="${href}" style="display:inline-block;border-radius:0.5rem;background:#111827;color:#ffffff;padding:0.625rem 1rem;text-decoration:none;font-weight:600;">Open Tape Desktop</a>
  </main>
  <script>window.location.href = ${scriptUrl};</script>
</body>
</html>`,
    {
      headers: {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
      },
    },
  );
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
