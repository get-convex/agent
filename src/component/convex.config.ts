import { defineComponent } from "convex/server";
import stream from "@convex-dev/stream/convex.config";

const component = defineComponent("agent");
component.use(stream);

export default component;
