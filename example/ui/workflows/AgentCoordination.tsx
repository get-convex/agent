import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import type { WorkflowId } from "@convex-dev/workflow";
import { api } from "../../convex/_generated/api";

const patterns = [
  {
    id: "routing",
    title: "Dynamic routing",
    description: "An LLM selects one specialist, then only that agent runs.",
    prompt:
      "Design a migration plan for a small team moving from REST to GraphQL.",
  },
  {
    id: "fanOut",
    title: "Parallel fan-out",
    description:
      "Three specialists run concurrently and a coordinator combines them.",
    prompt: "Evaluate whether a startup should launch a free tier.",
  },
  {
    id: "orchestration",
    title: "Agent orchestration",
    description:
      "A coordinator plans, delegates, reviews, and produces the answer.",
    prompt: "Create a rollout plan for a customer-facing analytics dashboard.",
  },
  {
    id: "react",
    title: "Reason and act (ReAct)",
    description:
      "The model alternates reasoning with project lookup and estimation tools.",
    prompt:
      "Can this team ship an audit log feature in the next release window?",
  },
  {
    id: "network",
    title: "Agent network",
    description:
      "Several agents exchange messages through one persistent thread.",
    prompt: "Choose a strategy for improving activation in a developer tool.",
  },
  {
    id: "pause",
    title: "Pause and resume",
    description:
      "A durable workflow waits for human feedback before revising its draft.",
    prompt:
      "Write a concise launch announcement for the advanced workflow examples.",
  },
] as const;

type PatternId = (typeof patterns)[number]["id"];
type ExampleResult = FunctionReturnType<
  typeof api.workflows.coordination.dynamicRouting
>;
type ReviewWorkflowStatus = FunctionReturnType<
  typeof api.workflows.coordination.reviewWorkflowStatus
>;

