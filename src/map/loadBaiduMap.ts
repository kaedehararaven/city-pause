import BMapLoader from "@baidumap/jsapi-loader";

type BMapNamespace = typeof BMap;

let loadingPromise: Promise<BMapNamespace> | undefined;

export function loadBaiduMap(browserAk: string): Promise<BMapNamespace> {
  if (!loadingPromise) {
    loadingPromise = BMapLoader.load({
      ak: browserAk,
      version: "4.0",
      protocol: "https",
      timeout: 15_000,
    })
      .then((namespace) => namespace as BMapNamespace)
      .catch((error: unknown) => {
        loadingPromise = undefined;
        throw error;
      });
  }

  return loadingPromise;
}
