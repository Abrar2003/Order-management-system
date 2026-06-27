import { useEffect } from "react";

/**
 * Mobile Keyboard Usability Handler
 * Automatically adjusts CSS viewport variables and ensures focused form inputs
 * in modals and long forms scroll smoothly into view above the mobile soft keyboard.
 */
export default function useMobileKeyboardHandler() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const docEl = document.documentElement;

    // Update CSS custom variables based on window.visualViewport
    const updateViewportVars = () => {
      if (window.visualViewport) {
        const vvHeight = window.visualViewport.height;
        const vvTop = window.visualViewport.offsetTop;
        const kbHeight = Math.max(0, window.innerHeight - vvHeight);

        docEl.style.setProperty("--visual-viewport-height", `${vvHeight}px`);
        docEl.style.setProperty("--keyboard-height", `${kbHeight}px`);
        docEl.style.setProperty("--visual-viewport-top", `${vvTop}px`);
      } else {
        docEl.style.setProperty("--visual-viewport-height", `${window.innerHeight}px`);
        docEl.style.setProperty("--keyboard-height", "0px");
        docEl.style.setProperty("--visual-viewport-top", "0px");
      }
    };

    updateViewportVars();

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", updateViewportVars);
      window.visualViewport.addEventListener("scroll", updateViewportVars);
    }
    window.addEventListener("resize", updateViewportVars);

    // Helper to find the nearest scrollable parent container
    const getScrollContainer = (element) => {
      let parent = element.parentElement;
      while (parent && parent !== document.body && parent !== document.documentElement) {
        const style = window.getComputedStyle(parent);
        const overflowY = style.overflowY || style.overflow || "";
        const isScrollable = /(auto|scroll)/.test(overflowY);
        
        // Also explicitly match common modal body containers
        const isModalBody = parent.classList.contains("modal-body") || 
                            parent.classList.contains("qc-update-modal-body") ||
                            parent.classList.contains("modal-content");

        if ((isScrollable && parent.scrollHeight > parent.clientHeight) || isModalBody) {
          return parent;
        }
        parent = parent.parentElement;
      }
      return document.scrollingElement || document.documentElement || document.body;
    };

    let userIsTouchScrolling = false;
    let touchTimeout = null;

    const handleTouchMove = () => {
      userIsTouchScrolling = true;
      if (touchTimeout) clearTimeout(touchTimeout);
      touchTimeout = setTimeout(() => {
        userIsTouchScrolling = false;
      }, 500);
    };

    window.addEventListener("touchmove", handleTouchMove, { passive: true });

    // Focus listener to scroll input above keyboard
    const handleFocusIn = (event) => {
      const target = event.target;
      if (!target || !(target instanceof HTMLElement)) return;

      const isInputElement =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable;

      if (!isInputElement) return;

      // Ignore checkboxes, radios, hidden inputs, buttons
      if (target instanceof HTMLInputElement) {
        const type = target.type.toLowerCase();
        if (["checkbox", "radio", "hidden", "button", "submit", "reset", "file"].includes(type)) {
          return;
        }
      }

      // Delay briefly to allow mobile browser soft keyboard animation to trigger and visualViewport to resize
      setTimeout(() => {
        if (userIsTouchScrolling) return;

        const container = getScrollContainer(target);
        
        // Native scrollIntoView center placement
        try {
          target.scrollIntoView({
            behavior: "smooth",
            block: "center",
            inline: "nearest",
          });
        } catch (e) {
          // Fallback if options not supported
          target.scrollIntoView(false);
        }

        // Additional precise alignment check within scroll containers like modal-body
        if (container && container !== document.body && container !== document.documentElement) {
          setTimeout(() => {
            if (userIsTouchScrolling) return;
            const targetRect = target.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            
            // If field is too close to bottom edge of container or covered
            const safetyMargin = 24; // 24px clearance above keyboard/footer
            const distanceToBottom = containerRect.bottom - targetRect.bottom;

            if (distanceToBottom < 60 || targetRect.top < containerRect.top) {
              const scrollDiff = (targetRect.top - containerRect.top) - (containerRect.height / 2) + (targetRect.height / 2);
              container.scrollBy({
                top: scrollDiff,
                behavior: "smooth",
              });
            }
          }, 150);
        }
      }, 200);
    };

    document.addEventListener("focusin", handleFocusIn, true);

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", updateViewportVars);
        window.visualViewport.removeEventListener("scroll", updateViewportVars);
      }
      window.removeEventListener("resize", updateViewportVars);
      window.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("focusin", handleFocusIn, true);
    };
  }, []);

  return null;
}