export function AgentCoordination() {
  const [selected, setSelected] = useState<PatternId>("routing");
  const [prompt, setPrompt] = useState<string>(patterns[0].prompt);
  const [result, setResult] = useState<ExampleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [workflowId, setWorkflowId] = useState<WorkflowId | null>(null);
  const [feedback, setFeedback] = useState("Make the draft more concrete.");

  const actions = {
    routing: useAction(api.workflows.coordination.dynamicRouting),
    fanOut: useAction(api.workflows.coordination.fanOut),
    orchestration: useAction(api.workflows.coordination.orchestrate),
    react: useAction(api.workflows.coordination.reasonAndAct),
    network: useAction(api.workflows.coordination.agentNetwork),
  };
  const startReview = useMutation(
    api.workflows.coordination.startReviewWorkflow,
  );
  const resumeReview = useMutation(
    api.workflows.coordination.resumeReviewWorkflow,
  );
  const workflowStatus = useQuery(
    api.workflows.coordination.reviewWorkflowStatus,
    workflowId ? { workflowId } : "skip",
  );
  const selectedPattern = patterns.find((pattern) => pattern.id === selected)!;

  const selectPattern = (id: PatternId) => {
    setSelected(id);
    setPrompt(patterns.find((pattern) => pattern.id === id)!.prompt);
    setResult(null);
    setError(null);
  };

  const runPattern = async () => {
    if (selected === "pause" || !prompt.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await actions[selected]({ prompt: prompt.trim() }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  const startPausedWorkflow = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setWorkflowId(await startReview({ prompt: prompt.trim() }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  const resumePausedWorkflow = async () => {
    if (!workflowId || !feedback.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await resumeReview({ workflowId, feedback: feedback.trim() });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full bg-slate-50 p-6 md:p-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 max-w-3xl">
          <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-indigo-700">
            Advanced workflows
          </p>
          <h1 className="text-3xl font-bold text-slate-950 md:text-4xl">
            Six ways to coordinate agents
          </h1>
          <p className="mt-3 text-lg text-slate-700">
            Run each pattern with the same prompt box, then inspect which agents
            participated and what they returned.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <div>
            <label
              htmlFor="workflow-pattern"
              className="mb-2 block font-medium text-slate-900"
            >
              Workflow pattern
            </label>
            <select
              id="workflow-pattern"
              value={selected}
              onChange={(event) =>
                selectPattern(event.target.value as PatternId)
              }
              disabled={loading || workflowId !== null}
              className="w-full rounded-xl border border-slate-400 bg-white p-3 text-slate-950 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-slate-100"
            >
              {patterns.map((pattern) => (
                <option key={pattern.id} value={pattern.id}>
                  {pattern.title}
                </option>
              ))}
            </select>
          </div>

          <section className="rounded-2xl border border-slate-300 bg-white p-5 shadow-sm md:p-7">
            <div className="mb-5">
              <h2 className="text-2xl font-bold text-slate-950">
                {selectedPattern.title}
              </h2>
              <p className="mt-1 text-slate-600">
                {selectedPattern.description}
              </p>
            </div>

            <label
              htmlFor="workflow-prompt"
              className="mb-2 block font-medium text-slate-900"
            >
              Prompt
            </label>
            <textarea
              id="workflow-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              disabled={selected === "pause" && workflowId !== null}
              className="min-h-28 w-full rounded-xl border border-slate-400 p-4 text-slate-950 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-100"
            />

            {selected === "pause" ? (
              <PausedWorkflowControls
                workflowId={workflowId}
                status={workflowStatus}
                feedback={feedback}
                setFeedback={setFeedback}
                loading={loading}
                start={startPausedWorkflow}
                resume={resumePausedWorkflow}
                reset={() => setWorkflowId(null)}
              />
            ) : (
              <button
                type="button"
                onClick={() => void runPattern()}
                disabled={loading || !prompt.trim()}
                className="mt-4 rounded-lg bg-indigo-600 px-5 py-3 font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Running…" : "Run pattern"}
              </button>
            )}

            {error && (
              <p
                role="alert"
                className="mt-5 rounded-lg border border-red-300 bg-red-50 p-4 text-red-800"
              >
                {error}
              </p>
            )}

            {result && <Result result={result} />}
          </section>
        </div>
      </div>
    </div>
  );
}

function PausedWorkflowControls({
  workflowId,
  status,
  feedback,
  setFeedback,
  loading,
  start,
  resume,
  reset,
}: {
  workflowId: WorkflowId | null;
  status: ReviewWorkflowStatus | undefined;
  feedback: string;
  setFeedback: (value: string) => void;
  loading: boolean;
  start: () => Promise<void>;
  resume: () => Promise<void>;
  reset: () => void;
}) {
  if (!workflowId) {
    return (
      <button
        type="button"
        onClick={() => void start()}
        disabled={loading}
        className="mt-4 rounded-lg bg-indigo-600 px-5 py-3 font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
      >
        {loading ? "Starting…" : "Start workflow"}
      </button>
    );
  }

  return (
    <div className="mt-5 space-y-4">
      <p className="rounded-lg border border-indigo-300 bg-indigo-50 p-3 font-medium text-indigo-950">
        Status: {status?.state ?? "starting"}
      </p>
      {status?.state === "waiting" && (
        <>
          <label
            htmlFor="workflow-feedback"
            className="block font-medium text-slate-900"
          >
            Human feedback
          </label>
          <textarea
            id="workflow-feedback"
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            className="min-h-24 w-full rounded-xl border border-slate-400 p-4 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
          <button
            type="button"
            onClick={() => void resume()}
            disabled={loading || !feedback.trim()}
            className="rounded-lg bg-indigo-600 px-5 py-3 font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {loading ? "Resuming…" : "Send feedback and resume"}
          </button>
        </>
      )}
      {status?.state === "completed" && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-5">
          <h3 className="font-semibold text-emerald-950">Revised result</h3>
          <p className="mt-2 whitespace-pre-wrap text-emerald-950">
            {status.result}
          </p>
        </div>
      )}
      {status?.state === "failed" && (
        <p role="alert" className="text-red-700">
          {status.error}
        </p>
      )}
      {(status?.state === "completed" ||
        status?.state === "failed" ||
        status?.state === "canceled") && (
        <button
          type="button"
          onClick={reset}
          className="rounded-lg border border-slate-400 px-4 py-2 font-medium text-slate-900 hover:bg-slate-100"
        >
          Start over
        </button>
      )}
    </div>
  );
}

function Result({ result }: { result: ExampleResult }) {
  return (
    <div className="mt-8 space-y-5">
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-5">
        <h3 className="font-semibold text-emerald-950">Combined result</h3>
        <p className="mt-2 whitespace-pre-wrap text-emerald-950">
          {result.steps.at(-1)!.output}
        </p>
      </div>
      <div>
        <h3 className="mb-3 font-semibold text-slate-950">Agent trace</h3>
        <ol className="space-y-3">
          {result.steps.map((step, index) => (
            <li
              key={`${step.agent}-${index}`}
              className="rounded-xl border border-slate-300 p-4"
            >
              <span className="text-sm font-semibold uppercase tracking-wide text-indigo-700">
                {index + 1}. {step.agent}
              </span>
              <p className="mt-2 whitespace-pre-wrap text-slate-700">
                {step.output}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
