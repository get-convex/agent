import {
  exposeDeploymentQuery,
  exposeUploadApi,
} from "@convex-dev/static-hosting";

import { components } from "./_generated/api";

export const {
  generateUploadUrl,
  generateUploadUrls,
  recordAsset,
  recordAssets,
  gcOldAssets,
  listAssets,
} = exposeUploadApi(components.staticHosting);

export const { getCurrentDeployment } = exposeDeploymentQuery(
  components.staticHosting,
);
