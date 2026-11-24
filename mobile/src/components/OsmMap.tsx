import { useEffect, useMemo, useRef } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import { colors, radius } from "../theme";
import { MAP_HTML } from "./mapHtml";

export interface MapPin { id: string; lat: number; lng: number; label: string; initial: string; me?: boolean }

// OpenStreetMap tiles rendered with Leaflet inside a WebView: no API key and identical on iOS/Android.
// (OsmMap.web.tsx is used instead in the browser preview.)
export function OsmMap({ pins, route, height = 260 }: { pins: MapPin[]; route?: [number, number][]; height?: number }) {
  // react-native-webview 14 types its default generic as `undefined`, which collapses props to `never`; pass `object`.
  const ref = useRef<WebView<object>>(null);
  const ready = useRef(false);
  const payload = useMemo(() => JSON.stringify({ type: "pins", pins, route }), [pins, route]);

  const push = () => ref.current?.injectJavaScript(`handle({data:${JSON.stringify(payload)}});true;`);
  useEffect(() => { if (ready.current) push(); }, [payload]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ height, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.border }}>
      <WebView<object>
        ref={ref} originWhitelist={["*"]} source={{ html: MAP_HTML }} javaScriptEnabled style={{ flex: 1 }}
        onMessage={e => { if (e.nativeEvent.data.includes("ready")) { ready.current = true; push(); } }}
      />
    </View>
  );
}
