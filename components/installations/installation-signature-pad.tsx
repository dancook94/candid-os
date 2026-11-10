"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import SignaturePad from "signature_pad";

import { Button } from "@/components/ui/button";

export type InstallationSignaturePadHandle = {
  isEmpty: () => boolean;
  toBlob: () => Promise<Blob | null>;
  clear: () => void;
};

export const InstallationSignaturePad = forwardRef<
  InstallationSignaturePadHandle,
  { onChange?: (empty: boolean) => void }
>(function InstallationSignaturePad({ onChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const padRef = useRef<SignaturePad | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      const pad = new SignaturePad(canvas, {
        minWidth: 0.8,
        maxWidth: 2.4,
        penColor: "#171717",
        backgroundColor: "rgba(255,255,255,0)",
      });
      padRef.current = pad;
      const notify = () => onChangeRef.current?.(pad.isEmpty());
      pad.addEventListener("endStroke", notify);

      const resize = () => {
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        const width = canvas.offsetWidth;
        const height = canvas.offsetHeight;
        if (width === 0 || height === 0) {
          return;
        }
        const strokes = pad.toData();
        canvas.width = width * ratio;
        canvas.height = height * ratio;
        const context = canvas.getContext("2d");
        context?.setTransform(ratio, 0, 0, ratio, 0, 0);
        pad.clear();
        if (strokes.length > 0) {
          pad.fromData(strokes);
        }
      };

      resize();
      const observer = new ResizeObserver(resize);
      observer.observe(canvas);

      return () => {
        observer.disconnect();
        pad.removeEventListener("endStroke", notify);
        pad.off();
        padRef.current = null;
      };
    }, []);

    useImperativeHandle(ref, () => ({
      isEmpty: () => padRef.current?.isEmpty() ?? true,
      clear: () => padRef.current?.clear(),
      toBlob: () =>
        new Promise((resolve) => {
          const canvas = canvasRef.current;
          if (!canvas || padRef.current?.isEmpty()) {
            resolve(null);
            return;
          }
          canvas.toBlob((blob) => resolve(blob), "image/png");
        }),
    }));

    return (
      <div className="space-y-2">
        <div className="overflow-hidden rounded-lg border border-neutral-300 bg-white">
          <canvas
            ref={canvasRef}
            aria-label="Customer signature"
            className="h-44 w-full touch-none"
            style={{ touchAction: "none" }}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => {
            padRef.current?.clear();
            onChangeRef.current?.(true);
          }}
        >
          Clear Signature
        </Button>
      </div>
    );
  }
);
