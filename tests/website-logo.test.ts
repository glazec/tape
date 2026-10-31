import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { request, type IncomingMessage, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));
vi.mock("node:http", () => ({ request: vi.fn() }));
vi.mock("node:https", () => ({ request: vi.fn() }));

import { fetchWebsiteLogo, isPrivateAddress } from "@/lib/website-logo";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("website logo address boundaries", () => {
  it.each([
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "0:0:0:0:0:ffff:7f00:1",
    "::ffff:a00:1",
    "::ffff:a9fe:a9fe",
    "::ffff:c0a8:1",
    "0:0:0:0:0:0:0:1",
  ])("blocks private address %s", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["93.184.216.34", "::ffff:5db8:d822", "2606:4700:4700::1111"])(
    "allows public address %s", (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );

  it("rejects an encoded loopback URL before making a request", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("No network in this test"));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchWebsiteLogo("http://[::ffff:127.0.0.1]/"))
      .rejects.toThrow("Blocked address");
    expect(fetch).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("pins the validated address even if DNS changes before connection", async () => {
    const publicAddresses = [{ address: "93.184.216.34", family: 4 }];
    lookupMock.mockResolvedValue(publicAddresses);
    const connections: string[] = [];
    mockResponse(request, (url, options) => {
        // A second resolver lookup would now return a private address.
        lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
        options.lookup!(url.hostname, { all: true }, (error, addresses) => {
          expect(error).toBeNull();
          expect(addresses).toEqual(publicAddresses);
        });
        connections.push(url.href);
        return { statusCode: 200, headers: { "content-type": "text/html" }, body: '<link rel="icon" href="/logo.png">' };
    });
    // The initial public page can be read; its subsequent private DNS answer
    // prevents every subsequent request, including fallbacks.
    vi.mocked(httpsRequest).mockImplementation((() => { throw new Error("No fallback network"); }) as typeof httpsRequest);
    await expect(fetchWebsiteLogo("http://logo.example/")).rejects.toThrow("No logo found");
    expect(connections).toEqual(["http://logo.example/"]);
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it.each(["http:", "https:"])("reads a public logo over %s", async (protocol) => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const transport = protocol === "https:" ? httpsRequest : request;
    mockResponse(transport, (url) => url.pathname === "/"
      ? { statusCode: 200, headers: { "content-type": "text/html" }, body: '<link rel="icon" href="/logo.png">' }
      : { statusCode: 200, headers: { "content-type": "image/png" }, body: Buffer.alloc(128, 1) });
    const logo = await fetchWebsiteLogo(`${protocol}//logo.example/`);
    expect(logo).toMatchObject({ contentType: "image/png", sourceUrl: `${protocol}//logo.example/logo.png` });
    expect(logo.bytes).toHaveLength(128);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("rejects a redirect to an encoded private address", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    mockResponse(request, () => ({
      statusCode: 302, headers: { location: "http://[::ffff:a9fe:a9fe]/" },
    }));
    await expect(fetchWebsiteLogo("http://logo.example/")).rejects.toThrow("Blocked address");
    expect(request).toHaveBeenCalledTimes(1);
  });
});

function mockResponse(
  transport: typeof request,
  respond: (url: URL, options: RequestOptions) => {
    statusCode: number;
    headers: IncomingMessage["headers"];
    body?: string | Buffer;
  },
) {
  vi.mocked(transport).mockImplementation(((url: URL, options: RequestOptions, onResponse: (response: IncomingMessage) => void) => {
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = () => {
      const { body = "", ...metadata } = respond(url, options);
      const response = Readable.from([Buffer.from(body)]) as IncomingMessage;
      Object.assign(response, metadata);
      onResponse(response);
    };
    return req;
  }) as typeof request);
}
