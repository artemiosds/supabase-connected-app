import { JSDOM } from "jsdom";
const { window } = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Node",
  "DOMParser",
  "XMLSerializer",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: key === "window" ? window : window[key],
  });
}
await import("./setup.ts");
