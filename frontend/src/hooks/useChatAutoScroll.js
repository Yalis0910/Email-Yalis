import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Intelligent auto-scroll hook for AI chat conversations.
 * 
 * Behavior:
 * - Automatically keeps the view pinned to the bottom during streaming IF the user is at the bottom.
 * - During streaming, uses instant scroll updates (scrollTop = scrollHeight) to avoid jitter and animation backlog.
 * - The moment the user scrolls up (mouse wheel deltaY < 0, touch swipe down, or scrollbar dragging past threshold),
 *   auto-scroll is immediately paused, allowing full freedom to read history without getting jerked down.
 * - If the user scrolls back near the bottom (within threshold px), auto-scroll automatically re-engages.
 * - Provides `showScrollBottom` and `scrollToBottom` for a quick-return floating button.
 * - Programmatic smooth scrolls (like clicking "Scroll to bottom" or sending a message) are protected
 *   from falsely triggering the scroll-up detection.
 */
export function useChatAutoScroll({
  messages = [],
  isStreaming = false,
  activeConvId = null,
  isOpen = true,
  threshold = 80
} = {}) {
  const containerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const isAutoScrollPinnedRef = useRef(true);
  const isProgrammaticScrollRef = useRef(false);
  const programmaticScrollTimerRef = useRef(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  
  const prevConvIdRef = useRef(activeConvId);
  const prevIsOpenRef = useRef(isOpen);

  // Check if container is scrolled within threshold of the bottom
  const checkIfAtBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distanceFromBottom <= threshold;
  }, [threshold]);

  // Handle container scroll event (fires on wheel, touch, scrollbar drag, or programmatic scroll)
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom <= threshold;

    if (isProgrammaticScrollRef.current) {
      if (atBottom) {
        isProgrammaticScrollRef.current = false;
        isAutoScrollPinnedRef.current = true;
        setShowScrollBottom(false);
      }
      return;
    }

    isAutoScrollPinnedRef.current = atBottom;
    setShowScrollBottom(!atBottom);
  }, [threshold]);

  // Immediately detect mouse wheel scrolling up to avoid token arrival race conditions
  const handleWheel = useCallback((e) => {
    if (e.deltaY < 0) {
      // User is scrolling UP
      isProgrammaticScrollRef.current = false;
      isAutoScrollPinnedRef.current = false;
      setShowScrollBottom(true);
    }
  }, []);

  // Detect touch swipe gestures for mobile/touchscreen devices
  const touchStartYRef = useRef(0);
  const handleTouchStart = useCallback((e) => {
    if (e.touches && e.touches[0]) {
      touchStartYRef.current = e.touches[0].clientY;
    }
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (e.touches && e.touches[0]) {
      const deltaY = e.touches[0].clientY - touchStartYRef.current;
      if (deltaY > 10) {
        // Swiping downwards drags content down -> scrolling up
        isProgrammaticScrollRef.current = false;
        isAutoScrollPinnedRef.current = false;
        setShowScrollBottom(true);
      }
    }
  }, []);

  // Explicitly scroll to bottom
  const scrollToBottom = useCallback((behavior = 'smooth') => {
    isAutoScrollPinnedRef.current = true;
    setShowScrollBottom(false);

    if (behavior === 'smooth') {
      isProgrammaticScrollRef.current = true;
      if (programmaticScrollTimerRef.current) {
        clearTimeout(programmaticScrollTimerRef.current);
      }
      programmaticScrollTimerRef.current = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 500);
    } else {
      isProgrammaticScrollRef.current = false;
    }

    const el = containerRef.current;
    if (el) {
      if (behavior === 'smooth') {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      } else {
        el.scrollTop = el.scrollHeight;
      }
    } else if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior });
    }
  }, []);

  // When switching conversations, reset auto-scroll and jump to bottom
  useEffect(() => {
    if (activeConvId !== prevConvIdRef.current) {
      prevConvIdRef.current = activeConvId;
      isAutoScrollPinnedRef.current = true;
      setShowScrollBottom(false);
      const timer = setTimeout(() => {
        scrollToBottom('auto');
      }, 30);
      return () => clearTimeout(timer);
    }
  }, [activeConvId, scrollToBottom]);

  // When drawer opens, reset and jump to bottom
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      isAutoScrollPinnedRef.current = true;
      setShowScrollBottom(false);
      const timer = setTimeout(() => {
        scrollToBottom('auto');
      }, 60);
      return () => clearTimeout(timer);
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, scrollToBottom]);

  // Stream & message updates: Only follow if user is pinned to bottom
  useEffect(() => {
    if (!isOpen) return;

    if (isAutoScrollPinnedRef.current) {
      const el = containerRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      } else if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'auto' });
      }
    }
  }, [messages, isStreaming, isOpen]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (programmaticScrollTimerRef.current) {
        clearTimeout(programmaticScrollTimerRef.current);
      }
    };
  }, []);

  return {
    containerRef,
    messagesEndRef,
    showScrollBottom,
    scrollToBottom,
    handleScroll,
    handleWheel,
    handleTouchStart,
    handleTouchMove
  };
}
