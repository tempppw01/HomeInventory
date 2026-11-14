"use client";

import { Camera, CircleCheck, Image as ImageIcon, Keyboard, LoaderCircle, MonitorUp, QrCode, RotateCcw, ScanLine, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactElement } from "react";
import { useEscapeClose } from "@/lib/use-escape-close";

export type ScanSource = "camera" | "screen" | "image" | "manual";

type Verdict = "matched" | "duplicate" | "unknown";
type Status = "idle" | "starting" | "live" | "error";
type Notice = { tone: "warn" | "error"; text: string; retry: boolean };

/** A code scanned twice inside this window is not reported again. */
const DEDUPE_MS = 3000;
/** Video streams are sampled on this cadence (per task spec). */
const SCAN_INTERVAL_MS = 300;

const UNSUPPORTED_TEXT = "当前浏览器不支持自动识别,请用『手动』输入编号或换 Chrome / Edge / Android Chrome";

const CAMERA_CONSTRAINTS: MediaStreamConstraints = { video: { facingMode: "environment" }, audio: false };
// `preferCurrentTab` keeps "scan what is on my own screen" to one click in Chromium;
// browsers that do not know the key ignore it.
const SCREEN_CONSTRAINTS = { video: true, audio: false, preferCurrentTab: true } as DisplayMediaStreamOptions;

