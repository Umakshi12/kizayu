// Leaflet + OpenStreetMap page shared by the native WebView and the web iframe.
// tile.openstreetmap.org is for light use only; for production traffic set EXPO_PUBLIC_MAP_TILE_URL to a provider
// (MapTiler, Stadia, Mapbox, or self-hosted tiles).
export const TILE_URL = process.env.EXPO_PUBLIC_MAP_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export const MAP_HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{height:100%;margin:0}.pin{width:34px;height:34px;border-radius:17px;background:#0088B8;color:#fff;font:700 13px sans-serif;
display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)}.pin.me{background:#1E9BF0}</style></head>
<body><div id="map"></div><script>
var map=L.map('map',{zoomControl:false}).setView([20.59,78.96],4);
L.tileLayer('${TILE_URL}',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
var markers=[],routeLine=null;
function setPins(pins,route){markers.forEach(function(m){map.removeLayer(m)});markers=[];
 if(routeLine){map.removeLayer(routeLine);routeLine=null}
 if(route&&route.length>1){routeLine=L.polyline(route,{color:'#00B8E6',weight:5,opacity:.95,lineCap:'round',lineJoin:'round'}).addTo(map)}
 pins.forEach(function(p){var ic=L.divIcon({className:'',html:'<div class="pin '+(p.me?'me':'')+'">'+p.initial+'</div>',iconSize:[34,34],iconAnchor:[17,17]});
  markers.push(L.marker([p.lat,p.lng],{icon:ic}).addTo(map).bindPopup(p.label))});
 var pts=pins.map(function(p){return[p.lat,p.lng]}).concat(route||[]);
 if(pts.length===1)map.setView(pts[0],16);
 else if(pts.length>1)map.fitBounds(pts,{padding:[40,40],maxZoom:17});}
function handle(e){try{var d=JSON.parse(e.data);if(d.type==='pins')setPins(d.pins,d.route)}catch(x){}}
document.addEventListener('message',handle);window.addEventListener('message',handle);
var hello=JSON.stringify({type:'ready'});
if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(hello)}else if(window.parent){window.parent.postMessage(hello,'*')}
</script></body></html>`;
