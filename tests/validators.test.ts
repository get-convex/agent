import type { GenericId, Infer } from "convex/values";
import { expectTypeOf, test } from "vitest";
import { vAgentMessageDoc } from "../src/validators.js";
import type { Doc } from "../src/component/_generated/dataModel.js";

type MessageBasedOnSchema = IdsToStrings<
  Omit<Doc<"messages">, "parentMessageId">
>;
expectTypeOf<Infer<typeof vAgentMessageDoc>>().toEqualTypeOf<MessageBasedOnSchema>();
expectTypeOf<MessageBasedOnSchema>().toEqualTypeOf<Infer<typeof vAgentMessageDoc>>();

test("noop", () => {});

type IdsToStrings<T> =
  T extends GenericId<string>
    ? string
    : T extends (infer U)[]
      ? IdsToStrings<U>[]
      : T extends ArrayBuffer
        ? ArrayBuffer
        : T extends object
          ? { [K in keyof T]: IdsToStrings<T[K]> }
          : T;
