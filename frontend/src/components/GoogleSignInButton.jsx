import { useEffect, useRef, useState } from "react";

function loadGoogleScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(true);
    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(true));
      existing.addEventListener("error", reject);
      return;
    }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve(true);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export default function GoogleSignInButton({ onCredential, disabled }) {
  const clientId = import.meta.env.REACT_APP_GOOGLE_CLIENT_ID;
  const ref = useRef(null);
  const wrapRef = useRef(null);
  const callbackRef = useRef(onCredential);
  const initializedRef = useRef(false);
  const [error, setError] = useState(null);
  const [width, setWidth] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    function compute() {
      const w = el.clientWidth || 0;
      // Google button width should be a number; keep it within a sane range.
      const next = Math.max(220, Math.min(420, w));
      setWidth(next);
    }

    compute();

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => compute());
      ro.observe(el);
      return () => ro.disconnect();
    }

    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

  useEffect(() => {
    callbackRef.current = onCredential;
  }, [onCredential]);

  useEffect(() => {
    let mounted = true;
    if (!clientId) return;

    (async () => {
      try {
        await loadGoogleScript();
        if (!mounted) return;
        setReady(true);

        if (!initializedRef.current) {
          window.google.accounts.id.initialize({
            client_id: clientId,
            callback: (resp) => {
              if (!resp?.credential) return;
              callbackRef.current?.(resp.credential);
            }
          });
          initializedRef.current = true;
        }
      } catch (e) {
        if (!mounted) return;
        setError("Google sign-in failed to load.");
      }
    })();

    return () => {
      mounted = false;
    };
  }, [clientId]);

  useEffect(() => {
    if (!ready || !ref.current || !window.google?.accounts?.id) return;
    ref.current.innerHTML = "";
    window.google.accounts.id.renderButton(ref.current, {
      theme: "outline",
      size: "large",
      shape: "pill",
      width: width || 320,
      text: "continue_with"
    });
  }, [ready, width]);

  if (!clientId) return null;

  return (
    <div
      ref={wrapRef}
      className={(disabled ? "pointer-events-none opacity-60 " : "") + "w-full"}
    >
      {error ? <div className="text-xs text-rose-700">{error}</div> : null}
      <div ref={ref} className="flex w-full justify-center" />
    </div>
  );
}
