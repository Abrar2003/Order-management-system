import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export default function EudrDialog({ titleId, className = "", onClose, onKeyDown, children }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const element = ref.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    const cancel = (event) => { event.preventDefault(); closeRef.current(); };
    element.addEventListener("cancel", cancel);
    return () => {
      element.removeEventListener("cancel", cancel);
      element.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(<dialog ref={ref} aria-labelledby={titleId} className={`eudr-dialog ${className}`} onKeyDown={onKeyDown}>{children}</dialog>, document.body);
}
