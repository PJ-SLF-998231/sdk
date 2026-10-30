// A value on the Content tab with a small copy button beside it. The button
// shows on hover and on keyboard focus (docsite.css), copies the value as the
// page shows it, and says "Copied" for a moment. The value is never sent
// anywhere but the clipboard: no analytics, no logging.

import { cx } from "../react/cx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon } from "../react/icons";
import { COPIED_MS, copyToClipboard } from "./copyToClipboard";

export function CopyValue({ value, label, children }: { value: string; label?: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const text = value.trim();
  if (text === "") return <>{children}</>;

  const copy = async () => {
    if (!(await copyToClipboard(text))) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  return (
    <span className={cx("docsite-copy")}>
      {children}
      <button type="button" className={cx("docsite-copy-btn")} data-copied={copied || undefined} aria-label={`Copy ${label ?? text}`} onClick={copy}>
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
      <span className={cx("visually-hidden")} role="status" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </span>
  );
}
