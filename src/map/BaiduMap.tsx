import { useEffect, useRef, useState } from "react";

import { loadBaiduMap } from "./loadBaiduMap";

type MapStatus = "loading" | "success" | "error";

const browserAk = import.meta.env.VITE_BAIDU_BROWSER_AK?.trim();

// Phase 1A development default: Tiananmen, expressed in Baidu BD-09 coordinates.
const developmentCenter = {
  longitude: 116.404,
  latitude: 39.915,
  zoom: 14,
} as const;

export function BaiduMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<MapStatus>("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const container = containerRef.current;

    if (!container) return;

    if (!browserAk) {
      setStatus("error");
      setErrorMessage(
        "未配置 Browser AK。请在 .env.local 中设置 VITE_BAIDU_BROWSER_AK。",
      );
      return;
    }

    let cancelled = false;
    let map: BMap.Map | undefined;
    let mapLoadTimer: number | undefined;

    setStatus("loading");
    setErrorMessage("");

    loadBaiduMap(browserAk)
      .then((BMapApi) => {
        if (cancelled) return;

        map = new BMapApi.Map(container, {
          center: new BMapApi.Point(
            developmentCenter.longitude,
            developmentCenter.latitude,
          ),
          zoom: developmentCenter.zoom,
          enableDragging: true,
          enableWheelZoom: true,
        });

        const handleMapLoaded = () => {
          if (cancelled) return;
          if (mapLoadTimer !== undefined) window.clearTimeout(mapLoadTimer);
          setStatus("success");
        };

        map.addEventListener("load", handleMapLoaded);
        mapLoadTimer = window.setTimeout(() => {
          if (cancelled) return;
          setStatus("error");
          setErrorMessage("地图加载超时，请检查网络和 Browser AK 配置。");
        }, 15_000);
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(
          "百度地图加载失败，请检查网络、Browser AK 和 Referer 白名单。",
        );
      });

    return () => {
      cancelled = true;
      if (mapLoadTimer !== undefined) window.clearTimeout(mapLoadTimer);
      map?.destroy();
    };
  }, []);

  return (
    <section className="map-panel" aria-labelledby="map-heading">
      <div className="map-panel__header">
        <div>
          <p className="eyebrow">Phase 1A</p>
          <h1 id="map-heading">城市暂停键 — Development</h1>
        </div>
        <p className={`map-status map-status--${status}`} aria-live="polite">
          {status === "loading" && "正在加载百度地图…"}
          {status === "success" && "地图已加载，可拖动和缩放"}
          {status === "error" && "地图加载失败"}
        </p>
      </div>

      <div className="map-shell">
        <div ref={containerRef} className="map-container" aria-label="百度地图" />

        {status !== "success" && (
          <div className={`map-state map-state--${status}`} role="status">
            {status === "loading" ? (
              <p>正在加载地图…</p>
            ) : (
              <>
                <strong>暂时无法显示地图</strong>
                <p>{errorMessage}</p>
              </>
            )}
          </div>
        )}
      </div>

      <p className="map-caption">
        开发阶段默认中心：北京天安门附近（BD-09）
      </p>
    </section>
  );
}
