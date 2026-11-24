import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { colors, radius } from "../theme";
import { MAP_HTML } from "./mapHtml";

export interface MapPin { id: string; lat: number; lng: number; label: string; initial: string; me?: boolean }

// Web preview: the same Leaflet/OpenStreetMap page, in an iframe instead of a native WebView.
export function OsmMap({ pins, route, height = 260 }: { pins: MapPin[]; route?: [number, number][]; height?: number }) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const payload = useMemo(() => JSON.stringify({ type: "pins", pins, route }), [pins, route]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source === ref.current?.contentWindow && typeof e.data === "string" && e.data.includes("ready")) setReady(true);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  useEffect(() => { if (ready) ref.current?.contentWindow?.postMessage(payload, "*"); }, [ready, payload]);

  return (
    <View style={{ height, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.border }}>
      <iframe ref={ref} title="Family map" srcDoc={MAP_HTML} style={{ border: 0, width: "100%", height: "100%" }} />
    </View>
  );
}
