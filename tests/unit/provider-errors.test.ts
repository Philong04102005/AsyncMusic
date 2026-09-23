import { afterEach, describe, expect, it, vi } from "vitest";
import { YouTubeProvider, SoundCloudProvider } from "@resonance/providers";
afterEach(() => vi.unstubAllGlobals());
describe("official provider failures", () => {
  it("normalizes a network failure without returning key-bearing URLs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network failure with secret URL")),
    );
    await expect(
      new YouTubeProvider("private-api-key").getTrack("abcdefghijk"),
    ).rejects.toMatchObject({
      code: "UNKNOWN",
      message: "The music provider could not be reached. Please try again.",
    });
  });
  it("recognizes the YouTube 403 quota response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              error: { errors: [{ reason: "quotaExceeded" }] },
            }),
            { status: 403 },
          ),
        ),
    );
    await expect(
      new YouTubeProvider("key").search("music"),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
  it("does not accept arbitrary URLs as SoundCloud metadata IDs", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      new SoundCloudProvider(async () => "token").getTrack(
        "http://127.0.0.1/private",
      ),
    ).rejects.toMatchObject({ code: "TRACK_NOT_FOUND" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
