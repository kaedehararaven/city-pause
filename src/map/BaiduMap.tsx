import { useEffect, useRef, useState } from "react";

import { loadBaiduMap } from "./loadBaiduMap";
import {
  adaptBaiduLocalResultPoi,
  type TemporaryMapPoi,
} from "./poiAdapter";

type MapStatus = "loading" | "success" | "error";
type LocationStatus =
  | "idle"
  | "locating"
  | "success"
  | "denied"
  | "timeout"
  | "unavailable"
  | "unsupported"
  | "error";

type PoiSearchState = {
  status: "idle" | "searching" | "success" | "empty" | "error";
  total: number;
  pois: TemporaryMapPoi[];
  observedRawFields: string[];
  message: string;
};

const browserAk = import.meta.env.VITE_BAIDU_BROWSER_AK?.trim();

// Phase 1 fallback: Tiananmen, expressed in Baidu BD-09 coordinates.
const developmentCenter = {
  longitude: 116.404,
  latitude: 39.915,
  zoom: 14,
} as const;

const poiSearchRadiusMeters = 1_500;
const initialPoiSearchState: PoiSearchState = {
  status: "idle",
  total: 0,
  pois: [],
  observedRawFields: [],
  message: "定位成功后将自动搜索附近 1500 米内的“公园”。",
};

function locationFailure(status: number): {
  status: LocationStatus;
  message: string;
} {
  if (status === BMAP_STATUS_PERMISSION_DENIED) {
    return { status: "denied", message: "定位权限被拒绝，已保留开发默认中心。" };
  }
  if (status === BMAP_STATUS_TIMEOUT) {
    return { status: "timeout", message: "定位请求超时，已保留开发默认中心。" };
  }
  if (status === BMAP_STATUS_SERVICE_UNAVAILABLE) {
    return {
      status: "unavailable",
      message: "定位服务当前不可用，已保留开发默认中心。",
    };
  }
  if (status === BMAP_STATUS_UNKNOWN_LOCATION) {
    return {
      status: "unavailable",
      message: "无法确定当前位置，已保留开发默认中心。",
    };
  }
  return { status: "error", message: "百度定位失败，已保留开发默认中心。" };
}

