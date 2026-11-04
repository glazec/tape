import TurndownService from "turndown";

function markdownTable(rows: string[][]) {
  const width = Math.max(...rows.map((row) => row.length));
  const line = (row: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`;
  return [
    line(rows[0]),
    line(Array(width).fill("---")),
    ...rows.slice(1).map(line),
  ].join("\n");
}

// Clipboard HTML is parsed in a detached document, never inserted into the page.
export function noteClipboardMarkdown(
  html: string,
  plain: string,
): string | null {
  if (html) {
    const document = new DOMParser().parseFromString(html, "text/html");
    document
      .querySelectorAll("script, style, iframe, object, template")
      .forEach((node) => node.remove());
    const converter = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    });
    converter.addRule("table", {
      filter: "table",
      replacement: (_content, node) => {
        const table = node as HTMLTableElement;
        const sourceRows = Array.from(table.rows);
        const rows: string[][] = sourceRows.map(() => []);
        sourceRows.forEach((row, rowIndex) => {
          let column = 0;
          Array.from(row.cells).forEach((cell) => {
            while (rows[rowIndex][column] !== undefined) column++;
            const value = converter
              .turndown(cell.innerHTML)
              .replace(/\r?\n/g, " ")
              .replace(/\|/g, "\\|");
            const width = Math.min(cell.colSpan, 100);
            const height = Math.min(
              cell.rowSpan || sourceRows.length,
              sourceRows.length - rowIndex,
            );
            for (let y = 0; y < height; y++) {
              for (let x = 0; x < width; x++) {
                rows[rowIndex + y][column + x] = x === 0 ? value : "";
              }
            }
            column += width;
          });
        });
        return rows.some((row) => row.length)
          ? `\n\n${markdownTable(rows)}\n\n`
          : "";
      },
    });
    const markdown = converter.turndown(document.body.innerHTML);
    if (markdown) return markdown;
  }
  const rows = plain
    .replace(/\r\n/g, "\n")
    .replace(/\n$/, "")
    .split("\n")
    .map((row) => row.split("\t"));
  if (
    rows.length > 1 &&
    rows.every((row) => row.length > 1 && row.length === rows[0].length)
  ) {
    return markdownTable(
      rows.map((row) =>
        row.map((cell) => cell.replace(/([\\`*_{}\[\]<>|])/g, "\\$1")),
      ),
    );
  }
  return null;
}
