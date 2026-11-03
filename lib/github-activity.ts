import { REPOSITORY_URL } from "@/lib/site";

export type GithubActivity = {
  /** Null below the threshold, where a tiny count reads as a warning sign. */
  stars: number | null;
  latestRelease: { tag: string; publishedAt: string } | null;
  pushedAt: string;
};

const STAR_DISPLAY_THRESHOLD = 50;
const REVALIDATE_SECONDS = 60 * 60;

function repositoryPath() {
  return new URL(REPOSITORY_URL).pathname.replace(/^\/|\/$/g, "");
}

async function readJson(path: string): Promise<unknown> {
  const response = await fetch(`https://api.github.com/repos/${path}`, {
    headers: { Accept: "application/vnd.github+json" },
    next: { revalidate: REVALIDATE_SECONDS },
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) return null;
  return response.json();
}

/**
 * Live repository activity for the open source section. Any failure returns
 * null so the landing page renders without it rather than waiting on GitHub.
 */
export async function readGithubActivity(): Promise<GithubActivity | null> {
  try {
    const path = repositoryPath();
    const [repo, release] = await Promise.all([
      readJson(path),
      readJson(`${path}/releases/latest`).catch(() => null),
    ]);
    if (!repo || typeof repo !== "object") return null;
    const { stargazers_count: stars, pushed_at: pushedAt } = repo as {
      stargazers_count?: unknown;
      pushed_at?: unknown;
    };
    if (typeof pushedAt !== "string") return null;
    const { tag_name: tag, published_at: publishedAt } = (release ?? {}) as {
      tag_name?: unknown;
      published_at?: unknown;
    };
    return {
      stars:
        typeof stars === "number" && stars >= STAR_DISPLAY_THRESHOLD
          ? stars
          : null,
      latestRelease:
        typeof tag === "string" && typeof publishedAt === "string"
          ? { tag, publishedAt }
          : null,
      pushedAt,
    };
  } catch {
    return null;
  }
}

const DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

// Non-breaking spaces keep "Oct 30" together when the line wraps on a phone.
function day(iso: string) {
  return DAY.format(new Date(iso)).replace(" ", "\u00a0");
}

/** One line of facts a stranger can check on GitHub. */
export function formatGithubActivity(activity: GithubActivity) {
  const parts: string[] = [];
  if (activity.stars !== null) parts.push(`${activity.stars} stars`);
  if (activity.latestRelease) {
    parts.push(
      `Released ${activity.latestRelease.tag} on ${day(activity.latestRelease.publishedAt)}`,
    );
  }
  parts.push(`Last commit ${day(activity.pushedAt)}`);
  return parts.join(" · ");
}
