import type { ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { decodeString } from "micromark-util-decode-string";

type Moment = { start: number; text: string; element: ReactNode };
type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

export function NoteMarkdown({
  children,
  moments = [],
}: {
  children: string;
  moments?: Moment[];
}) {
  function linkMoments() {
    return (tree: MarkdownNode) => {
      function walk(node: MarkdownNode) {
        if (!node.children || node.type === "link") return;
        node.children = node.children.flatMap((child) => {
          if (
            child.type !== "text" ||
            child.position?.start.offset === undefined
          ) {
            walk(child);
            return [child];
          }
          const value = child.value ?? "";
          const start = child.position.start.offset;
          const end = child.position.end.offset ?? start + value.length;
          const matches = moments.filter(
            (moment) =>
              moment.start >= start && moment.start + moment.text.length <= end,
          );
          const result: MarkdownNode[] = [];
          let offset = 0;
          for (const moment of matches) {
            const index = decodeString(
              children.slice(start, moment.start),
            ).replace(/\r\n?/g, "\n").length;
            if (
              index < offset ||
              value.slice(index, index + moment.text.length) !== moment.text
            )
              continue;
            result.push(
              { type: "text", value: value.slice(offset, index) },
              {
                type: "link",
                url: `#note-moment-${moment.start}`,
                children: [{ type: "text", value: moment.text }],
              },
            );
            offset = index + moment.text.length;
          }
          return matches.length
            ? [...result, { type: "text", value: value.slice(offset) }]
            : [child];
        });
      }
      walk(tree);
    };
  }
  return (
    <div className="break-words text-base leading-7 [&_p]:my-2 [&_h1]:my-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:my-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:my-2 [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-3 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_a]:underline [&_a]:underline-offset-4 [&_th]:border [&_th]:bg-muted/50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_td]:border [&_td]:px-3 [&_td]:py-2">
      <Markdown
        remarkPlugins={[remarkGfm, linkMoments]}
        skipHtml
        components={{
          a: ({ href, children }) => {
            const moment = moments.find(
              (moment) => href === `#note-moment-${moment.start}`,
            );
            return moment ? moment.element : <a href={href}>{children}</a>;
          },
          table: ({ children }) => (
            <div className="max-w-full overflow-x-auto">
              <table className="my-3 w-full border-collapse">{children}</table>
            </div>
          ),
          img: ({ alt }) => <span>{alt}</span>,
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
