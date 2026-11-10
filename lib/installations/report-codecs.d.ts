declare module "pngjs" {
  export class PNG {
    constructor(options: { width: number; height: number });
    width: number;
    height: number;
    data: Buffer;
    static sync: {
      read: (buffer: Buffer) => PNG;
      write: (png: PNG) => Buffer;
    };
  }
}

declare module "libheif-js/wasm-bundle" {
  const libheif: {
    ready: Promise<void> | undefined;
    HeifDecoder: new () => {
      decode: (buffer: Buffer) => Array<{
        get_width: () => number;
        get_height: () => number;
        display: (
          image: { data: Uint8ClampedArray; width: number; height: number },
          callback: (displayed: { data: Uint8ClampedArray } | null) => void
        ) => void;
        free: () => void;
      }>;
      decoder: { delete: () => void };
    };
  };
  export default libheif;
}
