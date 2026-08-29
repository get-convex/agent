// See the docs at https://docs.convex.dev/agents/debugging
import { trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { v } from "convex/values";
import { action } from "../_generated/server";
import { agent } from "../agents/simple";
import { authorizeThreadAccess } from "../threads";

const tracerProvider = new BasicTracerProvider({
  resource: resourceFromAttributes({ "service.name": "convex-agent" }),
  spanProcessors: [
    new SimpleSpanProcessor(
      new OTLPTraceExporter({
        url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
        headers: {
          Authorization: `Bearer ${process.env.OTEL_EXPORTER_OTLP_TRACES_TOKEN}`,
        },
      }),
    ),
  ],
});
trace.setGlobalTracerProvider(tracerProvider);

export const generateTextWithTelemetry = action({
  args: { prompt: v.string(), threadId: v.string() },
  handler: async (ctx, { prompt, threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    const result = await agent.generateText(
      ctx,
      { threadId },
      {
        prompt,
        experimental_telemetry: {
          isEnabled: true,
          functionId: "debugging/telemetry",
        },
      },
    );
    await tracerProvider.forceFlush();
    return result.text;
  },
});