// The built-in BarcodeDetector API is not in TypeScript's DOM lib yet, so the shape
// is declared locally instead of depending on a polyfill package.
type DetectedBarcode = { rawValue?: string };
type BarcodeDetectorLike = { detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

const barcodeDetectorCtor = () => (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;

async function createDetector(): Promise<BarcodeDetectorLike | null> {
  const Ctor = barcodeDetectorCtor();
  if (typeof Ctor !== "function") return null;
  try {
    if (typeof Ctor.getSupportedFormats === "function") {
      const formats = await Ctor.getSupportedFormats();
      if (!Array.isArray(formats) || !formats.includes("qr_code")) return null;
    }
    return new Ctor({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

/**
 * Turns a scanned payload into an item code: trims, unwraps any URL, and keeps the
 * last path segment so `https://host/consume/INV-1?x=1` and `/items/INV-1` both
 * become `INV-1`.
 */
export function normalizeScannedCode(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  let value = trimmed;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      const segments = url.pathname.split("/").filter(Boolean);
      value = segments.length ? segments[segments.length - 1] : url.hostname;
    } catch {
      value = value.split(/[?#]/)[0];
      const segments = value.split("/").filter(Boolean);
      value = segments.length ? segments[segments.length - 1] : value;
    }
  } else if (value.includes("/") || value.includes("?")) {
    const segments = value.split(/[?#]/)[0].split("/").filter(Boolean);
    if (segments.length) value = segments[segments.length - 1];
  }
  try {
    value = decodeURIComponent(value);
  } catch {
    /* keep the raw segment when it is not valid percent-encoding */
  }
  return value.trim();
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image-load-failed"));
    image.src = url;
  });
}

function errorName(error: unknown) {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) return error.name;
  if (error && typeof error === "object" && "name" in error) return String((error as { name: unknown }).name);
  return "";
}

function describeFailure(source: ScanSource, error: unknown) {
  const name = errorName(error);
  switch (name) {
    case "NotAllowedError":
      return source === "screen"
        ? "已取消屏幕共享,或没有获得共享权限。点「重试」可以重新选择要扫描的屏幕或窗口。"
        : "没有获得相机权限。请在浏览器地址栏的权限设置里允许相机,然后点「重试」;也可以改用「屏幕」「图片」或「手动」。";
    case "NotFoundError":
    case "OverconstrainedError":
      return source === "screen"
        ? "没有找到可以共享的屏幕或窗口,点「重试」后在共享列表里挑一块屏幕。"
        : "没有检测到可用的摄像头。电脑上可以切到「屏幕」扫描屏幕里的二维码,或用「图片」「手动」输入编号。";
    case "NotReadableError":
    case "TrackStartError":
      return "相机或屏幕画面被其它程序占用,请关掉占用它的应用后点「重试」。";
    case "AbortError":
      return source === "screen" ? "已取消屏幕共享,点「重试」可以重新选择要扫描的屏幕或窗口。" : "已取消,点「重试」可以重新开始。";
    case "NotSupportedError":
      return "当前浏览器不支持这种扫描方式,请改用「图片」或「手动」输入编号。";
    default:
      return `启动扫描失败${name ? `(${name})` : ""},请点「重试」;也可以改用「图片」或「手动」输入编号。`;
  }
}

const CHIP_LABEL: Record<ScanSource, string> = { camera: "相机", screen: "屏幕", image: "图片", manual: "手动" };

const STAGE_TITLE: Record<ScanSource, string> = {
  camera: "把二维码对准取景框,识别到编号会自动盘点",
  screen: "把二维码显示在这块屏幕上(本应用二维码、PDF、图片都可以),保持不动",
  image: "选一张照片或截图,识别其中的二维码",
  manual: "输入物品编号,例如 INV-2026-0001,也可以直接粘贴二维码里的链接",
};

export function QrScannerModal({
  onClose,
  onDetect,
  title = "扫码盘点",
  hint = "手机用相机扫实物上的二维码;电脑用「屏幕」扫屏幕里的二维码,识别到编号会自动盘点。",
}: {
  onClose: () => void;
  onDetect: (code: string) => Verdict;
  title?: string;
  hint?: string;
}): ReactElement {
  const [source, setSource] = useState<ScanSource>("camera");
  const [status, setStatus] = useState<Status>("idle");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [support, setSupport] = useState<"checking" | "ok" | "unsupported">("checking");
  const [canShareScreen, setCanShareScreen] = useState(false);
  const [last, setLast] = useState<{ code: string; verdict: Verdict; index: number } | null>(null);
  const [scanned, setScanned] = useState(0);
  const [manual, setManual] = useState("");
  const [busyImage, setBusyImage] = useState(false);
  const [entered, setEntered] = useState(false);
  const [reduced, setReduced] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const manualInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const startTokenRef = useRef(0);
  const seenRef = useRef(new Map<string, number>());
  const scannedRef = useRef(0);
  const startedRef = useRef(false);
  const onDetectRef = useRef(onDetect);

  useEffect(() => {
    onDetectRef.current = onDetect;
  }, [onDetect]);

  useEscapeClose(onClose);

  // Entrance transition + reduced-motion preference (OS setting or the app's switch).
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const read = () => setReduced(media.matches || document.documentElement.dataset.motion === "reduced");
    const first = window.setTimeout(read, 0);
    media.addEventListener("change", read);
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
    return () => {
      window.clearTimeout(first);
      media.removeEventListener("change", read);
      observer.disconnect();
    };
  }, []);

  const stopStream = useCallback(() => {
    startTokenRef.current += 1;
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.onended = null;
        track.stop();
      }
    }
    const video = videoRef.current;
    if (video) video.srcObject = null;
  }, []);

  // Closing the dialog (or unmounting it) must always release the camera / screen.
  useEffect(() => stopStream, [stopStream]);

  const accept = useCallback((raw: string, userInitiated = false) => {
    const code = normalizeScannedCode(raw);
    if (!code) return;
    const now = Date.now();
    const seen = seenRef.current;
    for (const [key, at] of seen) {
      if (now - at > DEDUPE_MS) seen.delete(key);
    }
    if (seen.has(code)) {
      if (userInitiated) setNotice({ tone: "warn", text: `刚刚已经识别过 ${code},${Math.ceil(DEDUPE_MS / 1000)} 秒后可以再次盘点。`, retry: false });
      return;
    }
    seen.set(code, now);
    const verdict = onDetectRef.current(code);
    // 只有真正盘点成功才计数:未知编号与重复扫描不应该让「已盘点 N 个」虚高。
    const index = verdict === "matched" ? scannedRef.current + 1 : scannedRef.current;
    if (verdict === "matched") scannedRef.current = index;
    setScanned(index);
    setLast({ code, verdict, index });
    setNotice(null);
  }, []);

  const startStream = useCallback(
    async (next: ScanSource) => {
      if (next !== "camera" && next !== "screen") {
        stopStream();
        setStatus("idle");
        return;
      }
      const detector = detectorRef.current ?? (await createDetector());
      if (!detector) {
        detectorRef.current = null;
        setSupport("unsupported");
        setSource("manual");
        setStatus("idle");
        setNotice({ tone: "warn", text: UNSUPPORTED_TEXT, retry: true });
        return;
      }
      detectorRef.current = detector;

      const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
      const supported = next === "camera" ? typeof media?.getUserMedia === "function" : typeof media?.getDisplayMedia === "function";
      if (!media || !supported) {
        stopStream();
        setStatus("error");
        setNotice({
          tone: "error",
          retry: true,
          text: next === "screen" ? "当前环境不支持屏幕共享扫描,请改用「图片」或「手动」输入编号。" : "当前环境不支持调用相机,请改用「图片」或「手动」输入编号。",
        });
        return;
      }

      stopStream();
      const token = startTokenRef.current;
      setStatus("starting");
      setNotice(null);
      try {
        const stream = next === "camera" ? await media.getUserMedia(CAMERA_CONSTRAINTS) : await media.getDisplayMedia(SCREEN_CONSTRAINTS);
        if (startTokenRef.current !== token) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        for (const track of stream.getTracks()) {
          track.addEventListener("ended", () => {
            if (streamRef.current !== stream) return;
            stopStream();
            setStatus("idle");
            setNotice({
              tone: "warn",
              retry: true,
              text: next === "screen" ? "屏幕共享已结束,点「重试」可以重新开始。" : "相机画面已停止,点「重试」可以重新打开。",
            });
          });
        }
        setStatus("live");
      } catch (error) {
        if (startTokenRef.current !== token) return;
        stopStream();
        setStatus("error");
        setNotice({ tone: "error", retry: true, text: describeFailure(next, error) });
      }
    },
    [stopStream],
  );

  const chooseSource = useCallback(
    async (next: ScanSource) => {
      setSource(next);
      setNotice(null);
      if (next === "camera" || next === "screen") {
        await startStream(next);
        return;
      }
      stopStream();
      setStatus("idle");
      if (next === "image") imageInputRef.current?.click();
      if (next === "manual") manualInputRef.current?.focus();
    },
    [startStream, stopStream],
  );

  // Pick the default source once: screen on a device that can share a display,
  // otherwise the rear camera; without BarcodeDetector fall back to manual input.
  useEffect(() => {
    if (startedRef.current) return;
    const frame = requestAnimationFrame(() => {
      if (startedRef.current) return;
      startedRef.current = true;
      void (async () => {
        const detector = await createDetector();
        detectorRef.current = detector;
        const desktop = typeof navigator.mediaDevices?.getDisplayMedia === "function";
        setCanShareScreen(desktop);
        if (!detector) {
          setSupport("unsupported");
          setSource("manual");
          setNotice({ tone: "warn", text: UNSUPPORTED_TEXT, retry: true });
          return;
        }
        setSupport("ok");
        if (desktop) {
          // 桌面默认选中「屏幕」但不自动连接:屏幕共享会弹系统选择器,未授权时还会先报一次错。
          setSource("screen");
          setNotice({ tone: "warn", text: "点一下「屏幕」并选择要共享的窗口,就能识别屏幕上的二维码;也可以切到「相机」。", retry: false });
          return;
        }
        await chooseSource("camera");
      })();
    });
    return () => cancelAnimationFrame(frame);
  }, [chooseSource]);

  // Decode loop: ~300ms sampling of the live video while a camera/screen source runs.
  useEffect(() => {
    if (status !== "live") return;
    const id = window.setInterval(() => {
      const video = videoRef.current;
      const detector = detectorRef.current;
      if (!video || !detector || video.readyState < 2) return;
      void detector
        .detect(video)
        .then((codes) => {
          for (const code of codes) {
            if (code?.rawValue) accept(code.rawValue);
          }
        })
        .catch(() => undefined);
    }, SCAN_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [status, accept]);

  const submitManual = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = normalizeScannedCode(manual);
    if (!code) {
      setNotice({ tone: "warn", text: "请先输入物品编号,或直接粘贴二维码里的链接。", retry: false });
      return;
    }
    setManual("");
    accept(code, true);
  };

  const pickImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusyImage(true);
    setNotice(null);
    const detector = detectorRef.current ?? (await createDetector());
    if (!detector) {
      detectorRef.current = null;
      setSupport("unsupported");
      setSource("manual");
      setBusyImage(false);
      setNotice({ tone: "warn", text: UNSUPPORTED_TEXT, retry: true });
      return;
    }
    detectorRef.current = detector;
    const url = URL.createObjectURL(file);
    try {
      const image = await loadImage(url);
      const codes = await detector.detect(image);
      const values = codes.map((code) => code?.rawValue ?? "").filter(Boolean);
      if (!values.length) {
        setNotice({ tone: "warn", text: "这张图片里没有识别到二维码,换一张更清晰、没有裁切的图片再试。", retry: true });
        return;
      }
      for (const value of values) accept(value, true);
    } catch {
      setNotice({ tone: "error", text: "图片读取失败,请换一张 JPG / PNG 截图后重试。", retry: true });
    } finally {
      URL.revokeObjectURL(url);
      setBusyImage(false);
    }
  };

  const retry = useCallback(async () => {
    setNotice(null);
    if (support === "unsupported") {
      const detector = await createDetector();
      detectorRef.current = detector;
      if (!detector) {
        setNotice({ tone: "warn", text: UNSUPPORTED_TEXT, retry: true });
        return;
      }
      setSupport("ok");
      await startStream(canShareScreen ? "screen" : "camera");
      return;
    }
    if (source === "image") {
      imageInputRef.current?.click();
      return;
    }
    if (source === "manual") {
      manualInputRef.current?.focus();
      return;
    }
    await startStream(source);
  }, [canShareScreen, source, startStream, support]);

  const chips: { id: ScanSource; icon: typeof Camera }[] = [
    { id: "camera", icon: Camera },
    ...(canShareScreen ? [{ id: "screen" as ScanSource, icon: MonitorUp }] : []),
    { id: "image", icon: ImageIcon },
    { id: "manual", icon: Keyboard },
  ];
  const live = source === "camera" || source === "screen";
  const stageBusy = status === "starting";

  const resultText = (() => {
    if (!last) return "还没有识别到编号";
    if (last.verdict === "unknown") return `没找到这个编号:${last.code}`;
    if (last.verdict === "duplicate") return `已盘点:${last.code}(本次已经扫过)`;
    return `已盘点:${last.code}(第 ${last.index} 个)`;
  })();

  return (
    <div
      className="fixed inset-0 z-[130] flex items-end justify-center bg-black/35 backdrop-blur-sm sm:items-center sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby="qr-scanner-hint"
        tabIndex={-1}
        data-qr-scanner="true"
        data-source={source}
        data-status={status}
        className="max-h-[min(92vh,88dvh)] w-full max-w-lg overflow-y-auto rounded-t-[28px] rounded-b-none p-5 shadow-2xl sm:rounded-[28px] sm:p-6"
        style={{
          background: "var(--surface-solid)",
          paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
          opacity: entered ? 1 : 0,
          transform: entered || reduced ? "none" : "translateY(14px)",
          transition: reduced ? "none" : "opacity 200ms ease, transform 220ms cubic-bezier(.2,.8,.2,1)",
        }}
      >
        <div className="mb-5 flex items-start gap-3 sm:mb-6">
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>
            <QrCode size={19} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-xl font-black leading-snug">{title}</h2>
            <p id="qr-scanner-hint" className="mb-0 mt-1 text-xs leading-5 muted">
              {hint}
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost grid size-11 min-h-11 shrink-0 place-items-center p-0" aria-label={`关闭${title}`} title="关闭">
            <X size={17} />
          </button>
        </div>

        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="扫描来源">
          {chips.map(({ id, icon: Icon }) => {
            const active = source === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => void chooseSource(id)}
                aria-pressed={active}
                data-source-chip={id}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-xs font-bold transition sm:min-h-10"
                style={active ? { background: "var(--primary)", color: "var(--on-primary)" } : { background: "var(--surface-soft)", color: "var(--muted)" }}
              >
                <Icon size={15} />
                {CHIP_LABEL[id]}
              </button>
            );
          })}
          <span className="inline-flex min-h-11 items-center px-1 text-xs font-bold muted">本次已盘点 {scanned} 个</span>
        </div>

        <p className="mb-3 mt-0 flex items-start gap-1.5 text-xs leading-5 muted">
          <ScanLine size={14} className="mt-0.5 shrink-0" style={{ color: "var(--primary)" }} />
          <span className="min-w-0 flex-1">{STAGE_TITLE[source]}</span>
        </p>

        {live && (
          <div className={`relative overflow-hidden rounded-[20px] bg-black ${support === "unsupported" ? "hidden" : ""}`} style={{ aspectRatio: "4 / 3" }}>
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              aria-label={source === "screen" ? "屏幕共享预览" : "相机预览"}
              data-qr-video="true"
              className={`size-full ${source === "screen" ? "object-contain" : "object-cover"}`}
            />
            <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
              <div className="size-36 rounded-[20px] border-2 border-white/80" />
            </div>
            {stageBusy && (
              <div className="absolute inset-0 grid place-items-center bg-black/55 text-xs font-bold text-white">
                <span className="inline-flex items-center gap-2">
                  <LoaderCircle size={16} className="animate-spin" />
                  {source === "screen" ? "请在弹窗里选择要共享的屏幕或窗口…" : "正在启动相机…"}
                </span>
              </div>
            )}
          </div>
        )}

        {source === "image" && (
          <div className="grid place-items-center gap-3 rounded-[20px] border border-dashed p-6 text-center" style={{ borderColor: "var(--hairline)", background: "var(--surface-soft)" }}>
            <ImageIcon size={22} style={{ color: "var(--primary)" }} />
            <p className="m-0 text-xs leading-5 muted">支持 JPG / PNG / WebP 的照片或截图,选中后立即识别一次。</p>
            <button type="button" onClick={() => imageInputRef.current?.click()} disabled={busyImage} className="btn-primary inline-flex min-h-11 items-center gap-2 px-4 text-sm disabled:opacity-60">
              {busyImage ? <LoaderCircle size={16} className="animate-spin" /> : <ImageIcon size={16} />}
              {busyImage ? "识别中…" : "选择图片"}
            </button>
          </div>
        )}

        {source === "manual" && (
          <form className="flex gap-2" onSubmit={submitManual}>
            <input
              ref={manualInputRef}
              className="input min-w-0 flex-1"
              value={manual}
              onChange={(event) => setManual(event.target.value)}
              placeholder="物品编号或二维码链接"
              aria-label="物品编号"
              autoComplete="off"
              enterKeyHint="done"
            />
            <button type="submit" className="btn-primary shrink-0 px-4" disabled={!manual.trim()}>
              确认
            </button>
          </form>
        )}

        <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => void pickImage(event)} aria-label="选择二维码图片" />

        <div className="mt-3 rounded-[20px] px-4 py-3 text-xs leading-5" style={{ background: "var(--surface-soft)" }} aria-live="polite">
          <div className="flex items-center gap-1.5 font-bold" style={{ color: !last ? "var(--muted)" : last.verdict === "unknown" ? "var(--danger)" : "var(--success)" }}>
            {last && last.verdict !== "unknown" ? <CircleCheck size={15} /> : null}
            <span className="min-w-0 flex-1">{resultText}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 muted">
            <span>{status === "live" ? (source === "camera" ? "相机识别中" : "屏幕识别中") : status === "starting" ? "启动中" : "等待扫描"}</span>
            <span>已盘点 {scanned} 个</span>
          </div>
        </div>

        {notice && (
          <div
            role="alert"
            data-qr-notice={notice.tone}
            className="mt-3 rounded-[20px] p-3 text-xs leading-5"
            style={{
              background: notice.tone === "error" ? "color-mix(in srgb, var(--danger) 12%, var(--surface-solid))" : "var(--surface-soft)",
              color: notice.tone === "error" ? "var(--danger)" : "var(--muted)",
            }}
          >
            <div className="flex gap-2">
              <TriangleAlert size={15} className="mt-0.5 shrink-0" />
              <span className="min-w-0 flex-1">{notice.text}</span>
            </div>
            {notice.retry && (
              <button type="button" onClick={() => void retry()} className="btn-ghost mt-2 inline-flex min-h-11 items-center gap-1.5 px-3 text-xs">
                <RotateCcw size={14} />
                重试
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
