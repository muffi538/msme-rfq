"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  animation?: "fade-up" | "fade-in" | "scale-in" | "slide-right";
};

export default function AnimateIn({
  children,
  className = "",
  delay = 0,
  animation = "fade-up",
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? undefined : 0,
        animation: visible
          ? `${animation === "fade-up" ? "fadeUp" : animation === "fade-in" ? "fadeIn" : animation === "scale-in" ? "scaleIn" : "slideRight"} 0.7s cubic-bezier(0.22,1,0.36,1) ${delay}ms both`
          : "none",
      }}
    >
      {children}
    </div>
  );
}
