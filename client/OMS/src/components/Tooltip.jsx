import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const OFFSET = 8;

const Tooltip = ({ children, content, onOpen }) => {
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);

  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const showTooltip = () => {
    if (onOpen) onOpen();
    setOpen(true);
  };

  const hideTooltip = () => {
    setOpen(false);
  };

  const updatePosition = () => {
    if (!triggerRef.current || !tooltipRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();

    let top = triggerRect.top - tooltipRect.height - OFFSET;
    let left = triggerRect.left;

    // Flip if no space on top
    if (top < 0) {
      top = triggerRect.bottom + OFFSET;
    }

    // Prevent overflow right
    if (left + tooltipRect.width > window.innerWidth) {
      left = window.innerWidth - tooltipRect.width - 8;
    }

    setPosition({ top, left });
  };

  useEffect(() => {
    if (open) {
      updatePosition();
    }
  }, [open, content]);

  useEffect(() => {
    if (!open) return;

    const handle = () => updatePosition();
    window.addEventListener("scroll", handle, true);
    window.addEventListener("resize", handle);

    return () => {
      window.removeEventListener("scroll", handle, true);
      window.removeEventListener("resize", handle);
    };
  }, [open]);

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocusCapture={showTooltip}
        onBlurCapture={hideTooltip}
        style={{ display: "inline-block" }}
      >
        {children}
      </span>

      {open &&
        createPortal(
          <div
            ref={tooltipRef}
            className="custom-tooltip"
            style={{
              top: position.top,
              left: position.left,
            }}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
};

export default Tooltip;
