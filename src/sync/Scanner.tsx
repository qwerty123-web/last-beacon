/** Camera QR scanner (getUserMedia + jsQR). Works offline: decoding happens entirely on the device. */
import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

export type CameraState = 'idle' | 'starting' | 'scanning' | 'denied' | 'unavailable' | 'insecure' | 'error';

export function cameraSupport(): { ok: boolean; reason?: string } {
  if (typeof window === 'undefined') return { ok: false, reason: 'No browser' };
  if (!window.isSecureContext) return { ok: false, reason: 'Camera access needs HTTPS (or localhost).' };
  if (!navigator.mediaDevices?.getUserMedia) return { ok: false, reason: 'This browser has no camera API.' };
  return { ok: true };
}

export function Scanner({ onCode, onClose }: { onCode: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<CameraState>('starting');
  const [msg, setMsg] = useState('Starting camera');
  const [hint, setHint] = useState('');

  useEffect(() => {
    const sup = cameraSupport();
    if (!sup.ok) {
      setState(window.isSecureContext ? 'unavailable' : 'insecure');
      setMsg(sup.reason!);
      return;
    }
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    let last = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const tick = (t: number) => {
      if (stopped) return;
      raf = requestAnimationFrame(tick);
      const v = video.current;
      if (!v || !ctx || v.readyState < 2 || t - last < 180) return;
      last = t;
      const w = v.videoWidth;
      const h = v.videoHeight;
      const scale = Math.min(1, 720 / Math.max(w, h));
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (code?.data) {
        if (code.data.startsWith('LB1:')) {
          stopped = true;
          onCode(code.data);
        } else setHint('That QR code is not a LAST BEACON sync code.');
      }
    };
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (stopped) return;
        const v = video.current!;
        v.srcObject = stream;
        v.setAttribute('playsinline', 'true');
        await v.play();
        setState('scanning');
        setMsg('Point the camera at the sync QR on the other device.');
        raf = requestAnimationFrame(tick);
      } catch (e) {
        const name = (e as DOMException)?.name;
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setState('denied');
          setMsg('Camera permission denied. Allow camera access in the browser settings, or paste the code below.');
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setState('unavailable');
          setMsg('No camera found. Paste the code below instead.');
        } else {
          setState('error');
          setMsg('The camera could not start. Paste the code below instead.');
        }
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);

  return (
    <div className="scanner">
      <div className={`viewfinder ${state}`}>
        <video ref={video} muted playsInline />
        {state === 'scanning' && <span className="reticle" />}
      </div>
      <p className={`hint ${state === 'scanning' || state === 'starting' ? '' : 'warn'}`} role="status">
        {msg}
      </p>
      {hint && <p className="hint warn">{hint}</p>}
      <button className="btn small" onClick={onClose}>
        Stop camera
      </button>
    </div>
  );
}
