import { randomUUID } from "node:crypto";
import { test as base, expect } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";

function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`Missing ${name}; configure .env.e2e.local first.`);
  return value;
}

interface Scenario {
  tripName: string;
  tripId?: string;
  created: boolean;
  placeName: string;
  secondPlaceName: string;
  secondNote: string;
  bSawOriginal?: boolean;
  bAddedSecond?: boolean;
  aCloudSawSecond?: boolean;
  cloudDeleteAcknowledged: boolean;
  hybridTripAbsent?: boolean;
  hybridRestored: boolean;
  cleanupError?: string;
}

const test = base.extend<{ scenario: Scenario }>({
  scenario: [
    async ({ page }, runFixture, info) => {
      const run = `E2E-share-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const scenario: Scenario = {
        tripName: run,
        created: false,
        placeName: "",
        secondPlaceName: "",
        secondNote: `${run}-B-place-2`,
        cloudDeleteAcknowledged: false,
        hybridRestored: false,
      };
      try {
        await runFixture(scenario);
      } finally {
        try {
          if (
            scenario.created &&
            (!scenario.cloudDeleteAcknowledged || !scenario.hybridRestored)
          ) {
            await test.step("[異常收尾] 回到 A、以混合模式清理本輪行程並復歸", async () => {
              await recoverOwner(page);
              try {
                await switchMode(page, "hybrid");
                if (!scenario.cloudDeleteAcknowledged)
                  await deleteHybridTrip(page, scenario);
              } finally {
                await switchMode(page, "hybrid");
                scenario.hybridRestored = true;
              }
            });
          }
        } catch (error) {
          scenario.cleanupError =
            error instanceof Error ? error.message : String(error);
          console.error(
            `[清理失敗] ${scenario.tripName}：${scenario.cleanupError}`,
          );
          throw error;
        } finally {
          console.log(`[結果紀錄] ${JSON.stringify(scenario)}`);
          await info.attach("scenario-result", {
            body: JSON.stringify(scenario, null, 2),
            contentType: "application/json",
          });
        }
      }
    },
    { timeout: 120_000 },
  ],
});

async function signIn(page: Page, email: string, password: string) {
  await page.getByLabel("電子郵件", { exact: true }).fill(email);
  // Avoid recording a password as a named Playwright fill action.
  await page.getByLabel("密碼", { exact: true }).evaluate((element, value) => {
    if (!(element instanceof HTMLInputElement))
      throw new Error("Password input is unavailable.");
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setter) throw new Error("Password input setter is unavailable.");
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^(展開|收合)工作區側欄$/ }),
  ).toBeVisible();
}

async function waitForUpload(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const path = "/src/database/hybrid.runtime.ts";
          const runtime: typeof import("../src/database/hybrid.runtime") =
            await import(path);
          const { ready, summary, error } = runtime.getHybridStatus();
          return {
            ready,
            initialized: summary?.initialized,
            pending: summary?.pendingCount,
            failed: summary?.failedCount,
            conflicts: summary?.conflictCount,
            error: error ?? null,
          };
        }),
      {
        timeout: 60_000,
        message: "等待目前帳號的本機操作自動同步；未完成時不繼續退出或刪除。",
      },
    )
    .toEqual({
      ready: true,
      initialized: true,
      pending: 0,
      failed: 0,
      conflicts: 0,
      error: null,
    });
}

async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await info.attach(name, { path, contentType: "image/png" });
}

async function signOut(page: Page) {
  const dialog = page.getByRole("dialog");
  if (await dialog.count())
    await dialog.getByRole("button", { name: "關閉", exact: true }).click();
  const expand = page.getByRole("button", {
    name: "展開工作區側欄",
    exact: true,
  });
  if (await expand.isVisible()) await expand.click();
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "登入", exact: true }),
  ).toBeVisible();
}

async function switchMode(page: Page, mode: "supabase" | "hybrid") {
  await page.goto("/data");
  const picker = page.getByLabel("資料庫來源", { exact: true });
  await expect(
    picker,
    "A 必須具有可切換資料庫來源的管理員權限。",
  ).toBeEnabled();
  await picker.selectOption(mode);
  await expect(picker).toHaveValue(mode);
  if (mode === "hybrid") await waitForUpload(page);
}

async function selectTripIfPresent(
  page: Page,
  tripName: string,
): Promise<boolean> {
  await expect(
    page.getByRole("button", { name: "協作管理", exact: true }),
  ).toBeEnabled();
  const picker = page.getByLabel("切換行程", { exact: true });
  if (await picker.count()) {
    const option = picker.getByRole("option", { name: tripName, exact: true });
    if (!(await option.count())) return false;
    await picker.selectOption({ label: tripName });
  } else if (
    !(await page
      .getByRole("heading", { name: tripName, exact: true, level: 1 })
      .count())
  ) {
    return false;
  }
  await expect(
    page.getByRole("heading", { name: tripName, exact: true, level: 1 }),
  ).toBeVisible();
  return true;
}

async function confirmAction(
  page: Page,
  message: string,
  action: () => Promise<unknown>,
) {
  const confirmation = page.waitForEvent("dialog").then(async (prompt) => {
    if (prompt.type() !== "confirm" || !prompt.message().includes(message)) {
      await prompt.dismiss();
      throw new Error(`Unexpected confirmation; expected: ${message}`);
    }
    await prompt.accept();
  });
  await Promise.all([confirmation, action()]);
}

async function recoverOwner(page: Page) {
  const login = page.getByRole("button", { name: "登入", exact: true });
  const account = page.locator(".workspace-session-card strong");
  const currentEmail = (await account.count())
    ? await account.innerText()
    : undefined;
  if (
    currentEmail?.trim().toLowerCase() !== required("E2E_A_EMAIL").toLowerCase()
  ) {
    if (currentEmail) await signOut(page);
    await expect(login).toBeVisible();
    await signIn(page, required("E2E_A_EMAIL"), required("E2E_A_PASSWORD"));
  }
}

async function deleteHybridTrip(page: Page, scenario: Scenario) {
  await page.goto("/itinerary");
  if (!(await selectTripIfPresent(page, scenario.tripName))) {
    throw new Error(
      `混合模式找不到本輪行程 ${scenario.tripName}；未聲稱清理成功。`,
    );
  }
  if (!scenario.tripId) {
    scenario.tripId = await page.evaluate(async (name) => {
      const path = "/src/database/index.ts";
      const db: typeof import("../src/database/index") = await import(path);
      return (await db.trips.list()).find((trip) => trip.name === name)?.id;
    }, scenario.tripName);
  }
  if (!scenario.tripId)
    throw new Error("無法確認本輪行程 ID；拒絕刪除其他資料。");
  await page.getByRole("button", { name: "刪除", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: `確定刪除「${scenario.tripName}」？`,
    exact: true,
  });
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) => {
        if (
          !response.url().endsWith("/rest/v1/rpc/app_sync_push") ||
          response.request().method() !== "POST"
        )
          return false;
        const body: {
          p_task?: { changes?: { entity: string; kind: string; id: string }[] };
        } = response.request().postDataJSON();
        return (
          body.p_task?.changes?.some(
            (change) =>
              change.entity === "trips" &&
              change.kind === "delete" &&
              change.id === scenario.tripId,
          ) ?? false
        );
      },
      { timeout: 60_000 },
    ),
    dialog.getByRole("button", { name: "刪除行程與項目", exact: true }).click(),
  ]);
  const result: { status: string } = await response.json();
  if (!response.ok() || result.status !== "applied") {
    throw new Error(
      `本輪混合刪除未獲雲端確認（HTTP ${response.status()}，${result.status}）。`,
    );
  }
  scenario.cloudDeleteAcknowledged = true;
  await expect(dialog).toBeHidden();
  await waitForUpload(page);
  await page.reload();
  scenario.hybridTripAbsent = !(await selectTripIfPresent(
    page,
    scenario.tripName,
  ));
}

test("單視窗：B 新增地點並退出，A 查看雲端結果後以混合模式刪除及復歸", async ({
  page,
  scenario,
}, info) => {
  if (process.env.E2E_ALLOW_LIVE_WRITES !== "true") {
    throw new Error(
      "Set E2E_ALLOW_LIVE_WRITES=true; this scenario creates a real shared trip.",
    );
  }
  const a = {
    email: required("E2E_A_EMAIL"),
    password: required("E2E_A_PASSWORD"),
  };
  const b = {
    email: required("E2E_B_EMAIL"),
    password: required("E2E_B_PASSWORD"),
  };
  if (a.email.toLowerCase() === b.email.toLowerCase())
    throw new Error("A and B must be different accounts.");
  const { tripName } = scenario;
  let placeName = "";

  await test.step("[01/24] A：登入", async () => {
    await page.goto("/");
    await signIn(page, a.email, a.password);
  });
  await test.step("[02/24] A：前往 /itinerary", async () => {
    await page.goto("/itinerary");
    await expect(
      page.getByRole("button", { name: "協作管理", exact: true }),
    ).toBeEnabled();
  });
  await test.step("[03/24] A：建立行程", async () => {
    await page
      .getByRole("button", { name: "＋ 新增行程", exact: true })
      .first()
      .click();
    await expect(page.getByLabel("行程名稱")).toBeVisible();
    await page.getByLabel("行程名稱").fill(tripName);
    const region = page.getByLabel("所屬區域");
    await expect(region, "A 需要至少一個既有區域。").toBeVisible();
    const first = region.locator("option:not([disabled])").first();
    await expect(first, "A 需要至少一個既有區域。").toHaveCount(1);
    const regionId = await first.getAttribute("value");
    if (!regionId) throw new Error("A has no selectable region.");
    await region.selectOption(regionId);
    scenario.created = true;
    await page.getByRole("button", { name: "建立行程", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: tripName, exact: true, level: 1 }),
    ).toBeVisible();
  });
  await test.step("[04/24] A：加入地點，選清單第一個", async () => {
    await page
      .getByRole("button", { name: "＋ 加入地點", exact: true })
      .first()
      .click();
    await page.getByRole("combobox", { name: "地點", exact: true }).click();
    const first = page
      .getByRole("listbox", { name: "地點", exact: true })
      .getByRole("option")
      .first();
    await expect(first, "行程所屬區域需要至少一個可選地點。").toBeVisible();
    placeName = (await first.locator("span").first().innerText()).trim();
    scenario.placeName = placeName;
    expect(placeName).not.toBe("");
    await first.click();
    await page.getByRole("button", { name: "加入行程", exact: true }).click();
    await expect(page.locator(".itinerary-item-list")).toContainText(placeName);
    await waitForUpload(page);
    await capture(page, info, "A-created-itinerary");
  });
  await test.step("[05/24] A：開啟協作管理，輸入 B Email，選可編輯", async () => {
    await page.getByRole("button", { name: "協作管理", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "行程協作管理",
      exact: true,
    });
    const picker = dialog.getByLabel("選擇雲端行程");
    await expect(picker).toBeEnabled();
    const option = picker.locator("option").filter({ hasText: tripName });
    await expect(option).toHaveCount(1);
    const tripId = await option.getAttribute("value");
    if (!tripId)
      throw new Error(
        "The new trip is not available in collaboration management.",
      );
    scenario.tripId = tripId;
    await picker.selectOption(tripId);
    await dialog.getByLabel("對方 Email").fill(b.email);
    await dialog.getByLabel("接受後的權限").selectOption("editor");
  });
  await test.step("[06/24] A：送出邀請", async () => {
    const dialog = page.getByRole("dialog", {
      name: "行程協作管理",
      exact: true,
    });
    await dialog.getByRole("button", { name: "送出邀請", exact: true }).click();
    await expect(dialog).toContainText("站內邀請已送出");
    await expect(
      dialog.getByRole("button", { name: "關閉", exact: true }),
    ).toBeEnabled();
  });
  await test.step("[07/24] A：啟用協作，找不到就 SKIP", async (step) => {
    const dialog = page.getByRole("dialog", {
      name: "行程協作管理",
      exact: true,
    });
    const enable = dialog.getByRole("button", {
      name: "啟用協作",
      exact: true,
    });
    step.skip(
      !(await enable.isVisible()),
      "找不到「啟用協作」，依指定流程略過。",
    );
    await confirmAction(page, "確定啟用此行程的共同編輯", () => enable.click());
    await expect(dialog).toContainText("共同編輯已啟用");
    await expect(
      dialog.getByRole("button", { name: "關閉", exact: true }),
    ).toBeEnabled();
  });
  await test.step("[08/24] A：登出", async () => {
    await signOut(page);
  });
  await test.step("[09/24] B：在同一視窗登入", async () => {
    await signIn(page, b.email, b.password);
  });
  await test.step("[10/24] B：前往 /itinerary", async () => {
    await page.goto("/itinerary");
    await expect(
      page.getByRole("button", { name: "協作管理", exact: true }),
    ).toBeEnabled();
  });
  await test.step("[11/24] B：開啟協作管理", async () => {
    await page.getByRole("button", { name: "協作管理", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "行程協作管理", exact: true }),
    ).toBeVisible();
  });
  await test.step("[12/24] B：接受 A 本輪行程的邀請", async () => {
    const dialog = page.getByRole("dialog", {
      name: "行程協作管理",
      exact: true,
    });
    const invitation = dialog
      .getByRole("region", { name: "收到的行程邀請" })
      .getByRole("listitem")
      .filter({ hasText: tripName });
    await invitation
      .getByRole("button", { name: "接受邀請", exact: true })
      .click();
    await expect(dialog).toContainText("已接受邀請");
    await dialog.getByRole("button", { name: "關閉", exact: true }).click();
  });
  await test.step("[13/24] B：等待 5 秒", async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 5000));
  });
  await test.step("[14/24] B：記錄是否看到 A 的行程與地點", async () => {
    const present = await selectTripIfPresent(page, tripName);
    scenario.bSawOriginal =
      present &&
      (
        await page.locator(".itinerary-item-title strong").allTextContents()
      ).some((name) => name.includes(placeName));
    console.log(`[觀察] B 看見 A 的地點：${scenario.bSawOriginal}`);
    await capture(page, info, "B-shared-itinerary");
  });
  await test.step("[15/24] B：加入另一個地點並等待上傳", async () => {
    if (!(await selectTripIfPresent(page, tripName))) {
      throw new Error("B 找不到本輪共享行程；拒絕將測試地點加入其他行程。");
    }
    await page
      .getByRole("button", { name: "＋ 加入地點", exact: true })
      .first()
      .click();
    await page.getByRole("combobox", { name: "地點", exact: true }).click();
    const options = page
      .getByRole("listbox", { name: "地點", exact: true })
      .getByRole("option");
    await expect(options.first()).toBeVisible();
    const index = await options.evaluateAll(
      (entries, original) =>
        entries.findIndex(
          (entry) =>
            entry.querySelector("span")?.textContent?.trim() !== original,
        ),
      placeName,
    );
    if (index < 0)
      throw new Error(
        "B 需要至少一個不同於地點 1 的可選地點；將先收尾再回報失敗。",
      );
    const second = options.nth(index);
    scenario.secondPlaceName = (
      await second.locator("span").first().innerText()
    ).trim();
    await second.click();
    await page.getByLabel("備註", { exact: true }).fill(scenario.secondNote);
    await page.getByRole("button", { name: "加入行程", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "協作管理", exact: true }),
    ).toBeEnabled();
    await waitForUpload(page);
    scenario.bAddedSecond =
      (await page
        .locator(".itinerary-item-row")
        .filter({ hasText: scenario.secondNote })
        .count()) === 1;
    console.log(
      `[觀察] B 已排入地點 2「${scenario.secondPlaceName}」：${scenario.bAddedSecond}`,
    );
    await capture(page, info, "B-added-place-2");
  });
  await test.step("[16/24] B：從協作管理退出本輪行程", async () => {
    await page.getByRole("button", { name: "協作管理", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "行程協作管理",
      exact: true,
    });
    await expect(dialog.getByLabel("選擇雲端行程")).toBeEnabled();
    if (!scenario.tripId)
      throw new Error("缺少本輪行程 ID；拒絕退出其他行程。");
    await dialog.getByLabel("選擇雲端行程").selectOption(scenario.tripId);
    await confirmAction(page, "確定退出這個協作行程", () =>
      dialog.getByRole("button", { name: "退出行程", exact: true }).click(),
    );
    await expect(dialog).toContainText("已退出行程");
    await expect(
      dialog.getByRole("button", { name: "關閉", exact: true }),
    ).toBeEnabled();
  });
  await test.step("[17/24] B：登出", async () => {
    await signOut(page);
  });
  await test.step("[18/24] A：在同一視窗重新登入", async () => {
    await signIn(page, a.email, a.password);
  });
  await test.step("[19/24] A：到 /data 切成雲端模式", async () => {
    await switchMode(page, "supabase");
  });
  await test.step("[20/24] A：記錄雲端是否有地點 2，不提前判定失敗", async () => {
    await page.goto("/itinerary");
    const present = await selectTripIfPresent(page, tripName);
    const row = page
      .locator(".itinerary-item-row")
      .filter({ hasText: scenario.secondNote });
    if (present) {
      const deadline = Date.now() + 5000;
      while (!(await row.count()) && Date.now() < deadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
      }
    }
    scenario.aCloudSawSecond =
      present &&
      (await row.count()) === 1 &&
      (await row.innerText()).includes(scenario.secondPlaceName);
    console.log(
      `[觀察] A 雲端看見地點 2「${scenario.secondPlaceName}」：${scenario.aCloudSawSecond}；清理後才斷言。`,
    );
    await capture(page, info, "A-cloud-place-2-observation");
  });
  await test.step("[21/24] A：回 /data 先切回混合模式", async () => {
    await switchMode(page, "hybrid");
  });
  await test.step("[22/24] A：以混合模式刪除本輪行程，等待雲端確認", async () => {
    await deleteHybridTrip(page, scenario);
  });
  await test.step("[23/24] A：回 /data 確認維持混合模式，完成復歸", async () => {
    await switchMode(page, "hybrid");
    scenario.hybridRestored = true;
    await capture(page, info, "A-restored-hybrid");
  });
  await test.step("[24/24] 清理與復歸後才判定觀察結果", async () => {
    expect({
      bSawOriginal: scenario.bSawOriginal,
      bAddedSecond: scenario.bAddedSecond,
      aCloudSawSecond: scenario.aCloudSawSecond,
      cloudDeleteAcknowledged: scenario.cloudDeleteAcknowledged,
      hybridTripAbsent: scenario.hybridTripAbsent,
      hybridRestored: scenario.hybridRestored,
    }).toEqual({
      bSawOriginal: true,
      bAddedSecond: true,
      aCloudSawSecond: true,
      cloudDeleteAcknowledged: true,
      hybridTripAbsent: true,
      hybridRestored: true,
    });
  });
});
