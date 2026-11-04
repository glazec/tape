import unittest

from fastmcp.server.auth.oauth_proxy.models import ProxyDCRClient
from mcp.shared.auth import InvalidRedirectUriError
from pydantic import AnyUrl
import main


class CursorRedirectTests(unittest.TestCase):
    def test_cursor_callback_and_reject_lookalikes(self):
        callback = "https://www.cursor.com/agents/mcp/oauth/callback"
        client = ProxyDCRClient(
            client_id="cursor-regression",
            redirect_uris=[AnyUrl(callback)],
            allowed_redirect_uri_patterns=main.ALLOWED_CLIENT_REDIRECT_URIS,
        )
        self.assertEqual(str(client.validate_redirect_uri(AnyUrl(callback))), callback)
        for invalid in (
            "https://www.cursor.com.attacker.example/agents/mcp/oauth/callback",
            "https://www.cursor.com/other/callback",
            "http://www.cursor.com/agents/mcp/oauth/callback",
        ):
            with self.subTest(uri=invalid), self.assertRaises(InvalidRedirectUriError):
                client.validate_redirect_uri(AnyUrl(invalid))
