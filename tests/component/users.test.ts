/// <reference types="vite/client" />

import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../../src/component/_generated/api.js";
import type { Id } from "../../src/component/_generated/dataModel.js";
import { initConvexTest } from "../setup/component.js";

function userMessage(text: string) {
  return {
    author: { type: "user" as const },
    content: [{ type: "text" as const, text }],
  };
}

function agentMessage(text: string) {
  return {
    author: { type: "agent" as const, name: "test" },
    content: [{ type: "text" as const, text }],
  };
}

describe("users", () => {
  test("listUsersWithThreads returns users who have threads", async () => {
    const t = initConvexTest();

    // Create two users with threads and one without
    await t.mutation(api.threads.createThread, {
      userId: "user1",
      title: "Test thread 1",
    });
    await t.mutation(api.threads.createThread, {
      userId: "user2",
      title: "Test thread 2",
    });
    await t.mutation(api.threads.createThread, {
      userId: "user1", // Same user, different thread
      title: "Test thread 3",
    });

    const result = await t.query(api.users.listUsersWithThreads, {
      paginationOpts: { cursor: null, numItems: 10 },
    });

    expect(result.page).toHaveLength(2);
    expect(result.page).toContain("user1");
    expect(result.page).toContain("user2");
  });

  test("listUsersWithThreads pagination works", async () => {
    const t = initConvexTest();

    // Create multiple users with threads
    for (let i = 0; i < 5; i++) {
      await t.mutation(api.threads.createThread, {
        userId: `user${i}`,
        title: `Test thread ${i}`,
      });
    }

    const firstPage = await t.query(api.users.listUsersWithThreads, {
      paginationOpts: { cursor: null, numItems: 2 },
    });

    expect(firstPage.page).toHaveLength(2);
    expect(firstPage.isDone).toBe(false);

    const secondPage = await t.query(api.users.listUsersWithThreads, {
      paginationOpts: { cursor: firstPage.continueCursor, numItems: 2 },
    });

    expect(secondPage.page).toHaveLength(2);
    // Should not have duplicate users
    expect(
      firstPage.page.every((user) => !secondPage.page.includes(user)),
    ).toBe(true);
  });

  test("deleteAllForUserId sync deletes all threads and messages for a user", async () => {
    const t = initConvexTest();

    // Create a user with multiple threads and messages
    const thread1 = await t.mutation(api.threads.createThread, {
      userId: "testUser",
      title: "Thread 1",
    });
    const thread2 = await t.mutation(api.threads.createThread, {
      userId: "testUser",
      title: "Thread 2",
    });

    // Add messages to both threads
    await t.mutation(api.messages.addMessages, {
      threadId: thread1._id as Id<"threads">,
      messages: [
        { message: userMessage("Hello thread 1") },
        { message: agentMessage("Response thread 1") },
      ],
    });

    await t.mutation(api.messages.addMessages, {
      threadId: thread2._id as Id<"threads">,
      messages: [
        { message: userMessage("Hello thread 2") },
        { message: agentMessage("Response thread 2") },
      ],
    });

    // Verify data exists before deletion
    const beforeThreads = await t.query(api.threads.listThreadsByUserId, {
      userId: "testUser",
    });
    expect(beforeThreads.page).toHaveLength(2);

    const beforeMessages1 = await t.query(api.messages.listMessagesByThreadId, {
      threadId: thread1._id as Id<"threads">,
      order: "desc",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    const beforeMessages2 = await t.query(api.messages.listMessagesByThreadId, {
      threadId: thread2._id as Id<"threads">,
      order: "desc",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(beforeMessages1.page).toHaveLength(2);
    expect(beforeMessages2.page).toHaveLength(2);

    // Delete all data for the user
    await t.action(api.users.deleteAllForUserId, { userId: "testUser" });

    // Verify all threads are deleted
    const afterThreads = await t.query(api.threads.listThreadsByUserId, {
      userId: "testUser",
    });
    expect(afterThreads.page).toHaveLength(0);

    // Verify threads are actually deleted from DB
    const thread1After = await t.query(api.threads.getThread, {
      threadId: thread1._id as Id<"threads">,
    });
    const thread2After = await t.query(api.threads.getThread, {
      threadId: thread2._id as Id<"threads">,
    });
    expect(thread1After).toBeNull();
    expect(thread2After).toBeNull();
  });

  test("deleteAllForUserId deletes runs and run streams for user threads", async () => {
    const t = initConvexTest();

    const thread = await t.mutation(api.threads.createThread, {
      userId: "runUser",
      title: "Run Thread",
    });
    const run = await t.mutation(api.runs.start, {
      threadId: thread._id as Id<"threads">,
      userId: "runUser",
      agentName: "test",
      prompt: "hello",
      key: "run-user-delete",
    });

    await t.action(api.users.deleteAllForUserId, { userId: "runUser" });

    const threadAfter = await t.query(api.threads.getThread, {
      threadId: thread._id as Id<"threads">,
    });
    const runAfter = await t.query(api.runs.get, {
      runId: run.runId as Id<"runs">,
    });

    expect(threadAfter).toBeNull();
    expect(runAfter).toBeNull();
  });

  test("deleteAllForUserIdAsync deletes data asynchronously", async () => {
    // Enable fake timers for scheduled function testing
    vi.useFakeTimers();

    const t = initConvexTest();

    // Create a user with a thread and messages
    const thread = await t.mutation(api.threads.createThread, {
      userId: "asyncUser",
      title: "Async Thread",
    });

    await t.mutation(api.messages.addMessages, {
      threadId: thread._id as Id<"threads">,
      messages: [
        { message: userMessage("Hello async") },
        { message: agentMessage("Response async") },
      ],
    });

    // Start async deletion
    const result = await t.mutation(api.users.deleteAllForUserIdAsync, {
      userId: "asyncUser",
    });

    // If there's more work to do, advance timers and wait for scheduled functions
    if (!result) {
      // Run all pending timers to trigger scheduled functions
      vi.runAllTimers();

      // Wait for all scheduled functions to complete
      await t.finishInProgressScheduledFunctions();
    }

    // Verify deletion completed
    const afterThreads = await t.query(api.threads.listThreadsByUserId, {
      userId: "asyncUser",
    });
    expect(afterThreads.page).toHaveLength(0);

    // Reset to normal timers
    vi.useRealTimers();
  });

  test("deletePageForUserId handles messages phase correctly", async () => {
    const t = initConvexTest();

    // Create a thread with many messages to test pagination
    const thread = await t.mutation(api.threads.createThread, {
      userId: "paginationUser",
      title: "Pagination Thread",
    });

    // Add multiple messages to force pagination
    const messages = [];
    for (let i = 0; i < 150; i++) {
      messages.push({
        message: userMessage(`Message ${i}`),
      });
    }
    await t.mutation(api.messages.addMessages, {
      threadId: thread._id as Id<"threads">,
      messages,
    });

    // Test first page deletion
    const result1 = await t.mutation(internal.users._deletePageForUserId, {
      userId: "paginationUser",
      messagesCursor: null,
      threadsCursor: null,
      threadInProgress: null,
    });

    expect(result1.isDone).toBe(false);
    expect(result1.threadInProgress).toBe(thread._id);
    expect(result1.messagesCursor).toBeTruthy();

    // Continue until messages are done
    let currentResult = result1;
    let iterations = 0;
    while (currentResult.messagesCursor !== null && iterations < 10) {
      currentResult = await t.mutation(internal.users._deletePageForUserId, {
        userId: "paginationUser",
        messagesCursor: currentResult.messagesCursor,
        threadsCursor: currentResult.threadsCursor,
        threadInProgress: currentResult.threadInProgress,
      });
      iterations++;
    }

    expect(currentResult.messagesCursor).toBeNull();
  });

  test("deletePageForUserId deletes the thread after messages are gone", async () => {
    const t = initConvexTest();

    // Create a thread with messages (no streams for this test)
    const thread = await t.mutation(api.threads.createThread, {
      userId: "streamsUser",
      title: "Streams Thread",
    });

    await t.mutation(api.messages.addMessages, {
      threadId: thread._id as Id<"threads">,
      messages: [
        { message: userMessage("Test message") },
      ],
    });

    const result = await t.mutation(internal.users._deletePageForUserId, {
      userId: "streamsUser",
      messagesCursor: null,
      threadsCursor: null,
      threadInProgress: thread._id as Id<"threads">,
    });

    expect(result.isDone).toBe(false);
    expect(result.threadInProgress).toBeNull();
    expect(result.messagesCursor).toBeNull();

    const threadAfter = await t.query(api.threads.getThread, {
      threadId: thread._id as Id<"threads">,
    });
    expect(threadAfter).toBeNull();
  });

  test("deletePageForUserId handles multiple threads correctly", async () => {
    const t = initConvexTest();

    // Create multiple threads for the same user
    const thread1 = await t.mutation(api.threads.createThread, {
      userId: "multiUser",
      title: "Thread 1",
    });
    const thread2 = await t.mutation(api.threads.createThread, {
      userId: "multiUser",
      title: "Thread 2",
    });

    // Add a message to each
    await t.mutation(api.messages.addMessages, {
      threadId: thread1._id as Id<"threads">,
      messages: [{ message: userMessage("Message 1") }],
    });
    await t.mutation(api.messages.addMessages, {
      threadId: thread2._id as Id<"threads">,
      messages: [{ message: userMessage("Message 2") }],
    });

    // Process first thread completely
    let currentResult = await t.mutation(internal.users._deletePageForUserId, {
      userId: "multiUser",
      messagesCursor: null,
      threadsCursor: null,
      threadInProgress: null,
    });

    // Continue until first thread is done
    while (currentResult.threadInProgress !== null) {
      currentResult = await t.mutation(internal.users._deletePageForUserId, {
        userId: "multiUser",
        messagesCursor: currentResult.messagesCursor,
        threadsCursor: currentResult.threadsCursor,
        threadInProgress: currentResult.threadInProgress,
      });
    }

    while (!currentResult.isDone) {
      currentResult = await t.mutation(internal.users._deletePageForUserId, {
        userId: "multiUser",
        messagesCursor: currentResult.messagesCursor,
        threadsCursor: currentResult.threadsCursor,
        threadInProgress: currentResult.threadInProgress,
      });
    }

    // All threads should be deleted
    const threadsAfter = await t.query(api.threads.listThreadsByUserId, {
      userId: "multiUser",
    });
    expect(threadsAfter.page).toHaveLength(0);
  });

  test("deleteAllForUserIdAsync with multiple scheduled iterations", async () => {
    // Enable fake timers for scheduled function testing
    vi.useFakeTimers();

    const t = initConvexTest();

    // Create a user with multiple threads and many messages to force multiple scheduling iterations
    const thread1 = await t.mutation(api.threads.createThread, {
      userId: "multiIterUser",
      title: "Multi Iter Thread 1",
    });
    const thread2 = await t.mutation(api.threads.createThread, {
      userId: "multiIterUser",
      title: "Multi Iter Thread 2",
    });

    // Add many messages to force pagination
    const messages = [];
    for (let i = 0; i < 150; i++) {
      messages.push({
        message: userMessage(`Message ${i}`),
      });
    }
    await t.mutation(api.messages.addMessages, {
      threadId: thread1._id as Id<"threads">,
      messages,
    });
    await t.mutation(api.messages.addMessages, {
      threadId: thread2._id as Id<"threads">,
      messages,
    });

    // Start async deletion
    const result = await t.mutation(api.users.deleteAllForUserIdAsync, {
      userId: "multiIterUser",
    });

    // Should return false since there's a lot of work to do
    expect(result).toBe(false);

    // Use finishAllScheduledFunctions to handle recursive scheduling
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Verify all data is deleted
    const afterThreads = await t.query(api.threads.listThreadsByUserId, {
      userId: "multiIterUser",
    });
    expect(afterThreads.page).toHaveLength(0);

    // Reset to normal timers
    vi.useRealTimers();
  });

  test("getThreadUserId returns correct userId", async () => {
    const t = initConvexTest();

    const thread = await t.mutation(api.threads.createThread, {
      userId: "testUserId",
      title: "Test Thread",
    });

    const userId = await t.query(internal.users.getThreadUserId, {
      threadId: thread._id as Id<"threads">,
    });

    expect(userId).toBe("testUserId");
  });

  test("getThreadUserId returns null for non-existent thread", async () => {
    const t = initConvexTest();

    // Create a thread, then delete it to get a valid but non-existent ID
    const thread = await t.mutation(api.threads.createThread, {
      userId: "tempUser",
      title: "Temp Thread",
    });

    // Delete the thread so it no longer exists
    await t.action(api.threads.deleteAllForThreadIdSync, {
      threadId: thread._id as Id<"threads">,
    });

    // Now test with the deleted thread's ID
    const userId = await t.query(internal.users.getThreadUserId, {
      threadId: thread._id as Id<"threads">,
    });

    expect(userId).toBeNull();
  });

  test("deleteAllForUserId handles user with no threads", async () => {
    const t = initConvexTest();

    // Try to delete for a user that doesn't exist
    await expect(
      t.action(api.users.deleteAllForUserId, { userId: "nonexistentUser" }),
    ).resolves.not.toThrow();

    // Should complete successfully without errors
  });
});