export function BaiduMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<BMap.Map | null>(null);
  const BMapRef = useRef<typeof BMap | null>(null);
  const currentLocationMarkerRef = useRef<BMap.Marker | null>(null);
  const localSearchRef = useRef<BMap.LocalSearch | null>(null);
  const locationRequestInFlightRef = useRef(false);

  const [mapStatus, setMapStatus] = useState<MapStatus>("loading");
  const [mapErrorMessage, setMapErrorMessage] = useState("");
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("idle");
  const [locationMessage, setLocationMessage] = useState(
    "尚未请求定位。点击按钮后浏览器可能询问位置权限。",
  );
  const [locationAccuracy, setLocationAccuracy] = useState<number>();
  const [poiSearch, setPoiSearch] = useState<PoiSearchState>(initialPoiSearchState);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!browserAk) {
      setMapStatus("error");
      setMapErrorMessage(
        "未配置 Browser AK。请在 .env.local 中设置 VITE_BAIDU_BROWSER_AK。",
      );
      return;
    }

    let cancelled = false;
    let map: BMap.Map | undefined;
    let mapLoadTimer: number | undefined;

    setMapStatus("loading");
    setMapErrorMessage("");

    loadBaiduMap(browserAk)
      .then((BMapApi) => {
        if (cancelled) return;

        BMapRef.current = BMapApi;
        map = new BMapApi.Map(container, {
          center: new BMapApi.Point(
            developmentCenter.longitude,
            developmentCenter.latitude,
          ),
          zoom: developmentCenter.zoom,
          enableDragging: true,
          enableWheelZoom: true,
        });
        mapRef.current = map;

        const handleMapLoaded = () => {
          if (cancelled) return;
          if (mapLoadTimer !== undefined) window.clearTimeout(mapLoadTimer);
          setMapStatus("success");
        };

        map.addEventListener("load", handleMapLoaded);
        mapLoadTimer = window.setTimeout(() => {
          if (cancelled) return;
          setMapStatus("error");
          setMapErrorMessage("地图加载超时，请检查网络和 Browser AK 配置。");
        }, 15_000);
      })
      .catch(() => {
        if (cancelled) return;
        setMapStatus("error");
        setMapErrorMessage(
          "百度地图加载失败，请检查网络、Browser AK 和 Referer 白名单。",
        );
      });

    return () => {
      cancelled = true;
      locationRequestInFlightRef.current = false;
      if (mapLoadTimer !== undefined) window.clearTimeout(mapLoadTimer);
      localSearchRef.current?.clearResults();
      map?.destroy();
      mapRef.current = null;
      BMapRef.current = null;
      currentLocationMarkerRef.current = null;
      localSearchRef.current = null;
    };
  }, []);

  function searchNearbyParks(
    BMapApi: typeof BMap,
    map: BMap.Map,
    center: BMap.Point,
  ) {
    localSearchRef.current?.clearResults();
    setPoiSearch({
      ...initialPoiSearchState,
      status: "searching",
      message: "正在搜索真实公园 POI…",
    });

    const localSearch = new BMapApi.LocalSearch(map, {
      pageCapacity: 10,
      renderOptions: { map, autoViewport: false },
      onSearchComplete(resultOrResults) {
        if (mapRef.current !== map) return;

        const status = localSearch.getStatus();
        const result = Array.isArray(resultOrResults)
          ? resultOrResults[0]
          : resultOrResults;

        if (status !== BMAP_STATUS_SUCCESS || !result) {
          setPoiSearch({
            ...initialPoiSearchState,
            status: "error",
            message: `公园 POI 搜索失败（百度状态码 ${status}）。`,
          });
          return;
        }

        const rawPois = Array.from(
          { length: result.getCurrentNumPois() },
          (_, index) => result.getPoi(index),
        ).filter((poi): poi is BMap.LocalResultPoi => poi !== undefined);
        const pois = rawPois
          .map(adaptBaiduLocalResultPoi)
          .filter((poi): poi is TemporaryMapPoi => poi !== null);
        const observedRawFields = Array.from(
          new Set(
            rawPois.flatMap((poi) =>
              Object.entries(poi).map(([name, value]) => {
                const runtimeType = Array.isArray(value)
                  ? "array"
                  : value === null
                    ? "null"
                    : typeof value;
                return `${name}:${runtimeType}`;
              }),
            ),
          ),
        ).sort();
        const total = result.getNumPois();

        setPoiSearch({
          status: pois.length ? "success" : "empty",
          total,
          pois,
          observedRawFields,
          message: pois.length
            ? `本页观察到 ${pois.length} 个真实公园 POI，共匹配 ${total} 个结果。`
            : "搜索成功，但当前页没有可适配的公园 POI。",
        });
      },
    });

    localSearch.disableFirstResultSelection();
    localSearchRef.current = localSearch;
    localSearch.searchNearby("公园", center, poiSearchRadiusMeters);
  }

  function restoreDevelopmentFallback(BMapApi: typeof BMap, map: BMap.Map) {
    localSearchRef.current?.clearResults();
    localSearchRef.current = null;

    if (currentLocationMarkerRef.current) {
      map.removeOverlay(currentLocationMarkerRef.current);
      currentLocationMarkerRef.current = null;
    }

    map.centerAndZoom(
      new BMapApi.Point(
        developmentCenter.longitude,
        developmentCenter.latitude,
      ),
      developmentCenter.zoom,
    );
    setLocationAccuracy(undefined);
    setPoiSearch(initialPoiSearchState);
  }

  function handleLocate() {
    const map = mapRef.current;
    const BMapApi = BMapRef.current;
    if (!map || !BMapApi || locationRequestInFlightRef.current) return;

    if (!("geolocation" in navigator)) {
      restoreDevelopmentFallback(BMapApi, map);
      setLocationStatus("unsupported");
      setLocationMessage("当前浏览器不支持定位，已保留开发默认中心。");
      return;
    }

    locationRequestInFlightRef.current = true;
    setLocationStatus("locating");
    setLocationMessage("正在请求真实位置，请处理浏览器的位置权限提示…");
    setLocationAccuracy(undefined);
    setPoiSearch(initialPoiSearchState);

    const options: BMap.PositionOptions = {
      enableHighAccuracy: true,
      timeout: 10_000,
      maximumAge: 0,
    };
    const geolocation = new BMapApi.Geolocation(options);

    geolocation.getCurrentPosition((result) => {
      if (mapRef.current !== map) return;

      locationRequestInFlightRef.current = false;
      const status = geolocation.getStatus();

      if (status !== BMAP_STATUS_SUCCESS || !result?.point) {
        const failure = locationFailure(status);
        restoreDevelopmentFallback(BMapApi, map);
        setLocationStatus(failure.status);
        setLocationMessage(failure.message);
        return;
      }

      if (currentLocationMarkerRef.current) {
        map.removeOverlay(currentLocationMarkerRef.current);
      }

      const marker = new BMapApi.Marker(result.point);
      marker.setTitle("当前位置");
      map.addOverlay(marker);
      map.centerAndZoom(result.point, 16);

      currentLocationMarkerRef.current = marker;
      const usableAccuracy =
        typeof result.accuracy === "number" && result.accuracy > 0
          ? result.accuracy
          : undefined;
      setLocationStatus("success");
      setLocationAccuracy(usableAccuracy);
      setLocationMessage(
        usableAccuracy === undefined
          ? "定位成功，已显示当前位置。定位精度未返回或不可用。"
          : `定位成功，已显示当前位置；返回精度约 ${Math.round(usableAccuracy)} 米。`,
      );

      searchNearbyParks(BMapApi, map, result.point);
    }, options);
  }

  const locationBusy = locationStatus === "locating";

  return (
    <main className="development-page">
      <section className="map-panel" aria-labelledby="map-heading">
        <div className="map-panel__header">
          <div>
            <p className="eyebrow">Phase 1B</p>
            <h1 id="map-heading">城市暂停键 — Development</h1>
          </div>
          <p className={`map-status map-status--${mapStatus}`} aria-live="polite">
            {mapStatus === "loading" && "正在加载百度地图…"}
            {mapStatus === "success" && "地图已加载，可拖动和缩放"}
            {mapStatus === "error" && "地图加载失败"}
          </p>
        </div>

        <div className="map-shell">
          <div ref={containerRef} className="map-container" aria-label="百度地图" />

          {mapStatus !== "success" && (
            <div className={`map-state map-state--${mapStatus}`} role="status">
              {mapStatus === "loading" ? (
                <p>正在加载地图…</p>
              ) : (
                <>
                  <strong>暂时无法显示地图</strong>
                  <p>{mapErrorMessage}</p>
                </>
              )}
            </div>
          )}
        </div>

        <p className="map-caption">
          定位失败时保留开发默认中心：北京天安门附近（BD-09）
        </p>
      </section>

      <aside className="probe-panel" aria-label="定位与公园 POI 数据探测">
        <section className="probe-card">
          <div className="probe-card__heading">
            <div>
              <p className="eyebrow">Geolocation</p>
              <h2>真实定位</h2>
            </div>
            <span className={`status-chip status-chip--${locationStatus}`}>
              {locationStatus}
            </span>
          </div>
          <p aria-live="polite">{locationMessage}</p>
          {locationStatus === "success" && locationAccuracy !== undefined && (
            <p className="probe-meta">百度返回精度：约 {Math.round(locationAccuracy)} 米</p>
          )}
          <button
            type="button"
            onClick={handleLocate}
            disabled={mapStatus !== "success" || locationBusy}
          >
            {locationBusy ? "正在定位…" : "获取当前位置并搜索公园"}
          </button>
        </section>

        <section className="probe-card">
          <div className="probe-card__heading">
            <div>
              <p className="eyebrow">LocalSearch · 1500m</p>
              <h2>真实公园 POI</h2>
            </div>
            <span className={`status-chip status-chip--${poiSearch.status}`}>
              {poiSearch.status}
            </span>
          </div>
          <p aria-live="polite">{poiSearch.message}</p>

          {poiSearch.observedRawFields.length > 0 && (
            <div className="raw-fields">
              <strong>本次 raw POI 字段名与运行时类型</strong>
              <code>{poiSearch.observedRawFields.join(", ")}</code>
            </div>
          )}

          {poiSearch.pois.length > 0 && (
            <ol className="poi-list">
              {poiSearch.pois.slice(0, 5).map((poi) => (
                <li key={poi.providerId}>
                  <strong>{poi.name}</strong>
                  <span>{poi.address ?? "地址 unknown"}</span>
                  <span>分类：{poi.categoryTags?.join(" / ") ?? "unknown"}</span>
                  <span>电话：{poi.telephone ?? "unknown"}</span>
                  <span>
                    坐标：{poi.location.longitude.toFixed(6)}, {" "}
                    {poi.location.latitude.toFixed(6)} · {" "}
                    {poi.location.coordinateSystem}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </aside>
    </main>
  );
}
