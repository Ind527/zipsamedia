declare module 'jszip' {
  type Compression = 'STORE' | 'DEFLATE';

  type FileOptions = {
    compression?: Compression;
    compressionOptions?: { level?: number };
  };

  type GenerateOptions = {
    type: 'blob';
    compression?: Compression;
    compressionOptions?: { level?: number };
  };

  type Metadata = {
    percent: number;
  };

  class JSZip {
    file(name: string, data: Blob, options?: FileOptions): JSZip;
    generateAsync(options: GenerateOptions, onUpdate?: (metadata: Metadata) => void): Promise<Blob>;
  }

  export default JSZip;
}