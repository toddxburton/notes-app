import { useRef, type TouchEvent } from "react";

type SwipeStart = { identifier: number; x: number; y: number; opening: boolean };

/** Keep mobile sidebar gestures separate from vertical scrolling and page content swipes. */
export function useMobileSidebarSwipe(open: boolean, setOpen: (open: boolean) => void) {
  const start = useRef<SwipeStart | null>(null);

  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    start.current = null;
    if (!window.matchMedia("(max-width: 640px)").matches || event.touches.length !== 1) return;
    if (!event.currentTarget.contains(event.target as Node)) return;

    const touch = event.touches[0];
    if (open) {
      if (!(event.target as Element).closest(".document-rail, .mobile-rail-backdrop")) return;
    } else if (touch.clientX > 40) {
      return;
    }

    start.current = { identifier: touch.identifier, x: touch.clientX, y: touch.clientY, opening: !open };
  }

  function onTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const gesture = start.current;
    start.current = null;
    if (!gesture) return;

    const touch = Array.from(event.changedTouches).find((item) => item.identifier === gesture.identifier);
    if (!touch) return;
    const dx = touch.clientX - gesture.x;
    const dy = touch.clientY - gesture.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (gesture.opening && dx > 0) setOpen(true);
    if (!gesture.opening && dx < 0) setOpen(false);
  }

  function onTouchCancel() { start.current = null; }

  return { onTouchStart, onTouchEnd, onTouchCancel };
}
