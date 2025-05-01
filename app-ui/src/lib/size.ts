import { useState, useEffect, useRef } from 'react';

const useWindowSize = () => {
  const [windowSize, setWindowSize] = useState<{ width: number | undefined; height: number | undefined }>({
    width: undefined,
    height: undefined,
  });

  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    resizeObserverRef.current = new ResizeObserver(entries => {
      if (entries.length === 0 || !entries[0].target) {
        return;
      }
      const { width, height } = entries[0].contentRect;
      setWindowSize({ width, height });
    });

    const targetElement = document.documentElement;
    resizeObserverRef.current.observe(targetElement);

    setWindowSize({
      width: targetElement.clientWidth,
      height: targetElement.clientHeight,
    });
    return () => {
      resizeObserverRef.current?.disconnect();
    };
  }, []);

  return windowSize;
}

export default useWindowSize;