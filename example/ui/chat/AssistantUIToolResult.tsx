import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import {
  Wrench,
  ChevronDown,
  LoaderCircle,
  CircleAlert,
  Check,
} from "lucide-react";
import styles from "./AssistantChat.module.css";

export function ToolResult({
  toolName,
  argsText,
  result,
  isError,
  status,
}: ToolCallMessagePartProps) {
  const failed = isError || status.type === "incomplete";
  const running = !failed && status.type === "running";
  const waiting = !failed && status.type === "requires-action";
  const label = failed
    ? "Failed to run"
    : running
      ? "Using"
      : waiting
        ? "Waiting for"
        : "Used";
  const Icon =
    failed || waiting ? CircleAlert : running ? LoaderCircle : Wrench;
  const title = toolName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ");
  let input = argsText;
  let fields: [string, unknown][] | undefined;
  try {
    const parsed: unknown = JSON.parse(argsText);
    input = JSON.stringify(parsed, null, 2);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed);
      if (
        entries.length > 0 &&
        entries.every(
          ([, value]) =>
            value === null ||
            ["string", "number", "boolean"].includes(typeof value),
        )
      ) {
        fields = entries;
      }
    }
  } catch {
    // Streamed arguments may still be incomplete JSON.
  }
  return (
    <details className={styles.tool} data-failed={failed}>
      <summary className={styles.toolSummary}>
        <Icon
          size={16}
          className={running ? styles.spinner : styles.toolIcon}
          aria-hidden="true"
        />
        <span className={styles.toolTitle} title={toolName}>
          {label} {title.toLowerCase()}
          {running ? "…" : ""}
        </span>
        <ChevronDown size={15} className={styles.chevron} aria-hidden="true" />
      </summary>
      <div className={styles.toolBody}>
        <p className={styles.sectionLabel}>Input</p>
        {fields ? (
          <dl className={styles.inputFields}>
            {fields.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value === null ? "null" : String(value)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <pre className={styles.code}>{input || "Waiting for input…"}</pre>
        )}
        {result !== undefined ? (
          <>
            <p className={styles.sectionLabel}>{failed ? "Error" : "Result"}</p>
            {Array.isArray(result) &&
            result.length > 0 &&
            result.every((item) => typeof item === "string") ? (
              <ul className={styles.chips} aria-label="Tool results">
                {result.map((item, index) => (
                  <li key={index}>
                    <Check size={12} aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            ) : (
              <pre className={styles.code} data-error={failed}>
                {typeof result === "string"
                  ? result
                  : JSON.stringify(result, null, 2)}
              </pre>
            )}
          </>
        ) : (
          <p className={styles.muted}>
            {running
              ? "Waiting for the tool to respond…"
              : waiting
                ? "Waiting for action before this tool can continue."
                : "No result returned."}
          </p>
        )}
      </div>
    </details>
  );
}
