package main

import (
	"crypto/sha256"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func TestMachinePaths(t *testing.T) {
	t.Parallel()

	for _, path := range []string{
		"/health",
		"/e/key",
		"/fn/register",
		"/v1/runs/id",
		"/api/v2/runs",
		"/v2/runs",
		"/v0/runs/id",
		"/v0/connect/start",
		"/v0/telemetry",
	} {
		if !isMachinePath(path) {
			t.Fatalf("expected %q to be a machine path", path)
		}
	}

	for _, path := range []string{"/", "/dev", "/assets/app.js", "/v0/gql"} {
		if isMachinePath(path) {
			t.Fatalf("expected %q to require a dashboard session", path)
		}
	}
}

func TestLoginCreatesReusableSession(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()

	hash, err := bcrypt.GenerateFromPassword([]byte("correct horse"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	upstreamURL, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatal(err)
	}

	g := newGateway(
		upstreamURL,
		"tape",
		string(hash),
		strings.Repeat("s", 32),
		tokenHash("mcp_test"),
		tokenHash("mcp_url_test"),
	)
	now := time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC)
	g.now = func() time.Time { return now }

	loginRequest := httptest.NewRequest(
		http.MethodPost,
		loginPath,
		strings.NewReader("username=tape&password=correct+horse&next=%2F"),
	)
	loginRequest.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	loginResponse := httptest.NewRecorder()
	g.ServeHTTP(loginResponse, loginRequest)

	if loginResponse.Code != http.StatusSeeOther {
		t.Fatalf("expected login redirect, got %d", loginResponse.Code)
	}
	cookies := loginResponse.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected one session cookie, got %d", len(cookies))
	}
	if !cookies[0].HttpOnly || !cookies[0].Secure || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatal("expected a secure, HTTP only, strict same site cookie")
	}

	dashboardRequest := httptest.NewRequest(http.MethodGet, "/", nil)
	dashboardRequest.AddCookie(cookies[0])
	dashboardResponse := httptest.NewRecorder()
	g.ServeHTTP(dashboardResponse, dashboardRequest)

	if dashboardResponse.Code != http.StatusNoContent {
		t.Fatalf("expected authenticated upstream response, got %d", dashboardResponse.Code)
	}

	g.now = func() time.Time { return now.Add(sessionTTL + time.Second) }
	expiredResponse := httptest.NewRecorder()
	g.ServeHTTP(expiredResponse, dashboardRequest)
	if expiredResponse.Code != http.StatusSeeOther {
		t.Fatalf("expected expired session redirect, got %d", expiredResponse.Code)
	}
}

func TestMCPAuthentication(t *testing.T) {
	t.Parallel()

	upstreamAuthorization := "not called"
	upstreamQuery := "not called"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamAuthorization = r.Header.Get("Authorization")
		upstreamQuery = r.URL.RawQuery
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()

	upstreamURL, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatal(err)
	}
	g := newGateway(
		upstreamURL,
		"tape",
		"unused",
		strings.Repeat("s", 32),
		tokenHash("mcp_secret"),
		tokenHash("mcp_url_secret"),
	)

	for _, authorization := range []string{"", "Bearer wrong", "Basic mcp_secret"} {
		request := httptest.NewRequest(http.MethodPost, "/mcp", nil)
		if authorization != "" {
			request.Header.Set("Authorization", authorization)
		}
		response := httptest.NewRecorder()
		g.ServeHTTP(response, request)

		if response.Code != http.StatusUnauthorized {
			t.Fatalf("expected %q to be unauthorized, got %d", authorization, response.Code)
		}
	}

	request := httptest.NewRequest(http.MethodPost, "/mcp", nil)
	request.Header.Set("Authorization", "Bearer mcp_secret")
	response := httptest.NewRecorder()
	g.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("expected valid MCP token to reach upstream, got %d", response.Code)
	}
	if upstreamAuthorization != "" {
		t.Fatal("expected the gateway to remove its bearer token before proxying")
	}

	request = httptest.NewRequest(http.MethodPost, "/mcp?accessToken=mcp_url_secret", nil)
	response = httptest.NewRecorder()
	g.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("expected valid MCP URL token to reach upstream, got %d", response.Code)
	}
	if upstreamQuery != "" {
		t.Fatalf("expected the gateway to remove the URL token before proxying, got %q", upstreamQuery)
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("expected authenticated MCP responses to prevent caching")
	}

	for _, requestURL := range []string{
		"/mcp?accessToken=wrong",
		"/mcp?accessToken=",
		"/mcp?accessToken=mcp_url_secret&accessToken=mcp_url_secret",
	} {
		request = httptest.NewRequest(http.MethodPost, requestURL, nil)
		response = httptest.NewRecorder()
		g.ServeHTTP(response, request)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("expected %q to be unauthorized, got %d", requestURL, response.Code)
		}
	}

	request = httptest.NewRequest(http.MethodPost, "/mcp?accessToken=mcp_url_secret", nil)
	request.Header.Set("Authorization", "Bearer mcp_secret")
	response = httptest.NewRecorder()
	g.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected mixed MCP credentials to be rejected, got %d", response.Code)
	}
}

func TestOAuthDiscoveryDoesNotRedirectToDashboardLogin(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("expected OAuth discovery request %q not to reach upstream", r.URL.Path)
	}))
	defer upstream.Close()

	upstreamURL, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatal(err)
	}
	g := newGateway(
		upstreamURL,
		"tape",
		"unused",
		strings.Repeat("s", 32),
		tokenHash("mcp_secret"),
		tokenHash("mcp_url_secret"),
	)

	for _, path := range []string{
		"/.well-known/oauth-protected-resource/mcp",
		"/.well-known/oauth-protected-resource",
		"/.well-known/oauth-authorization-server/mcp",
		"/.well-known/oauth-authorization-server",
		"/.well-known/openid-configuration/mcp",
		"/mcp/.well-known/openid-configuration",
		"/register",
	} {
		request := httptest.NewRequest(http.MethodGet, path, nil)
		response := httptest.NewRecorder()
		g.ServeHTTP(response, request)

		if response.Code != http.StatusNotFound {
			t.Fatalf("expected %q to return 404, got %d", path, response.Code)
		}
		if location := response.Header().Get("Location"); location != "" {
			t.Fatalf("expected %q not to redirect, got %q", path, location)
		}
		if response.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("expected %q response not to be cached", path)
		}
	}
}

func TestSafeNext(t *testing.T) {
	t.Parallel()

	if got := safeNext("/runs?status=failed"); got != "/runs?status=failed" {
		t.Fatalf("expected local redirect, got %q", got)
	}
	for _, unsafe := range []string{"", "https://example.com", "//example.com"} {
		if got := safeNext(unsafe); got != "/" {
			t.Fatalf("expected unsafe redirect %q to become root, got %q", unsafe, got)
		}
	}
}

func tokenHash(token string) []byte {
	digest := sha256.Sum256([]byte(token))
	return digest[:]
}
