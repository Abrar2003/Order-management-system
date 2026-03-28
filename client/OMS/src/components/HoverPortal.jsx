import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const VIEWPORT_PADDING = 8;
const PANEL_GAP = 8;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const HoverPortal = ({
  trigger,
  children,
  onOpen,
  className = "",
  panelClassName = "",
  align = "left",
}) => {
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const closeTimerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: VIEWPORT_PADDING, left: VIEWPORT_PADDING });

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
    }, 120);
  }, [clearCloseTimer]);

  const openPanel = useCallback(() => {
    clearCloseTimer();
    if (typeof onOpen === "function") {
      onOpen();
    }
    setOpen(true);
  }, [clearCloseTimer, onOpen]);

  const updatePosition = useCallback(() => {
    if (!open || !triggerRef.current || !panelRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const panelRect = panelRef.current.getBoundingClientRect();

    const safeLeft =
      align === "right"
        ? triggerRect.right - panelRect.width
        : triggerRect.left;
    const left = clamp(
      safeLeft,
      VIEWPORT_PADDING,
      Math.max(VIEWPORT_PADDING, window.innerWidth - panelRect.width - VIEWPORT_PADDING),
    );

    const preferredTop = triggerRect.top - panelRect.height - PANEL_GAP;
    const fallbackTop = triggerRect.bottom + PANEL_GAP;
    const top =
      preferredTop >= VIEWPORT_PADDING
        ? preferredTop
        : clamp(
            fallbackTop,
            VIEWPORT_PADDING,
            Math.max(VIEWPORT_PADDING, window.innerHeight - panelRect.height - VIEWPORT_PADDING),
          );

    setPosition((prev) => (
      prev.top === top && prev.left === left
        ? prev
        : { top, left }
    ));
  }, [align, open]);

  useLayoutEffect(() => {
    if (open) {
      updatePosition();
    }
  }, [children, open, updatePosition]);

  useEffect(() => {
    if (!open) return undefined;

    const handleViewportChange = () => updatePosition();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open, updatePosition]);

  useEffect(
    () => () => {
      clearCloseTimer();
    },
    [clearCloseTimer],
  );

  const handleLeave = (event) => {
    const nextTarget = event?.relatedTarget;
    if (
      (triggerRef.current && triggerRef.current.contains(nextTarget))
      || (panelRef.current && panelRef.current.contains(nextTarget))
    ) {
      return;
    }
    scheduleClose();
  };

  return (
    <>
      <span
        ref={triggerRef}
        className={className}
        onMouseEnter={openPanel}
        onMouseLeave={handleLeave}
        onFocus={openPanel}
        onBlur={handleLeave}
      >
        {trigger}
      </span>

      {open && typeof document !== "undefined"
        ? createPortal(
            <span
              ref={panelRef}
              className={panelClassName}
              role="tooltip"
              style={{
                position: "fixed",
                top: `${position.top}px`,
                left: `${position.left}px`,
              }}
              onMouseEnter={openPanel}
              onMouseLeave={handleLeave}
            >
              {children}
            </span>,
            document.body,
          )
        : null}
    </>
  );
};

export default HoverPortal;
