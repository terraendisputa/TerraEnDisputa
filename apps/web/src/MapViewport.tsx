import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useZoomShortcut } from './shortcuts.js';
import { UiIcon } from './UiIcon.js';
import { createPortal } from 'react-dom';
import { tr } from './language.js';

type Point = { x: number; y: number };
export function MapViewport({
  children,
  resetKey,
  onScaleChange,
  reveal,
}: {
  children: ReactNode;
  resetKey: number;
  onScaleChange: (scale: number) => void;
  /** Selector of map shapes to bring into view, above any open panel, when it changes. */
  reveal?: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const camera = useRef({ scale: 1, x: 0, y: 0 });
  const points = useRef(new Map<number, Point>());
  const suppressClick = useRef(false);
  const start = useRef<Point | undefined>(undefined);
  const [scale, setScale] = useState(1);
  const committedScale = useRef(1);
  const commitTimer = useRef<number>(undefined);
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  const initialView = useRef(true);
  const portrait = useRef<boolean | null>(null);
  useEffect(() => {
    setToolbar(document.getElementById('game-toolbar'));
  }, []);
  // React state follows the camera only once a gesture settles: during a drag,
  // pinch or wheel only the transform moves, so the map is not redrawn each step.
  function commitScale() {
    window.clearTimeout(commitTimer.current);
    viewport.current?.classList.remove('is-moving');
    const next = camera.current.scale;
    if (next === committedScale.current) return;
    committedScale.current = next;
    setScale(next);
    onScaleChange(next);
  }
  function render(gesture = false) {
    const el = viewport.current;
    if (!el || !content.current) return;
    const c = camera.current;
    const map = content.current.querySelector('svg');
    const ratio = map
      ? map.viewBox.baseVal.width / map.viewBox.baseVal.height
      : el.clientWidth / el.clientHeight;
    const mapWidth = Math.min(el.clientWidth, el.clientHeight * ratio);
    const mapHeight = Math.min(el.clientHeight, el.clientWidth / ratio);
    const maxX = Math.max(0, (mapWidth * c.scale - el.clientWidth) / 2);
    const maxY = Math.max(0, (mapHeight * c.scale - el.clientHeight) / 2);
    c.x = Math.max(-maxX, Math.min(maxX, c.x));
    c.y = Math.max(-maxY, Math.min(maxY, c.y));
    content.current.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.scale})`;
    if (!gesture) commitScale();
    else {
      // While moving, the map's paper and coast effects are switched off so
      // the browser only shifts the picture; they return when it settles.
      el.classList.add('is-moving');
      window.clearTimeout(commitTimer.current);
      // Pointer gestures commit when the last finger lifts; the wheel after a pause.
      if (!points.current.size)
        commitTimer.current = window.setTimeout(commitScale, 150);
    }
  }
  useZoomShortcut((direction) =>
    zoom(camera.current.scale * (direction === 1 ? 1.4 : 1 / 1.4)),
  );
  function zoom(value: number, at?: Point, gesture = false) {
    const el = viewport.current;
    if (!el) return;
    const c = camera.current;
    const next = Math.max(1, Math.min(6, value));
    const x = (at?.x ?? el.clientWidth / 2) - el.clientWidth / 2;
    const y = (at?.y ?? el.clientHeight / 2) - el.clientHeight / 2;
    c.x = x - ((x - c.x) * next) / c.scale;
    c.y = y - ((y - c.y) * next) / c.scale;
    c.scale = next;
    render(gesture);
  }
  function reset() {
    camera.current = { scale: 1, x: 0, y: 0 };
    render();
  }
  useEffect(() => {
    const el = viewport.current;
    if (
      initialView.current &&
      el &&
      el.clientWidth <= 800 &&
      el.clientHeight > el.clientWidth
    ) {
      camera.current = {
        scale: Math.min(
          3,
          (el.clientHeight * 0.75) / ((el.clientWidth * 960) / 1720),
        ),
        x: 0,
        y: 0,
      };
      render();
    } else reset();
    initialView.current = false;
  }, [resetKey]);
  useEffect(() => {
    const el = viewport.current;
    if (!reveal || !el || !content.current) return;
    const frame = requestAnimationFrame(() => {
      const shapes = [...content.current!.querySelectorAll(reveal)].map((s) =>
        s.getBoundingClientRect(),
      );
      if (!shapes.length) return;
      const box = el.getBoundingClientRect();
      const panel = document
        .querySelector('.information-content:not([hidden])')
        ?.getBoundingClientRect();
      const bottom =
        panel && panel.top > box.top
          ? Math.min(box.bottom, panel.top)
          : box.bottom;
      const left = Math.min(...shapes.map((r) => r.left)),
        right = Math.max(...shapes.map((r) => r.right)),
        top = Math.min(...shapes.map((r) => r.top)),
        low = Math.max(...shapes.map((r) => r.bottom));
      if (
        left >= box.left &&
        right <= box.right &&
        top >= box.top &&
        low <= bottom
      )
        return;
      camera.current.x += (box.left + box.right - left - right) / 2;
      camera.current.y += (box.top + bottom - top - low) / 2;
      render();
    });
    return () => cancelAnimationFrame(frame);
  }, [reveal]);
  useEffect(() => {
    const el = viewport.current!;
    const observer = new ResizeObserver(() => {
      const nextPortrait = el.clientHeight > el.clientWidth;
      if (portrait.current !== null && portrait.current !== nextPortrait) {
        camera.current = {
          scale:
            el.clientWidth <= 800 && nextPortrait
              ? Math.min(
                  3,
                  (el.clientHeight * 0.75) / ((el.clientWidth * 960) / 1720),
                )
              : 1,
          x: 0,
          y: 0,
        };
      }
      portrait.current = nextPortrait;
      render();
    });
    observer.observe(el);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = el.getBoundingClientRect();
      zoom(
        camera.current.scale * Math.exp(-event.deltaY * 0.002),
        { x: event.clientX - box.left, y: event.clientY - box.top },
        true,
      );
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer.disconnect();
      el.removeEventListener('wheel', wheel);
    };
  }, []);
  const controls = (
    <div
      className="map-zoom-controls"
      aria-label={tr('Vista del mapa', 'Map view')}
    >
      <button
        type="button"
        disabled={scale <= 1}
        aria-label={tr('Alejar mapa', 'Zoom out')}
        title={tr('Alejar mapa', 'Zoom out')}
        onClick={() => zoom(camera.current.scale / 1.4)}
      >
        <UiIcon name="minus" />
      </button>
      <button
        type="button"
        disabled={scale >= 6}
        aria-label={tr('Acercar mapa', 'Zoom in')}
        title={tr('Acercar mapa', 'Zoom in')}
        onClick={() => zoom(camera.current.scale * 1.4)}
      >
        <UiIcon name="plus" />
      </button>
      <button
        type="button"
        onClick={reset}
        aria-label={tr('Ver mapa completo', 'Show the whole map')}
        title={tr('Ver mapa completo', 'Show the whole map')}
      >
        <UiIcon name="fit" />
      </button>
    </div>
  );
  return (
    <>
      {toolbar ? createPortal(controls, toolbar) : controls}
      <div
        className="map-viewport"
        ref={viewport}
        tabIndex={0}
        aria-label={tr(
          'Mapa ampliable. Usá más y menos para ampliar, flechas para desplazar; en pantalla táctil arrastrá o usá dos dedos.',
          'Zoomable map. Use plus and minus to zoom and the arrows to move; on a touch screen drag or use two fingers.',
        )}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === '+' || e.key === '=') {
            e.preventDefault();
            zoom(camera.current.scale * 1.4);
          }
          if (e.key === '-') {
            e.preventDefault();
            zoom(camera.current.scale / 1.4);
          }
          if (
            ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)
          ) {
            e.preventDefault();
            camera.current.x +=
              e.key === 'ArrowLeft' ? 45 : e.key === 'ArrowRight' ? -45 : 0;
            camera.current.y +=
              e.key === 'ArrowUp' ? 45 : e.key === 'ArrowDown' ? -45 : 0;
            render();
          }
        }}
        onClickCapture={(e) => {
          if (suppressClick.current && e.detail !== 0) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          const p = { x: e.clientX, y: e.clientY };
          if (!points.current.size) {
            start.current = p;
            suppressClick.current = false;
          }
          points.current.set(e.pointerId, p);
          // Capture on the hit target so an unmoved tap retains its territory target.
          (e.target as Element).setPointerCapture(e.pointerId);
          if (points.current.size > 1) suppressClick.current = true;
        }}
        onPointerMove={(e) => {
          const previous = points.current.get(e.pointerId);
          if (!previous) return;
          const before = [...points.current.values()];
          points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (points.current.size >= 2) {
            const after = [...points.current.values()];
            const a = before[0]!,
              b = before[1]!,
              c = after[0]!,
              d = after[1]!;
            const oldDistance = Math.hypot(a.x - b.x, a.y - b.y);
            camera.current.x += (c.x + d.x - a.x - b.x) / 2;
            camera.current.y += (c.y + d.y - a.y - b.y) / 2;
            const box = e.currentTarget.getBoundingClientRect();
            zoom(
              (camera.current.scale * Math.hypot(c.x - d.x, c.y - d.y)) /
                (oldDistance || 1),
              { x: (c.x + d.x) / 2 - box.left, y: (c.y + d.y) / 2 - box.top },
              true,
            );
          } else {
            if (
              start.current &&
              Math.hypot(
                e.clientX - start.current.x,
                e.clientY - start.current.y,
              ) > 7
            )
              suppressClick.current = true;
            if (suppressClick.current) {
              camera.current.x += e.clientX - previous.x;
              camera.current.y += e.clientY - previous.y;
              render(true);
            }
          }
        }}
        onPointerUp={(e) => {
          points.current.delete(e.pointerId);
          if (!points.current.size) commitScale();
        }}
        onPointerCancel={(e) => {
          points.current.delete(e.pointerId);
          suppressClick.current = true;
          if (!points.current.size) commitScale();
        }}
        onLostPointerCapture={(e) => {
          points.current.delete(e.pointerId);
          if (!points.current.size) commitScale();
        }}
      >
        <div className="map-transform" ref={content}>
          {children}
        </div>
      </div>
    </>
  );
}
