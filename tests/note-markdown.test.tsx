// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { noteClipboardMarkdown } from "@/lib/note-markdown";
import { NoteMarkdown } from "@/components/note-markdown";

afterEach(cleanup);

describe("note Markdown", () => {
  it("converts headerless clipboard tables with formatted cells and escaped pipes", () => {
    const markdown = noteClipboardMarkdown(
      "<p>Budget</p><table><tr><td>Name</td><td>Amount</td></tr><tr><td><strong>A | B</strong></td><td>100</td></tr></table>",
      "",
    );
    expect(markdown).toContain("| Name | Amount |\n| --- | --- |");
    render(<NoteMarkdown>{markdown!}</NoteMarkdown>);
    expect(screen.getByRole("table")).toBeTruthy();
    expect(
      screen.getByRole("cell", { name: "A | B" }).querySelector("strong"),
    ).toBeTruthy();
  });
  it("converts spreadsheet text and leaves ordinary Markdown unchanged", () => {
    expect(noteClipboardMarkdown("", "Name\tAmount\r\nAlice\t100\r\n")).toBe(
      "| Name | Amount |\n| --- | --- |\n| Alice | 100 |",
    );
    expect(noteClipboardMarkdown("", "# Heading\n\n**Bold**")).toBeNull();
  });
  it("keeps moment controls interactive inside formatted text", () => {
    render(
      <NoteMarkdown
        moments={[
          { start: 3, text: "[12:34]", element: <button>Go to 12:34</button> },
        ]}
      >
        {"## [12:34] Budget"}
      </NoteMarkdown>,
    );
    expect(
      screen
        .getByRole("heading")
        .contains(screen.getByRole("button", { name: "Go to 12:34" })),
    ).toBe(true);
  });
  it.each(["A \\* B [12:34]", "A &amp; B [12:34]"])(
    "preserves moment controls after decoded Markdown: %s",
    (text) => {
      render(
        <NoteMarkdown
          moments={[
            {
              start: text.indexOf("[12:34]"),
              text: "[12:34]",
              element: <button>Go to 12:34</button>,
            },
          ]}
        >
          {text}
        </NoteMarkdown>,
      );
      expect(screen.getByRole("button", { name: "Go to 12:34" })).toBeTruthy();
    },
  );
  it("does not transfer an anchor to an identical decoded entity", () => {
    const text = "&#91;12:34] literal; [12:34] anchored";
    render(
      <NoteMarkdown
        moments={[
          {
            start: text.lastIndexOf("[12:34]"),
            text: "[12:34]",
            element: <button>ANCHOR</button>,
          },
        ]}
      >
        {text}
      </NoteMarkdown>,
    );
    expect(screen.getByRole("button").parentElement?.textContent).toBe(
      "[12:34] literal; ANCHOR anchored",
    );
  });
  it("keeps columns aligned when pasted tables contain merged cells", () => {
    const markdown = noteClipboardMarkdown(
      '<table><tr><th>Team</th><th>Task</th><th>Owner</th></tr><tr><td rowspan="2">Sales</td><td>Call</td><td>Alice</td></tr><tr><td>Email</td><td>Bob</td></tr></table>',
      "",
    );
    expect(markdown).toContain("| Sales | Email | Bob |");
    render(<NoteMarkdown>{markdown!}</NoteMarkdown>);
    expect(screen.getAllByRole("row")[2].textContent).toBe("SalesEmailBob");
  });
  it("renders headings lists code and safe links without executing clipboard HTML", () => {
    const markdown = noteClipboardMarkdown(
      '<h2>Agenda</h2><ul><li><em>Discuss</em></li></ul><script>alert(1)</script><a href="javascript:alert(1)">unsafe</a>',
      "",
    );
    const { container } = render(
      <NoteMarkdown>{markdown! + "\n\n`code`"}</NoteMarkdown>,
    );
    expect(screen.getByRole("heading", { name: "Agenda" })).toBeTruthy();
    expect(screen.getByRole("listitem")).toBeTruthy();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("a")?.getAttribute("href")).not.toContain(
      "javascript:",
    );
    expect(container.querySelector("code")?.textContent).toBe("code");
  });
});
