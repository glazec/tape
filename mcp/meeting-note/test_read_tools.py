import unittest
from unittest.mock import AsyncMock, patch

from fastmcp import Client

import main


MEETING_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"


class ReadToolTests(unittest.IsolatedAsyncioTestCase):
    async def test_tools_are_listed_and_use_signed_backend_with_bounded_arguments(self):
        with (
            patch.object(main, "APP_BASE_URL", "https://tape.example.com"),
            patch.object(main, "_post_tape_backend", AsyncMock(return_value={"ok": True})) as post,
            patch.object(main, "_record_current_mcp_onboarding_use", AsyncMock()),
        ):
            async with Client(main.mcp) as client:
                tools = {tool.name: tool for tool in await client.list_tools()}
                for name in ("get_meeting_transcript", "get_meeting_followup", "search_people", "get_person_profile"):
                    self.assertTrue(tools[name].annotations.readOnlyHint)

                await client.call_tool("get_meeting_transcript", {
                    "meeting_id": f"https://tape.example.com/meetings/{MEETING_ID}?t=30",
                    "limit": 500,
                    "offset": 50,
                })
                post.assert_awaited_with("api/mcp/read", {
                    "operation": "transcript", "meetingId": MEETING_ID, "limit": 100, "offset": 50,
                })

                await client.call_tool("get_meeting_followup", {"meeting_id": MEETING_ID})
                post.assert_awaited_with("api/mcp/read", {"operation": "followup", "meetingId": MEETING_ID})

                await client.call_tool("search_people", {"query": " Priya "})
                post.assert_awaited_with("api/mcp/read", {"operation": "search_people", "query": "Priya", "limit": 10})

                await client.call_tool("get_person_profile", {"person_id": MEETING_ID})
                post.assert_awaited_with("api/mcp/read", {"operation": "person_profile", "personId": MEETING_ID})

    async def test_other_hosts_are_rejected_before_contacting_backend(self):
        with (
            patch.object(main, "APP_BASE_URL", "https://tape.example.com"),
            patch.object(main, "_post_tape_backend", AsyncMock()) as post,
        ):
            with self.assertRaisesRegex(ValueError, "Tape meeting link"):
                await main.get_meeting_transcript(f"https://elsewhere.example.com/meetings/{MEETING_ID}")
            post.assert_not_awaited()
