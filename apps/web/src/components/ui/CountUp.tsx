'use client';

import { useEffect, useRef, useState } from 'react';

interface CountUpProps {
  /** The display value, e.g. "500+", "4.8★", "48+", "100%", "24/7", "GPS". */
  value: string;
  /** Animation duration in ms. */
  duration?: number;
  className?: string;
}

/** Splits "4.8★" -> { prefix:"", num:4.8, decimals:1, suffix:"★" }. */
function parse(value: string) {
  const match = value.match(/^(\D*)([\d,.]+)(.*)$/s);
  if (!match) return null;
  const [, prefix, rawNum, suffix] = match;
  const clean = rawNum!.replace(/,/g, '');
  const dotIdx = clean.indexOf('.');
  const decimals = dotIdx === -1 ? 0 : clean.length - dotIdx - 1;
  const num = parseFloat(clean);
  if (Number.isNaN(num)) return null;
  return { prefix: prefix ?? '', num, decimals, suffix: suffix ?? '' };
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export function CountUp({ value, duration = 1200, className }: CountUpProps) {
  const parsed = parse(value);
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(parsed ? parsed.num * 0 : value);
  const started = useRef(false);

  useEffect(() => {
    // Non-numeric values render as-is; nothing to animate.
    if (!parsed) {
      setDisplay(value);
      return;
    }

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const settle = () =>
      setDisplay(parsed.num.toFixed(parsed.decimals));

    if (prefersReduced) {
      settle();
      return;
    }

    const node = ref.current;
    if (!node) return;

    const run = () => {
      if (started.current) return;
      started.current = true;
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min((now - start) / duration, 1);
        const current = parsed.num * easeOut(t);
        setDisplay(current.toFixed(parsed.decimals));
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            run();
            observer.disconnect();
          }
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  if (!parsed) {
    return (
      <span ref={ref} className={className}>
        {value}
      </span>
    );
  }

  return (
    <span ref={ref} className={className}>
      {parsed.prefix}
      {display}
      {parsed.suffix}
    </span>
  );
}
