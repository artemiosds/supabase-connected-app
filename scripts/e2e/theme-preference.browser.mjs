import assert from "node:assert/strict";

/** Smoke-check the real SSR/hydration theme flow without production credentials. */
export async function verifyThemePreference(browser, appUrl) {
  const context = await browser.newContext({ colorScheme: "light" });
  const page = await context.newPage();

  try {
    await page.addInitScript(() => {
      if (window.sessionStorage.getItem("primus-theme-test-seeded") !== "true") {
        window.localStorage.setItem("primus-theme", "dark");
        window.sessionStorage.setItem("primus-theme-test-seeded", "true");
      }
    });

    await page.goto(appUrl + "/entrar?portal=secretaria", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Selecionar tema. Atual: Escuro" }).waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.classList.contains("dark")),
      true,
      "the stored dark preference should be applied before interaction",
    );

    await page.getByRole("button", { name: /Selecionar tema/ }).click();
    await page.getByRole("menuitem", { name: "Claro" }).click();
    await page.getByRole("button", { name: "Selecionar tema. Atual: Claro" }).waitFor();
    assert.deepEqual(
      await page.evaluate(() => ({
        storage: localStorage.getItem("primus-theme"),
        dark: document.documentElement.classList.contains("dark"),
      })),
      { storage: "light", dark: false },
    );

    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Selecionar tema. Atual: Claro" }).waitFor();

    await page.getByRole("button", { name: /Selecionar tema/ }).click();
    await page.getByRole("menuitem", { name: "Escuro" }).click();
    await page.getByRole("button", { name: "Selecionar tema. Atual: Escuro" }).waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.classList.contains("dark")),
      true,
    );

    await page.getByRole("button", { name: /Selecionar tema/ }).click();
    await page.getByRole("menuitem", { name: "Sistema" }).click();
    await page.getByRole("button", { name: "Selecionar tema. Atual: Sistema" }).waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.classList.contains("dark")),
      false,
      "System mode should follow a light operating system",
    );

    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
    assert.equal(await page.evaluate(() => localStorage.getItem("primus-theme")), "system");
    console.log("PASS theme: SSR preference, light/dark/system, persistence and OS changes");
  } finally {
    await context.close();
  }
}
