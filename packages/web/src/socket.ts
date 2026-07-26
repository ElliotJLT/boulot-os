import { useEffect, useRef, useState } from "react";

/**
 * A websocket that says when it is gone.
 *
 * The old code opened a socket and assumed it stayed open. When the server
 * restarted, the socket closed silently and the screen kept showing whatever it
 * had heard last: a spinner, a half-finished step list, a run that had actually
 * died minutes ago. A dead connection and a slow agent looked identical, and the
 * only way to tell them apart was to wait indefinitely and eventually guess.
 *
 * So this reconnects, and while it cannot, it says so. Both halves matter. A
 * banner that never clears is only marginally better than a spinner that never
 * stops.
 */

export type Connection = "connecting" | "open" | "lost";

export function useSocket(onMessage: (data: unknown) => void, onReopen?: () => void) {
  const [status, setStatus] = useState<Connection>("connecting");
  const live = useRef<WebSocket | null>(null);
  const handler = useRef(onMessage);
  handler.current = onMessage;
  const reopened = useRef(onReopen);
  reopened.current = onReopen;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let closed = false;
    // A reconnect is only a *re*connect after the first successful open, which
    // is what distinguishes "the server went away" from "it was never there".
    let everOpened = false;

    const connect = () => {
      if (closed) return;
      socket = new WebSocket(`ws://${location.host}/ws`);
      live.current = socket;

      socket.onopen = () => {
        attempts = 0;
        setStatus("open");
        if (everOpened) reopened.current?.();
        everOpened = true;
      };

      socket.onmessage = (e) => {
        try {
          handler.current(JSON.parse(e.data));
        } catch {
          /* a frame we cannot parse is not worth tearing the socket down for */
        }
      };

      socket.onclose = () => {
        if (closed) return;
        setStatus("lost");
        /*
         * Backoff, capped at four seconds.
         *
         * This is a local server on the same machine, so the common case is a
         * restart that takes a second or two. Backing off to thirty would mean
         * staring at a "lost connection" banner long after it came back.
         */
        const wait = Math.min(4000, 400 * 2 ** attempts++);
        timer = setTimeout(connect, wait);
      };

      socket.onerror = () => socket?.close();
    };

    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }, []);

  /**
   * Send, or say you could not.
   *
   * Returns false rather than throwing when the socket is down, so a caller can
   * tell the user their message went nowhere instead of clearing the box and
   * leaving them to assume it was received.
   */
  const send = (payload: unknown): boolean => {
    const s = live.current;
    if (!s || s.readyState !== WebSocket.OPEN) return false;
    s.send(JSON.stringify(payload));
    return true;
  };

  return { status, send };
}
