import { type ChangeEvent, type DragEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  CircleHelp,
  Download,
  FileVideo,
  FolderOpen,
  HardDrive,
  Info,
  LockKeyhole,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();

type ItemStatus = 'queued' | 'processing' | 'ready' | 'error';

type VideoItem = {
  id: string;
  file: File;
  outputName: string;
  status: ItemStatus;
  progress: number;
  error?: string;
};

const VIDEO_EXTENSIONS = new Set([
  'mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv', 'wmv', 'flv', 'mpeg', 'mpg', '3gp', 'ogv',
]);

function extensionOf(name: string) {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function isVideoFile(file: File) {
  return file.type.startsWith('video/') || VIDEO_EXTENSIONS.has(extensionOf(file.name));
}

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function archiveBaseName(name: string) {
  const lastDot = name.lastIndexOf('.');
  return lastDot > 0 ? name.slice(0, lastDot) : name;
}

function uniqueArchiveName(fileName: string, reserved: Set<string>) {
  const base = `${archiveBaseName(fileName)}.zip`;
  let candidate = base;
  let suffix = 2;
  while (reserved.has(candidate.toLowerCase())) {
    candidate = `${archiveBaseName(fileName)}-${suffix}.zip`;
    suffix += 1;
  }
  reserved.add(candidate.toLowerCase());
  return candidate;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function statusLabel(status: ItemStatus) {
  if (status === 'processing') return 'Sedang dikemas';
  if (status === 'ready') return 'ZIP terunduh';
  if (status === 'error') return 'Gagal diproses';
  return 'Menunggu';
}

function FileStatus({ item }: { item: VideoItem }) {
  if (item.status === 'processing') {
    return (
      <span className="status-chip processing" aria-live="polite">
        <RotateCcw size={12} aria-hidden="true" className="animate-spin" />
        {statusLabel(item.status)} · {item.progress}%
      </span>
    );
  }
  if (item.status === 'ready') {
    return (
      <span className="status-chip success">
        <CheckCircle2 size={12} aria-hidden="true" />
        {statusLabel(item.status)}
      </span>
    );
  }
  if (item.status === 'error') {
    return (
      <span className="status-chip error" title={item.error}>
        <AlertCircle size={12} aria-hidden="true" />
        {item.error ?? statusLabel(item.status)}
      </span>
    );
  }
  return (
    <span className="status-chip">
      <CircleHelp size={12} aria-hidden="true" />
      {statusLabel(item.status)}
    </span>
  );
}

function Home() {
  const [items, setItems] = useState<VideoItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [notice, setNotice] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const reservedNames = useRef(new Set<string>());
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const totalSize = useMemo(() => items.reduce((sum, item) => sum + item.file.size, 0), [items]);
  const completedCount = useMemo(() => items.filter((item) => item.status === 'ready').length, [items]);
  const processing = isBatchProcessing || items.some((item) => item.status === 'processing');

  const addFiles = useCallback((fileList: FileList | File[]) => {
    const incoming = Array.from(fileList);
    const valid = incoming.filter(isVideoFile);
    const invalidCount = incoming.length - valid.length;
    const existingIds = new Set(itemsRef.current.map((item) => item.id));
    const additions: VideoItem[] = [];

    valid.forEach((file) => {
      const id = `${file.name}-${file.size}-${file.lastModified}`;
      if (existingIds.has(id)) return;
      existingIds.add(id);
      additions.push({
        id,
        file,
        outputName: uniqueArchiveName(file.name, reservedNames.current),
        status: 'queued',
        progress: 0,
      });
    });

    if (invalidCount > 0) {
      setNotice(`${invalidCount} file dilewati. Pilih file video seperti MP4, MOV, WebM, AVI, atau MKV.`);
    } else if (additions.length > 0) {
      setNotice('');
    }
    if (additions.length > 0) {
      setItems((current) => [...current, ...additions]);
    }
  }, []);

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = '';
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (!processing) addFiles(event.dataTransfer.files);
  };

  const removeItem = (id: string) => {
    if (processing) return;
    setItems((current) => current.filter((item) => item.id !== id));
  };

  const createZip = useCallback(async (item: VideoItem) => {
    setItems((current) => current.map((entry) => (
      entry.id === item.id ? { ...entry, status: 'processing', progress: 0, error: undefined } : entry
    )));
    try {
      const zip = new JSZip();
      zip.file(item.file.name, item.file, { compression: 'STORE' });
      const archive = await zip.generateAsync(
        { type: 'blob', compression: 'STORE', compressionOptions: { level: 0 } },
        (metadata) => {
          setItems((current) => current.map((entry) => (
            entry.id === item.id
              ? { ...entry, status: 'processing', progress: Math.min(99, Math.round(metadata.percent)) }
              : entry
          )));
        },
      );
      triggerDownload(archive, item.outputName);
      setItems((current) => current.map((entry) => (
        entry.id === item.id ? { ...entry, status: 'ready', progress: 100 } : entry
      )));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ZIP tidak dapat dibuat.';
      setItems((current) => current.map((entry) => (
        entry.id === item.id ? { ...entry, status: 'error', error: message, progress: 0 } : entry
      )));
      return false;
    }
  }, []);

  const downloadAll = async () => {
    if (processing || itemsRef.current.length === 0) return;
    setIsBatchProcessing(true);
    const batch = [...itemsRef.current];
    for (const item of batch) {
      await createZip(item);
    }
    setIsBatchProcessing(false);
  };

  const clearQueue = () => {
    if (!processing) {
      setItems([]);
      setNotice('');
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="flex items-center gap-3">
            <div className="brand-mark" aria-hidden="true"><Archive size={18} /></div>
            <div className="brand-wordmark">Video<span>ZIP</span></div>
            <span className="micro-label hidden sm:inline">alat lokal</span>
          </div>
          <div className="privacy-badge">
            <LockKeyhole size={14} aria-hidden="true" />
            <span>File tidak meninggalkan perangkat</span>
          </div>
        </div>
      </header>

      <main className="page-wrap">
        <section className="hero" aria-labelledby="page-title">
          <div className="hero-kicker">Video ZIP Converter · 01</div>
          <h1 id="page-title">Video ke ZIP, <em>tanpa perjalanan keluar.</em></h1>
          <p className="hero-copy">
            Pilih beberapa video, lalu buat satu arsip ZIP untuk setiap file.
            Tidak ada unggahan, tidak ada transcoding, dan kualitas asli tetap utuh.
          </p>
        </section>

        <div className="workspace">
          <section aria-label="Area konversi">
            <div className="panel drop-panel">
              <div
                className={`drop-zone${isDragging ? ' is-dragging' : ''}`}
                onDragEnter={(event) => { event.preventDefault(); if (!processing) setIsDragging(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                  if (event.currentTarget === event.target) setIsDragging(false);
                }}
                onDrop={handleDrop}
              >
                <div className="drop-icon" aria-hidden="true"><UploadCloud size={29} strokeWidth={1.7} /></div>
                <h2>{isDragging ? 'Lepaskan video di sini' : 'Tambahkan video untuk mulai'}</h2>
                <p>Seret file ke area ini atau pilih dari perangkatmu.</p>
                <input
                  ref={inputRef}
                  className="sr-only"
                  type="file"
                  accept="video/*,.mp4,.mov,.m4v,.webm,.avi,.mkv,.wmv,.flv,.mpeg,.mpg,.3gp,.ogv"
                  multiple
                  onChange={handleInput}
                  aria-label="Pilih file video"
                />
                <button
                  className="primary-button focus-ring"
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={processing}
                >
                  <FolderOpen size={16} aria-hidden="true" />
                  Pilih file video
                </button>
                <span className="micro-label mt-4 text-[hsl(var(--muted-foreground))]">MP4 · MOV · WEBM · AVI · MKV dan lainnya</span>
              </div>
            </div>

            {notice && (
              <div className="notice" role="alert">
                <Info size={15} aria-hidden="true" />
                <span>{notice}</span>
                <button type="button" aria-label="Tutup pemberitahuan" onClick={() => setNotice('')}><X size={15} /></button>
              </div>
            )}

            <section className="panel queue-panel" aria-labelledby="queue-title">
              <div className="panel-heading">
                <div className="flex items-center gap-3">
                  <h2 id="queue-title">Antrean video</h2>
                  <span className="queue-count" aria-label={`${items.length} file`}>{items.length}</span>
                </div>
                {items.length > 0 && (
                  <button className="quiet-button focus-ring" type="button" onClick={clearQueue} disabled={processing}>
                    <Trash2 size={14} aria-hidden="true" />
                    Bersihkan
                  </button>
                )}
              </div>
              {items.length > 0 && (
                <div className="queue-actions">
                  <button
                    className="secondary-button focus-ring"
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    disabled={processing}
                  >
                    <Plus size={15} aria-hidden="true" />
                    Tambah video
                  </button>
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">
                    Setiap file menjadi ZIP terpisah
                  </span>
                </div>
              )}
              {items.length === 0 ? (
                <div className="empty-state">
                  <FileVideo size={28} strokeWidth={1.5} aria-hidden="true" />
                  <p>Antrean masih kosong. Video yang kamu pilih akan muncul di sini sebelum diproses.</p>
                </div>
              ) : (
                <div className="file-list">
                  {items.map((item) => (
                    <article className="file-row" key={item.id}>
                      <div className="file-type" aria-hidden="true"><FileVideo size={18} strokeWidth={1.7} /></div>
                      <div className="min-w-0">
                        <p className="file-name" title={item.file.name}>{item.file.name}</p>
                        <div className="file-meta">
                          <span>{formatBytes(item.file.size)}</span>
                          <span>ZIP: {item.outputName}</span>
                        </div>
                        {item.status === 'processing' && (
                          <div className="file-progress" aria-label={`Kemajuan ${item.progress}%`} role="progressbar" aria-valuenow={item.progress} aria-valuemin={0} aria-valuemax={100}>
                            <span style={{ width: `${item.progress}%` }} />
                          </div>
                        )}
                        <FileStatus item={item} />
                      </div>
                      <div className="row-actions">
                        <button
                          className="secondary-button focus-ring"
                          type="button"
                          onClick={() => void createZip(item)}
                          disabled={processing}
                          aria-label={`${item.status === 'ready' ? 'Unduh ulang' : 'Buat'} ZIP untuk ${item.file.name}`}
                        >
                          <Download size={14} aria-hidden="true" />
                          <span className="hidden sm:inline">{item.status === 'ready' ? 'Unduh ulang' : item.status === 'error' ? 'Coba lagi' : 'Buat ZIP'}</span>
                        </button>
                        <button
                          className="icon-button focus-ring"
                          type="button"
                          onClick={() => removeItem(item.id)}
                          disabled={processing}
                          aria-label={`Hapus ${item.file.name} dari antrean`}
                        >
                          <X size={16} aria-hidden="true" />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </section>

          <aside className="panel summary-panel" aria-labelledby="summary-title">
            <div className="micro-label">Ringkasan kerja</div>
            <h2 id="summary-title">Satu video. Satu ZIP.</h2>
            <p>ZIP memakai mode STORE: isi video disalin apa adanya, tanpa kompresi ulang yang tidak perlu.</p>
            <div className="summary-number">
              <strong>{items.length}</strong>
              <span>{items.length === 1 ? 'video dalam antrean' : 'video dalam antrean'}</span>
            </div>
            <div className="summary-stats">
              <div className="stat-box">
                <strong>{formatBytes(totalSize)}</strong>
                <span>Total ukuran sumber</span>
              </div>
              <div className="stat-box">
                <strong>{completedCount}/{items.length || 0}</strong>
                <span>ZIP selesai</span>
              </div>
            </div>
            <button className="primary-button large focus-ring" type="button" onClick={() => void downloadAll()} disabled={items.length === 0 || processing}>
              <Download size={17} aria-hidden="true" />
              {isBatchProcessing ? 'Mengunduh berurutan…' : 'Unduh semua ZIP'}
            </button>
            <div className="summary-divider" />
            <div className="how-it-works" aria-label="Cara kerja">
              <div className="how-step">
                <span>01</span>
                <p><strong>Pilih</strong> Tambahkan video dari perangkatmu.</p>
              </div>
              <div className="how-step">
                <span>02</span>
                <p><strong>Kemas</strong> Setiap video masuk ke ZIP-nya sendiri.</p>
              </div>
              <div className="how-step">
                <span>03</span>
                <p><strong>Simpan</strong> Unduhan muncul langsung di browser.</p>
              </div>
            </div>
            <div className="privacy-note">
              <ShieldCheck size={16} aria-hidden="true" />
              <span>Privasi bukan janji kosong. Semua proses berlangsung lokal di browser; tidak ada server upload, akun, atau penyimpanan.</span>
            </div>
          </aside>
        </div>

        <footer className="footer">
          <span><strong>VideoZIP</strong> · dibuat untuk paket cepat, bukan kualitas baru.</span>
          <span className="flex items-center gap-2"><HardDrive size={13} aria-hidden="true" /> File asli tetap tidak tersentuh</span>
        </footer>
      </main>
    </div>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  useEffect(() => {
    document.title = 'VideoZIP — Video ke ZIP, lokal dan privat';
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;