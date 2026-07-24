package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"html/template"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const (
	loginPath         = "/__auth/login"
	logoutPath        = "/__auth/logout"
	sessionCookieName = "inngest_dashboard_session"
	sessionTTL        = 7 * 24 * time.Hour
)

type gateway struct {
	proxy           *httputil.ReverseProxy
	username        string
	passwordHash    []byte
	sessionKey      []byte
	mcpTokenHash    []byte
	mcpURLTokenHash []byte
	now             func() time.Time
}

func main() {
	upstream := mustURL(requiredEnv("INNGEST_UPSTREAM"))
	mcpTokenHash := requiredSHA256Digest("MCP_AUTH_TOKEN_HASH")
	mcpURLTokenHash := requiredSHA256Digest("MCP_URL_TOKEN_HASH")
	g := newGateway(
		upstream,
		requiredEnv("DASHBOARD_USERNAME"),
		requiredEnv("DASHBOARD_PASSWORD_HASH"),
		requiredEnv("SESSION_SECRET"),
		mcpTokenHash,
		mcpURLTokenHash,
	)

	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "8080"
	}

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           g,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}

	log.Printf("inngest gateway listening on %s", server.Addr)
	log.Fatal(server.ListenAndServe())
}

func newGateway(upstream *url.URL, username, passwordHash, sessionSecret string, mcpTokenHash, mcpURLTokenHash []byte) *gateway {
	proxy := httputil.NewSingleHostReverseProxy(upstream)
	proxy.FlushInterval = -1
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, err error) {
		log.Printf("upstream request failed: %v", err)
		http.Error(w, "Inngest is temporarily unavailable", http.StatusBadGateway)
	}

	return &gateway{
		proxy:           proxy,
		username:        username,
		passwordHash:    []byte(passwordHash),
		sessionKey:      []byte(sessionSecret),
		mcpTokenHash:    append([]byte(nil), mcpTokenHash...),
		mcpURLTokenHash: append([]byte(nil), mcpURLTokenHash...),
		now:             time.Now,
	}
}

func (g *gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/mcp" {
		g.handleMCP(w, r)
		return
	}
	if r.URL.Path == "/mcp/" {
		http.Error(w, "Use the exact MCP endpoint path /mcp", http.StatusBadRequest)
		return
	}
	if isOAuthDiscoveryPath(r.URL.Path) {
		w.Header().Set("Cache-Control", "no-store")
		http.NotFound(w, r)
		return
	}

	if isMachinePath(r.URL.Path) {
		g.proxy.ServeHTTP(w, r)
		return
	}

	switch r.URL.Path {
	case loginPath:
		g.handleLogin(w, r)
	case logoutPath:
		g.handleLogout(w, r)
	default:
		if !g.hasValidSession(r) {
			next := r.URL.RequestURI()
			http.Redirect(w, r, loginPath+"?next="+url.QueryEscape(next), http.StatusSeeOther)
			return
		}
		g.proxy.ServeHTTP(w, r)
	}
}

func (g *gateway) handleMCP(w http.ResponseWriter, r *http.Request) {
	headerToken, hasHeaderToken := bearerToken(r.Header.Get("Authorization"))
	queryTokens, hasQueryToken := r.URL.Query()["accessToken"]
	if strings.TrimSpace(r.Header.Get("Authorization")) != "" && hasQueryToken {
		http.Error(w, "Use either bearer authentication or accessToken, not both", http.StatusBadRequest)
		return
	}

	token := headerToken
	expectedHash := g.mcpTokenHash
	ok := hasHeaderToken
	if hasQueryToken {
		ok = len(queryTokens) == 1 && queryTokens[0] != ""
		if ok {
			token = queryTokens[0]
			expectedHash = g.mcpURLTokenHash
		}
	}

	tokenHash := sha256.Sum256([]byte(token))
	if !ok || subtle.ConstantTimeCompare(tokenHash[:], expectedHash) != 1 {
		w.Header().Set("WWW-Authenticate", `Bearer realm="inngest-mcp"`)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	proxyRequest := r.Clone(r.Context())
	proxyRequest.Header = r.Header.Clone()
	proxyRequest.Header.Del("Authorization")
	proxyRequest.URL.RawQuery = ""
	proxyRequest.URL.ForceQuery = false
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	g.proxy.ServeHTTP(w, proxyRequest)
}

func (g *gateway) handleLogin(w http.ResponseWriter, r *http.Request) {
	next := safeNext(r.URL.Query().Get("next"))

	switch r.Method {
	case http.MethodGet:
		if g.hasValidSession(r) {
			http.Redirect(w, r, next, http.StatusSeeOther)
			return
		}
		g.renderLogin(w, http.StatusOK, next, "")
	case http.MethodPost:
		r.Body = http.MaxBytesReader(w, r.Body, 8<<10)
		if err := r.ParseForm(); err != nil {
			g.renderLogin(w, http.StatusBadRequest, next, "Unable to read the login form.")
			return
		}

		usernameMatches := hmac.Equal([]byte(r.FormValue("username")), []byte(g.username))
		passwordMatches := bcrypt.CompareHashAndPassword(g.passwordHash, []byte(r.FormValue("password"))) == nil
		if !usernameMatches || !passwordMatches {
			g.renderLogin(w, http.StatusUnauthorized, next, "Incorrect username or password.")
			return
		}

		g.setSessionCookie(w)
		http.Redirect(w, r, safeNext(r.FormValue("next")), http.StatusSeeOther)
	default:
		w.Header().Set("Allow", "GET, POST")
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (g *gateway) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	})
	http.Redirect(w, r, loginPath, http.StatusSeeOther)
}

