// @vitest-environment jsdom
import {
  useExternalStoreRuntime,
  type ThreadMessage,
} from "@assistant-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatAssistantUI from "./ChatAssistantUI";

const mocks = vi.hoisted(() => ({
  resetThread: vi.fn<() => Promise<void>>(),
  messages: [] as ThreadMessage[],
}));

vi.mock("../hooks/use-demo-thread", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../hooks/use-demo-thread")>()),
  useDemoThread: () => ({
    threadId: "thread-1",
    resetThread: mocks.resetThread,
  }),
}));
vi.mock("./assistant-ui/useConvexRuntime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./assistant-ui/useConvexRuntime")>()),
  useConvexRuntime: () => ({
    runtime: useExternalStoreRuntime({
      messages: mocks.messages,
      onNew: async () => {},
    }),
    error: undefined,
    paginationStatus: "Exhausted",
    loadMore: () => {},
  }),
}));
vi.mock("./assistant-ui/Thread", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./assistant-ui/Thread")>()),
  Thread: () => <p>Current conversation</p>,
}));

beforeEach(() => mocks.resetThread.mockReset());
afterEach(cleanup);

describe("ChatAssistantUI", () => {
  it("surfaces a failed new conversation request while keeping the current conversation", async () => {
    mocks.resetThread.mockRejectedValueOnce(
      new Error("Could not create conversation"),
    );
    render(<ChatAssistantUI />);
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not create conversation",
    );
    expect(screen.getByText("Current conversation")).toBeDefined();
    expect(
      (
        screen.getByRole("button", {
          name: "New conversation",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("clears a previous creation error on retry and prevents duplicate pending requests", async () => {
    mocks.resetThread.mockRejectedValueOnce("offline");
    render(<ChatAssistantUI />);
    const button = screen.getByRole("button", {
      name: "New conversation",
    }) as HTMLButtonElement;
    fireEvent.click(button);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Unable to create a new conversation.",
    );
    const creating = Promise.withResolvers<void>();
    mocks.resetThread.mockReturnValueOnce(creating.promise);
    fireEvent.click(button);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(mocks.resetThread).toHaveBeenCalledTimes(2);
    creating.resolve();
    await waitFor(() => expect(button.disabled).toBe(false));
  });
});
