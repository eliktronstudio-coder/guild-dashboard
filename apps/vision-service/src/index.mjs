import { createVisionServer } from "./server.mjs";
const port = Number(process.env.PORT ?? 10000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw Error("Invalid PORT");
createVisionServer().listen(port, "0.0.0.0", () =>
  console.info("XD Vision service ready"),
);
