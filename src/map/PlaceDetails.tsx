import { useEffect, useRef, useState } from "react";
import type { MapLocation, MapPOI } from "../contracts/map";
import { loadPlaceDetails } from "./placeDetailLoader";
export { loadPlaceDetails } from "./placeDetailLoader";
import { mergeBaiduPlaceDetail } from "./poiAdapter";
import type { TemporaryPlaceDetail } from "./capabilityClient";

function LocationPreview({ location, name }: { location: MapLocation; name: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !element.current) return;
    if (typeof BMap === "undefined") { setError(true); return; }
    const map = new BMap.Map(element.current);
    const point = new BMap.Point(location.longitude, location.latitude);
    map.centerAndZoom(point, 18);
    const marker = new BMap.Marker(point);
    marker.setTitle(name);
    map.addOverlay(marker);
    return () => map.clearOverlays();
  }, [open, location, name]);
  return <>
    <button type="button" onClick={() => setOpen(value => !value)}>{open ? "收起位置" : "查看位置"}</button>
    {open && <div ref={element} role="region" aria-label={`${name}的位置`} style={{ height: 240, width: "100%", marginTop: 8 }} />}
    {open && error && <p>地图暂未就绪，请先打开真实地图。</p>}
  </>;
}

export function PlaceDetails({ poi, offline = false }: { poi: MapPOI; offline?: boolean }) {
  const [detail, setDetail] = useState<MapPOI>(poi);
  // TEMP DEBUG: retain separate provider fields only for the audit display.
  const [categoryTags, setCategoryTags] = useState<Pick<TemporaryPlaceDetail, "categoryTag" | "classifiedTag"> | null>(null);
  const auditEnabled = import.meta.env.DEV && new URLSearchParams(window.location.search).get("audit") === "1";
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(offline ? "ready" : "idle");
  async function load() {
    if (offline || status === "loading" || status === "ready" || poi.source !== "real") return;
    setStatus("loading");
    try {
      const response = await loadPlaceDetails(poi);
      setCategoryTags({ categoryTag: response.categoryTag, classifiedTag: response.classifiedTag });
      setDetail(mergeBaiduPlaceDetail(poi, response));
      setStatus("ready");
    } catch { setStatus("error"); }
  }
  return <details onToggle={event => { if (event.currentTarget.open && status === "idle") void load(); }}>
    <summary>地点详情 · {poi.name}</summary>
    <div style={{ overflowWrap: "anywhere" }}>
      <p>地址：{detail.address ?? "暂无信息"}</p>
      <p>地点分类：{detail.categories?.join(" / ") ?? "暂无信息"}</p>
      {status === "loading" && <p role="status">正在获取地点详情…</p>}
      {status === "ready" && <>
        {auditEnabled && categoryTags && <section aria-label="百度原始分类标签" data-testid="provider-category-tags">
          <h4>百度原始分类标签 · {poi.name}</h4>
          <dl>
            <dt>detail_info.tag</dt>
            <dd style={{ marginInlineStart: 0, whiteSpace: "pre-wrap" }}>{categoryTags.categoryTag ?? "UNKNOWN（百度详情未返回）"}</dd>
            <dt>detail_info.classified_poi_tag</dt>
            <dd style={{ marginInlineStart: 0, whiteSpace: "pre-wrap" }}>{categoryTags.classifiedTag ?? "UNKNOWN（百度详情未返回）"}</dd>
          </dl>
          <p>百度地点详情原始字段，未经分类拆分或合并；服务端仅去除首尾空白。</p>
        </section>}
        <p>营业时间：{detail.openingHours ?? "暂无信息"}</p>
        <p>百度评分：{detail.rating === undefined ? "暂无信息" : `${detail.rating} / 5`}</p>
        <p>联系电话：{detail.telephone ?? "暂无信息"}</p>
        <p>品牌：{detail.brand ?? "暂无信息"}</p>
        <p>百度商户价格：{detail.priceText ?? "暂无信息"}</p>

        <p>最佳游玩时间：{detail.bestVisitTime ?? "暂无信息"}</p>
        {detail.detailUrl && <p><a href={detail.detailUrl} target="_blank" rel="noopener noreferrer">查看百度地点详情 ↗</a></p>}
        {detail.navigationLocation && <p>导航参考位置</p>}
        {!offline && detail.navigationLocation && <LocationPreview location={detail.navigationLocation} name={`${poi.name}导航引导点`} />}
        <h4>相关地点与出入口</h4>

        {detail.subPlaces?.length ? <ul>{detail.subPlaces.map(child => <li key={child.providerId}>
          <strong>{child.name}</strong>
          {child.categories?.length ? <span> · {child.categories.join(" / ")}</span> : null}
          {child.address && <p>{child.address}</p>}
          <p>{child.location ? "位置已提供" : "位置信息暂无"}</p>
          {!offline && child.location && <LocationPreview location={child.location} name={child.name} />}
        </li>)}</ul> : <p>暂无子地点或出入口资料。</p>}
        {detail.indoorFloor && <p>楼层：{detail.indoorFloor}</p>}
        {detail.suggestedVisitDuration && <p>百度建议游览时长：{detail.suggestedVisitDuration}</p>}
        {detail.description && <p>{detail.description}</p>}

      </>}
      {status === "error" && <p role="status">详情暂不可用，路线方案仍可查看。<button type="button" onClick={() => void load()}>重试详情</button></p>}
    </div>
  </details>;
}
