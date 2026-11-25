import { useEffect, useRef, useState } from "react";
import type { CropRect } from "@hcg-ads/contracts";
import { Button, Modal } from "./ui";

/**
 * Crop rectangle editor. The rectangle is stored normalised (0..1). When the
 * target placement has a fixed size the rectangle is locked to its aspect
 * ratio, so the delivered media fills the placement without distortion.
 */
export function CropTool({ src, initial, aspect, onClose, onSave }: {
  src: string; initial: CropRect | null; aspect: number | null; onClose: () => void; onSave: (c: CropRect | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [rect, setRect] = useState<CropRect | null>(initial);
  const drag = useRef<null | { mode: "move" | "resize"; sx: number; sy: number; start: CropRect }>(null);

  // Default rectangle: the largest centred rectangle with the placement's ratio.
  useEffect(() => {
    if (!nat || rect) return;
    if (!aspect) { setRect({ x: 0, y: 0, width: 1, height: 1 }); return; }
    const imgRatio = nat.w / nat.h;
    if (imgRatio > aspect) {
      const w = aspect / imgRatio;
      setRect({ x: (1 - w) / 2, y: 0, width: w, height: 1 });
    } else {
      const h = imgRatio / aspect;
      setRect({ x: 0, y: (1 - h) / 2, width: 1, height: h });
    }
  }, [nat, aspect, rect]);

  const clamp = (r: CropRect): CropRect => {
    const width = Math.min(Math.max(r.width, 0.05), 1);
    const height = Math.min(Math.max(r.height, 0.05), 1);
    return { width, height, x: Math.min(Math.max(r.x, 0), 1 - width), y: Math.min(Math.max(r.y, 0), 1 - height) };
  };

  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || !box.current || !nat) return;
    const b = box.current.getBoundingClientRect();
    const dx = (e.clientX - d.sx) / b.width;
    const dy = (e.clientY - d.sy) / b.height;
    if (d.mode === "move") setRect(clamp({ ...d.start, x: d.start.x + dx, y: d.start.y + dy }));
    else {
      let width = Math.min(Math.max(d.start.width + dx, 0.05), 1 - d.start.x);
      let height = Math.min(Math.max(d.start.height + dy, 0.05), 1 - d.start.y);
      if (aspect) {
        // Keep (width·imgW)/(height·imgH) = aspect.
        const k = aspect * nat.h / nat.w;
        height = width / k;
        if (d.start.y + height > 1) { height = 1 - d.start.y; width = height * k; }
      }
      setRect({ ...d.start, width, height });
    }
  };
  const stop = () => { drag.current = null; window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", stop); };
  const start = (mode: "move" | "resize") => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!rect) return;
    drag.current = { mode, sx: e.clientX, sy: e.clientY, start: rect };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
  };
  useEffect(() => stop, []); // eslint-disable-line react-hooks/exhaustive-deps

  const px = rect && nat ? `${Math.round(rect.width * nat.w)} × ${Math.round(rect.height * nat.h)} px` : "";
  return (
    <Modal wide title="Crop" onClose={onClose} footer={
      <>
        <span className="muted small grow">{aspect ? `Locked to the placement's aspect ratio. ` : "Free crop. "}Selection: {px}</span>
        <Button onClick={() => onSave(null)}>Remove crop</Button>
        <Button variant="primary" disabled={!rect} onClick={() => onSave(rect)}>Apply crop</Button>
      </>
    }>
      <div className="crop-wrap">
        <div ref={box} className="crop-box">
          <img src={src} alt="" draggable={false} onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
          {rect && (
            <div className="crop-rect" onPointerDown={start("move")} style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}>
              <span className="crop-handle" onPointerDown={start("resize")} />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
