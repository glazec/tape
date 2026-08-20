// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MeetingLibrarySearch } from "@/components/meeting-library-search";

const replace = vi.fn();
const pendingNavigation = new Promise<never>(() => {});
let beginNavigation: (() => void) | null = null;

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: (...args: Parameters<typeof replace>) => {
      replace(...args);
      beginNavigation?.();
    },
  }),
}));

describe("MeetingLibrarySearch", () => {
  beforeEach(() => {
    beginNavigation = null;
    replace.mockReset();
  });

  it("updates the dashboard search without a document navigation", () => {
    render(
      <MeetingLibrarySearch
        controls={
          <>
            <input defaultValue="founder" name="q" />
            <input defaultValue="ready" name="status" />
            <button type="submit">Search</button>
          </>
        }
      >
        <div>Current meeting results</div>
      </MeetingLibrarySearch>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(replace).toHaveBeenCalledWith(
      "/dashboard?q=founder&status=ready",
      { scroll: false },
    );
    expect(screen.getByText("Current meeting results")).toBeTruthy();
    expect(
      screen.getByLabelText("Meeting results").getAttribute("aria-busy"),
    ).toBe(
      "false",
    );
  });

  it("omits empty values and returns to the dashboard root", () => {
    render(
      <MeetingLibrarySearch
        controls={
          <>
            <input defaultValue="" name="q" />
            <button type="submit">Search</button>
          </>
        }
      >
        <div>Current meeting results</div>
      </MeetingLibrarySearch>,
    );

    fireEvent.submit(
      screen.getByRole("button", { name: "Search" }).closest("form")!,
    );

    expect(replace).toHaveBeenCalledWith("/dashboard", { scroll: false });
  });

  it("keeps the dashboard visible and makes only stale results inert while searching", () => {
    function PendingResults(): never {
      throw pendingNavigation;
    }

    function SearchHarness() {
      const [isLoading, setIsLoading] = useState(false);
      beginNavigation = () => setIsLoading(true);

      return (
        <>
          <div>Dashboard overview</div>
          <MeetingLibrarySearch
            controls={
              <>
                <input defaultValue="founder" name="q" />
                <button type="submit">Search</button>
              </>
            }
          >
            {isLoading ? (
              <PendingResults />
            ) : (
              <button type="button">Current meeting results</button>
            )}
          </MeetingLibrarySearch>
        </>
      );
    }

    render(<SearchHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(screen.getByText("Dashboard overview")).toBeTruthy();
    expect(screen.getByLabelText("Searching meetings")).toBeTruthy();
    expect(
      screen.getByLabelText("Meeting results").getAttribute("aria-busy"),
    ).toBe("true");
    expect(
      screen.getByText("Current meeting results").closest("[inert]"),
    ).toBeTruthy();
  });
});
