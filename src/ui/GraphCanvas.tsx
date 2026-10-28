import { select } from "d3-selection";
import { type ZoomBehavior, zoom, zoomIdentity } from "d3-zoom";
import { useEffect, useRef } from "react";

import type { Player } from "../engine/player";
import { Renderer, type View } from "../render/renderer";

export function GraphCanvas({ player }: { player: Player }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const renderer = new Renderer(player);
    const view: View = { k: 1, x: 0, y: 0, width: 1, height: 1, dpr: 1 };
    const selection = select(canvas);
    let applying = false;

    const zoomer: ZoomBehavior<HTMLCanvasElement, unknown> = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.06, 8])
      .on("zoom", (event) => {
        view.k = event.transform.k;
        view.x = event.transform.x;
        view.y = event.transform.y;
        // Any user pan or zoom stops the camera from following the graph.
        if (!applying && event.sourceEvent) player.setFollow(false);
      });
    selection.call(zoomer).on("dblclick.zoom", null);

    const setView = (k: number, x: number, y: number) => {
      applying = true;
      selection.call(zoomer.transform, zoomIdentity.translate(x, y).scale(k));
      applying = false;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      view.width = Math.max(1, rect.width);
      view.height = Math.max(1, rect.height);
      view.dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(view.width * view.dpr);
      canvas.height = Math.round(view.height * view.dpr);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    const first = renderer.fit(view);
    if (first) setView(first.k, first.x, first.y);
    else setView(1, view.width / 2, view.height / 2);

    const onMove = (e: PointerEvent) => {
      const node = renderer.pick(view, e.offsetX, e.offsetY);
      player.hover(node?.key);
      canvas.style.cursor = node ? "pointer" : "grab";
    };
    const onLeave = () => player.hover(undefined);
    const onClick = (e: MouseEvent) => {
      const node = renderer.pick(view, e.offsetX, e.offsetY);
      if (node) player.pin(node.key);
      else if (player.pinned) player.pin(player.pinned);
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("click", onClick);

    let raf = 0;
    const loop = (now: number) => {
      player.frame(now);
      if (player.follow) {
        const target = renderer.fit(view);
        if (target) {
          const ease = 0.045;
          setView(
            view.k + (target.k - view.k) * ease,
            view.x + (target.x - view.x) * ease,
            view.y + (target.y - view.y) * ease,
          );
        }
      }
      renderer.draw(ctx, view, now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("click", onClick);
      selection.on(".zoom", null);
    };
  }, [player]);

  return (
    <canvas ref={ref} className="graph" aria-label="Force-directed graph of people and channels" />
  );
}
