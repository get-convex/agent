// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { UIMessage } from "@convex-dev/agent/react";
import type { PaginationStatus } from "convex/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConvexRuntime } from "./useConvexRuntime";

const mocks = vi.hoisted(() => ({
  messages: [] as UIMessage[],
  status: "Exhausted" as PaginationStatus,
  send: vi.fn(),
  abort: vi.fn(),
  loadMore: vi.fn(),
}));

vi.mock("@convex-dev/agent/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/agent/react")>()),
  useUIMessages: () => ({
    results: mocks.messages,
    status: mocks.status,
    loadMore: mocks.loadMore,
  }),
}));
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useAction: () => mocks.send,
  useMutation: () => mocks.abort,
}));

const streamingMessage: UIMessage = {
  id: "stream-id",
  key: "thread-1-0",
  role: "assistant",
  parts: [{ type: "text", text: "Once upon a time" }],
  text: "Once upon a time",
  status: "streaming",
  order: 1,
  stepOrder: 0,
  _creationTime: 1_700_000_000_000,
};

beforeEach(() => {
  mocks.messages = [];
  mocks.status = "Exhausted";
  mocks.send.mockReset();
  mocks.abort.mockReset();
  mocks.loadMore.mockReset();
});
afterEach(cleanup);

describe("useConvexRuntime", () => {
  it("disables sending while the first history page loads, without marking it as generation", () => {
    mocks.status = "LoadingFirstPage";
    const { result, rerender } = renderHook(() => useConvexRuntime("thread-1"));
    expect(result.current.runtime.thread.getState()).toMatchObject({
      isLoading: true,
      isDisabled: true,
      isRunning: false,
    });
    mocks.status = "CanLoadMore";
    rerender();
    expect(result.current.runtime.thread.getState()).toMatchObject({
      isLoading: false,
      isDisabled: false,
      isRunning: false,
    });
    act(() => result.current.loadMore(10));
    expect(mocks.loadMore).toHaveBeenCalledWith(10);
  });

  it("tracks generation before the first stream delta and until the action settles", async () => {
    const sending = Promise.withResolvers<void>();
    mocks.send.mockReturnValue(sending.promise);
    const { result } = renderHook(() => useConvexRuntime("thread-1"));
    act(() => result.current.runtime.thread.append("Tell a story"));
    await waitFor(() =>
      expect(mocks.send).toHaveBeenCalledWith({
        threadId: "thread-1",
        prompt: "Tell a story",
      }),
    );
    expect(result.current.runtime.thread.getState().isRunning).toBe(true);
    await act(async () => sending.resolve());
    expect(result.current.runtime.thread.getState().isRunning).toBe(false);
  });

  it("reconnects to a stream and replaces it with the saved message without duplication", () => {
    mocks.messages = [streamingMessage];
    const { result, rerender } = renderHook(() => useConvexRuntime("thread-1"));
    expect(result.current.runtime.thread.getState().isRunning).toBe(true);
    mocks.messages = [
      { ...streamingMessage, id: "saved-id", status: "success" },
    ];
    rerender();
    const state = result.current.runtime.thread.getState();
    expect(state.isRunning).toBe(false);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].id).toBe(streamingMessage.key);
    expect(state.messages[0].content).toEqual(streamingMessage.parts);
  });

  it("keeps a failed prompt available for recovery and releases the running state", async () => {
    mocks.send.mockRejectedValue(new Error("Provider unavailable"));
    const { result } = renderHook(() => useConvexRuntime("thread-1"));
    act(() => result.current.runtime.thread.append("Keep this prompt"));
    await waitFor(() =>
      expect(result.current.error).toEqual({
        message: "Provider unavailable",
        prompt: "Keep this prompt",
      }),
    );
    expect(result.current.runtime.thread.getState().isRunning).toBe(false);
    mocks.send.mockResolvedValue(undefined);
    act(() => result.current.runtime.thread.append("Try again"));
    await waitFor(() => expect(result.current.error).toBeUndefined());
  });

  it("cancels the current stream even if the action rejects before the mutation resolves", async () => {
    const sending = Promise.withResolvers<void>();
    const aborting = Promise.withResolvers<void>();
    mocks.send.mockReturnValue(sending.promise);
    mocks.abort.mockReturnValue(aborting.promise);
    const { result, rerender } = renderHook(() => useConvexRuntime("thread-1"));
    act(() => result.current.runtime.thread.append("A long story"));
    await waitFor(() => expect(mocks.send).toHaveBeenCalled());
    mocks.messages = [streamingMessage];
    rerender();
    act(() => result.current.runtime.thread.cancelRun());
    expect(mocks.abort).toHaveBeenCalledWith({
      threadId: "thread-1",
      order: 1,
    });
    await act(async () => sending.reject(new Error("Aborted")));
    expect(result.current.error).toBeUndefined();
    mocks.messages = [{ ...streamingMessage, status: "failed" }];
    rerender();
    await act(async () => aborting.resolve());
    expect(result.current.runtime.thread.getState().isRunning).toBe(false);
    expect(
      result.current.runtime.thread.getState().messages[0].content,
    ).toEqual(streamingMessage.parts);
  });

  it("reports a failed cancellation while the provider remains running", async () => {
    mocks.messages = [streamingMessage];
    mocks.abort.mockRejectedValue(new Error("Cannot stop stream"));
    const { result } = renderHook(() => useConvexRuntime("thread-1"));
    act(() => result.current.runtime.thread.cancelRun());
    await waitFor(() =>
      expect(result.current.error?.message).toBe("Cannot stop stream"),
    );
    expect(result.current.runtime.thread.getState().isRunning).toBe(true);
  });
});
