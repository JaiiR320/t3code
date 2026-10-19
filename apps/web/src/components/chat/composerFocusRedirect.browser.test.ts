import { afterEach, describe, expect, it } from "vite-plus/test";

import { shouldTypeToFocusComposer } from "./composerFocusRedirect";

function typeFrom(target: HTMLElement): boolean {
  let redirected: boolean | undefined;
  const listener = (event: KeyboardEvent) => {
    redirected = shouldTypeToFocusComposer(event);
  };
  window.addEventListener("keydown", listener);
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
  window.removeEventListener("keydown", listener);
  return redirected ?? false;
}

describe("shouldTypeToFocusComposer", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("redirects typing from a plain element but leaves a device screen alone", () => {
    const plain = document.createElement("div");
    const deviceScreen = document.createElement("div");
    deviceScreen.setAttribute("role", "application");
    deviceScreen.tabIndex = 0;
    document.body.append(plain, deviceScreen);

    expect(typeFrom(plain)).toBe(true);
    expect(typeFrom(deviceScreen)).toBe(false);
  });
});
