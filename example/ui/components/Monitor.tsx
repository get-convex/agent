import { useState, useCallback, useEffect, useRef } from "react";
import type {
  GetRateLimitValueQuery,
  UseRateLimitOptions,
} from "@convex-dev/rate-limiter/react";
import { useRateLimit } from "@convex-dev/rate-limiter/react";
import { useQuery } from "convex/react";

interface ConsumptionEvent {
  timestamp: number;
  success: boolean;
}

interface MonitorProps {
  getRateLimitValueQuery: GetRateLimitValueQuery;
  opts?: UseRateLimitOptions;
  consumptionHistory?: ConsumptionEvent[];
  height?: string | number;
}

function formatNumber(value: number) {
  if (value < 1000) return value.toFixed(1);
  if (value < 100000) return (value / 1000).toFixed(1) + "k";
  return (value / 1000000).toFixed(1) + "M";
}

export function Monitor({
  getRateLimitValueQuery,
  opts,
  consumptionHistory = [],
  height = "320px",
}: MonitorProps) {
  const [timelineData, setTimelineData] = useState<
    Array<{ timestamp: number; value: number }>
  >([]);

  // Canvas refs and state
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | undefined>(undefined);
  const canvasSetupRef = useRef<{
    width: number;
    height: number;
    dpr: number;
  } | null>(null);

  const { check } = useRateLimit(getRateLimitValueQuery, opts);
  const raw = useQuery(getRateLimitValueQuery, {
    config: opts?.config,
    name: opts?.name,
    key: opts?.key,
    sampleShards: opts?.sampleShards,
  });

  const capacity = raw?.config.capacity ?? 1;

  // Update timeline data every 100ms with calculated values
  useEffect(() => {
    const updateTimeline = () => {
      const now = Date.now();
      // Calculate current value using server time for rate limit calculation
      const calculated = check(now, 0);
      if (!calculated) return;
      const newPoint = { timestamp: now, value: calculated.value }; // Keep client time for UI

      setTimelineData((prev) => {
        const filtered = prev.filter((point) => now - point.timestamp < 10000); // Keep last 10 seconds
        return [...filtered, newPoint];
      });
    };

    // Initial update
    updateTimeline();

    // Set up interval for regular updates
    const interval = setInterval(updateTimeline, 200);

    return () => {
      clearInterval(interval);
    };
  }, [check]);

  // Setup canvas with proper DPI scaling (only when size changes)
  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return null;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // Check if we need to resize
    const currentSetup = canvasSetupRef.current;
    if (
      currentSetup &&
      currentSetup.width === rect.width &&
      currentSetup.height === rect.height &&
      currentSetup.dpr === dpr
    ) {
      return canvas.getContext("2d");
    }

    // Set actual size in memory (scaled to account for pixel ratio)
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    // Scale CSS size back down
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";

    // Get context and scale it
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
    }

    // Store the current setup
    canvasSetupRef.current = { width: rect.width, height: rect.height, dpr };

    return ctx;
  }, []);

  // Draw timeline with smooth rendering
  const drawTimeline = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = container.getBoundingClientRect();
    const { width, height } = rect;
    const now = Date.now();
    const tenSecondsAgo = now - 10000;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Set up drawing parameters
    const padding = 40;
    const plotWidth = width - 2 * padding;
    const plotHeight = height - 2 * padding;

    // Title for the graph
    ctx.fillStyle = "#374151";
    ctx.font = "bold 14px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(opts?.name ?? "Tokens", width / 2, padding - 10);

    // Draw background grid
    ctx.strokeStyle = "#f3f4f6";
    ctx.lineWidth = 1;

    // Vertical grid lines (time)
    for (let i = 0; i <= 10; i++) {
      const x = padding + (i / 10) * plotWidth;
      ctx.beginPath();
      ctx.moveTo(x, padding);
      ctx.lineTo(x, height - padding);
      ctx.stroke();
    }

    // Horizontal grid lines (values)
    const maxY = Math.ceil(capacity * 1.1);
    for (let i = 0; i <= maxY; i += Math.max(1, Math.floor(maxY / 8))) {
      const y = height - padding - (i / maxY) * plotHeight;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }

    // Draw axes with better styling
    ctx.strokeStyle = "#d1d5db";
    ctx.lineWidth = 2;

    // Y-axis
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, height - padding);
    ctx.stroke();

    // X-axis
    ctx.beginPath();
    ctx.moveTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.stroke();

    // Draw capacity line with gradient
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, "#f59e0b");
    gradient.addColorStop(1, "#d97706");

    ctx.setLineDash([8, 4]);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2;
    const capacityY = height - padding - (capacity / maxY) * plotHeight;
    ctx.beginPath();
    ctx.moveTo(padding, capacityY);
    ctx.lineTo(width - padding, capacityY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw timeline data with smooth curves
    if (timelineData.length > 0) {
      // Create gradient for the line
      const lineGradient = ctx.createLinearGradient(0, 0, width, 0);
      lineGradient.addColorStop(0, "#3b82f6");
      lineGradient.addColorStop(1, "#1d4ed8");

      ctx.strokeStyle = lineGradient;
      ctx.lineWidth = 3;
      ctx.shadowColor = "rgba(59, 130, 246, 0.3)";
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 2;

      ctx.beginPath();

      // Start with a line from Y-axis to the first data point to eliminate gaps
      const firstPoint = timelineData[0];
      const firstX =
        padding + ((firstPoint.timestamp - tenSecondsAgo) / 10000) * plotWidth;
      const firstY =
        height - padding - (Math.max(0, firstPoint.value) / maxY) * plotHeight;

      // Only draw connecting line if first point is within visible area
      if (firstX >= padding) {
        // Draw line from Y-axis to first point at the same height
        ctx.moveTo(padding, firstY);
        ctx.lineTo(firstX, firstY);
      }

      timelineData.forEach((point, index) => {
        const x =
          padding + ((point.timestamp - tenSecondsAgo) / 10000) * plotWidth;
        const y =
          height - padding - (Math.max(0, point.value) / maxY) * plotHeight;

        if (index === 0) {
          // If we didn't draw connecting line, start here
          if (firstX < padding) {
            ctx.moveTo(Math.max(padding, x), y);
          }
        } else {
          ctx.lineTo(Math.max(padding, x), y);
        }
      });

      // Extend line to the right edge with current value
      if (timelineData.length > 0) {
        const lastPoint = timelineData[timelineData.length - 1];
        const lastY =
          height - padding - (Math.max(0, lastPoint.value) / maxY) * plotHeight;
        ctx.lineTo(width - padding, lastY);
      }

      ctx.stroke();
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      // Draw current value indicator (always at right edge)
      const lastPoint = timelineData[timelineData.length - 1];
      const y =
        height - padding - (Math.max(0, lastPoint.value) / maxY) * plotHeight;

      // Value label with modern styling (positioned to the right of the graph)
      const labelText = formatNumber(lastPoint.value);
      ctx.font = "bold 12px Inter, sans-serif";
      const labelMetrics = ctx.measureText(labelText);
      const labelWidth = labelMetrics.width + 8;
      const labelHeight = 24;
      const labelX = width - padding; // Position to the right of the graph
      const labelY = Math.max(y + labelHeight / 2, padding + labelHeight);

      // Label background with shadow
      ctx.fillStyle = "rgba(0, 0, 0, 0.1)";
      ctx.fillRect(
        labelX + 2,
        labelY - labelHeight + 2,
        labelWidth,
        labelHeight,
      );

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(labelX, labelY - labelHeight, labelWidth, labelHeight);

      // Label border
      ctx.strokeStyle = "#e5e7eb";
      ctx.lineWidth = 1;
      ctx.strokeRect(labelX, labelY - labelHeight, labelWidth, labelHeight);

      // Label text
      ctx.fillStyle = "#1f2937";
      ctx.textAlign = "center";
      ctx.fillText(labelText, labelX + labelWidth / 2, labelY - 6);
    }

    // Draw consumption dots at bottom of graph
    const recentEvents = consumptionHistory.filter(
      (event) => now - event.timestamp < 10000,
    );

    recentEvents.forEach((event) => {
      const x =
        padding + ((event.timestamp - tenSecondsAgo) / 10000) * plotWidth;

      // Position dot at the bottom of the graph
      const dotY = height - padding - 5; // 5px above the X-axis
      const dotRadius = 4;

      // Draw dot with appropriate color
      ctx.beginPath();
      ctx.arc(x, dotY, dotRadius, 0, 2 * Math.PI);

      if (event.success) {
        ctx.fillStyle = "#10b981"; // Green for success
      } else {
        ctx.fillStyle = "#ef4444"; // Red for failure
      }

      ctx.fill();

      // Add a subtle border
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // Draw axis labels with modern typography
    ctx.fillStyle = "#6b7280";
    ctx.font = "12px Inter, sans-serif";
    ctx.textAlign = "right";

    // Y-axis labels - position them better to avoid overlap
    for (let i = 0; i <= maxY; i += Math.max(1, Math.floor(capacity / 5))) {
      const y = height - padding - (i / maxY) * plotHeight;
      ctx.fillText(formatNumber(i), padding - 10, y + 4);
    }

    // X-axis labels
    ctx.textAlign = "center";
    ctx.fillText("10s ago", padding, height - 20);
    ctx.fillText("5s ago", padding + plotWidth / 2, height - 20);
    ctx.fillText("now", width - padding, height - 20);

    // Axis titles
    ctx.fillStyle = "#374151";
    ctx.font = "bold 14px Inter, sans-serif";

    // Schedule next frame
    animationRef.current = requestAnimationFrame(drawTimeline);
  }, [timelineData, consumptionHistory, capacity, opts?.name]);

  // Setup canvas when component mounts or container size changes
  useEffect(() => {
    setupCanvas();
  }, [setupCanvas]);

  // Start animation loop
  useEffect(() => {
    drawTimeline();
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [drawTimeline]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      setupCanvas();
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [setupCanvas]);

  return (
    <div
      ref={containerRef}
      className="relative w-full bg-linear-to-br from-gray-50 to-white rounded-xl border border-gray-200"
      style={{ height }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
}

export default Monitor;
