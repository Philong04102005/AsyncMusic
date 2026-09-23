import { test, expect } from "@playwright/test";
test("guest creates room, chats safely, sees provider setup error, and leaves", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Good music. Better together." }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/discovery-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Come on in" }).click();
  await page.getByLabel("Your display name").fill("Browser host");
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Start a room", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Room name", { exact: true })
    .fill("The evening session");
  await page.getByRole("button", { name: "Create your room" }).click();
  await expect(
    page.getByRole("heading", { name: "The evening session" }),
  ).toBeVisible();
  await expect(page.getByText("Hosting the room")).toBeVisible();
  await page.getByLabel("Chat message").fill('<script>alert("hello")</script>');
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByRole("log").getByText('<script>alert("hello")</script>'),
  ).toBeVisible();
  // Exercise the error UI deterministically, even when real credentials are configured.
  await page.route("**/api/providers/youtube/search?*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        code: "AUTH_REQUIRED",
        error: "YouTube search needs a server API key. See the setup guide.",
      }),
    }),
  );
  await page.getByRole("button", { name: "Add songs", exact: true }).click();
  await page
    .getByPlaceholder("Search songs, artists, a feeling…")
    .fill("lofi music");
  await expect(page.getByRole("alert")).toContainText(
    "YouTube search needs a server API key",
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.screenshot({
    path: "test-results/room-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/room-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Room settings" }).click();
  await page
    .getByLabel("Room name", { exact: true })
    .fill("The renamed session");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("heading", { name: "The renamed session" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Leave room", exact: true }).click();
  await expect(page).toHaveURL("http://localhost:3000/");
  expect(errors).toEqual([]);
});
test("private room password and realtime member roles work across browser contexts", async ({
  browser,
}) => {
  const hostContext = await browser.newContext(),
    guestContext = await browser.newContext();
  const host = await hostContext.newPage(),
    listener = await guestContext.newPage();
  const login = async (page: typeof host, name: string) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Come on in" }).click();
    await page.getByLabel("Your display name").fill(name);
    await page.getByRole("button", { name: "Continue as guest" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  };
  await login(host, "Private browser host");
  await host
    .getByRole("button", { name: "Start a room", exact: true })
    .first()
    .click();
  await host.getByLabel("Room name", { exact: true }).fill("The private club");
  await host.getByRole("button", { name: "Just your people" }).click();
  await host.getByLabel("Room password").fill("browser-password");
  await host.getByRole("button", { name: "Create your room" }).click();
  await expect(
    host.getByRole("heading", { name: "The private club" }),
  ).toBeVisible();
  await login(listener, "Browser listener");
  await listener.goto(host.url());
  await expect(listener.getByLabel("Room password")).toBeVisible();
  await listener.getByLabel("Room password").fill("browser-password");
  await listener.getByRole("button", { name: "Unlock room" }).click();
  await expect(
    listener.getByRole("heading", { name: "The private club" }),
  ).toBeVisible();
  await expect(
    listener.getByRole("button", { name: "Play room" }),
  ).toBeDisabled();
  await host
    .getByLabel("Manage Browser listener")
    .selectOption("member:promote");
  await expect(
    listener.getByRole("button", { name: "Play room" }),
  ).toBeEnabled();
  await host.getByRole("button", { name: "Room settings" }).click();
  await host.getByRole("button", { name: "Leave and close room" }).click();
  await host.getByRole("button", { name: "Yes, close this room" }).click();
  await expect(
    listener.getByText(
      "This room has closed. Find your next listening session.",
    ),
  ).toBeVisible();
  await hostContext.close();
  await guestContext.close();
});
