import { io, Socket } from "socket.io-client";
import { getToken } from "./api";
import { API_URL } from "./config";

// One shared socket per signed-in session: chat, doctor messages and live notifications all use it.
let socket: Socket | null = null;
let socketToken: string | null = null;

export function getSocket(): Socket | null {
  const token = getToken();
  if (!token) { closeSocket(); return null; }
  if (socket && socketToken === token) return socket;
  closeSocket();
  socketToken = token;
  socket = io(API_URL, { auth: { token }, transports: ["websocket"] });
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
  socketToken = null;
}
