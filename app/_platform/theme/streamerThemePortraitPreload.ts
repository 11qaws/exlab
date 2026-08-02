import { streamerThemePortraitUrls } from "./streamerThemes";

export type StreamerThemePortraitPreloadStatus =
  | "ready"
  | "degraded";

export interface StreamerThemePortraitPreloadResult {
  readonly status: StreamerThemePortraitPreloadStatus;
  readonly decodedCount: number;
  readonly totalCount: number;
  readonly failedUrls: readonly string[];
}

const PORTRAIT_DECODE_TIMEOUT_MS = 8_000;

/*
 * Keep both the network/decode work and the decoded Image objects alive for
 * the whole app session. Reopening the picker then reuses the browser's
 * decoded image cache instead of flashing its fallback again.
 */
const retainedPortraitImages = new Map<string, HTMLImageElement>();
const portraitDecodePromises = new Map<string, Promise<boolean>>();

function loadAndDecodePortrait(src: string): Promise<boolean> {
  const existing = portraitDecodePromises.get(src);
  if (existing) return existing;

  const image = new Image();
  image.decoding = "async";
  image.fetchPriority = "high";
  retainedPortraitImages.set(src, image);

  const promise = new Promise<boolean>((resolve) => {
    let settled = false;
    let decodeStarted = false;

    const finish = (decoded: boolean) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      image.removeEventListener("error", handleError);
      image.removeEventListener("load", handleLoad);
      resolve(decoded);
    };
    const decode = async () => {
      if (decodeStarted || settled) return;
      decodeStarted = true;
      try {
        await image.decode();
      } catch {
        // Some browsers reject decode() for an already usable cached image.
      }
      finish(image.complete && image.naturalWidth > 0);
    };
    const handleLoad = () => {
      void decode();
    };
    const handleError = () => {
      finish(false);
    };
    const timeout = globalThis.setTimeout(
      () => finish(false),
      PORTRAIT_DECODE_TIMEOUT_MS,
    );

    image.addEventListener("error", handleError, { once: true });
    image.addEventListener("load", handleLoad, { once: true });
    image.src = src;

    if (image.complete) {
      if (image.naturalWidth > 0) {
        void decode();
      } else {
        finish(false);
      }
    }
  });

  portraitDecodePromises.set(src, promise);
  return promise;
}

/**
 * Starts all four portrait requests together and resolves only after each
 * image is decoded or reaches an explicit failure/timeout state.
 */
export async function preloadStreamerThemePortraits(
  assetBasePath = ".",
): Promise<StreamerThemePortraitPreloadResult> {
  const urls = streamerThemePortraitUrls(assetBasePath);
  const results = await Promise.all(
    urls.map(async (src) => ({
      decoded: await loadAndDecodePortrait(src),
      src,
    })),
  );
  const failedUrls = results
    .filter(({ decoded }) => !decoded)
    .map(({ src }) => src);

  return {
    status: failedUrls.length === 0 ? "ready" : "degraded",
    decodedCount: results.length - failedUrls.length,
    totalCount: results.length,
    failedUrls,
  };
}
