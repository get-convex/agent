import schema from "./component/schema.js";
const modules = import.meta.glob("./**/*.ts");
export default { schema, modules };
