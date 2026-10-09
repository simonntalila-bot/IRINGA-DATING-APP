import { io, type Socket } from 'socket.io-client';
import { SOCKET_URL } from '../config';

type Listener = (payload: unknown) => void;

let socket: Socket | null = null;
const listeners = new Map<string, Set<Listener>>();

/**
 * Single shared socket for the whole app.
 *
 * The access token is sent in the handshake (never in the query string, which
 * would end up in server logs). The socket is authenticated server side; every
 * inbound event is authorised again before anything is used.
 */
export function getSocket(accessToken: string | null): Socket | null {
  if (!accessToken) return null;
  if (socket && socket.connected) return socket;

  socket?.disconnect();

  socket = io(SOCKET_URL, {
    transports: ['websocket'],
    auth: { token: accessToken },
    reconnectionAttempts: 8,
    reconnectionDelay: 1200,
  });

  socket.on('connect_error', () => {
    // Reconnect is handled by socket.io; the UI shows an offline banner.
  });

  return socket;
}

export function closeSocket(): void {
  socket?.disconnect();
  socket = null;
}

export function onSocket(event: string, listener: Listener): () => void {
  if (!socket) return () => undefined;

  const set = listeners.get(event) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(event, set);

  socket.on(event, listener);

  return () => {
    set.delete(listener);
    socket?.off(event, listener);
  };
}

export function emitWithAck<T>(event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!socket) {
      reject(new Error('Socket not connected'));
      return;
    }
    socket.emit(event, payload, (response: T) => resolve(response));
  });
}
