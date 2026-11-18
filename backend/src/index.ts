import http from "http";
import { createApp } from "./app";
import { APP_NAME, PORT } from "./config";
import { attachRealtime } from "./realtime";

const server = http.createServer(createApp());
attachRealtime(server);
server.listen(PORT, () => console.log(`${APP_NAME} API listening on http://localhost:${PORT}`));
