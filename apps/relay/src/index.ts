// ============================================================
// Stavi Relay — Zero-Knowledge Binary Frame Forwarder
// ============================================================
// This is intentionally minimal (~100 lines). The relay:
// - Accepts WebSocket connections from server + mobile
// - Routes encrypted binary frames between paired connections by room ID
// - Cannot decrypt anything (E2E encryption means relay sees only ciphertext)
// - Has no state beyond active rooms
// - Cleans up when both sides disconnect

type RelayRole = 'server' | 'mobile';

interface RelayData {
  roomId: string;
  role: RelayRole;
  token: string;
}

type RelaySocket = Bun.ServerWebSocket<RelayData>;

interface Room {
  server: RelaySocket | null;
  mobile: RelaySocket | null;
  createdAt: number;
  /** Grace period timer — if one side drops, wait before tearing down */
  graceTimer: ReturnType<typeof setTimeout> | null;
}

const rooms = new Map<string, Room>();
const GRACE_PERIOD_MS = 60_000; // 60 seconds

const PORT = parseInt(process.env.STAVI_RELAY_PORT || '9022', 10);
const HOST = process.env.STAVI_RELAY_HOST || '0.0.0.0';

console.log('===========================================');
console.log('  Stavi Relay v0.0.1');
console.log('===========================================');

const server = Bun.serve<RelayData>({
  port: PORT,
  hostname: HOST,

  fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        rooms: rooms.size,
        uptime: process.uptime(),
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Expect: /room/:roomId?role=server|mobile&token=xxx
    const match = url.pathname.match(/^\/room\/([a-zA-Z0-9_-]+)$/);
    if (!match) {
      return new Response('Not found', { status: 404 });
    }

    const roomId = match[1];
    const roleParam = url.searchParams.get('role');
    const token = url.searchParams.get('token');

    if (!roleParam || !['server', 'mobile'].includes(roleParam)) {
      return new Response('Missing or invalid role parameter', { status: 400 });
    }
    if (!token) {
      return new Response('Missing token parameter', { status: 400 });
    }
    const role = roleParam as RelayRole;

    const upgraded = server.upgrade(req, {
      data: { roomId, role, token },
    });

    if (!upgraded) {
      return new Response('WebSocket upgrade failed', { status: 400 });
    }
    return undefined;
  },

  websocket: {
    open(ws) {
      const { roomId, role } = ws.data;

      let room = rooms.get(roomId);
      if (!room) {
        room = { server: null, mobile: null, createdAt: Date.now(), graceTimer: null };
        rooms.set(roomId, room);
        console.log(`  [Room] Created: ${roomId}`);
      }

      // Cancel grace timer if peer is reconnecting
      if (room.graceTimer) {
        clearTimeout(room.graceTimer);
        room.graceTimer = null;
      }

      // Reject if slot is already taken
      if (room[role] !== null) {
        ws.close(4000, `${role} slot already occupied`);
        return;
      }

      room[role] = ws;
      console.log(`  [Room] ${roomId}: ${role} connected`);

      // Notify the other side
      const peer = role === 'server' ? room.mobile : room.server;
      if (peer) {
        peer.send(JSON.stringify({ type: 'peer_connected' }));
        ws.send(JSON.stringify({ type: 'peer_connected' }));
      }
    },

    message(ws, message) {
      const { roomId, role } = ws.data;
      const room = rooms.get(roomId);
      if (!room) return;

      // Forward to the OTHER connection (dumb pipe — we don't parse the message)
      const peer = role === 'server' ? room.mobile : room.server;
      if (peer) {
        peer.send(message);
      }
    },

    close(ws) {
      const { roomId, role } = ws.data;
      const room = rooms.get(roomId);
      if (!room) return;

      room[role] = null;
      console.log(`  [Room] ${roomId}: ${role} disconnected`);

      // Notify peer
      const peer = role === 'server' ? room.mobile : room.server;
      if (peer) {
        peer.send(JSON.stringify({ type: 'peer_disconnected' }));
      }

      // If both sides gone, clean up immediately
      if (!room.server && !room.mobile) {
        rooms.delete(roomId);
        console.log(`  [Room] Destroyed: ${roomId}`);
        return;
      }

      // Start grace period — give the other side time to reconnect
      room.graceTimer = setTimeout(() => {
        const r = rooms.get(roomId);
        if (!r) return;

        // Tear down the room
        if (r.server) r.server.close(4001, 'Peer disconnected (grace period expired)');
        if (r.mobile) r.mobile.close(4001, 'Peer disconnected (grace period expired)');
        rooms.delete(roomId);
        console.log(`  [Room] Destroyed (grace): ${roomId}`);
      }, GRACE_PERIOD_MS);
    },
  },
});

console.log(`  Listening on ${HOST}:${PORT}`);
console.log(`  Rooms: ws://${HOST}:${PORT}/room/:roomId?role=server|mobile&token=xxx`);
console.log(`  Health: http://${HOST}:${PORT}/health`);
console.log('');
