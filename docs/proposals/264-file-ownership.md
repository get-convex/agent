# Proposal: user ownership for Agent files (#264)

Draft against `origin/main` at `3cd5eb0faf7856783e59b1a13f0224f4472196b2`
(package `0.7.1`, AI SDK v7). Related issue:
[#264 — userId in the files table](https://github.com/get-convex/agent/issues/264).
Design recorded before implementation. See the file documentation and changelog
for the implemented API and migration guidance.

**Recommendation.** Add optional `files.userId`, scope file deduplication to
that user, and add an explicit ownership check to `getFile`. Carry the resolved
user through every v7 path that stores files, including streamed file chunks and
tool results. Keep authorization ownership separate from the existing reference
count, which controls how long files are retained.

The benefit is a single document read and owner comparison, without searching
messages to establish ownership. Alice uploading a PDF twice can reuse her file;
Bob uploading the same PDF gets his own file record and storage object. The cost
is additional rows and bytes for identical content uploaded by different users.
This is a deliberate change from global deduplication.

**Current behavior and the security boundary.**

| Surface                                                           | Behavior on this v7 base                                                        | Proposed change                                                      |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [File schema](../../src/component/schema.ts)                      | No user field; hash and cleanup indexes                                         | Optional owner and scoped dedup index                                |
| [Component file functions](../../src/component/files.ts)          | Global hash/filename candidates, with normalized media-type matching            | Scope both lookup and registration by owner                          |
| [File helpers](../../src/vercel/client/files.ts)                  | `getFile` fetches metadata and a storage URL without checking an owner          | Optional strict owner check before URL lookup; return owner metadata |
| [Serialization](../../src/vercel/mapping.ts)                      | Large images, files, and canonical tool-result files can create file rows       | Propagate the resolved owner                                         |
| [Stream materialization](../../src/vercel/fileMaterialization.ts) | Oversized file/reasoning-file chunks and tool outputs acquire stream references | Use the same owner as final message serialization                    |
| [Stream lifecycle](../../src/component/streams.ts)                | Stream references protect files until finalization, abort, or recovery          | Preserve reference transfer and cleanup semantics                    |

The earlier evaluation overstated the reachability of `files.get`. Component
functions are called by the parent application's server functions, not directly
by browser clients. Components also do not receive `ctx.auth`; the application
authenticates the caller and passes its user identifier. This is the documented
[component API and authentication boundary](https://docs.convex.dev/components/authoring).

There is still a concrete unsafe example to fix:
[`submitFileQuestion`](../../example/convex/files/addFile.ts) verifies that
someone is signed in, then accepts any `fileId` without checking whose file it
is. The proposal gives that wrapper a cheap ownership check. It does not make
every existing application wrapper secure automatically.

**Proposed API.** These are additions to the existing package exports:

```ts
// App server code: derive the same user identifier used for thread ownership.
const userId = await getAuthUserId(ctx);
if (!userId) throw new Error("Unauthorized");

const { file } = await storeFile(ctx, components.agent, blob, {
  filename,
  sha256,
  userId,
});

const { filePart, imagePart } = await getFile(ctx, components.agent, fileId, {
  requireUserId: userId,
});
```

`storeFile` gains `userId?: string` in its existing options. Both helpers return
`file.userId?: string`. The optional fourth argument to `getFile` has type
`{ requireUserId: string }`; omitting the argument preserves the existing
trusted-server behavior. Do not accept the requester identity from browser
arguments or silently skip the check when authentication fails.

Add `requireUserId: v.optional(v.string())` to the component `files.get`
arguments. When supplied, return `null` unless the row exists and its `userId`
equals the requested user. The helper treats that as “File not found” and never
calls `ctx.storage.getUrl` for the rejected file. Missing and wrong-owner rows
use the same error. Existing calls without this option retain their behavior.

| Stored owner               | Requested owner    | Checked read                     |
| -------------------------- | ------------------ | -------------------------------- |
| Alice                      | Alice              | Allowed                          |
| Alice                      | Bob                | Denied                           |
| Unset (legacy or unscoped) | Alice              | Denied                           |
| Any                        | No check requested | Existing trusted-server behavior |

In particular, the earlier suggestion that legacy rows should pass a requested
ownership check is withdrawn. Unset ownership cannot establish Alice's access.
An unscoped upload remains possible for compatibility, but that shared scope
does not isolate anonymous sessions. Apps needing that isolation should pass a
stable, server-verified session identifier in their ownership namespace.

Existing custom sharing policies can continue to authorize access in app code
before using the unchecked helper. Knowing a `fileId` is not authorization.
Applications must also authorize thread/message reads and attachments: an
already-stored URL in a message does not pass through `getFile` again. This
proposal adds no per-download authorization or revocation of issued URLs.

**Schema and deduplication.** Add `userId: v.optional(v.string())` to `files`
and an index named `userId_hash_filename` on those three fields. Preserve
`refcount`, `refcount_lastTouchedAt`, and initially `hash` for a staged rollout.
The new index's user prefix also supports paginated owner listings if added
later; no user-deletion convenience API is needed to deliver #264.

Both `addFile`/`addFileHandler` and `useExistingFile` must accept the optional
owner and use the same indexed `(userId, hash, filename)` candidate range.
Persist the owner only when creating a row; a cache hit must never reassign
ownership. An explicitly scoped request must not fall back to an unscoped row.
Omitted owners match only other unscoped rows.

Within that range, retain v7's `normalizeMediaType` and `sameMediaType`
behavior, including the deprecated `mimeType` fallback and reuse of rows with no
media type. The current `.collect().find(...)` exists because one hash/filename
can have distinct media types. Replacing it with `.first()` would change
behavior. Prefer lazy candidate iteration that stops on a compatible match; do
not use an arbitrary `take(n)` that can miss a later compatible candidate.

The client must pass the owner to both its pre-upload lookup and post-upload
registration. Preserve the losing-upload cleanup in `storeFile`: concurrent
uploads by one user may create two temporary blobs, but only the winner stays
registered. Uploads by different users must not compete for that row.

**Changes across the v7 code.**

| Area                                                                                                            | Required work                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Explicit message saves](../../src/vercel/client/messages.ts)                                                   | Resolve `args.userId ?? thread.userId` before serializing a batch, matching generation's existing fallback; pass it through `serializeMessage` and `serializeContent` |
| [Generation](../../src/vercel/client/start.ts)                                                                  | Reuse the user already resolved by `startGeneration` for prompt and response serialization, including `serializeResponseMessages`                                     |
| [Streaming](../../src/vercel/client/streamText.ts)                                                              | Pass that same resolved user into the `DeltaStreamer` materialization callback                                                                                        |
| [File materialization](../../src/vercel/fileMaterialization.ts)                                                 | Thread the owner through UI chunks, reasoning files, canonical tool-result content, and `materializeInlineFile` into `storeFile`                                      |
| [Message updates](../../src/vercel/index.ts)                                                                    | Load the existing message and resolve its user/thread owner before serializing replacement content; the current update API only receives a message ID                 |
| [Canonical persistence](../../src/client/messages.ts) and [component messages](../../src/component/messages.ts) | Preserve supplied file IDs and their owners; do not relabel existing files when attaching or cloning messages                                                         |
| Public types and generated API                                                                                  | Update file result types and options; regenerate component API types using repository codegen rather than editing generated declarations                              |
| [File docs](../files.mdx) and [upload example](../../example/convex/files/addFile.ts)                           | Supply the authenticated user on upload and require it when resolving a client-provided file ID                                                                       |

Capture the owner once for a generation so its streamed and finalized files
deduplicate together. Explicit user IDs are supplied by trusted application
code; thread fallback is metadata resolution, not an authorization check. Keep
the existing nullish fallback semantics. An anonymous thread with no supplied
user remains unscoped. Changing a thread's user later does not transfer existing
file ownership.

The reference-counting helpers remain concerned with retention. In particular,
`copyFile` currently increments a reference on the same row. Keep its signature
and behavior; adding `toUserId` would turn it into a different operation.
Likewise, trusted cross-user message clones preserve the original file owner and
require the application's sharing policy for subsequent access. An explicit
cross-user copy/transfer API and an access-grant table are separate proposals.

**Cleanup and storage aliases.** Preserve registration at `refcount: 0`,
`lastTouchedAt` refresh on reuse, the 24-hour grace period, and set-based
reference changes. Stream finalization and recovery must acquire message
references before releasing stream references, as v7 does today.

Per-user uploads through `storeFile` naturally create separate blobs, so owner
scoping alone does not require a new blob table or persistent blob counter.
However, direct `addFile` calls already permit multiple rows to name the same
`storageId` (for example, different filenames). Cleanup must account for those
aliases before any design introduces more of them.

Include an indexed storage-alias check in the implementation: add a `storageId`
index and an additive component mutation, tentatively
`deleteFilesWithStorageIds`, returning `{ deletedFileIds, storageIdsToDelete }`.
It should share the existing eligibility checks, delete eligible rows, and
return each storage ID only if no file row still references it. Keep the
existing `deleteFiles` return shape for compatibility. This needs an existence
lookup per distinct storage ID, not a scan/count of every alias.

Update the vacuum example to call this operation and then delete only the
returned blobs in the same parent-app mutation. Propagate deletion errors so the
whole operation rolls back. Do not split it into an action that commits row
deletion before blob deletion. Convex supports
[transactional changes across component calls](https://docs.convex.dev/components/understanding#isolation).
Keep `force` a trusted maintenance operation; it must not bypass the
remaining-alias check. Document the same change for apps with custom vacuum
jobs.

**Compatibility and rollout.** Ship optional schema fields and additive API
arguments first, then update all creation paths and examples together. Existing
rows remain unscoped; existing unchecked calls still work. New scoped uploads
may duplicate old unscoped content. That storage cost is preferable to silently
claiming a shared legacy row. Do not describe this as automatic security
enforcement for existing installations.

Do not run an automatic owner backfill. A file may be referenced by multiple
users' messages, live streams, trusted clones, or app-side records the component
cannot inspect. A future opt-in migration should first produce a paginated
reference report, reconcile message and stream owners, and leave ambiguous or
unreferenced rows untouched. Apply assignments only with application-level
evidence and controlled concurrent writes; never assign the first user found.
Splitting shared legacy rows also requires rewriting references and maintaining
blob cleanup, so it is outside this initial change.

**Acceptance criteria for implementation.**

- Alice can read her file through the checked helper; Bob and an unauthenticated
  app caller cannot. A requested check also rejects legacy rows, and rejected
  reads never resolve storage URLs. Cover the actual app wrapper, including a
  client attempting to supply another user's identity.
- Equal owner/hash/filename and compatible media type reuse one row. Different
  owners and scoped-versus-unscoped requests do not. Preserve legacy media-type
  matching and filename distinctions in both dedup entry points.
- Concurrent same-user uploads remove losing blobs; different-user uploads
  retain their own blobs. Existing missing-storage and cleanup-error behavior
  remains covered by the client tests.
- Explicit saves, thread-only generation, assistant files, tool-result files,
  message updates, and streamed reasoning/file chunks receive the expected
  owner. Finalization reuses stream-created rows, including when only a thread
  ID was supplied. Anonymous paths remain usable.
- Finalization, abort, timeout recovery, message deletion, and same-user cloning
  preserve refcounts and grace periods. Cross-user trusted cloning does not
  reassign ownership or make an owner-only read succeed for the recipient.
- Deleting one storage alias preserves the blob while any alias remains,
  including a fresh zero-refcount alias. Deleting the last eligible alias
  deletes the blob; failures roll back; `force` cannot orphan another alias.
- Old API calls and ownerless fixtures still work. Extend the existing file,
  mapping, stream, and integration suites, then run build/codegen, tests, lint,
  and typechecking. The implementation should satisfy these checks.

This scope supplies a useful owner field and enforceable owner-only retrieval
without choosing a general sharing or account-deletion policy for applications.
