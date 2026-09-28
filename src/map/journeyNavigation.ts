import type { SuccessfulRouteResult } from "../contracts/map";

export function navigationUrl(route: SuccessfulRouteResult, fromName: string, toName: string) {
  const url = new URL("https://api.map.baidu.com/direction");
  url.search = new URLSearchParams({ origin: `latlng:${route.from.location.latitude},${route.from.location.longitude}|name:${fromName}`,
    destination: `latlng:${route.to.location.latitude},${route.to.location.longitude}|name:${toName}`,
    mode: route.mode === "cycling" ? "riding" : "walking", coord_type: "bd09ll", output: "html", src: "webapp.city-pause" }).toString();
  return url.toString();
}
