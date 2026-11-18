import type http from "http";
import { Server } from "socket.io";
import { CORS_ORIGINS, IS_PROD } from "./config";
import { authenticate } from "./auth";
import { circleIdsOf } from "./util";
import { roomOf, sendMessage, setIo } from "./routes/chat";
import { setDoctorIo } from "./routes/doctors";
import { setNotifyIo, userRoom } from "./services/notify";

/**
 * Realtime: clients connect with { auth: { token } }. Each socket joins one room per circle (chat) and a personal
 * room (notifications, doctor messages). Events: "message", "doctorMessage", "notification".
 */
export function attachRealtime(server: http.Server) {
  const io = new Server(server, { cors: { origin: IS_PROD ? (CORS_ORIGINS.length ? CORS_ORIGINS : false) : "*" } });
  setIo(io); setDoctorIo(io); setNotifyIo(io);

  io.use((socket, next) => {
    authenticate(String(socket.handshake.auth?.token ?? ""))
      .then(id => { socket.data.userId = id; next(); })
      .catch(() => next(new Error("unauthorized")));
  });

  io.on("connection", async socket => {
    const userId: string = socket.data.userId;
    socket.join(userRoom(userId));
    const circleIds = await circleIdsOf(userId);
    circleIds.forEach(id => socket.join(roomOf(id)));
    socket.emit("ready", { circles: circleIds.length });

    socket.on("message", async (p: { circleId?: string; text?: string }, ack?: (r: unknown) => void) => {
      try {
        if (!p?.circleId || !circleIds.includes(p.circleId)) throw new Error("Not a member of this circle");
        const text = String(p.text ?? "").trim().slice(0, 2000);
        ack?.({ ok: true, message: await sendMessage(p.circleId, userId, text || undefined) });
      } catch (e) { ack?.({ ok: false, error: (e as Error).message }); }
    });
  });
  return io;
}
