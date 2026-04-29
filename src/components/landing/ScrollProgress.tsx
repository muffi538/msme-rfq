"use client";

import { useEffect, useState } from "react";

export default function ScrollProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    function update() {
      const total = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(total > 0 ? (window.scrollY / total) * 100 : 0);
    }
    window.addEventListener("scroll", update, { passive: true });
    update();
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        top: "68px",
        left: 0,
        right: 0,
        zIndex: 60,
        height: "2px",
        backgroundColor: "#e0d5c5",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${progress}%`,
          background: "linear-gradient(90deg, #1847F5, #5b77f6)",
          boxShadow: "0 0 6px rgba(24,71,245,0.5)",
          transition: "width 80ms linear",
        }}
      />
    </div>
  );
}