func (g *gateway) setSessionCookie(w http.ResponseWriter) {
	expires := g.now().Add(sessionTTL)
	payload := g.username + ":" + strconv.FormatInt(expires.Unix(), 10)
	signature := g.sign(payload)
	value := base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + signature

	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    value,
		Path:     "/",
		Expires:  expires,
		MaxAge:   int(sessionTTL.Seconds()),
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	})
}

func (g *gateway) hasValidSession(r *http.Request) bool {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		return false
	}

	parts := strings.Split(cookie.Value, ".")
	if len(parts) != 2 {
		return false
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return false
	}
	payload := string(payloadBytes)
	if !hmac.Equal([]byte(parts[1]), []byte(g.sign(payload))) {
		return false
	}

	payloadParts := strings.Split(payload, ":")
	if len(payloadParts) != 2 || payloadParts[0] != g.username {
		return false
	}

	expiresUnix, err := strconv.ParseInt(payloadParts[1], 10, 64)
	return err == nil && g.now().Before(time.Unix(expiresUnix, 0))
}

func (g *gateway) sign(payload string) string {
	mac := hmac.New(sha256.New, g.sessionKey)
	_, _ = mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (g *gateway) renderLogin(w http.ResponseWriter, status int, next, message string) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)

	if err := loginTemplate.Execute(w, struct {
		Message string
		Next    string
	}{
		Message: message,
		Next:    next,
	}); err != nil {
		log.Printf("render login failed: %v", err)
	}
}

func isOAuthDiscoveryPath(path string) bool {
	return path == "/register" ||
		strings.HasPrefix(path, "/.well-known/oauth-") ||
		strings.HasPrefix(path, "/.well-known/openid-configuration") ||
		strings.HasPrefix(path, "/mcp/.well-known/openid-configuration")
}

func isMachinePath(path string) bool {
	if path == "/health" || path == "/v0/telemetry" {
		return true
	}

	for _, prefix := range []string{
		"/e/",
		"/fn/",
		"/v1/",
		"/api/v2/",
		"/v2/",
		"/v0/runs/",
		"/v0/connect/",
	} {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}

	return false
}

func safeNext(next string) string {
	if next == "" || !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") {
		return "/"
	}
	return next
}

func bearerToken(header string) (string, bool) {
	scheme, token, found := strings.Cut(strings.TrimSpace(header), " ")
	if !found || !strings.EqualFold(scheme, "Bearer") {
		return "", false
	}
	token = strings.TrimSpace(token)
	return token, token != "" && !strings.Contains(token, " ")
}

func requiredEnv(name string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		log.Fatalf("%s is required", name)
	}
	return value
}

func requiredSHA256Digest(name string) []byte {
	digest, err := hex.DecodeString(requiredEnv(name))
	if err != nil || len(digest) != sha256.Size {
		log.Fatalf("%s must be a SHA 256 digest encoded as 64 hexadecimal characters", name)
	}
	return digest
}

func mustURL(value string) *url.URL {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		log.Fatalf("INNGEST_UPSTREAM must be an absolute HTTP URL")
	}
	return parsed
}

var loginTemplate = template.Must(template.New("login").Parse(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tape · Inngest</title>
  <style>
    :root { color-scheme: light; --ink: #17221c; --muted: #657068; --line: #dce3de; --paper: #f7f8f4; --accent: #176b45; --accent-dark: #0f5134; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 28px; color: var(--ink); background: radial-gradient(circle at 18% 12%, #e8f3ec 0, transparent 34%), linear-gradient(135deg, var(--paper), #edf0e9); font-family: "Avenir Next", Avenir, sans-serif; }
    main { width: min(100%, 410px); padding: 38px; background: rgba(255, 255, 252, .94); border: 1px solid rgba(23, 34, 28, .12); border-radius: 22px; box-shadow: 0 24px 70px rgba(29, 45, 35, .13); animation: arrive .35s ease-out both; }
    .eyebrow { margin: 0 0 18px; color: var(--accent); font-size: 12px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; }
    h1 { margin: 0; font-family: "Iowan Old Style", "Palatino Linotype", Palatino, serif; font-size: 38px; font-weight: 600; letter-spacing: -.03em; }
    .intro { margin: 10px 0 28px; color: var(--muted); line-height: 1.55; }
    label { display: block; margin: 17px 0 7px; font-size: 13px; font-weight: 650; }
    input { width: 100%; height: 46px; padding: 0 13px; color: var(--ink); background: #fff; border: 1px solid var(--line); border-radius: 10px; font: inherit; outline: none; transition: border-color .15s, box-shadow .15s; }
    input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(23, 107, 69, .12); }
    button { width: 100%; height: 48px; margin-top: 24px; color: #fff; background: var(--accent); border: 0; border-radius: 11px; font: inherit; font-weight: 700; cursor: pointer; transition: transform .15s, background .15s; }
    button:hover { background: var(--accent-dark); transform: translateY(-1px); }
    .error { margin: 0 0 18px; padding: 11px 13px; color: #802d27; background: #fff0ed; border: 1px solid #f0c8c1; border-radius: 10px; font-size: 13px; }
    .note { margin: 20px 0 0; color: var(--muted); font-size: 12px; text-align: center; }
    @keyframes arrive { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @media (prefers-reduced-motion: reduce) { main { animation: none; } button { transition: none; } }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">Tape operations</p>
    <h1>Inngest control room</h1>
    <p class="intro">Sign in once to review functions, events, and run history.</p>
    {{if .Message}}<p class="error" role="alert">{{.Message}}</p>{{end}}
    <form method="post" action="` + loginPath + `">
      <input type="hidden" name="next" value="{{.Next}}">
      <label for="username">Username</label>
      <input id="username" name="username" autocomplete="username" required autofocus>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Open dashboard</button>
    </form>
    <p class="note">Session remains active for seven days on this browser.</p>
  </main>
</body>
</html>`))
